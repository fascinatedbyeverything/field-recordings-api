import { describe, it, expect, beforeEach } from 'vitest';
import { NPSProvider } from '../../src/providers/nps';

const SAMPLE_ENTRIES = [
  {
    id: 'yell-dawn-001',
    title: 'Dawn at Yellowstone Lake',
    category: 'soundscape',
    tags: ['dawn', 'lake', 'birds'],
    file_key: 'nps/audio/yell-dawn-001.mp3',
  },
  {
    id: 'grca-river-002',
    title: 'Colorado River Rapids',
    category: 'water',
    tags: ['river', 'rapids', 'canyon'],
    file_key: 'nps/audio/grca-river-002.mp3',
  },
  {
    id: 'yose-meadow-003',
    title: 'Yosemite Meadow Birds',
    category: 'soundscape',
    tags: ['birds', 'meadow', 'morning'],
    file_key: 'nps/audio/yose-meadow-003.mp3',
  },
];

function mockR2(entries = SAMPLE_ENTRIES) {
  return {
    get: async (key: string) => {
      if (key === 'nps/index.json') {
        return { json: async () => entries };
      }
      return null;
    },
  } as unknown as R2Bucket;
}

describe('NPSProvider', () => {
  let provider: NPSProvider;

  beforeEach(() => {
    provider = new NPSProvider(mockR2());
  });

  it('has correct name and rateLimit', () => {
    expect(provider.name).toBe('nps');
    expect(provider.rateLimit).toEqual({ requests: 1000, window_ms: 60_000 });
  });

  describe('search', () => {
    it('returns all entries with no filters', async () => {
      const results = await provider.search({});
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('nps:yell-dawn-001');
      expect(results[0].provider).toBe('nps');
      expect(results[0].license).toBe('public-domain');
    });

    it('filters by q matching title', async () => {
      const results = await provider.search({ q: 'yellowstone' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Dawn at Yellowstone Lake');
    });

    it('filters by q matching tags', async () => {
      const results = await provider.search({ q: 'rapids' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('nps:grca-river-002');
    });

    it('q search is case-insensitive', async () => {
      const results = await provider.search({ q: 'BIRDS' });
      expect(results).toHaveLength(2);
    });

    it('filters by type (category)', async () => {
      const results = await provider.search({ type: 'soundscape' });
      expect(results).toHaveLength(2);
    });

    it('type filter is case-insensitive', async () => {
      const results = await provider.search({ type: 'Water' });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Colorado River Rapids');
    });

    it('combines q and type filters', async () => {
      const results = await provider.search({ q: 'birds', type: 'soundscape' });
      expect(results).toHaveLength(2);
    });

    it('returns empty array when nothing matches', async () => {
      const results = await provider.search({ q: 'nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('paginates results', async () => {
      const page1 = await provider.search({ per_page: 2, page: 1 });
      const page2 = await provider.search({ per_page: 2, page: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it('sets lat/lng to null (NPS has no geo data)', async () => {
      const results = await provider.search({});
      for (const r of results) {
        expect(r.lat).toBeNull();
        expect(r.lng).toBeNull();
      }
    });

    it('sets stream_url correctly', async () => {
      const results = await provider.search({});
      expect(results[0].stream_url).toBe('/stream/nps/yell-dawn-001');
    });

    it('returns empty array when index is missing', async () => {
      const emptyR2 = { get: async () => null } as unknown as R2Bucket;
      const p = new NPSProvider(emptyR2);
      const results = await p.search({ q: 'anything' });
      expect(results).toHaveLength(0);
    });
  });

  describe('getRecording', () => {
    it('returns a recording by id', async () => {
      const rec = await provider.getRecording('grca-river-002');
      expect(rec).not.toBeNull();
      expect(rec!.id).toBe('nps:grca-river-002');
      expect(rec!.title).toBe('Colorado River Rapids');
      expect(rec!.tags).toEqual(['river', 'rapids', 'canyon']);
    });

    it('returns null for unknown id', async () => {
      const rec = await provider.getRecording('does-not-exist');
      expect(rec).toBeNull();
    });
  });

  describe('getStreamUrl', () => {
    it('returns the R2 key path', async () => {
      const url = await provider.getStreamUrl('yell-dawn-001');
      expect(url).toBe('nps/audio/yell-dawn-001.mp3');
    });
  });
});
