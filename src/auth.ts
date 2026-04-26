import { error } from 'itty-router';
import type { Env } from './types';

/**
 * Returns null when authorization is OK, or a 401 Response when not.
 * v1 is single-user: any caller presenting OWNER_TOKEN is `ownerId === "owner"`.
 * Schema is shaped to grow into multi-user later (token map, JWT, etc.) without breaking R2 layout.
 */
export async function requireBearer(request: Request, env: Env): Promise<Response | null> {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return error(401, 'Missing bearer token');
  if (!env.OWNER_TOKEN || m[1] !== env.OWNER_TOKEN) return error(401, 'Invalid token');
  return null;
}

export async function ownerIdFor(_request: Request, _env: Env): Promise<string> {
  // Single-user for v1. When this becomes multi-tenant, derive from JWT/sub.
  return 'owner';
}
