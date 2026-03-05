import { AutoRouter, cors, json, error } from 'itty-router';
import type { Env, Provider, UnifiedQuery } from './types';
import { XenoCantoProvider } from './providers/xenocanto';
import { FreesoundProvider } from './providers/freesound';
import { INaturalistProvider } from './providers/inaturalist';
import { GBIFProvider } from './providers/gbif';
import { NPSProvider } from './providers/nps';
import { LOCProvider } from './providers/loc';
import { searchAll } from './search';
import { streamRecording } from './stream';
import { CacheLayer } from './cache';

function buildProviders(env: Env): Provider[] {
  return [
    new XenoCantoProvider(env.XENOCANTO_API_KEY),
    new FreesoundProvider(env.FREESOUND_API_KEY),
    new INaturalistProvider(),
    new GBIFProvider(),
    new NPSProvider(env.CACHE),
    new LOCProvider(),
  ];
}

export function createRouter() {
  const { preflight, corsify } = cors();
  const router = AutoRouter({
    before: [preflight],
    after: [corsify],
    catch: () => error(500, 'Internal Server Error'),
  });

  router.get('/api', () =>
    json({
      name: 'Field Recordings API',
      version: '0.1.0',
      endpoints: ['/search', '/stream/:provider/:id', '/providers', '/categories'],
    })
  );

  router.get('/providers', () =>
    json([
      { name: 'freesound', description: 'Freesound.org community sounds', has_geo: true },
      { name: 'xenocanto', description: 'Xeno-canto bird recordings', has_geo: true },
      { name: 'inaturalist', description: 'iNaturalist citizen science sounds', has_geo: true },
      { name: 'gbif', description: 'GBIF biodiversity sound records', has_geo: true },
      { name: 'nps', description: 'US National Park Service natural sounds', has_geo: false },
      { name: 'loc', description: 'Library of Congress field recordings', has_geo: false },
    ])
  );

  router.get('/categories', () =>
    json([
      'nature', 'birds', 'mammals', 'amphibians', 'insects', 'reptiles', 'fish',
      'weather', 'ocean', 'forest', 'river', 'desert',
      'urban', 'cultural', 'folk', 'language',
    ])
  );

  router.get('/search', async (request: Request, env: Env) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    if (!q && !lat) {
      return error(400, 'Provide q (search term) or lat/lng (location)');
    }

    const query: UnifiedQuery = {
      q: q ?? undefined,
      lat: lat ? Number(lat) : undefined,
      lng: url.searchParams.has('lng') ? Number(url.searchParams.get('lng')) : undefined,
      radius_km: url.searchParams.has('radius') ? Number(url.searchParams.get('radius')) : undefined,
      type: url.searchParams.get('type') ?? undefined,
      license: url.searchParams.get('license') ?? undefined,
      provider: url.searchParams.get('provider') ?? undefined,
      page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
      per_page: url.searchParams.has('per_page') ? Number(url.searchParams.get('per_page')) : undefined,
    };

    const cache = new CacheLayer(env.CACHE);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });
    const cacheKey = cache.hashQuery(params);

    const cached = await cache.getSearch(cacheKey);
    if (cached) return json(cached);

    const providers = buildProviders(env);
    const result = await searchAll(providers, query);

    await cache.putSearch(cacheKey, result);
    return json(result);
  });

  router.get('/stream/:provider/:id', async (request: Request, env: Env) => {
    const { provider: providerName, id } = (request as any).params;
    const providers = buildProviders(env);
    const provider = providers.find((p) => p.name === providerName);
    if (!provider) return error(404, `Unknown provider: ${providerName}`);

    const rangeHeader = request.headers.get('Range');
    return streamRecording(provider, id, rangeHeader);
  });

  router.all('*', (request: Request, env: Env) => env.ASSETS.fetch(request));

  return router;
}
