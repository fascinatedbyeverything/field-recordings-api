import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class LOCProvider extends BaseProvider {
  name = 'loc';
  rateLimit = { requests: 200, window_ms: 60000 };

  private baseUrl = 'https://www.loc.gov';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      fo: 'json',
      c: String(query.per_page ?? 20),
      sp: String(query.page ?? 1),
    });

    if (query.q) params.set('q', query.q);

    const url = `${this.baseUrl}/audio/?${params}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as LOCSearchResponse;
      return (data.results ?? []).map((item) => this.normalize(item));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}/item/${id}/?fo=json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as LOCItemResponse;
      if (!data.item) return null;
      return this.normalizeItem(data, id);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const url = `${this.baseUrl}/item/${id}/?fo=json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as LOCItemResponse;
      return this.findAudioUrl(data.resources ?? []);
    } catch {
      return null;
    }
  }

  private normalize(item: LOCSearchResult): Recording {
    const sourceId = this.extractId(item.id);

    return {
      id: this.makeId(sourceId),
      title: item.title ?? 'Untitled',
      provider: this.name,
      lat: null,
      lng: null,
      duration_sec: null,
      tags: item.subject ?? [],
      species: null,
      license: 'public-domain',
      stream_url: this.makeStreamUrl(sourceId),
      thumbnail_url: item.image_url?.[0] ?? undefined,
      recorded_at: item.date ?? null,
    };
  }

  private normalizeItem(data: LOCItemResponse, sourceId: string): Recording {
    const item = data.item;
    return {
      id: this.makeId(sourceId),
      title: item.title ?? 'Untitled',
      provider: this.name,
      lat: null,
      lng: null,
      duration_sec: null,
      tags: item.subjects?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean) ?? [],
      species: null,
      license: 'public-domain',
      stream_url: this.makeStreamUrl(sourceId),
      recorded_at: item.date ?? null,
    };
  }

  private extractId(idUrl: string): string {
    const match = idUrl.match(/\/item\/([^/]+)/);
    return match?.[1] ?? idUrl;
  }

  private findAudioUrl(resources: LOCResource[]): string | null {
    for (const resource of resources) {
      for (const file of resource.files ?? []) {
        if (file.mime_type?.startsWith('audio/')) {
          return file.url;
        }
      }
    }
    return null;
  }
}

interface LOCSearchResponse {
  results: LOCSearchResult[];
}

interface LOCSearchResult {
  id: string;
  title: string;
  date: string | null;
  description: string[];
  url: string;
  aka: string[];
  subject: string[];
  image_url: string[];
}

interface LOCItemResponse {
  item: {
    title: string;
    date: string | null;
    subjects: any[];
  };
  resources: LOCResource[];
}

interface LOCResource {
  files: LOCFile[];
}

interface LOCFile {
  url: string;
  mime_type: string;
}
