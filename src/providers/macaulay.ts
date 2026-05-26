import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class MacaulayProvider extends BaseProvider {
  name = 'macaulay';
  rateLimit = { requests: 100, window_ms: 60000 };

  // 2026-05-25: was hitting ebird.org/media/catalog.json which 302's to
  // an endpoint that's since returned 404. Cornell's working public search
  // endpoint is /api/v1/search at search.macaulaylibrary.org. The /api/v2
  // variant returns 403 without auth.
  private baseUrl = 'https://search.macaulaylibrary.org/api/v1/search';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    // 2026-05-25: Macaulay's public /api/v1/search IGNORES q=, commonName=,
    // species= and similar free-text params — it only filters by taxonCode
    // (which requires auth to resolve from a string). Without a taxonCode
    // it returns ~20 random birds regardless of input, polluting every
    // free-text search with irrelevant entries. So we ONLY hit Macaulay
    // when caller provides a geographic filter OR when q is empty (catalog
    // browse mode); free-text queries get [] back. Cornell's audio catalog
    // is birds-only anyway — "bengal tiger" should never hit it.
    if (query.q && (query.lat === undefined || query.lng === undefined)) {
      return [];
    }

    const params = new URLSearchParams({
      mediaType: 'audio',
      sort: 'rating_rank_desc',
      count: String(query.per_page ?? 200),
      offset: String(((query.page ?? 1) - 1) * (query.per_page ?? 200)),
    });

    if (query.lat !== undefined && query.lng !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lng', String(query.lng));
      params.set('dist', String(query.radius_km ?? 100));
    }

    try {
      const res = await fetch(`${this.baseUrl}?${params}`, {
        headers: {
          'User-Agent': 'FieldRecordingsAPI/1.0',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) return [];
      const data = await res.json() as MacaulayResponse;
      return (data.results?.content || []).map((r) => this.normalize(r));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    try {
      const res = await fetch(`https://ebird.org/media/catalog.json?assetId=${id}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as MacaulayResponse;
      const r = data.results?.content?.[0];
      return r ? this.normalize(r) : null;
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    return `https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${id}/audio`;
  }

  private normalize(r: MacaulayAsset): Recording {
    return {
      id: this.makeId(r.assetId ?? r.catalogId),
      title: r.commonName
        ? `${r.commonName}${r.location ? ` - ${r.location}` : ''}`
        : r.sciName || 'Unknown',
      provider: this.name,
      lat: r.latitude ?? null,
      lng: r.longitude ?? null,
      duration_sec: r.mediaDuration ? Math.floor(r.mediaDuration) : null,
      tags: this.buildTags(r),
      species: r.sciName || null,
      license: 'macaulay',
      stream_url: this.makeStreamUrl(r.assetId ?? r.catalogId),
      // 2026-05-25: v1 API uses obsDttm; older code used obsDt (v2 shape)
      recorded_at: r.obsDttm ?? r.obsDt ?? null,
    };
  }

  private buildTags(r: MacaulayAsset): string[] {
    const tags: string[] = [];
    if (r.commonName) tags.push(r.commonName);
    if (r.familyName) tags.push(r.familyName);
    if (r.behaviors) tags.push(...r.behaviors);
    if (r.location) tags.push(r.location);
    return tags;
  }
}

interface MacaulayResponse {
  results: { content: MacaulayAsset[] };
}

interface MacaulayAsset {
  // v1 uses catalogId; old v2 used assetId. Accept either.
  assetId?: number;
  catalogId?: number;
  commonName: string;
  sciName: string;
  familyName: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  mediaDuration: number | null;
  obsDt?: string | null;
  obsDttm?: string | null;
  behaviors: string[];
}
