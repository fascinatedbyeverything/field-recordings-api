import { describe, it, expect, vi } from 'vitest';
import {
  META_INDEX_KEY,
  listAllMetaKeys,
  scanAllMeta,
  getAllMeta,
  invalidateMetaIndex,
} from '../../src/user/metaIndex';
import type { UserRecordingMeta } from '../../src/types';

function meta(id: string, title = id): UserRecordingMeta {
  return {
    id, title, lat: null, lng: null, tags: ['t'], species: null,
    recorded_at: null, uploaded_at: '2026-01-01T00:00:00Z',
    duration_sec: null, filename: `${id}.m4a`, notes: '',
  };
}

/** In-memory R2 stand-in with paginated list (page size configurable). */
function makeBucket(pageSize = 1000) {
  const store = new Map<string, string>();
  const bucket = {
    _store: store,
    gets: 0,
    maxConcurrent: 0,
    inFlight: 0,
    list: vi.fn(async (opts: { prefix?: string; cursor?: string; limit?: number }) => {
      const keys = [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(start + pageSize) : undefined,
      };
    }),
    get: vi.fn(async (k: string) => {
      bucket.gets++;
      bucket.inFlight++;
      bucket.maxConcurrent = Math.max(bucket.maxConcurrent, bucket.inFlight);
      await new Promise((r) => setTimeout(r, 1));
      bucket.inFlight--;
      if (!store.has(k)) return null;
      const body = store.get(k)!;
      return { text: async () => body, json: async () => JSON.parse(body) };
    }),
    put: vi.fn(async (k: string, v: any) => { store.set(k, typeof v === 'string' ? v : '<stream>'); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  };
  return bucket as any as (R2Bucket & typeof bucket);
}

describe('listAllMetaKeys', () => {
  it('follows list pagination past the first page', async () => {
    const b = makeBucket(3);
    for (let i = 0; i < 8; i++) b._store.set(`meta/r${i}.json`, JSON.stringify(meta(`r${i}`)));
    b._store.set('audio/r0.m4a', 'x');
    const keys = await listAllMetaKeys(b);
    expect(keys).toHaveLength(8);
    expect(keys.every((k) => k.startsWith('meta/'))).toBe(true);
    expect(b.list).toHaveBeenCalledTimes(3);
  });
});

describe('scanAllMeta', () => {
  it('reads every meta object in parallel batches and skips corrupt ones', async () => {
    const b = makeBucket();
    for (let i = 0; i < 120; i++) b._store.set(`meta/r${i}.json`, JSON.stringify(meta(`r${i}`)));
    b._store.set('meta/bad.json', '{not json');
    const metas = await scanAllMeta(b);
    expect(metas).toHaveLength(120);
    expect(b.gets).toBe(121);
    // The whole point: gets overlap instead of running one at a time.
    expect(b.maxConcurrent).toBeGreaterThan(10);
  });
});

describe('getAllMeta', () => {
  it('builds and stores the index on a cold read, then serves from it', async () => {
    const b = makeBucket();
    for (let i = 0; i < 5; i++) b._store.set(`meta/r${i}.json`, JSON.stringify(meta(`r${i}`)));

    const first = await getAllMeta(b);
    expect(first.map((m) => m.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    expect(b._store.has(META_INDEX_KEY)).toBe(true);
    const getsAfterCold = b.gets;

    const second = await getAllMeta(b);
    expect(second).toHaveLength(5);
    // Warm read = one get (the index), no per-object gets.
    expect(b.gets - getsAfterCold).toBe(1);
  });

  it('ignores an expired index and rebuilds it', async () => {
    const b = makeBucket();
    b._store.set('meta/r0.json', JSON.stringify(meta('r0')));
    const stale = {
      generated_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      count: 1,
      recordings: [meta('ghost')],
    };
    b._store.set(META_INDEX_KEY, JSON.stringify(stale));
    const metas = await getAllMeta(b);
    expect(metas.map((m) => m.id)).toEqual(['r0']);
    expect(JSON.parse(b._store.get(META_INDEX_KEY)!).recordings[0].id).toBe('r0');
  });

  it('never lists the index object itself as a recording', async () => {
    const b = makeBucket();
    b._store.set('meta/r0.json', JSON.stringify(meta('r0')));
    await getAllMeta(b);
    expect(META_INDEX_KEY.startsWith('meta/')).toBe(false);
    const metas = await scanAllMeta(b);
    expect(metas).toHaveLength(1);
  });

  it('still returns the recordings when the index cannot be written', async () => {
    const b = makeBucket();
    b._store.set('meta/r0.json', JSON.stringify(meta('r0')));
    b.put.mockRejectedValueOnce(new Error('R2 write failed'));
    const metas = await getAllMeta(b);
    expect(metas.map((m) => m.id)).toEqual(['r0']);
  });
});

describe('invalidateMetaIndex', () => {
  it('removes the index so the next read rebuilds from the bucket', async () => {
    const b = makeBucket();
    b._store.set('meta/r0.json', JSON.stringify(meta('r0')));
    await getAllMeta(b);
    expect(b._store.has(META_INDEX_KEY)).toBe(true);
    b._store.set('meta/r1.json', JSON.stringify(meta('r1')));
    await invalidateMetaIndex(b);
    expect(b._store.has(META_INDEX_KEY)).toBe(false);
    const metas = await getAllMeta(b);
    expect(metas.map((m) => m.id).sort()).toEqual(['r0', 'r1']);
  });

  it('is non-fatal when the delete fails', async () => {
    const b = makeBucket();
    b.delete.mockRejectedValueOnce(new Error('boom'));
    await expect(invalidateMetaIndex(b)).resolves.toBeUndefined();
  });
});
