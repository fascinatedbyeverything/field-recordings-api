import { describe, it, expect, vi } from 'vitest';
import { CacheLayer } from '../src/cache';

function mockR2(): any {
  const store = new Map<string, { body: string; customMetadata: Record<string, string> }>();
  return {
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return { json: async () => JSON.parse(item.body), customMetadata: item.customMetadata };
    }),
    put: vi.fn(async (key: string, body: string, opts: any) => {
      store.set(key, { body, customMetadata: opts?.customMetadata ?? {} });
    }),
  };
}

describe('CacheLayer', () => {
  it('returns null on cache miss', async () => {
    const r2 = mockR2();
    r2.get.mockResolvedValueOnce(null);
    const cache = new CacheLayer(r2);
    const result = await cache.getSearch('test-hash');
    expect(result).toBeNull();
  });

  it('returns cached data when fresh', async () => {
    const r2 = mockR2();
    const cache = new CacheLayer(r2);
    const data = { recordings: [], total: 0, page: 1, providers_queried: [], providers_failed: [] };
    await cache.putSearch('test-hash', data);
    const result = await cache.getSearch('test-hash');
    expect(result).toEqual(data);
  });

  it('returns null when expired', async () => {
    const r2 = mockR2();
    const cache = new CacheLayer(r2);
    const data = { recordings: [], total: 0 };
    const oldTime = String(Date.now() - 25 * 60 * 60 * 1000);
    await r2.put('search/test-hash', JSON.stringify(data), {
      customMetadata: { expires: oldTime },
    });
    const result = await cache.getSearch('test-hash');
    expect(result).toBeNull();
  });

  it('hashQuery produces consistent hashes', () => {
    const r2 = mockR2();
    const cache = new CacheLayer(r2);
    const hash1 = cache.hashQuery({ q: 'birds', lat: '10' });
    const hash2 = cache.hashQuery({ lat: '10', q: 'birds' });
    expect(hash1).toBe(hash2);
  });
});
