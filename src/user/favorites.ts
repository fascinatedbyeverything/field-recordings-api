import type { Favorite, FavoritesFile } from '../types';

const keyFor = (ownerId: string) => `favorites/${ownerId}.json`;

export async function getFavorites(bucket: R2Bucket, ownerId: string): Promise<FavoritesFile> {
  const obj = await bucket.get(keyFor(ownerId));
  if (!obj) return { version: 1, owner_id: ownerId, updated_at: new Date().toISOString(), favorites: [] };
  try {
    const parsed = JSON.parse(await obj.text()) as FavoritesFile;
    if (!parsed.favorites) parsed.favorites = [];
    if (parsed.version !== 1) parsed.version = 1;
    return parsed;
  } catch {
    return { version: 1, owner_id: ownerId, updated_at: new Date().toISOString(), favorites: [] };
  }
}

export async function upsertFavorite(bucket: R2Bucket, ownerId: string, fav: Favorite): Promise<void> {
  const file = await getFavorites(bucket, ownerId);
  const idx = file.favorites.findIndex(f => f.fav_id === fav.fav_id);
  if (idx >= 0) file.favorites[idx] = fav; else file.favorites.push(fav);
  file.updated_at = new Date().toISOString();
  await bucket.put(keyFor(ownerId), JSON.stringify(file), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function removeFavorite(bucket: R2Bucket, ownerId: string, favId: string): Promise<void> {
  const file = await getFavorites(bucket, ownerId);
  file.favorites = file.favorites.filter(f => f.fav_id !== favId);
  file.updated_at = new Date().toISOString();
  await bucket.put(keyFor(ownerId), JSON.stringify(file), {
    httpMetadata: { contentType: 'application/json' },
  });
}
