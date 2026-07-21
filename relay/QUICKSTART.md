# Quick Start Guide

The Earthly relay: a khatru-based Nostr relay with geo-aware search.

## What You Get

- **Composite event store** — indexes and small events in `./data/events-lmdb/`,
  with content above the upstream codec's 65,535-byte boundary in
  `./data/large-event-content.db`
- **bleve geo index** — `./data/search/` (derived data, rebuildable at any time)
- **1 MiB inline content policy** — enforced on writes and advertised through NIP-11
- **NIP-50 + Earthly extension grammar** — text, bbox, geo-relation, temporal, facet queries
- **`#g` viewport queries** — multi-precision geohash matching for map pan/zoom
- **NIP-40 expiry** — expired beacons/sightings are GC'd and never served

## Get Started

```bash
make dev      # Start the relay on ws://localhost:3334
```

## Query lanes

1. Regular filters → composite event store (large content is transparently rehydrated)
2. `#g` tag filters → geo index (any geohash precision 1–7 matches)
3. `search` filters → geo index via the extension grammar
   (`docs/GEO_SEARCH_REWRITE.md` §4; e.g. `playground bbox:16.1,48.1,16.7,48.4`)

Capability document: `GET /earthly-search` → grammar version + extensions.

## Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `--port` | 3334 | Listen port |
| `--data-dir` | ./data | Event store + index location |
| `--log-level` | info | debug logs every event/query |
| `--reset-db` | | Wipe event store (index too — it derives from it) |
| `--reset-index` | | Wipe index only (auto-rebuilds from LMDB on start) |
| `--reset-all` | | Both |
| `--reindex` | | Force full index rebuild on start |
| `--min-free-bytes` | 512 MB | Refuse writes below this free disk space |

The index self-heals: if it is empty (fresh/reset) while canonical events exist,
the relay reindexes automatically on startup. Back up both `events-lmdb/` and
`large-event-content.db`; neither can be reconstructed from the search index.
