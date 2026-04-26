import type { FieldSet } from '../types';

const ownerKey = (ownerId: string, setId: string) => `sets/${ownerId}/${setId}.json`;
const publicKey = (slug: string) => `sets/public/${slug}.json`;

export async function listSets(bucket: R2Bucket, ownerId: string): Promise<Array<{ set_id: string; name: string; slug: string; is_public: boolean; updated_at: string }>> {
  const listed = await bucket.list({ prefix: `sets/${ownerId}/` });
  const out: Array<{ set_id: string; name: string; slug: string; is_public: boolean; updated_at: string }> = [];
  for (const obj of listed.objects) {
    const data = await bucket.get(obj.key);
    if (!data) continue;
    try {
      const s = JSON.parse(await data.text()) as FieldSet;
      out.push({ set_id: s.set_id, name: s.name, slug: s.slug, is_public: s.is_public, updated_at: s.updated_at });
    } catch { /* skip */ }
  }
  return out;
}

export async function getSet(bucket: R2Bucket, ownerId: string, setId: string): Promise<FieldSet | null> {
  const obj = await bucket.get(ownerKey(ownerId, setId));
  if (!obj) return null;
  try { return JSON.parse(await obj.text()) as FieldSet; } catch { return null; }
}

export async function upsertSet(bucket: R2Bucket, ownerId: string, set: FieldSet): Promise<void> {
  set.updated_at = new Date().toISOString();
  await bucket.put(ownerKey(ownerId, set.set_id), JSON.stringify(set), {
    httpMetadata: { contentType: 'application/json' },
  });
  if (set.is_public) {
    await bucket.put(publicKey(set.slug), JSON.stringify(set), {
      httpMetadata: { contentType: 'application/json' },
    });
  }
}

export async function deleteSet(bucket: R2Bucket, ownerId: string, setId: string): Promise<void> {
  const existing = await getSet(bucket, ownerId, setId);
  if (existing?.is_public) {
    await bucket.delete(publicKey(existing.slug));
  }
  await bucket.delete(ownerKey(ownerId, setId));
}

export async function publishSet(bucket: R2Bucket, ownerId: string, setId: string): Promise<FieldSet | null> {
  const set = await getSet(bucket, ownerId, setId);
  if (!set) return null;
  set.is_public = true;
  set.updated_at = new Date().toISOString();
  await upsertSet(bucket, ownerId, set);
  return set;
}

export async function unpublishSet(bucket: R2Bucket, ownerId: string, setId: string): Promise<FieldSet | null> {
  const set = await getSet(bucket, ownerId, setId);
  if (!set) return null;
  if (set.is_public) await bucket.delete(publicKey(set.slug));
  set.is_public = false;
  set.updated_at = new Date().toISOString();
  await bucket.put(ownerKey(ownerId, setId), JSON.stringify(set), {
    httpMetadata: { contentType: 'application/json' },
  });
  return set;
}

export async function getPublicSet(bucket: R2Bucket, slug: string): Promise<FieldSet | null> {
  const obj = await bucket.get(publicKey(slug));
  if (!obj) return null;
  try { return JSON.parse(await obj.text()) as FieldSet; } catch { return null; }
}
