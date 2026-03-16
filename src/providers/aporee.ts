import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

/** Radio Aporee — global sound map with thousands of geo-tagged field recordings */
export class AporeeProvider extends BaseProvider {
  name = 'aporee';
  rateLimit = { requests: 60, window_ms: 60000 };

  private baseUrl = 'https://aporee.org/maps/api';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      f: 'json',
      limit: String(query.per_page ?? 20),
    });

    if (query.q) params.set('q', query.q);
    if (query.lat !== undefined && query.lng !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lng', String(query.lng));
      params.set('radius', String(query.radius_km ?? 100));
    }

    try {
      const res = await fetch(`${this.baseUrl}/sounds?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return [];
      const data = await res.json() as AporeeSound[];
      return (Array.isArray(data) ? data : []).map((r) => this.normalize(r));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    try {
      const res = await fetch(`${this.baseUrl}/sounds/${id}?f=json`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const r = await res.json() as AporeeSound;
      return this.normalize(r);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    try {
      const rec = await this.getRecording(id);
      if (!rec) return null;
      // The stream_url stored is our proxy URL, but we need the actual file
      const res = await fetch(`${this.baseUrl}/sounds/${id}?f=json`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as AporeeSound;
      return data.file || null;
    } catch {
      return null;
    }
  }

  private normalize(r: AporeeSound): Recording {
    return {
      id: this.makeId(r.id),
      title: r.title || 'Untitled',
      provider: this.name,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      duration_sec: r.duration ? Math.floor(r.duration) : null,
      tags: r.tags ? r.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      species: null,
      license: r.license || 'cc-by-nc',
      stream_url: this.makeStreamUrl(r.id),
      recorded_at: r.created ?? null,
    };
  }
}

interface AporeeSound {
  id: number;
  title: string;
  lat: number;
  lng: number;
  duration: number;
  tags: string;
  license: string;
  file: string;
  created: string;
}
