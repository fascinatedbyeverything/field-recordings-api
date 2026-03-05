import type { Provider, UnifiedQuery, Recording } from '../types';

export abstract class BaseProvider implements Provider {
  abstract name: string;
  abstract rateLimit: { requests: number; window_ms: number };

  abstract search(query: UnifiedQuery): Promise<Recording[]>;
  abstract getRecording(id: string): Promise<Recording | null>;
  abstract getStreamUrl(id: string): Promise<string | null>;

  protected makeId(sourceId: string | number): string {
    return `${this.name}:${sourceId}`;
  }

  protected makeStreamUrl(sourceId: string | number): string {
    return `/stream/${this.name}/${sourceId}`;
  }
}
