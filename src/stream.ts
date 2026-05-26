import type { Provider } from './types';

// 2026-05-26: stream now returns a 302 redirect to the upstream provider's
// audio CDN URL instead of proxying the bytes through the Worker. Two reasons:
//   1. Worker proxying through `new Response(upstream.body, ...)` was
//      intermittently throwing into the global catch handler, returning 500
//      to AVPlayer with no useful diagnostic. AVPlayer follows 302 natively.
//   2. Eliminates Worker subrequest CPU/time pressure on every preview,
//      which scales linearly with library use.
// AVPlayer + browser <audio> both follow 302 fine. Range requests pass through
// to the CDN URL on the follow-up request, so seeking still works.
export async function streamRecording(
  provider: Provider,
  id: string,
  _rangeHeader: string | null,
): Promise<Response> {
  let url: string | null = null;
  try {
    url = await provider.getStreamUrl(id);
  } catch {
    return new Response(JSON.stringify({ error: 'Resolver failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (!url) {
    return new Response(JSON.stringify({ error: 'Recording not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
