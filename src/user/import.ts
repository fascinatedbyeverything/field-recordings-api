import type { Recording, UserRecordingMeta } from '../types';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export interface ImportResult {
  ok: boolean;
  id: string;
  audio_key: string;
  meta_key: string;
  deduped: boolean;
}

/** Build a deterministic R2 id for a remote recording so re-stars dedupe. */
export function importIdFor(recording: Pick<Recording, 'id'>): string {
  // recording.id is "provider:sourceId" — sanitize for R2 key safety.
  const safe = recording.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `imported__${safe}`;
}

/** Returns true if a meta object already exists for this id. */
export async function isAlreadyImported(bucket: R2Bucket, id: string): Promise<boolean> {
  const head = await bucket.head(`meta/${id}.json`);
  return head !== null;
}

/**
 * Stream `audio` (already transcoded to AAC m4a by the client) into R2 + write metadata.
 * Idempotent — if `meta/<id>.json` already exists, returns deduped:true without re-uploading.
 */
export async function importRecording(
  bucket: R2Bucket,
  recording: Recording,
  audio: ReadableStream,
  contentLength: number,
): Promise<ImportResult> {
  if (contentLength > MAX_BYTES) {
    throw new Error(`Audio too large (${contentLength} > ${MAX_BYTES})`);
  }

  const id = importIdFor(recording);
  const audioKey = `audio/${id}.m4a`;
  const metaKey = `meta/${id}.json`;

  if (await isAlreadyImported(bucket, id)) {
    return { ok: true, id, audio_key: audioKey, meta_key: metaKey, deduped: true };
  }

  await bucket.put(audioKey, audio, {
    httpMetadata: { contentType: 'audio/mp4' },
  });

  const meta: UserRecordingMeta = {
    id,
    title: recording.title || id,
    lat: recording.lat,
    lng: recording.lng,
    tags: recording.tags ?? [],
    species: recording.species ?? null,
    recorded_at: recording.recorded_at,
    uploaded_at: new Date().toISOString(),
    duration_sec: recording.duration_sec,
    filename: `${id}.m4a`,
    notes: `Imported from ${recording.provider}`,
  };

  await bucket.put(metaKey, JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });

  return { ok: true, id, audio_key: audioKey, meta_key: metaKey, deduped: false };
}
