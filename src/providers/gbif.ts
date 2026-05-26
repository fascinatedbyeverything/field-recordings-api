import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class GBIFProvider extends BaseProvider {
  name = 'gbif';
  rateLimit = { requests: 3000, window_ms: 60000 };

  private baseUrl = 'https://api.gbif.org/v1/occurrence';

  // 2026-05-25: per-query taxonKey cache. resolveTaxon makes an extra HTTP
  // round-trip to GBIF's species/search endpoint, and fetchAllPages was
  // calling search() once per page — so we'd re-resolve the same taxon up
  // to 10 times per user query, with each call adding failure surface. Now
  // resolved once on page 1, reused on subsequent pages.
  private taxonCache = new Map<string, number | null>();

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      mediaType: 'Sound',
      limit: String(Math.min(query.per_page ?? 300, 300)),
      offset: String(((query.page ?? 1) - 1) * (query.per_page ?? 300)),
    });

    if (query.q) {
      const cacheKey = query.q.toLowerCase().trim();
      let taxonKey: number | null;
      if (this.taxonCache.has(cacheKey)) {
        taxonKey = this.taxonCache.get(cacheKey)!;
      } else {
        taxonKey = await this.resolveTaxon(query.q);
        this.taxonCache.set(cacheKey, taxonKey);
      }

      if (taxonKey) {
        // Use precise taxon match — returns only that species' occurrences.
        params.set('taxonKey', String(taxonKey));
      } else {
        // 2026-05-25: NO fallback to free-text q=. GBIF's free-text matches
        // any field (locality, scientific name fragment, etc.) and returns
        // hundreds of irrelevant species observed in regions matching the
        // query tokens. E.g. "BENGAL TIGER" with q= surfaces Cuculus
        // sparverioides (observed in Bengal region) + Lanius tigrinus (Tiger
        // Shrike — different bird that just shares the "tigr" stem). Better
        // to return empty than to flood with wrong-species noise.
        return [];
      }
    }

    if (query.lat !== undefined && query.lng !== undefined) {
      const radius = query.radius_km ?? 50;
      const latDelta = radius / 111;
      const lngDelta = radius / (111 * Math.cos((query.lat * Math.PI) / 180));
      params.set('decimalLatitude', `${query.lat - latDelta},${query.lat + latDelta}`);
      params.set('decimalLongitude', `${query.lng - lngDelta},${query.lng + lngDelta}`);
    }

    const url = `${this.baseUrl}/search?${params}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as GBIFResponse;
      return data.results
        .filter((r) => r.media?.some((m) => m.type === 'Sound'))
        .map((r) => this.normalize(r));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as GBIFOccurrence;
      if (!data.key) return null;
      return this.normalize(data);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as GBIFOccurrence;
      const sound = data.media?.find((m) => m.type === 'Sound');
      return sound?.identifier ?? null;
    } catch {
      return null;
    }
  }

  private normalize(r: GBIFOccurrence): Recording {
    const sound = r.media?.find((m) => m.type === 'Sound');

    return {
      id: this.makeId(r.key),
      title: r.species ?? r.genericName ?? 'Unknown species',
      provider: this.name,
      lat: r.decimalLatitude ?? null,
      lng: r.decimalLongitude ?? null,
      duration_sec: null,
      tags: [r.basisOfRecord, r.country].filter(Boolean) as string[],
      species: r.species ?? null,
      license: this.normalizeLicense(r.license),
      stream_url: this.makeStreamUrl(r.key),
      recorded_at: r.eventDate ?? null,
    };
  }

  private async resolveTaxon(q: string): Promise<number | null> {
    try {
      // Try vernacular (common) names first, then scientific
      for (const qField of ['VERNACULAR', 'SCIENTIFIC']) {
        const res = await fetch(
          `https://api.gbif.org/v1/species/search?q=${encodeURIComponent(q)}&qField=${qField}&limit=5`,
        );
        if (!res.ok) continue;
        const data = await res.json() as { results: { nubKey?: number; key?: number; rank?: string }[] };
        const match = data.results.find((r) =>
          (r.nubKey || r.key) && ['SPECIES', 'GENUS', 'ORDER', 'FAMILY'].includes(r.rank ?? ''),
        );
        if (match) return match.nubKey ?? match.key ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private normalizeLicense(license: string | undefined): string {
    if (!license) return 'unknown';
    const map: Record<string, string> = {
      'CC_BY_4_0': 'cc-by-4.0',
      'CC_BY_NC_4_0': 'cc-by-nc-4.0',
      'CC0_1_0': 'cc0',
      'CC_BY_SA_4_0': 'cc-by-sa-4.0',
      'CC_BY_NC_SA_4_0': 'cc-by-nc-sa-4.0',
      'CC_BY_NC_ND_4_0': 'cc-by-nc-nd-4.0',
      'CC_BY_ND_4_0': 'cc-by-nd-4.0',
    };
    if (map[license]) return map[license];
    // Fallback: lowercase, replace underscores, strip trailing _0 version style
    return license.toLowerCase().replace(/_/g, '-').replace(/-(\d+)-(\d+)$/, '-$1.$2');
  }
}

interface GBIFResponse {
  offset: number;
  limit: number;
  count: number;
  results: GBIFOccurrence[];
}

interface GBIFOccurrence {
  key: number;
  species?: string;
  genericName?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  eventDate?: string;
  license?: string;
  basisOfRecord?: string;
  country?: string;
  media?: GBIFMedia[];
}

interface GBIFMedia {
  type: string;
  identifier: string;
  format?: string;
}
