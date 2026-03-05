import { describe, it, expect } from 'vitest';
import { createRouter } from '../src/router';

describe('Router', () => {
  const mockEnv = { CACHE: {} as any, FREESOUND_API_KEY: 'test', XENOCANTO_API_KEY: 'test' };

  it('GET / returns API info', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/'), mockEnv);
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

  it('returns 404 for unknown routes', async () => {
    const router = createRouter();
    const res = await router.fetch(new Request('http://localhost/nope'), mockEnv);
    expect(res.status).toBe(404);
  });
});
