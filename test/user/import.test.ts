import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importRecording, importIdFor, isAlreadyImported } from '../../src/user/import';
import type { Recording, UserRecordingMeta } from '../../src/types';

const sampleRec: Recording = {
  id: 'freesound:12345', title: 'Common Loon at Lake', provider: 'freesound',
  lat: 45.1, lng: -78.2, duration_sec: 60, tags: ['bird', 'loon', 'lake'],
  species: 'Common Loon', license: 'cc-by',
  stream_url: 'https://example/audio.mp3', recorded_at: '2024-06-12T00:00:00Z',
};

function makeBucket() {
  const store = new Map<string, { body: string; meta: any }>();
  return {
    head: vi.fn(async (k: string) => store.has(k) ? {} : null),
    get: vi.fn(async (k: string) => store.has(k) ? { text: async () => store.get(k)!.body } : null),
    put: vi.fn(async (k: string, v: any, opts?: any) => {
      const body = typeof v === 'string' ? v : '<stream>';
      store.set(k, { body, meta: opts });
    }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
    _store: store,
  } as any;
}

function asStream(s: string): ReadableStream {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(s);
  return new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
}

describe('importIdFor', () => {
  it('produces deterministic id from recording.id', () => {
    expect(importIdFor({ id: 'freesound:12345' })).toBe('imported__freesound_12345');
  });

  it('sanitizes unsafe characters', () => {
    expect(importIdFor({ id: 'xeno-canto:XC/789?foo=bar' })).toMatch(/^imported__xeno-canto_XC_789_foo_bar$/);
  });

  it('keeps allowed characters intact', () => {
    expect(importIdFor({ id: 'inaturalist:abc.123-XYZ_99' })).toBe('imported__inaturalist_abc.123-XYZ_99');
  });
});

describe('importRecording', () => {
  let bucket: any;
  beforeEach(() => { bucket = makeBucket(); });

  it('writes audio + meta on first import and returns deduped:false', async () => {
    const result = await importRecording(bucket, sampleRec, asStream('fakeaudio'), 9);
    expect(result.deduped).toBe(false);
    expect(result.id).toBe('imported__freesound_12345');
    expect(result.audio_key).toBe('audio/imported__freesound_12345.m4a');
    expect(result.meta_key).toBe('meta/imported__freesound_12345.json');

    const meta = JSON.parse(bucket._store.get('meta/imported__freesound_12345.json').body) as UserRecordingMeta;
    expect(meta.title).toBe('Common Loon at Lake');
    expect(meta.species).toBe('Common Loon');
    expect(meta.tags).toEqual(['bird', 'loon', 'lake']);
    expect(meta.lat).toBe(45.1);
    expect(meta.duration_sec).toBe(60);
    expect(meta.filename).toBe('imported__freesound_12345.m4a');
    expect(meta.notes).toContain('freesound');
  });

  it('returns deduped:true on second import without re-uploading', async () => {
    await importRecording(bucket, sampleRec, asStream('first'), 5);
    bucket.put.mockClear();
    const result = await importRecording(bucket, sampleRec, asStream('second'), 6);
    expect(result.deduped).toBe(true);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('rejects audio over the 200 MB cap', async () => {
    await expect(
      importRecording(bucket, sampleRec, asStream('x'), 250 * 1024 * 1024)
    ).rejects.toThrow(/too large/i);
  });

  it('uses audio/mp4 content type', async () => {
    await importRecording(bucket, sampleRec, asStream('a'), 1);
    const audioPut = bucket.put.mock.calls.find((c: any[]) => c[0].startsWith('audio/'));
    expect(audioPut[2].httpMetadata.contentType).toBe('audio/mp4');
  });

  it('handles missing optional fields gracefully', async () => {
    const sparse: Recording = {
      ...sampleRec, species: null, recorded_at: null, lat: null, lng: null,
      duration_sec: null, tags: [],
    };
    const result = await importRecording(bucket, sparse, asStream('a'), 1);
    expect(result.deduped).toBe(false);
    const meta = JSON.parse(bucket._store.get(result.meta_key).body) as UserRecordingMeta;
    expect(meta.species).toBeNull();
    expect(meta.lat).toBeNull();
    expect(meta.tags).toEqual([]);
  });
});

describe('isAlreadyImported', () => {
  it('returns true when meta exists', async () => {
    const bucket = makeBucket();
    await importRecording(bucket, sampleRec, asStream('a'), 1);
    expect(await isAlreadyImported(bucket, 'imported__freesound_12345')).toBe(true);
  });

  it('returns false when meta absent', async () => {
    const bucket = makeBucket();
    expect(await isAlreadyImported(bucket, 'imported__nonexistent')).toBe(false);
  });
});
