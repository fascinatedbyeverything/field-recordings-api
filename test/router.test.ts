import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../src/router';

// Mock fetch globally so provider API calls don't go out
const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ recordings: [], numRecordings: '0', results: [], count: 0 }), { status: 200 }));
vi.stubGlobal('fetch', mockFetch);

describe('Router', () => {
  const mockR2 = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const mockAssets = {
    fetch: vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
  };
  const mockEnv = { CACHE: mockR2 as any, UPLOADS: mockR2 as any, ASSETS: mockAssets, FREESOUND_API_KEY: 'test', XENOCANTO_API_KEY: 'test', OWNER_TOKEN: 'test-tok' };

  it('GET /api returns API info', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/api'), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.name).toBe('Field Recordings API');
  });

  it('GET /providers returns provider list', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/providers'), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /search without params returns 400', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/search'), mockEnv);
    expect(res.status).toBe(400);
  });

  it('GET /search with q fans out to providers', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/search?q=birds'), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('recordings');
    expect(body).toHaveProperty('providers_queried');
  });

  it('GET /stream/:provider/:id with unknown provider returns 404', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/stream/unknown/123'), mockEnv);
    expect(res.status).toBe(404);
  });

  it('GET / serves static assets', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/'), mockEnv);
    expect(res.status).toBe(200);
    expect(mockAssets.fetch).toHaveBeenCalled();
  });

  it('GET /user/favorites without auth returns 401', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/user/favorites'), mockEnv);
    expect(res.status).toBe(401);
  });

  it('GET /user/favorites with valid bearer returns empty file', async () => {
    const router = createRouter();
    const env = { ...mockEnv, OWNER_TOKEN: 'tok', UPLOADS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ objects: [] }),
    }} as any;
    const res = await router.fetch(new Request('http://localhost/user/favorites', {
      headers: { Authorization: 'Bearer tok' },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.favorites).toEqual([]);
  });

  it('GET /sets/public/:slug returns 404 when missing', async () => {
    const router = createRouter();
    const env = { ...mockEnv, UPLOADS: {
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ objects: [] }),
    }} as any;
    const res = await router.fetch(new Request('http://localhost/sets/public/missing'), env);
    expect(res.status).toBe(404);
  });
});
