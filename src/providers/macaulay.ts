import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class MacaulayProvider extends BaseProvider {
  name = 'macaulay';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://ebird.org/media/catalog.json';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      mediaType: 'audio',
      sort: 'rating_rank_desc',
      count: String(query.per_page ?? 200),
      offset: String(((query.page ?? 1) - 1) * (query.per_page ?? 200)),
    });

    if (query.q) params.set('q', query.q);
    if (query.lat !== undefined && query.lng !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lng', String(query.lng));
      params.set('dist', String(query.radius_km ?? 100));
    }

    try {
      const res = await fetch(`${this.baseUrl}?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
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
      id: this.makeId(r.assetId),
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
      stream_url: this.makeStreamUrl(r.assetId),
      recorded_at: r.obsDt ?? null,
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
  assetId: number;
  commonName: string;
  sciName: string;
  familyName: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  mediaDuration: number | null;
  obsDt: string | null;
  behaviors: string[];
}
