import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class FreesoundProvider extends BaseProvider {
  name = 'freesound';
  rateLimit = { requests: 2000, window_ms: 86400000 };

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
      page_size: String(Math.min(query.per_page ?? 50, 150)),
      page: String(query.page ?? 1),
    });

    if (query.q) params.set('query', query.q);

    const filters: string[] = [];
    if (query.lat !== undefined && query.lng !== undefined) {
      const radiusDeg = (query.radius_km ?? 100) / 111;
      filters.push(`{!geofilt sfield=geotag pt=${query.lat},${query.lng} d=${radiusDeg.toFixed(2)}}`);
    }
    if (query.license === 'cc0') {
      filters.push('license:"Creative Commons 0"');
    }
    if (filters.length > 0) params.set('filter', filters.join(' '));

    const url = `${this.baseUrl}/search/text/?${params}`;

    // 2026-09-07: a failed Freesound call used to return [] — indistinguishable
    // from "no results", so `providers_failed` stayed empty and the degraded
    // response was CACHED for 24 h (freesound.org's TLS certificate expired
    // 2026-09-07 and every query cached Freesound-less). Let it reject:
    // searchAll records the provider in providers_failed and the router
    // skips caching a degraded result.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`freesound search HTTP ${res.status}`);
    const data = await res.json() as FreesoundSearchResponse;
    return data.results.map((r) => this.normalize(r));
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
    let lat: number | null = null;
    let lng: number | null = null;
    if (r.geotag) {
      const parts = r.geotag.split(' ').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
      }
    }

    return {
      id: this.makeId(r.id),
      title: r.name,
      provider: this.name,
      lat,
      lng,
      duration_sec: r.duration ? Math.floor(r.duration) : null,
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
  geotag: string | null;
  duration: number;
  created: string;
  previews: Record<string, string>;
}
