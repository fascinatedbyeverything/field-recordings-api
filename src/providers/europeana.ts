import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

/** Europeana — European cultural heritage including field recordings */
export class EuropeanaProvider extends BaseProvider {
  name = 'europeana';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://api.europeana.eu/record/v2/search.json';
  // Europeana provides a free API key for non-commercial use
  private apiKey = 'api2demo';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const searchTerm = query.q || 'field recording';
    const params = new URLSearchParams({
      wskey: this.apiKey,
      query: `${searchTerm} AND TYPE:SOUND`,
      rows: String(Math.min(query.per_page ?? 20, 50)),
      start: String(((query.page ?? 1) - 1) * (query.per_page ?? 20) + 1),
      profile: 'standard',
      media: 'true',
    });

    try {
      const res = await fetch(`${this.baseUrl}?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return [];
      const data = await res.json() as EuropeanaResponse;
      return (data.items || [])
        .map((item) => this.normalize(item))
        .filter((r): r is Recording => r !== null);
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    return null;
  }

  async getStreamUrl(id: string): Promise<string | null> {
    // The id stores the edmIsShownBy URL directly
    return id || null;
  }

  private normalize(item: EuropeanaItem): Recording | null {
    const audioUrl = item.edmIsShownBy?.[0];
    if (!audioUrl) return null;

    const title = (item.title?.[0] || item.dcTitleLangAware?.en?.[0] || 'Untitled').slice(0, 200);
    const lat = item.edmPlaceLatitude?.[0] ? parseFloat(item.edmPlaceLatitude[0]) : null;
    const lng = item.edmPlaceLongitude?.[0] ? parseFloat(item.edmPlaceLongitude[0]) : null;

    const tags: string[] = [];
    if (item.dcSubject) tags.push(...item.dcSubject.slice(0, 6));
    if (item.dataProvider) tags.push(item.dataProvider[0]);

    // Use the audio URL as the stream ID (url-encoded)
    const streamId = encodeURIComponent(audioUrl);

    return {
      id: this.makeId(item.id || streamId),
      title,
      provider: this.name,
      lat,
      lng,
      duration_sec: null,
      tags,
      species: null,
      license: this.parseLicense(item.rights?.[0]),
      stream_url: this.makeStreamUrl(streamId),
      recorded_at: item.year?.[0] || null,
    };
  }

  private parseLicense(url: string | undefined): string {
    if (!url) return 'unknown';
    if (url.includes('publicdomain') || url.includes('/zero/')) return 'cc0';
    if (url.includes('by-nc')) return 'cc-by-nc';
    if (url.includes('/by/')) return 'cc-by';
    if (url.includes('InC')) return 'in-copyright';
    return 'unknown';
  }
}

interface EuropeanaResponse {
  items: EuropeanaItem[];
  totalResults: number;
}

interface EuropeanaItem {
  id: string;
  title: string[];
  dcTitleLangAware: Record<string, string[]>;
  dcSubject: string[];
  edmIsShownBy: string[];
  edmPlaceLatitude: string[];
  edmPlaceLongitude: string[];
  dataProvider: string[];
  rights: string[];
  year: string[];
}
