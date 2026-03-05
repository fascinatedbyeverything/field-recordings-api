# Field Recordings API — Design Document

Date: 2026-03-05

## Problem

There are dozens of public domain and open source field recording libraries scattered across the internet — covering wildlife, ocean soundscapes, forests, urban environments, weather, and cultural recordings. No unified interface exists to search, filter, and stream from all of them.

## Solution

A Cloudflare Worker REST API that unifies 6 field recording sources behind a single endpoint. Clients search/filter by location, species, biome, or keyword. Audio is proxied through the Worker. Metadata is cached on R2.

## Architecture

**Approach:** Real-time proxy with R2 caching (Approach A). The Worker fans out queries to provider APIs in parallel, normalizes results into a common schema, and returns unified responses. No pre-indexing or database required.

## API Endpoints

```
GET /search?q=&lat=&lng=&radius=&type=&license=&provider=
GET /recordings/:provider/:id
GET /stream/:provider/:id
GET /regions?bounds=sw_lat,sw_lng,ne_lat,ne_lng
GET /providers
GET /categories
```

## Common Recording Schema

```json
{
  "id": "freesound:12345",
  "title": "Dawn chorus, Amazon basin",
  "provider": "freesound",
  "lat": -3.12,
  "lng": -60.02,
  "duration_sec": 180,
  "tags": ["birds", "rainforest", "dawn"],
  "species": "mixed",
  "license": "cc0",
  "stream_url": "/stream/freesound/12345",
  "thumbnail_url": "...",
  "recorded_at": "2024-03-15T06:00:00Z"
}
```

## Provider Adapters

Each source implements a common interface:

```typescript
interface Provider {
  name: string
  search(query: UnifiedQuery): Promise<Recording[]>
  stream(id: string): Promise<Response>
  rateLimit: { requests: number, windowMs: number }
}
```

Phase 1 providers:

| Provider | Auth | Rate Limits |
|----------|------|-------------|
| Freesound | API key (free) | Generous |
| Xeno-canto | None | 1000 req/hr |
| iNaturalist | None | 100 req/min |
| GBIF | Account for downloads | Generous |
| NPS | None (scraped) | N/A |
| Library of Congress | None | Rate-limited |

## Caching (R2)

- Metadata cache: search results by query hash, 24hr TTL
- NPS audio files: mirrored to R2 (public domain, small collection)
- Geo-index tiles: built incrementally as searches happen
- Spectrogram thumbnails: optional, cached on demand

Audio from non-PD providers is NOT stored — streamed on demand via proxy.

Estimated R2 usage: under 10 GB.

## Project Structure

```
field-recordings-api/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── router.ts
│   ├── types.ts
│   ├── cache.ts
│   ├── providers/
│   │   ├── base.ts
│   │   ├── freesound.ts
│   │   ├── xenocanto.ts
│   │   ├── inaturalist.ts
│   │   ├── gbif.ts
│   │   ├── nps.ts
│   │   └── loc.ts
│   ├── search.ts
│   └── stream.ts
└── test/
    └── providers/
```

TypeScript. Minimal deps — itty-router for routing, Workers API for everything else.

## Constraints

- Public API, no user accounts (consumer app handles auth)
- Client-side audio mixing (app handles spatial layering)
- Respect upstream rate limits with caching and queuing
- Only redistribute CC0/public domain audio; all others proxied

## Out of Scope

- User accounts and personalization
- Server-side audio mixing
- Full pre-indexing of all sources
- Commercial-only sources (Macaulay Library, etc.)
