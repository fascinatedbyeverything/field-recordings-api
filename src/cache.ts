import type { SearchResult } from './types';

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export class CacheLayer {
  private r2: R2Bucket;

  constructor(r2: R2Bucket) {
    this.r2 = r2;
  }

  async getSearch(queryHash: string): Promise<SearchResult | null> {
    try {
      const obj = await this.r2.get(`search/${queryHash}`);
      if (!obj) return null;
      const expires = Number(obj.customMetadata?.expires ?? 0);
      if (Date.now() > expires) return null;
      return await obj.json<SearchResult>();
    } catch {
      return null;
    }
  }

  async putSearch(queryHash: string, data: SearchResult): Promise<void> {
    try {
      await this.r2.put(`search/${queryHash}`, JSON.stringify(data), {
        customMetadata: { expires: String(Date.now() + SEARCH_TTL_MS) },
      });
    } catch {
      // Cache write failure is non-fatal
    }
  }

  hashQuery(params: Record<string, string>): string {
    const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    let hash = 2166136261;
    for (let i = 0; i < sorted.length; i++) {
      hash ^= sorted.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
  }
}
