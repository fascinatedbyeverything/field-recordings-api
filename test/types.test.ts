import { describe, it, expect } from 'vitest';
import type { Recording, UnifiedQuery } from '../src/types';

describe('Recording type', () => {
  it('should accept a valid recording object', () => {
    const recording: Recording = {
      id: 'freesound:12345',
      title: 'Dawn chorus',
      provider: 'freesound',
      lat: -3.12,
      lng: -60.02,
      duration_sec: 180,
      tags: ['birds', 'rainforest'],
      species: 'mixed',
      license: 'cc0',
      stream_url: '/stream/freesound/12345',
      recorded_at: '2024-03-15T06:00:00Z',
    };
    expect(recording.id).toBe('freesound:12345');
    expect(recording.provider).toBe('freesound');
  });
});

describe('UnifiedQuery type', () => {
  it('should accept a valid query', () => {
    const query: UnifiedQuery = { q: 'birds' };
    expect(query.q).toBe('birds');
  });

  it('should accept geo params', () => {
    const query: UnifiedQuery = { lat: 10, lng: 20, radius_km: 100 };
    expect(query.lat).toBe(10);
  });
});
