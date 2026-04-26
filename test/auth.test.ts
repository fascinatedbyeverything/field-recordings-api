import { describe, it, expect } from 'vitest';
import { requireBearer, ownerIdFor } from '../src/auth';

describe('requireBearer', () => {
  const env = { OWNER_TOKEN: 'secret-abc' } as any;

  it('returns 401 when Authorization header is missing', async () => {
    const req = new Request('http://x/user/favorites');
    const res = await requireBearer(req, env);
    expect(res?.status).toBe(401);
  });

  it('returns 401 when token does not match', async () => {
    const req = new Request('http://x/user/favorites', { headers: { Authorization: 'Bearer wrong' } });
    const res = await requireBearer(req, env);
    expect(res?.status).toBe(401);
  });

  it('returns null + ownerId when token matches', async () => {
    const req = new Request('http://x/user/favorites', { headers: { Authorization: 'Bearer secret-abc' } });
    const res = await requireBearer(req, env);
    expect(res).toBeNull();
  });

  it('treats Bearer match as ownerId="owner" for v1 single-user', async () => {
    const req = new Request('http://x/user/favorites', { headers: { Authorization: 'Bearer secret-abc' } });
    const ownerId = await ownerIdFor(req, env);
    expect(ownerId).toBe('owner');
  });
});
