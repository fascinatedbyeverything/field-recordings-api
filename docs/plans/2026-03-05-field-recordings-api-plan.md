# Field Recordings API — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare Worker REST API that unifies 6 field recording sources (Freesound, Xeno-canto, iNaturalist, GBIF, NPS, Library of Congress) behind a single search/stream endpoint.

**Architecture:** Real-time proxy with R2 metadata caching. Worker fans out queries to provider APIs in parallel, normalizes results into a common schema. Audio is proxied through the Worker (not stored). R2 caches search results by query hash.

**Tech Stack:** TypeScript, Cloudflare Workers, R2, itty-router, Vitest

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts`

**Step 1: Initialize project**

```bash
cd /Users/chrisholmes/Projects/field-recordings-api
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install itty-router
npm install -D typescript wrangler vitest @cloudflare/workers-types
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Step 4: Create wrangler.toml**

```toml
name = "field-recordings-api"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
ENVIRONMENT = "development"

[[r2_buckets]]
binding = "CACHE"
bucket_name = "field-recordings-cache"
```

**Step 5: Create minimal src/index.ts**

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response('Field Recordings API', { status: 200 });
  },
};

export interface Env {
  CACHE: R2Bucket;
  FREESOUND_API_KEY: string;
}
```

**Step 6: Verify it runs**

Run: `npx wrangler dev --local`
Expected: Worker starts, responds with "Field Recordings API" on localhost

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml src/index.ts
git commit -m "feat: scaffold Cloudflare Worker project"
```

---

## Task 2: Types and Provider Interface

**Files:**
- Create: `src/types.ts`
- Create: `src/providers/base.ts`

**Step 1: Write the test**

Create: `test/types.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import type { Recording, UnifiedQuery, Provider } from '../src/types';

describe('Recording type', () => {
  it('should accept a valid recording object', () => {
    const recording: Recording = {
      id: 'freesound:12345',
      title: 'Dawn chorus',
      provider: 'freesound',
      lat: -3.12,
      lng: -60.02,
      duration_sec: 180,
      tags: ['birds', 'rainforest'],
      species: 'mixed',
      license: 'cc0',
      stream_url: '/stream/freesound/12345',
      recorded_at: '2024-03-15T06:00:00Z',
    };
    expect(recording.id).toBe('freesound:12345');
    expect(recording.provider).toBe('freesound');
  });
});

describe('UnifiedQuery type', () => {
  it('should accept a valid query', () => {
    const query: UnifiedQuery = { q: 'birds' };
    expect(query.q).toBe('birds');
  });

  it('should accept geo params', () => {
    const query: UnifiedQuery = { lat: 10, lng: 20, radius_km: 100 };
    expect(query.lat).toBe(10);
  });
});
```

**Step 2: Create src/types.ts**

```typescript
export interface Recording {
  id: string;              // "provider:sourceId"
  title: string;
  provider: string;
  lat: number | null;
  lng: number | null;
  duration_sec: number | null;
  tags: string[];
  species: string | null;
  license: string;
  stream_url: string;
  thumbnail_url?: string;
  recorded_at: string | null;
}

export interface UnifiedQuery {
  q?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  type?: string;           // bird, mammal, insect, weather, etc.
  license?: string;        // cc0, cc-by, cc-by-nc, etc.
  provider?: string;       // filter to single provider
  page?: number;
  per_page?: number;
}

export interface SearchResult {
  recordings: Recording[];
  total: number;
  page: number;
  providers_queried: string[];
  providers_failed: string[];
}

export interface Provider {
  name: string;
  search(query: UnifiedQuery): Promise<Recording[]>;
  getRecording(id: string): Promise<Recording | null>;
  getStreamUrl(id: string): Promise<string | null>;
  rateLimit: { requests: number; window_ms: number };
}

export interface Env {
  CACHE: R2Bucket;
  FREESOUND_API_KEY: string;
}
```

**Step 3: Create src/providers/base.ts**

```typescript
import type { Provider, UnifiedQuery, Recording } from '../types';

export abstract class BaseProvider implements Provider {
  abstract name: string;
  abstract rateLimit: { requests: number; window_ms: number };

  abstract search(query: UnifiedQuery): Promise<Recording[]>;
  abstract getRecording(id: string): Promise<Recording | null>;
  abstract getStreamUrl(id: string): Promise<string | null>;

  protected makeId(sourceId: string | number): string {
    return `${this.name}:${sourceId}`;
  }

  protected makeStreamUrl(sourceId: string | number): string {
    return `/stream/${this.name}/${sourceId}`;
  }
}
```

**Step 4: Add vitest config and run tests**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`

Run: `npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/providers/base.ts test/types.test.ts vitest.config.ts package.json
git commit -m "feat: add Recording/Query types and Provider base class"
```

---

## Task 3: Router Setup

**Files:**
- Create: `src/router.ts`
- Modify: `src/index.ts`

**Step 1: Write the test**

Create: `test/router.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createRouter } from '../src/router';

describe('Router', () => {
  const mockEnv = { CACHE: {} as any, FREESOUND_API_KEY: 'test' };

  it('GET / returns API info', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/'), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Field Recordings API');
  });

  it('GET /providers returns provider list', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/providers'), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /search without params returns 400', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/search'), mockEnv);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/nope'), mockEnv);
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Create src/router.ts**

```typescript
import { AutoRouter, cors, json, error } from 'itty-router';
import type { Env } from './types';

export function createRouter() {
  const { preflight, corsify } = cors();
  const router = AutoRouter({
    before: [preflight],
    after: [corsify],
    catch: () => error(500, 'Internal Server Error'),
  });

  router.get('/', () =>
    json({
      name: 'Field Recordings API',
      version: '0.1.0',
      endpoints: ['/search', '/stream/:provider/:id', '/providers', '/categories'],
    })
  );

  router.get('/providers', () =>
    json([
      { name: 'freesound', description: 'Freesound.org community sounds', has_geo: true },
      { name: 'xenocanto', description: 'Xeno-canto bird recordings', has_geo: true },
      { name: 'inaturalist', description: 'iNaturalist citizen science sounds', has_geo: true },
      { name: 'gbif', description: 'GBIF biodiversity sound records', has_geo: true },
      { name: 'nps', description: 'US National Park Service natural sounds', has_geo: false },
      { name: 'loc', description: 'Library of Congress field recordings', has_geo: false },
    ])
  );

  router.get('/categories', () =>
    json([
      'birds', 'mammals', 'amphibians', 'insects', 'reptiles', 'fish',
      'weather', 'ocean', 'forest', 'urban', 'river', 'desert',
      'cultural', 'folk', 'language',
    ])
  );

  router.get('/search', (request: Request, env: Env) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!q && !lat) {
      return error(400, 'Provide q (search term) or lat/lng (location)');
    }
    // Placeholder — Task 5 wires this up
    return json({ recordings: [], total: 0, page: 1, providers_queried: [], providers_failed: [] });
  });

  router.get('/stream/:provider/:id', (request: Request) => {
    // Placeholder — Task 6 wires this up
    return error(501, 'Not implemented yet');
  });

  router.all('*', () => error(404, 'Not found'));

  return router;
}
```

**Step 3: Update src/index.ts**

```typescript
import { createRouter } from './router';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const router = createRouter();
    return router.fetch(request, env);
  },
};

export type { Env };
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/router.ts src/index.ts test/router.test.ts
git commit -m "feat: add router with search, stream, providers, categories endpoints"
```

---

## Task 4: Xeno-canto Provider (simplest API — no auth)

**Files:**
- Create: `src/providers/xenocanto.ts`
- Create: `test/providers/xenocanto.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XenoCantoProvider } from '../../src/providers/xenocanto';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('XenoCantoProvider', () => {
  const provider = new XenoCantoProvider();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct name', () => {
    expect(provider.name).toBe('xenocanto');
  });

  it('search transforms xeno-canto response to Recording[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        numRecordings: '1',
        numSpecies: '1',
        page: 1,
        numPages: 1,
        recordings: [{
          id: '12345',
          gen: 'Turdus',
          sp: 'merula',
          en: 'Eurasian Blackbird',
          cnt: 'Brazil',
          loc: 'Amazon',
          lat: '-3.12',
          lng: '-60.02',
          type: 'song',
          lic: '//creativecommons.org/licenses/by-nc-sa/4.0/',
          file: 'https://xeno-canto.org/12345/download',
          'file-name': 'XC12345-blackbird.mp3',
          length: '1:30',
          date: '2024-03-15',
          time: '06:00',
        }],
      }),
    });

    const results = await provider.search({ q: 'blackbird' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('xenocanto:12345');
    expect(results[0].provider).toBe('xenocanto');
    expect(results[0].lat).toBe(-3.12);
    expect(results[0].species).toBe('Turdus merula');
    expect(results[0].stream_url).toBe('/stream/xenocanto/12345');
    expect(results[0].license).toBe('cc-by-nc-sa-4.0');
  });

  it('search with geo params builds correct query', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ numRecordings: '0', recordings: [] }),
    });

    await provider.search({ lat: 10, lng: 20 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('lat:10');
    expect(calledUrl).toContain('lon:20');
  });

  it('getStreamUrl returns download URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        recordings: [{ id: '999', file: 'https://xeno-canto.org/999/download' }],
      }),
    });

    const url = await provider.getStreamUrl('999');
    expect(url).toBe('https://xeno-canto.org/999/download');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/providers/xenocanto.test.ts`
Expected: FAIL — module not found

**Step 3: Implement src/providers/xenocanto.ts**

Xeno-canto API: `GET https://xeno-canto.org/api/2/recordings?query={query}`
- No auth required
- Query syntax: species name, `cnt:brazil`, `lat:-3`, `lon:-60`, `type:song`
- Response: `{ numRecordings, recordings: [{ id, gen, sp, en, lat, lng, file, lic, length, date, time, cnt, loc, type }] }`

```typescript
import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class XenoCantoProvider extends BaseProvider {
  name = 'xenocanto';
  rateLimit = { requests: 1000, window_ms: 3600000 }; // 1000/hr

  private baseUrl = 'https://xeno-canto.org/api/2/recordings';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const xcQuery = this.buildQuery(query);
    if (!xcQuery) return [];

    const page = query.page ?? 1;
    const url = `${this.baseUrl}?query=${encodeURIComponent(xcQuery)}&page=${page}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as XenoCantoResponse;
      return data.recordings.map((r) => this.normalize(r));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}?query=nr:${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as XenoCantoResponse;
      if (data.recordings.length === 0) return null;
      return this.normalize(data.recordings[0]);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const url = `${this.baseUrl}?query=nr:${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as XenoCantoResponse;
      if (data.recordings.length === 0) return null;
      return data.recordings[0].file;
    } catch {
      return null;
    }
  }

  private buildQuery(query: UnifiedQuery): string {
    const parts: string[] = [];
    if (query.q) parts.push(query.q);
    if (query.lat !== undefined) parts.push(`lat:${query.lat}`);
    if (query.lng !== undefined) parts.push(`lon:${query.lng}`);
    if (query.type) parts.push(`type:${query.type}`);
    if (query.license === 'cc0') parts.push('lic:PD');
    return parts.join(' ');
  }

  private normalize(r: XenoCantoRecording): Recording {
    return {
      id: this.makeId(r.id),
      title: `${r.en || `${r.gen} ${r.sp}`} — ${r.type || 'call'} (${r.cnt})`,
      provider: this.name,
      lat: r.lat ? parseFloat(r.lat) : null,
      lng: r.lng ? parseFloat(r.lng) : null,
      duration_sec: this.parseDuration(r.length),
      tags: [r.type, r.cnt, r.loc].filter(Boolean) as string[],
      species: r.gen && r.sp ? `${r.gen} ${r.sp}` : null,
      license: this.parseLicense(r.lic),
      stream_url: this.makeStreamUrl(r.id),
      recorded_at: r.date || null,
    };
  }

  private parseDuration(length: string): number | null {
    if (!length) return null;
    const parts = length.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  private parseLicense(lic: string): string {
    if (!lic) return 'unknown';
    if (lic.includes('publicdomain') || lic.includes('/zero/')) return 'cc0';
    const match = lic.match(/licenses\/([\w-]+)\/([\d.]+)/);
    if (match) return `cc-${match[1]}-${match[2]}`;
    return 'unknown';
  }
}

interface XenoCantoResponse {
  numRecordings: string;
  numSpecies?: string;
  page?: number;
  numPages?: number;
  recordings: XenoCantoRecording[];
}

interface XenoCantoRecording {
  id: string;
  gen: string;
  sp: string;
  en: string;
  cnt: string;
  loc: string;
  lat: string;
  lng: string;
  type: string;
  lic: string;
  file: string;
  'file-name': string;
  length: string;
  date: string;
  time: string;
}
```

**Step 4: Run tests**

Run: `npx vitest run test/providers/xenocanto.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/xenocanto.ts test/providers/xenocanto.test.ts
git commit -m "feat: add Xeno-canto provider adapter"
```

---

## Task 5: Freesound Provider (API key auth)

**Files:**
- Create: `src/providers/freesound.ts`
- Create: `test/providers/freesound.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreesoundProvider } from '../../src/providers/freesound';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('FreesoundProvider', () => {
  const provider = new FreesoundProvider('test-api-key');

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('freesound');
  });

  it('search includes API key in request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });

    await provider.search({ q: 'rain' });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('token=test-api-key');
  });

  it('search transforms freesound response to Recording[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{
          id: 42,
          name: 'Rain on roof',
          tags: ['rain', 'weather', 'field-recording'],
          license: 'https://creativecommons.org/publicdomain/zero/1.0/',
          geotag: { lat: 51.5, lon: -0.12 },
          duration: 120.5,
          created: '2024-01-15T10:30:00',
          previews: { 'preview-hq-mp3': 'https://freesound.org/data/previews/42/42-hq.mp3' },
        }],
      }),
    });

    const results = await provider.search({ q: 'rain' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('freesound:42');
    expect(results[0].lat).toBe(51.5);
    expect(results[0].lng).toBe(-0.12);
    expect(results[0].license).toBe('cc0');
    expect(results[0].duration_sec).toBe(120);
  });

  it('search with geo params uses filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });

    await provider.search({ lat: 40, lng: -74, radius_km: 50 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('filter=geotag');
  });
});
```

**Step 2: Run test to verify fail**

Run: `npx vitest run test/providers/freesound.test.ts`
Expected: FAIL

**Step 3: Implement src/providers/freesound.ts**

Freesound API v2: `GET https://freesound.org/apiv2/search/text/?query={q}&token={key}`
- Auth: `token` query param or `Authorization: Token {key}` header
- Geo filter: `filter=geotag:"Intersects(-74.0 40.0 50.0)"` (lng lat radius_deg)
- License filter: `filter=license:"Creative Commons 0"`
- Fields: `fields=id,name,tags,license,geotag,duration,created,previews`
- Response: `{ count, results: [{ id, name, tags, license, geotag: {lat,lon}, duration, previews }] }`

```typescript
import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class FreesoundProvider extends BaseProvider {
  name = 'freesound';
  rateLimit = { requests: 2000, window_ms: 86400000 }; // generous daily

  private baseUrl = 'https://freesound.org/apiv2';
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      token: this.apiKey,
      fields: 'id,name,tags,license,geotag,duration,created,previews',
      page_size: String(query.per_page ?? 20),
      page: String(query.page ?? 1),
    });

    if (query.q) params.set('query', query.q);

    const filters: string[] = [];
    if (query.lat !== undefined && query.lng !== undefined) {
      const radiusDeg = (query.radius_km ?? 100) / 111;
      filters.push(`geotag:"Intersects(${query.lng} ${query.lat} ${radiusDeg.toFixed(2)})"`);
    }
    if (query.license === 'cc0') {
      filters.push('license:"Creative Commons 0"');
    }
    if (filters.length > 0) params.set('filter', filters.join(' '));

    const url = `${this.baseUrl}/search/text/?${params}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as FreesoundSearchResponse;
      return data.results.map((r) => this.normalize(r));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}/sounds/${id}/?token=${this.apiKey}&fields=id,name,tags,license,geotag,duration,created,previews`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const r = await res.json() as FreesoundSound;
      return this.normalize(r);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const url = `${this.baseUrl}/sounds/${id}/?token=${this.apiKey}&fields=previews`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const r = await res.json() as FreesoundSound;
      return r.previews?.['preview-hq-mp3'] ?? null;
    } catch {
      return null;
    }
  }

  private normalize(r: FreesoundSound): Recording {
    return {
      id: this.makeId(r.id),
      title: r.name,
      provider: this.name,
      lat: r.geotag?.lat ?? null,
      lng: r.geotag?.lon ?? null,
      duration_sec: r.duration ? Math.round(r.duration) : null,
      tags: r.tags ?? [],
      species: null,
      license: this.parseLicense(r.license),
      stream_url: this.makeStreamUrl(r.id),
      recorded_at: r.created ?? null,
    };
  }

  private parseLicense(lic: string): string {
    if (!lic) return 'unknown';
    if (lic.includes('zero') || lic.includes('publicdomain')) return 'cc0';
    if (lic.includes('by-nc')) return 'cc-by-nc';
    if (lic.includes('/by/')) return 'cc-by';
    return 'unknown';
  }
}

interface FreesoundSearchResponse {
  count: number;
  results: FreesoundSound[];
}

interface FreesoundSound {
  id: number;
  name: string;
  tags: string[];
  license: string;
  geotag: { lat: number; lon: number } | null;
  duration: number;
  created: string;
  previews: Record<string, string>;
}
```

**Step 4: Run tests**

Run: `npx vitest run test/providers/freesound.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/freesound.ts test/providers/freesound.test.ts
git commit -m "feat: add Freesound provider adapter with API key auth"
```

---

## Task 6: iNaturalist Provider

**Files:**
- Create: `src/providers/inaturalist.ts`
- Create: `test/providers/inaturalist.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INaturalistProvider } from '../../src/providers/inaturalist';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('INaturalistProvider', () => {
  const provider = new INaturalistProvider();

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('inaturalist');
  });

  it('search adds sounds=true and transforms response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_results: 1,
        results: [{
          id: 999,
          species_guess: 'American Robin',
          observed_on: '2024-06-15',
          location: '40.7,-74.0',
          license_code: 'cc-by-nc',
          taxon: { name: 'Turdus migratorius', preferred_common_name: 'American Robin' },
          sounds: [{
            id: 5555,
            file_url: 'https://static.inaturalist.org/sounds/5555.m4a',
            license_code: 'cc-by-nc',
            file_content_type: 'audio/mp4',
          }],
          tags: [],
        }],
      }),
    });

    const results = await provider.search({ q: 'robin' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('inaturalist:999');
    expect(results[0].species).toBe('Turdus migratorius');
    expect(results[0].lat).toBe(40.7);
    expect(results[0].lng).toBe(-74.0);
  });

  it('search filters by bounding box when lat/lng provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_results: 0, results: [] }),
    });

    await provider.search({ lat: 40, lng: -74, radius_km: 50 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('lat=40');
    expect(calledUrl).toContain('lng=-74');
    expect(calledUrl).toContain('radius=50');
  });
});
```

**Step 2: Run test to verify fail**

Run: `npx vitest run test/providers/inaturalist.test.ts`
Expected: FAIL

**Step 3: Implement src/providers/inaturalist.ts**

iNaturalist API: `GET https://api.inaturalist.org/v1/observations?sounds=true&q={q}`
- No auth. Rate limit ~100 req/min.
- Geo: `lat=X&lng=Y&radius=Z` (km)
- License filter: `license=cc0` or `license=cc-by`
- Sound object: `{ id, file_url, license_code, file_content_type }`
- Location is a string `"lat,lng"` — needs parsing.

```typescript
import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class INaturalistProvider extends BaseProvider {
  name = 'inaturalist';
  rateLimit = { requests: 100, window_ms: 60000 }; // 100/min

  private baseUrl = 'https://api.inaturalist.org/v1/observations';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      sounds: 'true',
      per_page: String(query.per_page ?? 20),
      page: String(query.page ?? 1),
      order_by: 'id',
      order: 'desc',
    });

    if (query.q) params.set('q', query.q);
    if (query.type) params.set('iconic_taxa', this.mapType(query.type));
    if (query.lat !== undefined) params.set('lat', String(query.lat));
    if (query.lng !== undefined) params.set('lng', String(query.lng));
    if (query.radius_km !== undefined) params.set('radius', String(query.radius_km));
    if (query.license) params.set('license', query.license);

    const url = `${this.baseUrl}?${params}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as INatResponse;
      return data.results
        .filter((obs) => obs.sounds && obs.sounds.length > 0)
        .map((obs) => this.normalize(obs));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as INatResponse;
      if (data.results.length === 0) return null;
      return this.normalize(data.results[0]);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const obs = await this.getRecording(id);
    if (!obs) return null;
    // The stream_url stored in the recording is our proxy URL.
    // We need the actual source URL. Re-fetch from API.
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as INatResponse;
      const sounds = data.results[0]?.sounds;
      return sounds?.[0]?.file_url ?? null;
    } catch {
      return null;
    }
  }

  private normalize(obs: INatObservation): Recording {
    const [lat, lng] = obs.location ? obs.location.split(',').map(Number) : [null, null];
    const sound = obs.sounds[0];

    return {
      id: this.makeId(obs.id),
      title: obs.taxon?.preferred_common_name || obs.species_guess || 'Unknown species',
      provider: this.name,
      lat: lat ?? null,
      lng: lng ?? null,
      duration_sec: null, // iNat doesn't provide duration in API
      tags: obs.tags?.map((t: any) => typeof t === 'string' ? t : t.name).filter(Boolean) ?? [],
      species: obs.taxon?.name ?? null,
      license: sound?.license_code ?? obs.license_code ?? 'unknown',
      stream_url: this.makeStreamUrl(obs.id),
      recorded_at: obs.observed_on ?? null,
    };
  }

  private mapType(type: string): string {
    const map: Record<string, string> = {
      bird: 'Aves', mammal: 'Mammalia', amphibian: 'Amphibia',
      reptile: 'Reptilia', insect: 'Insecta', fish: 'Actinopterygii',
    };
    return map[type.toLowerCase()] ?? '';
  }
}

interface INatResponse {
  total_results: number;
  results: INatObservation[];
}

interface INatObservation {
  id: number;
  species_guess: string;
  observed_on: string;
  location: string;
  license_code: string;
  taxon: { name: string; preferred_common_name: string } | null;
  sounds: { id: number; file_url: string; license_code: string; file_content_type: string }[];
  tags: any[];
}
```

**Step 4: Run tests**

Run: `npx vitest run test/providers/inaturalist.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/inaturalist.ts test/providers/inaturalist.test.ts
git commit -m "feat: add iNaturalist provider adapter"
```

---

## Task 7: Search Orchestrator (fan-out + merge)

**Files:**
- Create: `src/search.ts`
- Create: `test/search.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { searchAll } from '../src/search';
import type { Provider, Recording, UnifiedQuery } from '../src/types';

function mockProvider(name: string, results: Recording[]): Provider {
  return {
    name,
    rateLimit: { requests: 100, window_ms: 60000 },
    search: vi.fn().mockResolvedValue(results),
    getRecording: vi.fn(),
    getStreamUrl: vi.fn(),
  };
}

function makeRecording(provider: string, id: string): Recording {
  return {
    id: `${provider}:${id}`, title: 'Test', provider, lat: 0, lng: 0,
    duration_sec: 60, tags: ['test'], species: null, license: 'cc0',
    stream_url: `/stream/${provider}/${id}`, recorded_at: null,
  };
}

describe('searchAll', () => {
  it('fans out to all providers and merges results', async () => {
    const providers = [
      mockProvider('a', [makeRecording('a', '1')]),
      mockProvider('b', [makeRecording('b', '2'), makeRecording('b', '3')]),
    ];

    const result = await searchAll(providers, { q: 'test' });
    expect(result.recordings).toHaveLength(3);
    expect(result.providers_queried).toEqual(['a', 'b']);
    expect(result.providers_failed).toEqual([]);
  });

  it('handles provider failures gracefully', async () => {
    const failing: Provider = {
      name: 'bad',
      rateLimit: { requests: 100, window_ms: 60000 },
      search: vi.fn().mockRejectedValue(new Error('fail')),
      getRecording: vi.fn(),
      getStreamUrl: vi.fn(),
    };
    const good = mockProvider('good', [makeRecording('good', '1')]);

    const result = await searchAll([failing, good], { q: 'test' });
    expect(result.recordings).toHaveLength(1);
    expect(result.providers_failed).toEqual(['bad']);
  });

  it('filters by provider when specified', async () => {
    const a = mockProvider('a', [makeRecording('a', '1')]);
    const b = mockProvider('b', [makeRecording('b', '2')]);

    const result = await searchAll([a, b], { q: 'test', provider: 'a' });
    expect(result.recordings).toHaveLength(1);
    expect(b.search).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify fail**

Run: `npx vitest run test/search.test.ts`
Expected: FAIL

**Step 3: Implement src/search.ts**

```typescript
import type { Provider, UnifiedQuery, SearchResult } from './types';

export async function searchAll(
  providers: Provider[],
  query: UnifiedQuery,
): Promise<SearchResult> {
  const targetProviders = query.provider
    ? providers.filter((p) => p.name === query.provider)
    : providers;

  const results = await Promise.allSettled(
    targetProviders.map((p) => p.search(query)),
  );

  const recordings = [];
  const queried: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const providerName = targetProviders[i].name;
    queried.push(providerName);

    if (result.status === 'fulfilled') {
      recordings.push(...result.value);
    } else {
      failed.push(providerName);
    }
  }

  return {
    recordings,
    total: recordings.length,
    page: query.page ?? 1,
    providers_queried: queried,
    providers_failed: failed,
  };
}
```

**Step 4: Run tests**

Run: `npx vitest run test/search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/search.ts test/search.test.ts
git commit -m "feat: add search orchestrator with parallel fan-out"
```

---

## Task 8: Audio Stream Proxy

**Files:**
- Create: `src/stream.ts`
- Create: `test/stream.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamRecording } from '../src/stream';
import type { Provider } from '../src/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('streamRecording', () => {
  const mockProvider: Provider = {
    name: 'test',
    rateLimit: { requests: 100, window_ms: 60000 },
    search: vi.fn(),
    getRecording: vi.fn(),
    getStreamUrl: vi.fn().mockResolvedValue('https://example.com/audio.mp3'),
  };

  beforeEach(() => vi.clearAllMocks());

  it('proxies audio with correct content-type', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('audio-data', {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '1000' },
      }),
    );

    const res = await streamRecording(mockProvider, '123', null);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('passes Range header for seeking', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('partial', {
        status: 206,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-499/1000' },
      }),
    );

    await streamRecording(mockProvider, '123', 'bytes=0-499');
    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['Range']).toBe('bytes=0-499');
  });

  it('returns 404 if provider has no stream URL', async () => {
    const noUrl: Provider = {
      ...mockProvider,
      getStreamUrl: vi.fn().mockResolvedValue(null),
    };

    const res = await streamRecording(noUrl, '123', null);
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify fail, then implement**

**Step 3: Implement src/stream.ts**

```typescript
import type { Provider } from './types';

export async function streamRecording(
  provider: Provider,
  id: string,
  rangeHeader: string | null,
): Promise<Response> {
  const url = await provider.getStreamUrl(id);
  if (!url) {
    return new Response(JSON.stringify({ error: 'Recording not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers: Record<string, string> = {};
  if (rangeHeader) headers['Range'] = rangeHeader;

  try {
    const upstream = await fetch(url, { headers });

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);

    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    const acceptRanges = upstream.headers.get('Accept-Ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run test/stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stream.ts test/stream.test.ts
git commit -m "feat: add audio stream proxy with Range header support"
```

---

## Task 9: R2 Cache Layer

**Files:**
- Create: `src/cache.ts`
- Create: `test/cache.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheLayer } from '../src/cache';

function mockR2(): any {
  const store = new Map<string, { body: string; customMetadata: Record<string, string> }>();
  return {
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return { json: async () => JSON.parse(item.body), customMetadata: item.customMetadata };
    }),
    put: vi.fn(async (key: string, body: string, opts: any) => {
      store.set(key, { body, customMetadata: opts?.customMetadata ?? {} });
    }),
  };
}

describe('CacheLayer', () => {
  it('returns null on cache miss', async () => {
    const r2 = mockR2();
    r2.get.mockResolvedValueOnce(null);
    const cache = new CacheLayer(r2);
    const result = await cache.getSearch('test-hash');
    expect(result).toBeNull();
  });

  it('returns cached data when fresh', async () => {
    const r2 = mockR2();
    const cache = new CacheLayer(r2);
    const data = { recordings: [], total: 0, page: 1, providers_queried: [], providers_failed: [] };
    await cache.putSearch('test-hash', data);
    const result = await cache.getSearch('test-hash');
    expect(result).toEqual(data);
  });

  it('returns null when expired', async () => {
    const r2 = mockR2();
    const cache = new CacheLayer(r2);
    // Store with old timestamp
    const data = { recordings: [], total: 0 };
    const oldTime = String(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    await r2.put('search/test-hash', JSON.stringify(data), {
      customMetadata: { expires: oldTime },
    });
    const result = await cache.getSearch('test-hash');
    expect(result).toBeNull();
  });
});
```

**Step 2: Implement src/cache.ts**

```typescript
import type { SearchResult } from './types';

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class CacheLayer {
  private r2: R2Bucket;

  constructor(r2: R2Bucket) {
    this.r2 = r2;
  }

  async getSearch(queryHash: string): Promise<SearchResult | null> {
    try {
      const obj = await this.r2.get(`search/${queryHash}`);
      if (!obj) return null;

      const expires = Number(obj.customMetadata?.expires ?? 0);
      if (Date.now() > expires) return null;

      return await obj.json<SearchResult>();
    } catch {
      return null;
    }
  }

  async putSearch(queryHash: string, data: SearchResult): Promise<void> {
    try {
      await this.r2.put(`search/${queryHash}`, JSON.stringify(data), {
        customMetadata: { expires: String(Date.now() + SEARCH_TTL_MS) },
      });
    } catch {
      // Cache write failure is non-fatal
    }
  }

  hashQuery(params: Record<string, string>): string {
    const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    // Simple FNV-1a hash — no crypto needed for cache keys
    let hash = 2166136261;
    for (let i = 0; i < sorted.length; i++) {
      hash ^= sorted.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
  }
}
```

**Step 3: Run tests**

Run: `npx vitest run test/cache.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cache.ts test/cache.test.ts
git commit -m "feat: add R2 cache layer for search results"
```

---

## Task 10: Wire Everything Together

**Files:**
- Modify: `src/router.ts`
- Modify: `src/index.ts`
- Create: `test/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external fetches
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocking
import { createRouter } from '../src/router';
import { createProviders } from '../src/index';

describe('Integration', () => {
  const mockEnv = {
    CACHE: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
    } as any,
    FREESOUND_API_KEY: 'test-key',
  };

  beforeEach(() => vi.clearAllMocks());

  it('GET /search fans out to providers and returns unified results', async () => {
    // Mock xeno-canto response
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('xeno-canto')) {
        return {
          ok: true,
          json: async () => ({
            numRecordings: '1',
            recordings: [{
              id: '100', gen: 'Turdus', sp: 'merula', en: 'Blackbird',
              cnt: 'UK', loc: 'London', lat: '51.5', lng: '-0.12',
              type: 'song', lic: '//creativecommons.org/licenses/by/4.0/',
              file: 'https://xeno-canto.org/100/download',
              'file-name': 'XC100.mp3', length: '0:30', date: '2024-01-01', time: '06:00',
            }],
          }),
        };
      }
      // Other providers return empty
      return { ok: true, json: async () => ({ count: 0, results: [], total_results: 0 }) };
    });

    const router = createRouter(mockEnv);
    const res = await router.fetch(new Request('http://localhost/search?q=blackbird'), mockEnv);
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.recordings.length).toBeGreaterThan(0);
    expect(body.providers_queried.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Update src/index.ts to wire providers**

```typescript
import { createRouter } from './router';
import type { Env } from './types';
import { FreesoundProvider } from './providers/freesound';
import { XenoCantoProvider } from './providers/xenocanto';
import { INaturalistProvider } from './providers/inaturalist';

export function createProviders(env: Env) {
  return [
    new XenoCantoProvider(),
    new FreesoundProvider(env.FREESOUND_API_KEY),
    new INaturalistProvider(),
  ];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const router = createRouter(env);
    return router.fetch(request, env);
  },
};

export type { Env };
```

**Step 3: Update src/router.ts to use search orchestrator and stream proxy**

Update the `/search` handler to call `searchAll` with real providers. Update `/stream/:provider/:id` to call `streamRecording`. Pass `env` into `createRouter` so it can instantiate providers and cache.

```typescript
import { AutoRouter, cors, json, error } from 'itty-router';
import type { Env, Provider } from './types';
import { FreesoundProvider } from './providers/freesound';
import { XenoCantoProvider } from './providers/xenocanto';
import { INaturalistProvider } from './providers/inaturalist';
import { searchAll } from './search';
import { streamRecording } from './stream';
import { CacheLayer } from './cache';

export function createRouter(env: Env) {
  const { preflight, corsify } = cors();
  const router = AutoRouter({
    before: [preflight],
    after: [corsify],
    catch: () => error(500, 'Internal Server Error'),
  });

  const providers: Provider[] = [
    new XenoCantoProvider(),
    new FreesoundProvider(env.FREESOUND_API_KEY),
    new INaturalistProvider(),
  ];

  const cache = new CacheLayer(env.CACHE);

  router.get('/', () =>
    json({
      name: 'Field Recordings API',
      version: '0.1.0',
      endpoints: ['/search', '/stream/:provider/:id', '/providers', '/categories'],
    })
  );

  router.get('/providers', () =>
    json(providers.map((p) => ({ name: p.name })))
  );

  router.get('/categories', () =>
    json([
      'birds', 'mammals', 'amphibians', 'insects', 'reptiles', 'fish',
      'weather', 'ocean', 'forest', 'urban', 'river', 'desert',
      'cultural', 'folk', 'language',
    ])
  );

  router.get('/search', async (request: Request) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');
    if (!q && !lat) {
      return error(400, 'Provide q (search term) or lat/lng (location)');
    }

    const queryParams: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { queryParams[k] = v; });
    const queryHash = cache.hashQuery(queryParams);

    // Check cache
    const cached = await cache.getSearch(queryHash);
    if (cached) return json(cached);

    const query = {
      q: q ?? undefined,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
      radius_km: url.searchParams.has('radius') ? Number(url.searchParams.get('radius')) : undefined,
      type: url.searchParams.get('type') ?? undefined,
      license: url.searchParams.get('license') ?? undefined,
      provider: url.searchParams.get('provider') ?? undefined,
      page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
      per_page: url.searchParams.has('per_page') ? Number(url.searchParams.get('per_page')) : undefined,
    };

    const result = await searchAll(providers, query);

    // Cache async — don't block response
    cache.putSearch(queryHash, result);

    return json(result);
  });

  router.get('/stream/:provider/:id', async (request: Request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const providerName = parts[2];
    const id = parts[3];

    const provider = providers.find((p) => p.name === providerName);
    if (!provider) return error(404, `Unknown provider: ${providerName}`);

    const rangeHeader = request.headers.get('Range');
    return streamRecording(provider, id, rangeHeader);
  });

  router.all('*', () => error(404, 'Not found'));

  return router;
}
```

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

**Step 5: Test locally with wrangler**

Run: `npx wrangler dev --local`
Test: `curl http://localhost:8787/search?q=birds`
Expected: JSON response with recordings from xeno-canto, freesound (if API key set), iNaturalist

**Step 6: Commit**

```bash
git add src/index.ts src/router.ts test/integration.test.ts
git commit -m "feat: wire search orchestrator, stream proxy, and cache together"
```

---

## Task 11: GBIF Provider

**Files:**
- Create: `src/providers/gbif.ts`
- Create: `test/providers/gbif.test.ts`

GBIF API: `GET https://api.gbif.org/v1/occurrence/search?mediaType=Sound&q={q}`
- No auth for search. Geo: `decimalLatitude=X&decimalLongitude=Y` with range filters.
- Response includes `media` array with `identifier` (URL to audio).
- Use to fill gaps — not primary source to avoid Xeno-canto/iNat duplicates.
- Register providers in router and index.ts after implementation.

Follow same TDD pattern: test → fail → implement → pass → commit.

```bash
git commit -m "feat: add GBIF provider adapter"
```

---

## Task 12: NPS Provider (static scrape → R2)

**Files:**
- Create: `src/providers/nps.ts`
- Create: `test/providers/nps.test.ts`
- Create: `scripts/scrape-nps.ts` (one-time scrape script)

NPS has no API. Strategy:
1. Write a one-time scrape script that downloads the NPS sound gallery page, extracts audio URLs, downloads audio files to R2.
2. NPS provider reads from R2 bucket, serving pre-scraped public domain audio.

The provider `search` method will fetch a cached JSON index from R2 (`nps/index.json`) and filter locally. The `getStreamUrl` returns an R2 key.

Follow same TDD pattern. Commit: `feat: add NPS provider with R2-backed static content`

---

## Task 13: Library of Congress Provider

**Files:**
- Create: `src/providers/loc.ts`
- Create: `test/providers/loc.test.ts`

LOC API: `GET https://www.loc.gov/audio/?q={query}&fo=json`
- No auth. Response includes `results` with `id`, `title`, `description`, `date`, `url` (link to item page).
- Audio streaming URLs are on individual item pages — need to fetch item detail for actual audio.
- Focus on the American Folklife Center / field recording collections.

Follow same TDD pattern. Commit: `feat: add Library of Congress provider adapter`

---

## Task 14: Deploy to Cloudflare

**Step 1: Create R2 bucket**

```bash
npx wrangler r2 bucket create field-recordings-cache
```

**Step 2: Set Freesound API key secret**

```bash
npx wrangler secret put FREESOUND_API_KEY
# Paste API key when prompted
```

**Step 3: Deploy**

```bash
npx wrangler deploy
```

**Step 4: Test production endpoints**

```bash
curl https://field-recordings-api.<your-subdomain>.workers.dev/search?q=birds
curl https://field-recordings-api.<your-subdomain>.workers.dev/providers
```

**Step 5: Commit wrangler config if needed**

```bash
git commit -m "chore: configure production deployment"
```

---

## Task Summary

| # | Task | Key Files | Estimated Effort |
|---|------|-----------|-----------------|
| 1 | Project scaffolding | wrangler.toml, package.json, index.ts | Quick |
| 2 | Types + Provider interface | types.ts, providers/base.ts | Quick |
| 3 | Router setup | router.ts | Quick |
| 4 | Xeno-canto provider | providers/xenocanto.ts | Medium |
| 5 | Freesound provider | providers/freesound.ts | Medium |
| 6 | iNaturalist provider | providers/inaturalist.ts | Medium |
| 7 | Search orchestrator | search.ts | Quick |
| 8 | Stream proxy | stream.ts | Quick |
| 9 | R2 cache layer | cache.ts | Quick |
| 10 | Wire everything together | router.ts, index.ts | Medium |
| 11 | GBIF provider | providers/gbif.ts | Medium |
| 12 | NPS provider (scrape) | providers/nps.ts, scripts/ | Medium |
| 13 | LOC provider | providers/loc.ts | Medium |
| 14 | Deploy to Cloudflare | wrangler config | Quick |
