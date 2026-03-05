import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LOCProvider } from '../../src/providers/loc';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LOCProvider', () => {
  const provider = new LOCProvider();

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('loc');
  });

  it('has correct rate limit', () => {
    expect(provider.rateLimit).toEqual({ requests: 200, window_ms: 60000 });
  });

  it('search builds correct URL with query params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await provider.search({ q: 'folk music', per_page: 10, page: 2 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('https://www.loc.gov/audio/');
    expect(calledUrl).toContain('fo=json');
    expect(calledUrl).toContain('q=folk+music');
    expect(calledUrl).toContain('c=10');
    expect(calledUrl).toContain('sp=2');
  });

  it('search transforms response to Recording[]', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          id: 'http://www.loc.gov/item/2018655107/',
          title: 'Appalachian field recording',
          date: '1939',
          description: ['Folk songs from Appalachia'],
          url: 'https://www.loc.gov/item/2018655107/',
          aka: [],
          subject: ['Folk music', 'Appalachian Region'],
          image_url: ['https://www.loc.gov/static/image.jpg'],
        }],
      }),
    });

    const results = await provider.search({ q: 'appalachian' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('loc:2018655107');
    expect(results[0].title).toBe('Appalachian field recording');
    expect(results[0].provider).toBe('loc');
    expect(results[0].lat).toBeNull();
    expect(results[0].lng).toBeNull();
    expect(results[0].duration_sec).toBeNull();
    expect(results[0].tags).toEqual(['Folk music', 'Appalachian Region']);
    expect(results[0].species).toBeNull();
    expect(results[0].license).toBe('public-domain');
    expect(results[0].stream_url).toBe('/stream/loc/2018655107');
    expect(results[0].thumbnail_url).toBe('https://www.loc.gov/static/image.jpg');
    expect(results[0].recorded_at).toBe('1939');
  });

  it('search handles missing image_url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          id: 'http://www.loc.gov/item/123/',
          title: 'No image item',
          date: null,
          description: [],
          url: '',
          aka: [],
          subject: [],
          image_url: [],
        }],
      }),
    });

    const results = await provider.search({ q: 'test' });
    expect(results[0].thumbnail_url).toBeUndefined();
    expect(results[0].recorded_at).toBeNull();
  });

  it('search uses defaults for per_page and page', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });
    await provider.search({ q: 'banjo' });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('c=20');
    expect(calledUrl).toContain('sp=1');
  });

  it('search handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });

  it('search handles fetch exceptions gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });

  it('getRecording fetches item detail', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        item: {
          title: 'Mountain songs',
          date: '1941',
          subjects: ['Folk music', 'Mountain life'],
        },
        resources: [],
      }),
    });

    const recording = await provider.getRecording('2018655107');
    expect(mockFetch.mock.calls[0][0]).toBe('https://www.loc.gov/item/2018655107/?fo=json');
    expect(recording).not.toBeNull();
    expect(recording!.id).toBe('loc:2018655107');
    expect(recording!.title).toBe('Mountain songs');
    expect(recording!.tags).toEqual(['Folk music', 'Mountain life']);
  });

  it('getRecording returns null on API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await provider.getRecording('999');
    expect(result).toBeNull();
  });

  it('getRecording returns null on fetch exception', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await provider.getRecording('999');
    expect(result).toBeNull();
  });

  it('getStreamUrl fetches item detail and finds audio URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        item: { title: 'Test' },
        resources: [{
          files: [
            { url: 'https://www.loc.gov/item/2018655107/thumb.jpg', mime_type: 'image/jpeg' },
            { url: 'https://www.loc.gov/item/2018655107/recording.mp3', mime_type: 'audio/mpeg' },
          ],
        }],
      }),
    });

    const url = await provider.getStreamUrl('2018655107');
    expect(mockFetch.mock.calls[0][0]).toBe('https://www.loc.gov/item/2018655107/?fo=json');
    expect(url).toBe('https://www.loc.gov/item/2018655107/recording.mp3');
  });

  it('getStreamUrl returns null when no audio files found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        item: { title: 'Test' },
        resources: [{
          files: [
            { url: 'https://example.com/image.jpg', mime_type: 'image/jpeg' },
          ],
        }],
      }),
    });

    const url = await provider.getStreamUrl('2018655107');
    expect(url).toBeNull();
  });

  it('getStreamUrl finds audio in second resource group', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        item: { title: 'Test' },
        resources: [
          { files: [{ url: 'https://example.com/doc.pdf', mime_type: 'application/pdf' }] },
          { files: [{ url: 'https://example.com/song.wav', mime_type: 'audio/wav' }] },
        ],
      }),
    });

    const url = await provider.getStreamUrl('123');
    expect(url).toBe('https://example.com/song.wav');
  });

  it('getStreamUrl returns null on API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const url = await provider.getStreamUrl('999');
    expect(url).toBeNull();
  });

  it('getStreamUrl returns null on fetch exception', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const url = await provider.getStreamUrl('999');
    expect(url).toBeNull();
  });
});
