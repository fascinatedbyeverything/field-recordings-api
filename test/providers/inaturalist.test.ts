import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INaturalistProvider } from '../../src/providers/inaturalist';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('INaturalistProvider', () => {
  const provider = new INaturalistProvider();

  beforeEach(() => vi.clearAllMocks());

  it('has correct name', () => {
    expect(provider.name).toBe('inaturalist');
  });

  it('search adds sounds=true and transforms response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        total_results: 1,
        results: [{
          id: 999,
          species_guess: 'American Robin',
          observed_on: '2024-06-15',
          location: '40.7,-74.0',
          license_code: 'cc-by-nc',
          taxon: { name: 'Turdus migratorius', preferred_common_name: 'American Robin' },
          sounds: [{
            id: 5555,
            file_url: 'https://static.inaturalist.org/sounds/5555.m4a',
            license_code: 'cc-by-nc',
            file_content_type: 'audio/mp4',
          }],
          tags: [],
        }],
      }),
    });

    const results = await provider.search({ q: 'robin' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('inaturalist:999');
    expect(results[0].species).toBe('Turdus migratorius');
    expect(results[0].lat).toBe(40.7);
    expect(results[0].lng).toBe(-74.0);
  });

  it('search filters by location when lat/lng provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ total_results: 0, results: [] }),
    });
    await provider.search({ lat: 40, lng: -74, radius_km: 50 });
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('lat=40');
    expect(calledUrl).toContain('lng=-74');
    expect(calledUrl).toContain('radius=50');
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const results = await provider.search({ q: 'test' });
    expect(results).toEqual([]);
  });
});
