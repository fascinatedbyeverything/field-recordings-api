import type { Provider, UnifiedQuery, SearchResult } from './types';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Hard safety limit to prevent runaway pagination (Workers have 30s CPU limit)
const ABSOLUTE_MAX = 10000;
const DELAY_MS = 200; // delay between pages to avoid rate limits

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllPages(
  provider: Provider,
  query: UnifiedQuery,
): Promise<import('./types').Recording[]> {
  const all: import('./types').Recording[] = [];
  const pageSize = query.per_page ?? 200;

  for (let page = 1; ; page++) {
    const pageQuery = { ...query, page, per_page: pageSize };
    const results = await provider.search(pageQuery);
    all.push(...results);

    // Stop if provider returned fewer than requested (no more pages)
    if (results.length < pageSize) break;
    // Safety limit
    if (all.length >= ABSOLUTE_MAX) break;
    // Rate limit protection
    await delay(DELAY_MS);
  }

  return all;
}

export async function searchAll(
  providers: Provider[],
  query: UnifiedQuery,
): Promise<SearchResult> {
  const targetProviders = query.provider
    ? providers.filter((p) => p.name === query.provider)
    : providers;

  const results = await Promise.allSettled(
    targetProviders.map((p) => fetchAllPages(p, query)),
  );

  const recordings = [];
  const queried: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const providerName = targetProviders[i].name;
    queried.push(providerName);

    if (result.status === 'fulfilled') {
      recordings.push(...result.value);
    } else {
      console.error(`Provider ${providerName} failed:`, result.reason);
      failed.push(providerName);
    }
  }

  let filtered = recordings;

  // Geo filter: remove results outside the search radius
  if (query.lat !== undefined && query.lng !== undefined) {
    const maxKm = query.radius_km ?? 100;
    filtered = filtered.filter((r) => {
      if (r.lat === null || r.lng === null) return false;
      return haversineKm(query.lat!, query.lng!, r.lat, r.lng) <= maxKm;
    });
  }

  // Filter by minimum duration (keep results with unknown duration — don't exclude them)
  if (query.min_duration) {
    filtered = filtered.filter(
      (r) => r.duration_sec === null || r.duration_sec >= query.min_duration!,
    );
  }

  // Sort: longest first by default, or by date
  if (query.sort === 'date') {
    filtered.sort((a, b) => {
      if (!a.recorded_at) return 1;
      if (!b.recorded_at) return -1;
      return b.recorded_at.localeCompare(a.recorded_at);
    });
  } else {
    // Default: longest recordings first (ambient-friendly)
    filtered.sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0));
  }

  return {
    recordings: filtered,
    total: filtered.length,
    page: query.page ?? 1,
    providers_queried: queried,
    providers_failed: failed,
  };
}
