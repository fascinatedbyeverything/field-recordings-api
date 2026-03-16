import { BaseProvider } from './base';
import type { UnifiedQuery, Recording, UserRecordingMeta } from '../types';

/** Provider for user-uploaded recordings stored in R2 */
export class UserProvider extends BaseProvider {
  name = 'user';
  rateLimit = { requests: 1000, window_ms: 60000 };

  private bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    super();
    this.bucket = bucket;
  }

  async search(query: UnifiedQuery): Promise<Recording[]> {
    // List all metadata files from R2
    const listed = await this.bucket.list({ prefix: 'meta/' });
    const metas: UserRecordingMeta[] = [];

    for (const obj of listed.objects) {
      const data = await this.bucket.get(obj.key);
      if (!data) continue;
      try {
        const meta = JSON.parse(await data.text()) as UserRecordingMeta;
        metas.push(meta);
      } catch { /* skip corrupt */ }
    }

    let results = metas.map((m) => this.normalize(m));

    // Text filter
    if (query.q) {
      const q = query.q.toLowerCase();
      results = results.filter((r) =>
        r.title.toLowerCase().includes(q)
        || r.tags.some((t) => t.toLowerCase().includes(q))
        || (r.species && r.species.toLowerCase().includes(q))
      );
    }

    // Geo filter
    if (query.lat !== undefined && query.lng !== undefined) {
      const radiusKm = query.radius_km ?? 100;
      results = results.filter((r) => {
        if (r.lat === null || r.lng === null) return false;
        return haversine(query.lat!, query.lng!, r.lat, r.lng) <= radiusKm;
      });
    }

    return results;
  }

  async getRecording(id: string): Promise<Recording | null> {
    const data = await this.bucket.get(`meta/${id}.json`);
    if (!data) return null;
    try {
      const meta = JSON.parse(await data.text()) as UserRecordingMeta;
      return this.normalize(meta);
    } catch {
      return null;
    }
  }

  async getStreamUrl(id: string): Promise<string | null> {
    // Check if the audio file exists
    const listed = await this.bucket.list({ prefix: `audio/${id}` });
    const obj = listed.objects[0];
    if (!obj) return null;
    // Return a presigned-style path (we'll serve directly from R2)
    return `r2://${obj.key}`;
  }

  private normalize(m: UserRecordingMeta): Recording {
    return {
      id: this.makeId(m.id),
      title: m.title,
      provider: this.name,
      lat: m.lat,
      lng: m.lng,
      duration_sec: m.duration_sec,
      tags: m.tags,
      species: m.species,
      license: 'personal',
      stream_url: this.makeStreamUrl(m.id),
      recorded_at: m.recorded_at,
    };
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
