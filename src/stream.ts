import type { Provider } from './types';

export async function streamRecording(
  provider: Provider,
  id: string,
  rangeHeader: string | null,
): Promise<Response> {
  const url = await provider.getStreamUrl(id);
  if (!url) {
    return new Response(JSON.stringify({ error: 'Recording not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers: Record<string, string> = {};
  if (rangeHeader) headers['Range'] = rangeHeader;

  try {
    const upstream = await fetch(url, { headers });

    const responseHeaders = new Headers();
    const contentType = upstream.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);

    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);

    const contentRange = upstream.headers.get('Content-Range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    const acceptRanges = upstream.headers.get('Accept-Ranges');
    if (acceptRanges) responseHeaders.set('Accept-Ranges', acceptRanges);

    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream fetch failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
