import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class INaturalistProvider extends BaseProvider {
  name = 'inaturalist';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://api.inaturalist.org/v1/observations';

  async search(query: UnifiedQuery): Promise<Recording[]> {
    // 2026-05-25: iNat's free-text q= search misses observations where the
    // query is a species name (e.g. "BENGAL TIGER" hits 11-13 via q=, 11
    // via taxon_name=, but their union has more). Strategy:
    //   1. Try q= (free-text) first
    //   2. If q= returned >0 results, also fetch taxon_name= on page 1
    //      to catch additional species matches and merge
    //   3. If q= returned 0, fall back to taxon_name= only
    // This keeps the common case fast (single fetch) while filling the gap
    // for species queries. Avoids double-fetch overhead that was contributing
    // to Worker subrequest budget exhaustion in cold-cache runs.
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

    const fetchPage = async (url: string): Promise<INatObservation[]> => {
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
            return [];
          }
          const data = await res.json() as INatResponse;
          return (data.results ?? []).filter((obs) => obs.sounds && obs.sounds.length > 0);
        } catch (e) {
          console.error('iNaturalist error:', e);
          return [];
        }
      }
      return [];
    };

    const allObs = new Map<number, INatObservation>();

    if (query.q) {
      const textParams = baseParams();
      textParams.set('q', query.q);
      const urls: string[] = [`${this.baseUrl}?${textParams}`];

      // On page 1: also try taxon_name= to catch species queries that
      // free-text misses. Run in parallel with q= to avoid serial latency.
      if (page === 1) {
        const taxonParams = baseParams();
        taxonParams.set('taxon_name', query.q);
        urls.push(`${this.baseUrl}?${taxonParams}`);
      }

      const allResults = await Promise.all(urls.map((u) => fetchPage(u)));
      for (const batch of allResults) {
        for (const obs of batch) {
          if (!allObs.has(obs.id)) allObs.set(obs.id, obs);
        }
      }
    } else {
      const hits = await fetchPage(`${this.baseUrl}?${baseParams()}`);
      for (const obs of hits) {
        if (!allObs.has(obs.id)) allObs.set(obs.id, obs);
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
