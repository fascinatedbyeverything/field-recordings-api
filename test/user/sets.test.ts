import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listSets, getSet, upsertSet, deleteSet, publishSet, unpublishSet } from '../../src/user/sets';
import type { FieldSet, SetEntry, Recording } from '../../src/types';

const rec: Recording = {
  id: 'xenocanto:1', title: 'Loon', provider: 'xenocanto',
  lat: null, lng: null, duration_sec: 60, tags: [], species: null,
  license: 'CC', stream_url: 'http://x', recorded_at: null,
};
const entry: SetEntry = {
  fav_id: 'f1', recording: rec, in_sec: 0, out_sec: 30,
  loop_on: true, sum_to_mono: true, gain_db: 0, notes: '',
};

function makeBucket() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.has(k) ? { text: async () => store.get(k)! } : null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })),
    })),
    _store: store,
  } as any;
}

describe('sets', () => {
  let bucket: any;
  beforeEach(() => { bucket = makeBucket(); });

  it('listSets returns empty', async () => {
    expect(await listSets(bucket, 'owner')).toEqual([]);
  });

  it('upsertSet stores and getSet reads', async () => {
    const s: FieldSet = {
      version: 1, set_id: 's1', owner_id: 'owner',
      name: 'Dawn chorus', slug: 'dawn-chorus', is_public: false,
      updated_at: '2026-04-26T00:00:00Z', entries: [entry],
    };
    await upsertSet(bucket, 'owner', s);
    const got = await getSet(bucket, 'owner', 's1');
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Dawn chorus');
    expect(got!.entries).toHaveLength(1);
  });

  it('listSets returns ids after upserts', async () => {
    const s1: FieldSet = {
      version: 1, set_id: 's1', owner_id: 'owner', name: 'A', slug: 'a',
      is_public: false, updated_at: '2026-04-26T00:00:00Z', entries: [],
    };
    const s2: FieldSet = { ...s1, set_id: 's2', name: 'B', slug: 'b' };
    await upsertSet(bucket, 'owner', s1);
    await upsertSet(bucket, 'owner', s2);
    const summaries = await listSets(bucket, 'owner');
    expect(summaries.map(x => x.set_id).sort()).toEqual(['s1', 's2']);
  });

  it('deleteSet removes from list', async () => {
    const s: FieldSet = {
      version: 1, set_id: 's1', owner_id: 'owner', name: 'A', slug: 'a',
      is_public: false, updated_at: '2026-04-26T00:00:00Z', entries: [],
    };
    await upsertSet(bucket, 'owner', s);
    await deleteSet(bucket, 'owner', 's1');
    expect(await getSet(bucket, 'owner', 's1')).toBeNull();
  });

  it('publishSet writes to sets/public/<slug>.json and flips is_public', async () => {
    const s: FieldSet = {
      version: 1, set_id: 's1', owner_id: 'owner', name: 'A', slug: 'a',
      is_public: false, updated_at: '2026-04-26T00:00:00Z', entries: [entry],
    };
    await upsertSet(bucket, 'owner', s);
    await publishSet(bucket, 'owner', 's1');
    const pub = bucket._store.get('sets/public/a.json');
    expect(pub).toBeDefined();
    const owner = await getSet(bucket, 'owner', 's1');
    expect(owner!.is_public).toBe(true);
  });

  it('unpublishSet removes public copy + flips is_public', async () => {
    const s: FieldSet = {
      version: 1, set_id: 's1', owner_id: 'owner', name: 'A', slug: 'a',
      is_public: false, updated_at: '2026-04-26T00:00:00Z', entries: [],
    };
    await upsertSet(bucket, 'owner', s);
    await publishSet(bucket, 'owner', 's1');
    await unpublishSet(bucket, 'owner', 's1');
    expect(bucket._store.has('sets/public/a.json')).toBe(false);
    const owner = await getSet(bucket, 'owner', 's1');
    expect(owner!.is_public).toBe(false);
  });
});
