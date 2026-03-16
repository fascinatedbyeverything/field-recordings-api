import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

/** Wikimedia Commons — huge audio collection with geo data */
export class WikimediaProvider extends BaseProvider {
  name = 'wikimedia';
  rateLimit = { requests: 200, window_ms: 60000 };

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const searchTerm = query.q || 'field recording';
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      generator: 'search',
      gsrsearch: `${searchTerm} filetype:audio`,
      gsrnamespace: '6', // File namespace
      gsrlimit: String(query.per_page ?? 20),
      prop: 'imageinfo|coordinates',
      iiprop: 'url|mime|extmetadata|size',
      origin: '*',
    });

    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0 (contact@example.com)' },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      const pages = data.query?.pages || {};
      return Object.values(pages)
        .map((p: any) => this.normalize(p))
        .filter((r): r is Recording => r !== null);
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    return null;
  }

  async getStreamUrl(id: string): Promise<string | null> {
    // id is the page ID, fetch the file URL
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      pageids: id,
      prop: 'imageinfo',
      iiprop: 'url',
      origin: '*',
    });
    try {
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      const page = Object.values(data.query?.pages || {})[0] as any;
      return page?.imageinfo?.[0]?.url || null;
    } catch {
      return null;
    }
  }

  private normalize(page: any): Recording | null {
    const info = page.imageinfo?.[0];
    if (!info) return null;
    const mime = info.mime || '';
    if (!mime.startsWith('audio/')) return null;

    const meta = info.extmetadata || {};
    const title = (page.title || '').replace(/^File:/, '').replace(/\.\w+$/, '').replace(/_/g, ' ');
    const coords = page.coordinates?.[0];

    const tags: string[] = [];
    const cats = meta.Categories?.value || '';
    if (cats) tags.push(...cats.split('|').slice(0, 8));

    return {
      id: this.makeId(page.pageid),
      title,
      provider: this.name,
      lat: coords?.lat ?? null,
      lng: coords?.lon ?? null,
      duration_sec: null,
      tags,
      species: null,
      license: this.parseLicense(meta.LicenseShortName?.value),
      stream_url: this.makeStreamUrl(page.pageid),
      recorded_at: meta.DateTimeOriginal?.value?.slice(0, 10) ?? null,
    };
  }

  private parseLicense(lic: string | undefined): string {
    if (!lic) return 'unknown';
    const l = lic.toLowerCase();
    if (l.includes('cc0') || l.includes('pd')) return 'cc0';
    if (l.includes('by-sa')) return 'cc-by-sa';
    if (l.includes('by-nc')) return 'cc-by-nc';
    if (l.includes('by')) return 'cc-by';
    return lic;
  }
}
