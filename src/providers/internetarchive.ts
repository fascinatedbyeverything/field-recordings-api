import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class InternetArchiveProvider extends BaseProvider {
  name = 'internet-archive';
  rateLimit = { requests: 100, window_ms: 60000 };

  private searchUrl = 'https://archive.org/advancedsearch.php';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    // Build a query targeting field recordings, nature sounds, ambient audio
    const userQuery = query.q || 'field recording';
    const exclude = 'NOT subject:(jazz OR radio OR podcast OR episode OR hip-hop OR rock OR pop OR sermon OR lecture OR interview OR comedy OR audiobook)';
    const collections = 'collection:(field_recordings OR opensource_audio)';
    const searchTerms = `(${userQuery}) AND mediatype:audio AND ${collections} AND ${exclude}`;

    const params = new URLSearchParams({
      q: searchTerms,
      fl: 'identifier,title,description,date,licenseurl,creator,subject',
      rows: String(query.per_page ?? 20),
      page: String(query.page ?? 1),
      output: 'json',
      sort: 'downloads desc',
    });

    try {
      const res = await fetch(`${this.searchUrl}?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return [];
      const data = await res.json() as IASearchResponse;
      const docs = data.response?.docs || [];

      // Filter out obvious non-field-recordings before resolving
      const filtered = docs.filter((doc) => !this.isJunk(doc));

      const recordings = await Promise.all(
        filtered.slice(0, 15).map((doc) => this.resolveItem(doc))
      );
      return recordings.filter((r): r is Recording => r !== null);
    } catch {
      return [];
    }
  }

  private async resolveItem(doc: IADoc): Promise<Recording | null> {
    try {
      const res = await fetch(`https://archive.org/metadata/${doc.identifier}/files`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as { result: IAFile[] };
      const files = data.result || [];

      // Find best audio file (prefer mp3/ogg, skip tiny files)
      const audioFile = files.find((f) =>
        f.format && (f.format.includes('MP3') || f.format.includes('VBR MP3') || f.format.includes('Ogg'))
        && (f.length ? parseFloat(f.length) > 10 : true)
      );
      if (!audioFile) return null;

      const tags = this.parseTags(doc.subject);
      const duration = audioFile.length ? Math.floor(parseFloat(audioFile.length)) : null;

      return {
        id: this.makeId(doc.identifier),
        title: doc.title || doc.identifier,
        provider: this.name,
        lat: null,
        lng: null,
        duration_sec: duration,
        tags,
        species: null,
        license: this.parseLicense(doc.licenseurl),
        stream_url: this.makeStreamUrl(`${doc.identifier}/${audioFile.name}`),
        recorded_at: doc.date ?? null,
      };
    } catch {
      return null;
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    try {
      const res = await fetch(`https://archive.org/metadata/${id}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return {
        id: this.makeId(id),
        title: data.metadata?.title || id,
        provider: this.name,
        lat: null,
        lng: null,
        duration_sec: null,
        tags: this.parseTags(data.metadata?.subject),
        species: null,
        license: this.parseLicense(data.metadata?.licenseurl),
        stream_url: this.makeStreamUrl(id),
        recorded_at: data.metadata?.date ?? null,
      };
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    // id format: "identifier/filename.mp3"
    return `https://archive.org/download/${id}`;
  }

  private isJunk(doc: IADoc): boolean {
    const text = `${doc.title} ${doc.identifier} ${doc.creator || ''}`.toLowerCase();
    const junkWords = [
      'episode', 'radio', 'jazz', 'podcast', 'hip-hop', 'rock', 'pop',
      'sermon', 'lecture', 'comedy', 'audiobook', 'mixtape', 'dj-set',
      'in-transition', 'talk-show', 'news', 'interview', 'album',
      'live-concert', 'vinyl', 'remix', 'beats', 'synthwave',
    ];
    return junkWords.some((w) => text.includes(w));
  }

  private parseTags(subject: string | string[] | undefined): string[] {
    if (!subject) return [];
    if (Array.isArray(subject)) return subject.slice(0, 10);
    return subject.split(/[;,]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  }

  private parseLicense(url: string | undefined): string {
    if (!url) return 'unknown';
    if (url.includes('publicdomain') || url.includes('zero')) return 'cc0';
    if (url.includes('by-nc')) return 'cc-by-nc';
    if (url.includes('/by/')) return 'cc-by';
    return 'unknown';
  }
}

interface IASearchResponse {
  response: { docs: IADoc[]; numFound: number };
}

interface IADoc {
  identifier: string;
  title: string;
  description: string;
  date: string;
  licenseurl: string;
  creator: string;
  subject: string | string[];
}

interface IAFile {
  name: string;
  format: string;
  length: string;
  size: string;
}
