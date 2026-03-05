import { AutoRouter, cors, json, error } from 'itty-router';
import type { Env } from './types';

export function createRouter() {
  const { preflight, corsify } = cors();
  const router = AutoRouter({
    before: [preflight],
    after: [corsify],
    catch: () => error(500, 'Internal Server Error'),
  });

  router.get('/', () =>
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
    ])
  );

  router.get('/categories', () =>
    json([
      'birds', 'mammals', 'amphibians', 'insects', 'reptiles', 'fish',
      'weather', 'ocean', 'forest', 'urban', 'river', 'desert',
      'cultural', 'folk', 'language',
    ])
  );

  router.get('/search', (request: Request, env: Env) => {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    if (!q && !lat) {
      return error(400, 'Provide q (search term) or lat/lng (location)');
    }
    return json({ recordings: [], total: 0, page: 1, providers_queried: [], providers_failed: [] });
  });

  router.get('/stream/:provider/:id', () => {
    return error(501, 'Not implemented yet');
  });

  router.all('*', () => error(404, 'Not found'));

  return router;
}
