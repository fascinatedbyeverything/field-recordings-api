import type { UserRecordingMeta } from '../types';

/**
 * The user archive index.
 *
 * 2026-09-07: `/my-recordings` and `UserProvider.search` both listed
 * `meta/` and then fetched EVERY meta object one at a time — 556 serial R2
 * gets = 47-48 s per call, measured. Every other provider answers a cold
 * query in about a second, so this scan was the entire cold-search latency
 * Fascinated Fields sees (the Composer runs 3-7 searches + one
 * /my-recordings per compose).
 *
 * Now: one index object (`index/meta.json`, deliberately OUTSIDE the
 * `meta/` prefix so it is never mistaken for a recording) holds every
 * UserRecordingMeta. A read is one get. The index is rebuilt when it is
 * missing or older than INDEX_TTL_MS, and the rebuild itself reads the
 * meta objects in parallel batches instead of serially.
 *
 * Writers (upload, import, delete) call `invalidateMetaIndex` after they
 * touch `meta/`, so the next read rebuilds. A rebuild that overlaps a
 * write can persist an index missing that one item; the TTL bounds that
 * staleness, and callers that need the just-written item (FF's SetLoader
 * self-heal, ArchiveQueue) already tolerate a miss by streaming live and
 * re-queueing — the import then dedupes.
 */

export const META_INDEX_KEY = 'index/meta.json';
const META_PREFIX = 'meta/';
const INDEX_TTL_MS = 10 * 60 * 1000;
const GET_BATCH = 50;

interface MetaIndex {
  generated_at: string;
  count: number;
  recordings: UserRecordingMeta[];
}

/** Every key under `meta/`, following R2 list pagination. */
export async function listAllMetaKeys(bucket: R2Bucket): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix: META_PREFIX, cursor });
    for (const obj of listed.objects) keys.push(obj.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return keys;
}

/** Read every meta object, GET_BATCH at a time in parallel. Corrupt objects are skipped. */
export async function scanAllMeta(bucket: R2Bucket): Promise<UserRecordingMeta[]> {
  const keys = await listAllMetaKeys(bucket);
  const out: UserRecordingMeta[] = [];
  for (let i = 0; i < keys.length; i += GET_BATCH) {
    const batch = keys.slice(i, i + GET_BATCH);
    const bodies = await Promise.all(
      batch.map(async (key) => {
        try {
          const obj = await bucket.get(key);
          if (!obj) return null;
          return JSON.parse(await obj.text()) as UserRecordingMeta;
        } catch {
          return null;
        }
      }),
    );
    for (const m of bodies) if (m) out.push(m);
  }
  return out;
}

async function readIndex(bucket: R2Bucket): Promise<MetaIndex | null> {
  try {
    const obj = await bucket.get(META_INDEX_KEY);
    if (!obj) return null;
    const idx = JSON.parse(await obj.text()) as MetaIndex;
    if (!Array.isArray(idx.recordings)) return null;
    const age = Date.now() - Date.parse(idx.generated_at);
    if (!(age >= 0 && age < INDEX_TTL_MS)) return null;
    return idx;
  } catch {
    return null;
  }
}

async function writeIndex(bucket: R2Bucket, recordings: UserRecordingMeta[]): Promise<void> {
  const idx: MetaIndex = {
    generated_at: new Date().toISOString(),
    count: recordings.length,
    recordings,
  };
  try {
    await bucket.put(META_INDEX_KEY, JSON.stringify(idx), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    // The index is a cache; failing to write it must not fail the read.
  }
}

/** All user recordings: from the index when fresh, else rebuilt from the bucket. */
export async function getAllMeta(bucket: R2Bucket): Promise<UserRecordingMeta[]> {
  const idx = await readIndex(bucket);
  if (idx) return idx.recordings;
  const recordings = await scanAllMeta(bucket);
  await writeIndex(bucket, recordings);
  return recordings;
}

/** Drop the index after any write under `meta/`. Non-fatal. */
export async function invalidateMetaIndex(bucket: R2Bucket): Promise<void> {
  try {
    await bucket.delete(META_INDEX_KEY);
  } catch {
    // Next read falls back to the TTL.
  }
}
