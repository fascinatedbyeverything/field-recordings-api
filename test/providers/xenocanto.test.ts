import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XenoCantoProvider } from '../../src/providers/xenocanto';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('XenoCantoProvider', () => {
  const provider = new XenoCantoProvider('test-xc-key');

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('xenocanto');
  });

  it('includes API key in requests', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ numRecordings: '0', recordings: [] }),
    });
    await provider.search({ q: 'test' });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('key=test-xc-key');
  });

  it('uses v3 API endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ numRecordings: '0', recordings: [] }),
    });
    await provider.search({ q: 'test' });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/3/');
  });

  it('search transforms response to Recording[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        numRecordings: '1',
        recordings: [{
          id: '12345',
          gen: 'Turdus',
          sp: 'merula',
          en: 'Eurasian Blackbird',
          cnt: 'Brazil',
          loc: 'Amazon',
          lat: '-3.12',
          lon: '-60.02',
          type: 'song',
          lic: '//creativecommons.org/licenses/by-nc-sa/4.0/',
          file: 'https://xeno-canto.org/12345/download',
          'file-name': 'XC12345-blackbird.mp3',
          length: '1:30',
          date: '2024-03-15',
          time: '06:00',
        }],
      }),
    });

    const results = await provider.search({ q: 'blackbird' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('xenocanto:12345');
    expect(results[0].provider).toBe('xenocanto');
    expect(results[0].lat).toBe(-3.12);
    expect(results[0].lng).toBe(-60.02);
    expect(results[0].species).toBe('Turdus merula');
    expect(results[0].stream_url).toBe('/stream/xenocanto/12345');
    expect(results[0].license).toBe('cc-by-nc-sa-4.0');
    expect(results[0].duration_sec).toBe(90);
  });

  it('search with geo params builds correct query', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ numRecordings: '0', recordings: [] }),
    });
    await provider.search({ lat: 10, lng: 20 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('lat%3A10');
    expect(calledUrl).toContain('lon%3A20');
  });

  it('getStreamUrl returns download URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        recordings: [{ id: '999', file: 'https://xeno-canto.org/999/download' }],
      }),
    });
    const url = await provider.getStreamUrl('999');
    expect(url).toBe('https://xeno-canto.org/999/download');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });
});
