import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class INaturalistProvider extends BaseProvider {
  name = 'inaturalist';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://api.inaturalist.org/v1/observations';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    const params = new URLSearchParams({
      sounds: 'true',
      per_page: String(query.per_page ?? 20),
      page: String(query.page ?? 1),
      order_by: 'id',
      order: 'desc',
    });

    if (query.q) params.set('q', query.q);
    if (query.type) params.set('iconic_taxa', this.mapType(query.type));
    if (query.lat !== undefined) params.set('lat', String(query.lat));
    if (query.lng !== undefined) params.set('lng', String(query.lng));
    if (query.radius_km !== undefined) params.set('radius', String(query.radius_km));
    if (query.license) params.set('license', query.license);

    const url = `${this.baseUrl}?${params}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as INatResponse;
      return data.results
        .filter((obs) => obs.sounds && obs.sounds.length > 0)
        .map((obs) => this.normalize(obs));
    } catch {
      return [];
    }
  }

  async getRecording(id: string): Promise<Recording | null> {
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as INatResponse;
      if (data.results.length === 0) return null;
      return this.normalize(data.results[0]);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    const url = `${this.baseUrl}/${id}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as INatResponse;
      const sounds = data.results[0]?.sounds;
      return sounds?.[0]?.file_url ?? null;
    } catch {
      return null;
    }
  }

  private normalize(obs: INatObservation): Recording {
    const [lat, lng] = obs.location ? obs.location.split(',').map(Number) : [null, null];
    const sound = obs.sounds[0];

    return {
      id: this.makeId(obs.id),
      title: obs.taxon?.preferred_common_name || obs.species_guess || 'Unknown species',
      provider: this.name,
      lat: lat ?? null,
      lng: lng ?? null,
      duration_sec: null,
      tags: obs.tags?.map((t: any) => typeof t === 'string' ? t : t.name).filter(Boolean) ?? [],
      species: obs.taxon?.name ?? null,
      license: sound?.license_code ?? obs.license_code ?? 'unknown',
      stream_url: this.makeStreamUrl(obs.id),
      recorded_at: obs.observed_on ?? null,
    };
  }

  private mapType(type: string): string {
    const map: Record<string, string> = {
      bird: 'Aves', mammal: 'Mammalia', amphibian: 'Amphibia',
      reptile: 'Reptilia', insect: 'Insecta', fish: 'Actinopterygii',
    };
    return map[type.toLowerCase()] ?? '';
  }
}

interface INatResponse {
  total_results: number;
  results: INatObservation[];
}

interface INatObservation {
  id: number;
  species_guess: string;
  observed_on: string;
  location: string;
  license_code: string;
  taxon: { name: string; preferred_common_name: string } | null;
  sounds: { id: number; file_url: string; license_code: string; file_content_type: string }[];
  tags: any[];
}
