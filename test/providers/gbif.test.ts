import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GBIFProvider } from '../../src/providers/gbif';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock response for species resolve (returns no match so it falls back to q param)
const speciesNoMatch = {
  ok: true,
  json: async () => ({ results: [] }),
};

describe('GBIFProvider', () => {
  const provider = new GBIFProvider();

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('gbif');
  });

  it('has correct rate limit', () => {
    expect(provider.rateLimit).toEqual({ requests: 3000, window_ms: 60000 });
  });

  it('search transforms response to Recording[]', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        offset: 0,
        limit: 20,
        count: 1,
        results: [{
          key: 12345,
          species: 'Turdus merula',
          genericName: 'Turdus',
          decimalLatitude: 51.5,
          decimalLongitude: -0.1,
          eventDate: '2024-05-10',
          license: 'CC_BY_4_0',
          basisOfRecord: 'HUMAN_OBSERVATION',
          country: 'United Kingdom',
          media: [{
            type: 'Sound',
            identifier: 'https://example.com/audio/12345.mp3',
            format: 'audio/mpeg',
          }],
        }],
      }),
    });

    const results = await provider.search({ q: 'blackbird' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('gbif:12345');
    expect(results[0].provider).toBe('gbif');
    expect(results[0].title).toBe('Turdus merula');
    expect(results[0].lat).toBe(51.5);
    expect(results[0].lng).toBe(-0.1);
    expect(results[0].species).toBe('Turdus merula');
    expect(results[0].license).toBe('cc-by-4.0');
    expect(results[0].stream_url).toBe('/stream/gbif/12345');
    expect(results[0].recorded_at).toBe('2024-05-10');
    expect(results[0].tags).toContain('HUMAN_OBSERVATION');
    expect(results[0].tags).toContain('United Kingdom');
  });

  it('search includes mediaType=Sound param', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ offset: 0, limit: 20, count: 0, results: [] }),
    });
    await provider.search({ q: 'test' });
    const calledUrl = mockFetch.mock.calls[2][0];
    expect(calledUrl).toContain('mediaType=Sound');
  });

  it('search builds geo range params from lat/lng/radius', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ offset: 0, limit: 20, count: 0, results: [] }),
    });
    await provider.search({ lat: 40, lng: -74, radius_km: 50 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('decimalLatitude=');
    expect(calledUrl).toContain('decimalLongitude=');
    // Should not contain the exact value, but a range
    expect(calledUrl).not.toContain('decimalLatitude=40&');
  });

  it('search filters out occurrences without Sound media', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        offset: 0, limit: 20, count: 2,
        results: [
          {
            key: 1, species: 'Has Sound', media: [
              { type: 'Sound', identifier: 'https://example.com/a.mp3' },
            ],
          },
          {
            key: 2, species: 'No Sound', media: [
              { type: 'StillImage', identifier: 'https://example.com/b.jpg' },
            ],
          },
        ],
      }),
    });

    const results = await provider.search({ q: 'test' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('gbif:1');
  });

  it('normalizes license strings correctly', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        offset: 0, limit: 20, count: 3,
        results: [
          { key: 1, license: 'CC_BY_4_0', media: [{ type: 'Sound', identifier: 'a' }] },
          { key: 2, license: 'CC0_1_0', media: [{ type: 'Sound', identifier: 'b' }] },
          { key: 3, license: 'CC_BY_NC_4_0', media: [{ type: 'Sound', identifier: 'c' }] },
        ],
      }),
    });

    const results = await provider.search({ q: 'test' });
    expect(results[0].license).toBe('cc-by-4.0');
    expect(results[1].license).toBe('cc0');
    expect(results[2].license).toBe('cc-by-nc-4.0');
  });

  it('getStreamUrl returns audio identifier', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 12345,
        media: [
          { type: 'StillImage', identifier: 'https://example.com/photo.jpg' },
          { type: 'Sound', identifier: 'https://example.com/audio/12345.mp3' },
        ],
      }),
    });
    const url = await provider.getStreamUrl('12345');
    expect(url).toBe('https://example.com/audio/12345.mp3');
  });

  it('getStreamUrl returns null when no sound media', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 99,
        media: [{ type: 'StillImage', identifier: 'https://example.com/photo.jpg' }],
      }),
    });
    const url = await provider.getStreamUrl('99');
    expect(url).toBeNull();
  });

  it('getRecording returns normalized recording', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        key: 555,
        species: 'Parus major',
        decimalLatitude: 52.0,
        decimalLongitude: 4.3,
        eventDate: '2024-01-01',
        license: 'CC0_1_0',
        media: [{ type: 'Sound', identifier: 'https://example.com/555.mp3' }],
      }),
    });
    const rec = await provider.getRecording('555');
    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('gbif:555');
    expect(rec!.species).toBe('Parus major');
    expect(rec!.license).toBe('cc0');
  });

  it('getRecording returns null on not found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const rec = await provider.getRecording('999');
    expect(rec).toBeNull();
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });

  it('handles fetch throw in getRecording', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const rec = await provider.getRecording('123');
    expect(rec).toBeNull();
  });

  it('handles fetch throw in getStreamUrl', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const url = await provider.getStreamUrl('123');
    expect(url).toBeNull();
  });

  it('uses offset pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ offset: 0, limit: 20, count: 0, results: [] }),
    });
    await provider.search({ page: 3, per_page: 10 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('offset=20');
    expect(calledUrl).toContain('limit=10');
  });

  it('returns empty array when no query params given', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ offset: 0, limit: 20, count: 0, results: [] }),
    });
    const results = await provider.search({});
    expect(results).toEqual([]);
  });

  it('falls back to genericName when species is missing', async () => {
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // vernacular
    mockFetch.mockResolvedValueOnce(speciesNoMatch); // scientific
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        offset: 0, limit: 20, count: 1,
        results: [{
          key: 77,
          genericName: 'Corvus',
          media: [{ type: 'Sound', identifier: 'https://example.com/77.mp3' }],
        }],
      }),
    });
    const results = await provider.search({ q: 'crow' });
    expect(results[0].title).toBe('Corvus');
    expect(results[0].species).toBeNull();
  });
});
