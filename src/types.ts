export interface Recording {
  id: string;              // "provider:sourceId"
  title: string;
  provider: string;
  lat: number | null;
  lng: number | null;
  duration_sec: number | null;
  tags: string[];
  species: string | null;
  license: string;
  stream_url: string;
  thumbnail_url?: string;
  recorded_at: string | null;
}

export interface UnifiedQuery {
  q?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  type?: string;
  license?: string;
  provider?: string;
  page?: number;
  per_page?: number;
  min_duration?: number;
  sort?: 'duration' | 'date';
}

export interface SearchResult {
  recordings: Recording[];
  total: number;
  page: number;
  providers_queried: string[];
  providers_failed: string[];
}

export interface Provider {
  name: string;
  search(query: UnifiedQuery): Promise<Recording[]>;
  getRecording(id: string): Promise<Recording | null>;
  getStreamUrl(id: string): Promise<string | null>;
  rateLimit: { requests: number; window_ms: number };
}

export interface Env {
  CACHE: R2Bucket;
  UPLOADS: R2Bucket;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  FREESOUND_API_KEY: string;
  XENOCANTO_API_KEY: string;
}

export interface UserRecordingMeta {
  id: string;
  title: string;
  lat: number | null;
  lng: number | null;
  tags: string[];
  species: string | null;
  recorded_at: string | null;
  uploaded_at: string;
  duration_sec: number | null;
  filename: string;
  notes: string;
}
