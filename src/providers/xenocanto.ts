import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class XenoCantoProvider extends BaseProvider {
  name = 'xenocanto';
  rateLimit = { requests: 1000, window_ms: 3600000 };

  private baseUrl = 'https://xeno-canto.org/api/3/recordings';
  private apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const xcQuery = this.buildQuery(query);
    if (!xcQuery) return [];
    const page = query.page ?? 1;
    const url = `${this.baseUrl}?query=${encodeURIComponent(xcQuery)}&page=${page}&key=${this.apiKey}`;
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
    const url = `${this.baseUrl}?query=nr:${id}&key=${this.apiKey}`;
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
    const url = `${this.baseUrl}?query=nr:${id}&key=${this.apiKey}`;
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
      lng: r.lon ? parseFloat(r.lon) : null,
      duration_sec: this.parseDuration(r.length),
      tags: [r.type, r.cnt, r.loc].filter(Boolean) as string[],
      species: r.gen && r.sp ? `${r.gen} ${r.sp}` : null,
      license: this.parseLicense(r.lic),
      stream_url: this.makeStreamUrl(r.id),
      thumbnail_url: r.sono?.small ? `https:${r.sono.small}` : undefined,
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
  lon: string;
  type: string;
  lic: string;
  file: string;
  'file-name': string;
  length: string;
  date: string;
  time: string;
  sono?: { small: string; med: string; large: string; full: string };
}
