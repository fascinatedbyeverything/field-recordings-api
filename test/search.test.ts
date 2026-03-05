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
