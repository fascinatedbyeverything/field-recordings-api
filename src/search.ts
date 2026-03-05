import type { Provider, UnifiedQuery, SearchResult } from './types';

export async function searchAll(
  providers: Provider[],
  query: UnifiedQuery,
): Promise<SearchResult> {
  const targetProviders = query.provider
    ? providers.filter((p) => p.name === query.provider)
    : providers;

  const results = await Promise.allSettled(
    targetProviders.map((p) => p.search(query)),
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
      failed.push(providerName);
    }
  }

  let filtered = recordings;

  // Filter by minimum duration
  if (query.min_duration) {
    filtered = filtered.filter(
      (r) => r.duration_sec !== null && r.duration_sec >= query.min_duration!,
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
