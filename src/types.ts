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
  /** Bearer token for /user/* and /user/sets/:id/publish endpoints. Set via `wrangler secret put OWNER_TOKEN`. */
  OWNER_TOKEN: string;
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

/** A starred recording with optional cue + tagging. */
export interface Favorite {
  fav_id: string;                 // uuid
  recording: Recording;           // full snapshot at time of star
  in_sec: number;                 // 0 = file start
  out_sec: number;                // 0 = file end
  loop_on: boolean;
  sum_to_mono: boolean;
  gain_db: number;
  tags: string[];                 // free-form user tags
  set_ids: string[];              // sets this fav belongs to (denormalised; sets are source of truth)
  saved_at: string;               // ISO 8601
  notes: string;
}

/** A named collection of favorites + their cue settings. */
export interface FieldSet {
  version: 1;
  set_id: string;                 // uuid
  owner_id: string;
  name: string;
  slug: string;                   // url-safe; required when is_public
  is_public: boolean;
  updated_at: string;             // ISO 8601
  entries: SetEntry[];
}

export interface SetEntry {
  fav_id: string;                 // matches a Favorite
  recording: Recording;           // snapshot
  in_sec: number;
  out_sec: number;
  loop_on: boolean;
  sum_to_mono: boolean;
  gain_db: number;
  notes: string;
}

/** Wrapper persisted at favorites/<ownerId>.json */
export interface FavoritesFile {
  version: 1;
  owner_id: string;
  updated_at: string;
  favorites: Favorite[];
}
