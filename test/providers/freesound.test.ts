import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreesoundProvider } from '../../src/providers/freesound';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('FreesoundProvider', () => {
  const provider = new FreesoundProvider('test-api-key');

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('freesound');
  });

  it('search includes API key in request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });
    await provider.search({ q: 'rain' });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('token=test-api-key');
  });

  it('search transforms response with string geotag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{
          id: 42,
          name: 'Rain on roof',
          tags: ['rain', 'weather', 'field-recording'],
          license: 'https://creativecommons.org/publicdomain/zero/1.0/',
          geotag: '51.5 -0.12',
          duration: 120.5,
          created: '2024-01-15T10:30:00',
          previews: { 'preview-hq-mp3': 'https://freesound.org/data/previews/42/42-hq.mp3' },
        }],
      }),
    });

    const results = await provider.search({ q: 'rain' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('freesound:42');
    expect(results[0].lat).toBe(51.5);
    expect(results[0].lng).toBe(-0.12);
    expect(results[0].license).toBe('cc0');
    expect(results[0].duration_sec).toBe(120);
  });

  it('handles null geotag', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        results: [{
          id: 43,
          name: 'No location',
          tags: [],
          license: 'Attribution',
          geotag: null,
          duration: 60,
          created: '2024-01-01',
          previews: { 'preview-hq-mp3': 'https://example.com/audio.mp3' },
        }],
      }),
    });

    const results = await provider.search({ q: 'test' });
    expect(results[0].lat).toBeNull();
    expect(results[0].lng).toBeNull();
  });

  it('search with geo params uses geofilt filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ count: 0, results: [] }),
    });
    await provider.search({ lat: 40, lng: -74, radius_km: 50 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('filter=');
    expect(calledUrl).toContain('geofilt');
  });

  it('rejects on API errors so searchAll reports the provider as failed', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(provider.search({ q: 'x' } as any)).rejects.toThrow(/401/);
  });

  it('returns [] for an empty result set', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ count: 0, results: [] }) });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });
});
