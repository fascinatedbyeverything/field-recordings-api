import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFavorites, upsertFavorite, removeFavorite } from '../../src/user/favorites';
import type { Favorite, FavoritesFile, Recording } from '../../src/types';

const sampleRec: Recording = {
  id: 'xenocanto:1', title: 'Loon', provider: 'xenocanto',
  lat: 45, lng: -78, duration_sec: 120, tags: ['bird'], species: null,
  license: 'CC', stream_url: 'http://x', recorded_at: null,
};

function makeBucket() {
  let store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.has(k) ? { text: async () => store.get(k)! } : null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _store: store,
  } as any;
}

describe('favorites', () => {
  let bucket: any;
  beforeEach(() => { bucket = makeBucket(); });

  it('getFavorites returns empty when no file exists', async () => {
    const file = await getFavorites(bucket, 'owner');
    expect(file.favorites).toEqual([]);
    expect(file.owner_id).toBe('owner');
    expect(file.version).toBe(1);
  });

  it('upsertFavorite adds a new favorite', async () => {
    const fav: Favorite = {
      fav_id: 'f1', recording: sampleRec, in_sec: 0, out_sec: 30,
      loop_on: true, sum_to_mono: true, gain_db: 0, tags: [], set_ids: [],
      saved_at: '2026-04-26T00:00:00Z', notes: '',
    };
    await upsertFavorite(bucket, 'owner', fav);
    const file = await getFavorites(bucket, 'owner');
    expect(file.favorites).toHaveLength(1);
    expect(file.favorites[0].fav_id).toBe('f1');
  });

  it('upsertFavorite replaces existing fav_id (idempotent edit)', async () => {
    const fav: Favorite = {
      fav_id: 'f1', recording: sampleRec, in_sec: 0, out_sec: 30,
      loop_on: false, sum_to_mono: true, gain_db: 0, tags: [], set_ids: [],
      saved_at: '2026-04-26T00:00:00Z', notes: '',
    };
    await upsertFavorite(bucket, 'owner', fav);
    await upsertFavorite(bucket, 'owner', { ...fav, in_sec: 5, loop_on: true });
    const file = await getFavorites(bucket, 'owner');
    expect(file.favorites).toHaveLength(1);
    expect(file.favorites[0].in_sec).toBe(5);
    expect(file.favorites[0].loop_on).toBe(true);
  });

  it('removeFavorite drops by fav_id', async () => {
    const fav: Favorite = {
      fav_id: 'f1', recording: sampleRec, in_sec: 0, out_sec: 30,
      loop_on: false, sum_to_mono: true, gain_db: 0, tags: [], set_ids: [],
      saved_at: '2026-04-26T00:00:00Z', notes: '',
    };
    await upsertFavorite(bucket, 'owner', fav);
    await removeFavorite(bucket, 'owner', 'f1');
    const file = await getFavorites(bucket, 'owner');
    expect(file.favorites).toEqual([]);
  });

  it('getFavorites recovers from corrupt JSON', async () => {
    bucket._store.set('favorites/owner.json', '{not json');
    const file = await getFavorites(bucket, 'owner');
    expect(file.favorites).toEqual([]);
  });
});
