import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamRecording } from '../src/stream';
import type { Provider } from '../src/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('streamRecording', () => {
  const mockProvider: Provider = {
    name: 'test',
    rateLimit: { requests: 100, window_ms: 60000 },
    search: vi.fn(),
    getRecording: vi.fn(),
    getStreamUrl: vi.fn().mockResolvedValue('https://example.com/audio.mp3'),
  };

  beforeEach(() => vi.clearAllMocks());

  it('proxies audio with correct content-type', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('audio-data', {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '1000' },
      }),
    );
    const res = await streamRecording(mockProvider, '123', null);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });

  it('passes Range header for seeking', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('partial', {
        status: 206,
        headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-499/1000' },
      }),
    );
    await streamRecording(mockProvider, '123', 'bytes=0-499');
    const fetchOpts = mockFetch.mock.calls[0][1];
    expect(fetchOpts.headers['Range']).toBe('bytes=0-499');
  });

  it('returns 404 if provider has no stream URL', async () => {
    const noUrl: Provider = {
      ...mockProvider,
      getStreamUrl: vi.fn().mockResolvedValue(null),
    };
    const res = await streamRecording(noUrl, '123', null);
    expect(res.status).toBe(404);
  });
});
