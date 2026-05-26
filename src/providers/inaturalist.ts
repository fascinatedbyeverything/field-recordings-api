import { BaseProvider } from './base';
import type { UnifiedQuery, Recording } from '../types';

export class INaturalistProvider extends BaseProvider {
  name = 'inaturalist';
  rateLimit = { requests: 100, window_ms: 60000 };

  private baseUrl = 'https://api.inaturalist.org/v1/observations';
  private taxaUrl = 'https://api.inaturalist.org/v1/taxa';

  // Per-query cache for common-name → scientific-name resolution
  private sciNameCache = new Map<string, string | null>();

  private async resolveScientificName(q: string): Promise<string | null> {
    const key = q.toLowerCase().trim();
    if (this.sciNameCache.has(key)) return this.sciNameCache.get(key)!;
    try {
      const res = await fetch(
        `${this.taxaUrl}?q=${encodeURIComponent(q)}&per_page=1`,
        { headers: { 'User-Agent': 'FieldRecordingsAPI/1.0' } },
      );
      if (!res.ok) {
        this.sciNameCache.set(key, null);
        return null;
      }
      const data = await res.json() as { results: Array<{ name?: string; rank?: string }> };
      const first = data.results?.[0];
      if (!first?.name) {
        this.sciNameCache.set(key, null);
        return null;
      }
      // Prefer species-level scientific name. If subspecies, drop trailing
      // word to get parent species (broader observations pool).
      let sci = first.name;
      if (first.rank === 'subspecies') {
        const parts = sci.split(/\s+/);
        if (parts.length >= 2) sci = parts.slice(0, 2).join(' ');
      }
      this.sciNameCache.set(key, sci);
      return sci;
    } catch {
      this.sciNameCache.set(key, null);
      return null;
    }
  }

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
      // 2026-05-26: simplified to minimize subrequest count. Earlier versions
      // ran a separate /v1/taxa resolver call up-front to get the scientific
      // name. Under unified search load (12 providers in parallel), that
      // extra subrequest pushed iNat past Cloudflare's per-request subrequest
      // budget on free plan and iNat silently returned 0. Now: try
      // taxon_name=<user query> first (handles common names AND scientific
      // names — iNat resolves both); if that returns <5 hits, also do q=
      // free-text. Max 2 subrequests per page. iNat's taxon_name matcher is
      // permissive enough that "bengal tiger" still returns 11+ and the q=
      // fallback adds whatever free-text uniquely surfaces.
      const taxonParams = baseParams();
      taxonParams.set('taxon_name', query.q);
      const taxonHits = await fetchPage(`${this.baseUrl}?${taxonParams}`);
      for (const obs of taxonHits) {
        if (!allObs.has(obs.id)) allObs.set(obs.id, obs);
      }
      if (allObs.size < 5) {
        const textParams = baseParams();
        textParams.set('q', query.q);
        const textHits = await fetchPage(`${this.baseUrl}?${textParams}`);
        for (const obs of textHits) {
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
