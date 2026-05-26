import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class INaturalistProvider extends BaseProvider {
  name = 'inaturalist';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://api.inaturalist.org/v1/observations';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    // 2026-05-25: iNat's free-text q= search misses observations where the
    // query is a species name (e.g. "BENGAL TIGER" hits 13 vs taxon_name=
    // "Panthera tigris" which hits 20). Run BOTH queries on page 1 and merge
    // by observation id to surface everything. On later pages, free-text is
    // primary (taxon_name doesn't paginate the same way).
    const page = query.page ?? 1;
    const perPage = Math.min(query.per_page ?? 200, 200);

    const baseParams = (): URLSearchParams => {
      const p = new URLSearchParams({
        sounds: 'true',
        per_page: String(perPage),
        page: String(page),
        order_by: 'id',
        order: 'desc',
      });
      if (query.type) p.set('iconic_taxa', this.mapType(query.type));
      if (query.lat !== undefined) p.set('lat', String(query.lat));
      if (query.lng !== undefined) p.set('lng', String(query.lng));
      if (query.radius_km !== undefined) p.set('radius', String(query.radius_km));
      if (query.license) p.set('license', query.license);
      return p;
    };

    const urls: string[] = [];
    if (query.q) {
      const textParams = baseParams();
      textParams.set('q', query.q);
      urls.push(`${this.baseUrl}?${textParams}`);
      // Also try as a taxon_name lookup on page 1 — catches species queries
      // that iNat's text search misses (their free-text doesn't always tag
      // common-name → species).
      if (page === 1) {
        const taxonParams = baseParams();
        taxonParams.set('taxon_name', query.q);
        urls.push(`${this.baseUrl}?${taxonParams}`);
      }
    } else {
      urls.push(`${this.baseUrl}?${baseParams()}`);
    }

    const allObs = new Map<number, INatObservation>();
    for (const url of urls) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' },
          });
          if (res.status === 429) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          if (!res.ok) {
            console.error(`iNaturalist ${res.status} for ${url}`);
            break;
          }
          const data = await res.json() as INatResponse;
          for (const obs of data.results) {
            if (obs.sounds && obs.sounds.length > 0 && !allObs.has(obs.id)) {
              allObs.set(obs.id, obs);
            }
          }
          break;
        } catch (e) {
          console.error('iNaturalist error:', e);
          break;
        }
      }
    }
    return [...allObs.values()].map((obs) => this.normalize(obs));
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
