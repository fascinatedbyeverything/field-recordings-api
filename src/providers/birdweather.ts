import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

/** BirdWeather — AI-detected bird vocalizations from global network of stations */
export class BirdWeatherProvider extends BaseProvider {
  name = 'birdweather';
  rateLimit = { requests: 60, window_ms: 60000 };

  private baseUrl = 'https://app.birdweather.com/api/v1';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      limit: String(query.per_page ?? 20),
    });

    if (query.q) params.set('species', query.q);
    if (query.lat !== undefined && query.lng !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lon', String(query.lng));
      params.set('radius', String(query.radius_km ?? 100));
    }

    try {
      const res = await fetch(`${this.baseUrl}/stations/detections?${params}`, {
        headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      const detections = data.detections || [];
      return detections.map((d: any) => this.normalize(d)).filter(Boolean);
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    return null;
  }

  async getStreamUrl(id: string): Promise<string | null> {
    return id; // soundscape URL stored directly
  }

  private normalize(d: any): Recording | null {
    const soundUrl = d.soundscape_url || d.soundscape?.url;
    if (!soundUrl) return null;

    return {
      id: this.makeId(d.id),
      title: `${d.species?.common_name || 'Bird'} - ${d.station?.name || 'Unknown Station'}`,
      provider: this.name,
      lat: d.station?.latitude ?? d.lat ?? null,
      lng: d.station?.longitude ?? d.lon ?? null,
      duration_sec: d.soundscape?.duration ? Math.floor(d.soundscape.duration) : null,
      tags: [d.species?.common_name, 'birds', 'AI-detected'].filter(Boolean),
      species: d.species?.scientific_name || null,
      license: 'birdweather',
      stream_url: this.makeStreamUrl(encodeURIComponent(soundUrl)),
      recorded_at: d.timestamp || null,
    };
  }
}
