import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

interface NPSEntry {
  id: string;
  title: string;
  category: string;
  tags: string[];
  file_key: string;
}

export class NPSProvider extends BaseProvider {
  name = 'nps';
  rateLimit = { requests: 1000, window_ms: 60_000 };

  private r2: R2Bucket;

  constructor(r2: R2Bucket) {
    super();
    this.r2 = r2;
  }

  private async loadIndex(): Promise<NPSEntry[]> {
    const obj = await this.r2.get('nps/index.json');
    if (!obj) return [];
    return obj.json<NPSEntry[]>();
  }

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const entries = await this.loadIndex();

    let filtered = entries;

    if (query.q) {
      const q = query.q.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    if (query.type) {
      const type = query.type.toLowerCase();
      filtered = filtered.filter(
        (e) => e.category.toLowerCase() === type,
      );
    }

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const start = (page - 1) * perPage;
    const paged = filtered.slice(start, start + perPage);

    return paged.map((e) => this.toRecording(e));
  }

  async getRecording(id: string): Promise<Recording | null> {
    const entries = await this.loadIndex();
    const entry = entries.find((e) => e.id === id);
    return entry ? this.toRecording(entry) : null;
  }

  async getStreamUrl(id: string): Promise<string | null> {
    return `nps/audio/${id}.mp3`;
  }

  private toRecording(entry: NPSEntry): Recording {
    return {
      id: this.makeId(entry.id),
      title: entry.title,
      provider: this.name,
      lat: null,
      lng: null,
      duration_sec: null,
      tags: entry.tags,
      species: null,
      license: 'public-domain',
      stream_url: this.makeStreamUrl(entry.id),
      recorded_at: null,
    };
  }
}
