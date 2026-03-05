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

  return {
    recordings,
    total: recordings.length,
    page: query.page ?? 1,
    providers_queried: queried,
    providers_failed: failed,
  };
}
