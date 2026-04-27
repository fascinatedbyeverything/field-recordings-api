import { describe, it, expect, vi } from 'vitest';
import { searchAll } from '../src/search';
import type { Provider, Recording } from '../src/types';

function mockProvider(name: string, results: Recording[]): Provider {
  return {
    name,
    rateLimit: { requests: 100, window_ms: 60000 },
    search: vi.fn().mockResolvedValue(results),
    getRecording: vi.fn(),
    getStreamUrl: vi.fn(),
  };
}

function makeRecording(provider: string, id: string): Recording {
  return {
    id: `${provider}:${id}`, title: 'Test', provider, lat: 0, lng: 0,
    duration_sec: 60, tags: ['test'], species: null, license: 'cc0',
    stream_url: `/stream/${provider}/${id}`, recorded_at: null,
  };
}

describe('searchAll', () => {
  it('fans out to all providers and merges results', async () => {
    const providers = [
      mockProvider('a', [makeRecording('a', '1')]),
      mockProvider('b', [makeRecording('b', '2'), makeRecording('b', '3')]),
    ];
    const result = await searchAll(providers, { q: 'test' });
    expect(result.recordings).toHaveLength(3);
    expect(result.providers_queried).toEqual(['a', 'b']);
    expect(result.providers_failed).toEqual([]);
  });

  it('handles provider failures gracefully', async () => {
    const failing: Provider = {
      name: 'bad',
      rateLimit: { requests: 100, window_ms: 60000 },
      search: vi.fn().mockRejectedValue(new Error('fail')),
      getRecording: vi.fn(),
      getStreamUrl: vi.fn(),
    };
    const good = mockProvider('good', [makeRecording('good', '1')]);
    const result = await searchAll([failing, good], { q: 'test' });
    expect(result.recordings).toHaveLength(1);
    expect(result.providers_failed).toEqual(['bad']);
  });

  it('filters by provider when specified', async () => {
    const a = mockProvider('a', [makeRecording('a', '1')]);
    const b = mockProvider('b', [makeRecording('b', '2')]);
    const result = await searchAll([a, b], { q: 'test', provider: 'a' });
    expect(result.recordings).toHaveLength(1);
    expect(b.search).not.toHaveBeenCalled();
  });
});

describe('relevance ranking (default when q is set)', () => {
  function rec(overrides: Partial<Recording>): Recording {
    return {
      id: 'p:1', title: '', provider: 'p', lat: null, lng: null,
      duration_sec: 60, tags: [], species: null, license: 'cc0',
      stream_url: '/stream/p/1', recorded_at: null,
      ...overrides,
    };
  }

  it('ranks species whole-word match above title substring match', async () => {
    // Repro: q="common loon" must surface bird recordings, not "Loonse" place-name ambiences.
    const ambience = rec({
      id: 'p:1', title: '62 minute drifting sand ambience Loonse en Drunense Duinen',
      species: null, duration_sec: 3756,
    });
    const loonCall = rec({
      id: 'p:2', title: 'Common Loon territorial call',
      species: 'Common Loon', duration_sec: 25,
    });
    const provider = mockProvider('p', [ambience, loonCall]);
    const result = await searchAll([provider], { q: 'common loon' });
    expect(result.recordings[0].id).toBe('p:2');
    expect(result.recordings[1].id).toBe('p:1');
  });

  it('ranks whole-word title match above substring-only title match', async () => {
    const substring = rec({ id: 'p:1', title: 'Loonse heath wind', duration_sec: 3600 });
    const wholeWord = rec({ id: 'p:2', title: 'Loon at dusk', duration_sec: 30 });
    const provider = mockProvider('p', [substring, wholeWord]);
    const result = await searchAll([provider], { q: 'loon' });
    expect(result.recordings[0].id).toBe('p:2');
  });

  it('uses relevance by default when q is non-empty', async () => {
    const longAmbient = rec({ id: 'p:1', title: 'untitled', duration_sec: 7200 });
    const shortMatch = rec({ id: 'p:2', title: 'thunder clap', species: 'thunder', duration_sec: 5 });
    const provider = mockProvider('p', [longAmbient, shortMatch]);
    const result = await searchAll([provider], { q: 'thunder' });
    expect(result.recordings[0].id).toBe('p:2');
  });

  it('uses duration sort by default when q is empty', async () => {
    const short = rec({ id: 'p:1', duration_sec: 30 });
    const long = rec({ id: 'p:2', duration_sec: 3600 });
    const provider = mockProvider('p', [short, long]);
    const result = await searchAll([provider], {});
    expect(result.recordings[0].id).toBe('p:2');
  });

  it('respects explicit sort=duration even when q is set', async () => {
    const longNoMatch = rec({ id: 'p:1', title: 'untitled', duration_sec: 7200 });
    const shortMatch = rec({ id: 'p:2', title: 'loon call', species: 'Common Loon', duration_sec: 30 });
    const provider = mockProvider('p', [longNoMatch, shortMatch]);
    const result = await searchAll([provider], { q: 'loon', sort: 'duration' });
    expect(result.recordings[0].id).toBe('p:1');
  });

  it('respects explicit sort=relevance even with no q (zero scores → duration tiebreak)', async () => {
    const short = rec({ id: 'p:1', duration_sec: 30 });
    const long = rec({ id: 'p:2', duration_sec: 3600 });
    const provider = mockProvider('p', [short, long]);
    const result = await searchAll([provider], { sort: 'relevance' });
    expect(result.recordings[0].id).toBe('p:2');
  });

  it('breaks relevance ties by duration desc', async () => {
    const shortMatch = rec({ id: 'p:1', species: 'Common Loon', title: 'Common Loon', duration_sec: 30 });
    const longMatch = rec({ id: 'p:2', species: 'Common Loon', title: 'Common Loon', duration_sec: 3600 });
    const provider = mockProvider('p', [shortMatch, longMatch]);
    const result = await searchAll([provider], { q: 'common loon' });
    expect(result.recordings[0].id).toBe('p:2');
  });

  it('does not match "loon" inside "Loonse" (word-boundary check)', async () => {
    const placeName = rec({ id: 'p:1', title: 'Loonse heath', duration_sec: 3600 });
    const noMatchAtAll = rec({ id: 'p:2', title: 'thunder', duration_sec: 60 });
    const provider = mockProvider('p', [placeName, noMatchAtAll]);
    const result = await searchAll([provider], { q: 'loon' });
    // Both score 0, tiebreak by duration → placeName first. The point: no relevance points awarded for "Loonse".
    expect(result.recordings[0].id).toBe('p:1');
    expect(result.recordings[1].id).toBe('p:2');
  });

  it('scores tag whole-word matches', async () => {
    const taggedHit = rec({ id: 'p:1', title: 'recording', tags: ['birds', 'loon', 'lake'], duration_sec: 30 });
    const noMatch = rec({ id: 'p:2', title: 'recording', tags: ['unrelated'], duration_sec: 3600 });
    const provider = mockProvider('p', [taggedHit, noMatch]);
    const result = await searchAll([provider], { q: 'loon' });
    expect(result.recordings[0].id).toBe('p:1');
  });
});
