import { AutoRouter, cors, json, error } from 'itty-router';
import type { Env, Provider, UnifiedQuery, UserRecordingMeta } from './types';
import { XenoCantoProvider } from './providers/xenocanto';
import { FreesoundProvider } from './providers/freesound';
import { INaturalistProvider } from './providers/inaturalist';
import { GBIFProvider } from './providers/gbif';
import { NPSProvider } from './providers/nps';
import { LOCProvider } from './providers/loc';
import { MacaulayProvider } from './providers/macaulay';

import { AporeeProvider } from './providers/aporee';
import { UserProvider } from './providers/user';
import { WikimediaProvider } from './providers/wikimedia';
import { EuropeanaProvider } from './providers/europeana';
import { BirdWeatherProvider } from './providers/birdweather';
import { searchAll } from './search';
import { streamRecording } from './stream';
import { CacheLayer } from './cache';
import { requireBearer, ownerIdFor } from './auth';
import { getFavorites, upsertFavorite, removeFavorite } from './user/favorites';
import { listSets, getSet, upsertSet, deleteSet, publishSet, unpublishSet, getPublicSet } from './user/sets';
import { importRecording } from './user/import';
import type { Favorite, FieldSet, Recording } from './types';

function buildProviders(env: Env): Provider[] {
  return [
    new XenoCantoProvider(env.XENOCANTO_API_KEY),
    new FreesoundProvider(env.FREESOUND_API_KEY),
    new INaturalistProvider(),
    new GBIFProvider(),
    new NPSProvider(env.CACHE),
    new LOCProvider(),
    new MacaulayProvider(),

    new AporeeProvider(),
    new UserProvider(env.UPLOADS),
    new WikimediaProvider(),
    new EuropeanaProvider(),
    new BirdWeatherProvider(),
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
      endpoints: [
        '/search', '/stream/:provider/:id', '/providers', '/categories',
        '/upload', '/my-recordings',
        '/user/favorites', '/user/sets', '/user/sets/:id', '/user/sets/:id/publish',
        '/sets/public/:slug',
      ],
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
      { name: 'macaulay', description: 'Macaulay Library (Cornell Lab) bird & wildlife audio', has_geo: true },

      { name: 'aporee', description: 'Radio Aporee global sound map', has_geo: true },
      { name: 'user', description: 'Your uploaded field recordings', has_geo: true },
      { name: 'wikimedia', description: 'Wikimedia Commons audio files', has_geo: true },
      { name: 'europeana', description: 'Europeana cultural heritage sounds', has_geo: true },
      { name: 'birdweather', description: 'BirdWeather AI-detected bird audio', has_geo: true },
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
      radius_km: url.searchParams.has('radius_km')
        ? Number(url.searchParams.get('radius_km'))
        : url.searchParams.has('radius')
          ? Number(url.searchParams.get('radius'))
          : undefined,
      type: url.searchParams.get('type') ?? undefined,
      license: url.searchParams.get('license') ?? undefined,
      provider: url.searchParams.get('provider') ?? undefined,
      page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
      per_page: url.searchParams.has('per_page') ? Number(url.searchParams.get('per_page')) : undefined,
      min_duration: url.searchParams.has('min_duration') ? Number(url.searchParams.get('min_duration')) : undefined,
      sort: (url.searchParams.get('sort') as 'duration' | 'date' | 'relevance') ?? undefined,
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

  router.get('/stream/:provider/:id+', async (request: Request, env: Env) => {
    const { provider: providerName, id } = (request as any).params;

    // User uploads served directly from R2
    if (providerName === 'user') {
      const listed = await env.UPLOADS.list({ prefix: `audio/${id}` });
      const obj = listed.objects[0];
      if (!obj) return error(404, 'Recording not found');
      const file = await env.UPLOADS.get(obj.key);
      if (!file) return error(404, 'Recording not found');

      const headers = new Headers();
      headers.set('Content-Type', file.httpMetadata?.contentType || 'audio/mpeg');
      headers.set('Access-Control-Allow-Origin', '*');
      if (file.size) headers.set('Content-Length', String(file.size));
      headers.set('Accept-Ranges', 'bytes');
      return new Response(file.body, { status: 200, headers });
    }

    const providers = buildProviders(env);
    const provider = providers.find((p) => p.name === providerName);
    if (!provider) return error(404, `Unknown provider: ${providerName}`);

    const rangeHeader = request.headers.get('Range');
    return streamRecording(provider, id, rangeHeader);
  });

  // ===== Upload API =====
  router.post('/upload', async (request: Request, env: Env) => {
    try {
      const formData = await request.formData();
      const file = formData.get('audio') as File | null;
      if (!file) return error(400, 'No audio file provided');

      const title = (formData.get('title') as string) || file.name;
      const lat = formData.get('lat') ? Number(formData.get('lat')) : null;
      const lng = formData.get('lng') ? Number(formData.get('lng')) : null;
      const tags = (formData.get('tags') as string || '').split(',').map(t => t.trim()).filter(Boolean);
      const species = (formData.get('species') as string) || null;
      const notes = (formData.get('notes') as string) || '';
      const recordedAt = (formData.get('recorded_at') as string) || null;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = file.name.split('.').pop() || 'mp3';
      const audioKey = `audio/${id}.${ext}`;

      // Store audio in R2
      await env.UPLOADS.put(audioKey, file.stream(), {
        httpMetadata: { contentType: file.type || 'audio/mpeg' },
      });

      // Store metadata
      const meta: UserRecordingMeta = {
        id,
        title,
        lat,
        lng,
        tags,
        species,
        recorded_at: recordedAt,
        uploaded_at: new Date().toISOString(),
        duration_sec: null, // could be extracted client-side
        filename: `${id}.${ext}`,
        notes,
      };

      await env.UPLOADS.put(`meta/${id}.json`, JSON.stringify(meta), {
        httpMetadata: { contentType: 'application/json' },
      });

      return json({ ok: true, id, recording: meta });
    } catch (e: any) {
      return error(500, `Upload failed: ${e.message}`);
    }
  });

  // List user recordings
  router.get('/my-recordings', async (request: Request, env: Env) => {
    const listed = await env.UPLOADS.list({ prefix: 'meta/' });
    const recordings: UserRecordingMeta[] = [];

    for (const obj of listed.objects) {
      const data = await env.UPLOADS.get(obj.key);
      if (!data) continue;
      try {
        recordings.push(JSON.parse(await data.text()));
      } catch { /* skip */ }
    }

    recordings.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
    return json({ recordings, total: recordings.length });
  });

  // Delete user recording
  router.delete('/upload/:id', async (request: Request, env: Env) => {
    const { id } = (request as any).params;
    // Delete meta and audio
    await env.UPLOADS.delete(`meta/${id}.json`);
    const listed = await env.UPLOADS.list({ prefix: `audio/${id}` });
    for (const obj of listed.objects) {
      await env.UPLOADS.delete(obj.key);
    }
    return json({ ok: true });
  });

  router.delete('/cache', async (request: Request, env: Env) => {
    const listed = await env.CACHE.list({ prefix: 'search/' });
    let deleted = 0;
    for (const obj of listed.objects) {
      await env.CACHE.delete(obj.key);
      deleted++;
    }
    return json({ ok: true, deleted });
  });

  // ===== User favorites (auth-gated) =====
  router.get('/user/favorites', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    return json(await getFavorites(env.UPLOADS, ownerId));
  });

  router.post('/user/favorites', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const fav = (await request.json()) as Favorite;
    if (!fav?.fav_id || !fav?.recording) return error(400, 'fav_id and recording required');
    await upsertFavorite(env.UPLOADS, ownerId, fav);
    return json({ ok: true });
  });

  router.delete('/user/favorites/:favId', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const { favId } = (request as any).params;
    await removeFavorite(env.UPLOADS, ownerId, favId);
    return json({ ok: true });
  });

  /**
   * Star → import: client posts the AAC-m4a-transcoded audio + a Recording snapshot.
   * Worker streams the audio into UPLOADS and writes a UserRecordingMeta so the
   * UserProvider auto-surfaces it in subsequent searches. Idempotent — re-stars
   * of the same recording.id return deduped:true without re-uploading.
   */
  router.post('/user/favorites/import', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;

    let form: FormData;
    try { form = await request.formData(); }
    catch { return error(400, 'multipart form-data required'); }

    const audio = form.get('audio') as File | null;
    const recordingJson = form.get('recording') as string | null;
    if (!audio) return error(400, 'audio field required');
    if (!recordingJson) return error(400, 'recording field required');

    let recording: Recording;
    try { recording = JSON.parse(recordingJson); }
    catch { return error(400, 'recording must be valid JSON'); }
    if (!recording.id || !recording.provider) return error(400, 'recording.id and recording.provider required');

    try {
      const result = await importRecording(env.UPLOADS, recording, audio.stream(), audio.size);
      return json(result);
    } catch (e: any) {
      return error(500, `Import failed: ${e.message}`);
    }
  });

  // ===== User sets (auth-gated) =====
  router.get('/user/sets', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    return json({ sets: await listSets(env.UPLOADS, ownerId) });
  });

  router.get('/user/sets/:setId', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const { setId } = (request as any).params;
    const set = await getSet(env.UPLOADS, ownerId, setId);
    if (!set) return error(404, 'Set not found');
    return json(set);
  });

  router.post('/user/sets', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const set = (await request.json()) as FieldSet;
    if (!set?.set_id || !set?.slug) return error(400, 'set_id and slug required');
    set.owner_id = ownerId;
    set.version = 1;
    await upsertSet(env.UPLOADS, ownerId, set);
    return json({ ok: true, set_id: set.set_id });
  });

  router.delete('/user/sets/:setId', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const { setId } = (request as any).params;
    await deleteSet(env.UPLOADS, ownerId, setId);
    return json({ ok: true });
  });

  router.post('/user/sets/:setId/publish', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const { setId } = (request as any).params;
    const set = await publishSet(env.UPLOADS, ownerId, setId);
    if (!set) return error(404, 'Set not found');
    return json({ ok: true, slug: set.slug, public_url: `/sets/public/${set.slug}` });
  });

  router.delete('/user/sets/:setId/publish', async (request: Request, env: Env) => {
    const denial = await requireBearer(request, env);
    if (denial) return denial;
    const ownerId = await ownerIdFor(request, env);
    const { setId } = (request as any).params;
    const set = await unpublishSet(env.UPLOADS, ownerId, setId);
    if (!set) return error(404, 'Set not found');
    return json({ ok: true });
  });

  // ===== Public sets (no auth) =====
  router.get('/sets/public/:slug', async (request: Request, env: Env) => {
    const { slug } = (request as any).params;
    const set = await getPublicSet(env.UPLOADS, slug);
    if (!set) return error(404, 'Public set not found');
    return json(set);
  });

  router.all('*', (request: Request, env: Env) => env.ASSETS.fetch(request));

  return router;
}
