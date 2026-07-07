# Geo-Aware Relay Search Rewrite

**Status:** Plan approved 2026-07-07. WP1–WP6 implemented same day (relay rewrite, geo index,
grammar both sides + golden vectors, facade, entity-search extension, AI tools). Open: the
mention-picker async rewiring (WP5 remainder) and WP7 VPS deployment/ops — both tracked as
follow-up tasks.

**Field note (Lane 1):** filter-verifying clients (nak, possibly applesauce) drop relay
results that don't literally match the `#g` filter. Publishers therefore emit
**multi-precision `g` tags** (tags.ts `setGeohash`, SPEC §1.2) — the relay-side precision
expansion alone is not enough. Both are in place.
**Owner docs:** SPEC.md (event model), docs/RELAY_STAGES.md (relay ops), docs/VPS_OPS.md (deployment).

## 1 Why

The relay (`relay/main.go`) is a repurposed radio-station relay running legacy khatru
(`github.com/fiatjaf/khatru` v0.19.1) with the Bluge full-text backend. Concrete failures:

- **2026-06-08 incident:** the Bluge index at `data/search/` grew to **86 GB across 68k
  un-merged segments**, filled the VPS disk (100%), and crash-looped the whole app (ENOSPC).
- **Log flood:** every event, query, and subscription is `log.Printf`'d unconditionally;
  under pm2 with no rotation this grows without bound.
- **Signed-event mutation bug:** the ingest hook appends a `description` tag to events
  *after* signing; khatru broadcasts the mutated object to live subscribers, who receive
  events whose tags no longer match the signature.
- **Dead code:** kind-31237 radio-station enrichment; a Blossom stub whose `LoadBlob`
  returns the literal string `"aaaaa"` (mapnolia owns blobs now).
- **No geo queries:** search is text-only over whatever tags happen to exist. The app needs
  viewport queries ("all sightings in this area") and geometry-relation queries.

This is a full rewrite of the relay plus a client search layer, not a patch.

## 2 Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D-01 | Migrate to the **`fiatjaf.com/nostr` monorepo** (khatru + eventstore + go-nostr unified) | Legacy repo is frozen; new eventstore ships a bleve backend (fiatjaf dropped bluge himself). No tagged releases → pin a commit deliberately. |
| D-02 | **Event storage: LMDB** (`fiatjaf.com/nostr/eventstore/lmdb`) | New eventstore has no sqlite3 backend. Data is dev/seedable → re-seed, no migration. |
| D-03 | **Search/geo engine: bleve v2 `geoshape`** (S2-backed) | Native `intersects` / `contains` / `within` relations against full GeoJSON geometries + relevance-ranked FTS in one engine. Chosen over SQLite R*Tree+FTS5 sidecar. |
| D-04 | **Custom index schema per kind**, not "index all tags" | The index is a deliberate, documented document mapping (§5), owned by an `earthlysearch` Go package with its own bleve index — the stock eventstore bleve backend is not used. |
| D-05 | **Two-lane query API** (§4) | Automated viewport queries must not hit the FTS path; user search must not be constrained to NIP-01 filters. |
| D-06 | Extensions ride **inside the NIP-50 `search` string** as `key:value` tokens | NIP-50-sanctioned extension point; unknown extensions are ignored by other relays (graceful degradation). Custom top-level filter fields are stripped by go-nostr/applesauce serialization. |
| D-07 | **Pairwise geometry predicates are out of scope for the relay** | "Do X and Y overlap" is a join, not set retrieval. Client-side turf, or the ContextVM geo service, own computational geometry. |
| D-08 | **The index is derived data** | `--reindex` rebuilds the whole bleve index from the event store. Corrupt index = delete + rebuild, never data loss. |
| D-09 | **One grammar implementation per side**, shared golden vectors | TS serializer (client facade) and Go parser tested against the same fixture file (`spec/search-grammar-vectors.json`). The fixture is the grammar's source of truth. |
| D-10 | AI tools take **structured params**, never raw grammar strings | Schema validation catches model mistakes; no second unvalidated serializer to drift. |
| D-11 | Expired events (NIP-40) are **excluded server-side** and GC-swept | Clients already filter per SPEC §10; the relay shouldn't ship or store dead beacons. Directly addresses the disk problem (beacons heartbeat at 30 s). |
| D-12 | Blob-stub datasets are indexed at **envelope precision only** (v1) | No blob fetching at ingest — keeps ingest offline-safe and bounded. Marked `blob:true` in the index. |

## 3 Architecture

```
                       ┌──────────────────────────── relay (Go) ────────────────────────────┐
 client ── NIP-01 ────►│ khatru (fiatjaf.com/nostr/khatru)                                  │
        ── NIP-50+ext ►│   │                                                                │
                       │   ├── eventstore/lmdb            (events, canonical)               │
                       │   └── earthlysearch (custom pkg)                                   │
                       │         ├── ingest: per-kind extract → normalize → bleve doc       │
                       │         ├── bleve index (geoshape + FTS + facets), derived data    │
                       │         ├── grammar: parse NIP-50 extension tokens → bleve query   │
                       │         ├── #g route: multi-precision geohash queries              │
                       │         └── GC: NIP-40 expiry sweep (LMDB + index)                 │
                       └────────────────────────────────────────────────────────────────────┘

 client (TS)
   src/lib/search/            ← ONE typed facade (query builder → grammar string; result parse;
     │                           viewport geohash cover for Lane 1)
     ├── useRelayEntitySearch / EntitySearchPopover   (pickers, all 5 entity kinds)
     ├── viewport query hooks                          (map pan/zoom → #g filters)
     └── chat tools: search_entities, query_entities_in_area
```

### Query routing (relay)

1. Filter has `search` → `earthlysearch` (grammar parse → bleve).
2. Filter has `#g` → `earthlysearch` (geohash keyword field, multi-precision).
3. Otherwise → LMDB event store.

Search results return event IDs ranked by relevance; events are hydrated from LMDB (single
source of truth for event bytes).

## 4 The two-lane query API

### Lane 1 — automated viewport queries (plain NIP-01)

The client covers the viewport with geohash cells at a precision matching zoom, then sends
an ordinary filter: `{"kinds":[37522],"#g":["u2yh","u2yj"]}`.

- The **relay** indexes every entity's centroid geohash at **all precisions 1–7** in the
  index (events are *not* mutated; publishers keep emitting one `g` tag per SPEC).
- Cell queries are stable across small pans → client-side dedupe/caching is trivial.
- Degrades on foreign relays to exact-precision `#g` matching — still standard protocol.
- Cells are rectangles → client clips against the true bbox after receipt.

### Lane 2 — search (NIP-50 + extension grammar)

`search` string = free text + space-separated `key:value` extension tokens. Unknown tokens
are ignored by other relays (NIP-50 semantics); our relay strips them from the FTS text.

| Token | Value | Meaning |
|-------|-------|---------|
| `bbox:` | `w,s,e,n` | Query shape = envelope (WGS-84). |
| `point:` | `lon,lat` | Query shape = point. |
| `poly:` | geohash-encoded ring (v1: omit; attachedGeometry flows can use bbox) | Query shape = polygon. |
| `rel:` | `intersects` \| `contains` \| `within` | Geo relation of the *indexed* geometry to the query shape. Default `intersects`. `contains` = indexed geometry contains the query shape ("what am I standing in", with `point:`). |
| `near:` | geohash (5–7 chars) | Proximity bias / distance sort origin. |
| `radius:` | `<n>km` \| `<n>m` | With `near:` — hard distance cutoff. |
| `label:` | vocab value | NIP-32 `l` label facet (namespace `earthly`). Repeatable (AND). |
| `tag:` | hashtag | `t` facet. Repeatable (AND). |
| `ref:` | `kind:pubkey:d` | Entity references this coordinate (`a` or `c` lane). |
| `start-after:` / `start-before:` | epoch seconds or `YYYY-MM-DD` | NIP-52 temporal range (Sightings). |
| `sort:` | `relevance` (default) \| `distance` \| `recent` \| `scale` | `distance` needs `near:` or `point:`; `scale` ranks by bbox-area ratio to the query bbox ("about this place", not "merely intersects it"). |

Kinds/authors/limit stay in the standard filter fields. NIP-50 result order is relevance —
clients must not paginate search with `until`.

**Capability advertisement (NIP-11):** the relay info document carries

```json
"earthly_search": { "version": 1, "extensions": ["bbox","point","rel","near","radius","label","tag","ref","start-after","start-before","sort"] }
```

The client facade feature-detects and falls back to plain-text NIP-50 for foreign relays.

## 5 Index document schema

Doc ID = **`kind:pubkey:d` coordinate** for parameterized-replaceable kinds → a beacon
heartbeat *overwrites* one document instead of accumulating (the Bluge segment explosion
was fed by never-replaced docs). Regular events use event ID.

| Field | Type | Source | Kinds |
|-------|------|--------|-------|
| `kind` | numeric | event | all |
| `author` | keyword | event | all |
| `created_at` | numeric | event | all |
| `title` | text (boosted) | content: FC `name` / `title` / group `name` | 37515/18/20 |
| `summary` | text | content: `summary` / `description` | 37518/20 |
| `body` | text | content: Markdown body / sighting text | 37518/20/22 |
| `feature_names` | text, multi | each feature's `properties.name` (+`description`) | 37515 |
| `geometry` | geoshape, multi | **each feature's geometry**, normalized (CCW rings, closed, antimeridian split) | 37515 (per feature), others (point/bbox) |
| `centroid` | geopoint | bbox centroid | all geo kinds |
| `geohash` | keyword, multi | centroid geohash at precisions 1–7 | all geo kinds |
| `bbox_area` | numeric | bbox area (deg², ranking only) | all geo kinds |
| `t` | keyword, multi (facet) | `t` tags | all |
| `l` | keyword, multi (facet) | NIP-32 `l` (namespace `earthly`) | all |
| `refs` | keyword, multi | `a` + `c` coordinates | 37518/20 |
| `start` / `end` | numeric | content NIP-52 fields | 37522 |
| `expiration` | numeric | NIP-40 tag | 37521/22 |
| `blob` | boolean | has `blob` tags | 37515 |
| `feature_count`, `geom_types` | numeric / keyword multi | FC stats | 37515 |

**Ingest gates:** parse-don't-trust content (size caps, feature-count cap for indexing);
`modelVersion` gate for 37518/20/21/22 (legacy events are stored but not indexed); events
that fail geometry normalization index text fields only (never reject the event for that).

**GC sweep:** periodic job deletes events with `expiration < now - grace` from LMDB and the
index. Query paths additionally filter `expiration >= now` so the sweep interval is not a
correctness window.

## 6 Work packages

| WP | Deliverable | Acceptance |
|----|-------------|------------|
| WP1 | Relay rewritten on `fiatjaf.com/nostr` (khatru + LMDB), radio-station/mutation/Blossom code deleted, `slog` leveled logging (per-event logging = DEBUG), sane-default policies | builds; serves NIP-01 publish/subscribe; `bun run seed minimal` round-trips |
| WP2 | `earthlysearch` package: ingest pipeline, bleve geoshape index, doc schema §5, `--reindex`, expiry GC | unit tests: per-kind extraction, ring normalization, replaceable overwrite, expiry exclusion; reindex rebuilds from LMDB |
| WP3 | Grammar parser (Go) + bleve query translation, `#g` route, NIP-11 advertisement | golden vectors pass; integration: seeded events answer bbox/rel/label/temporal queries |
| WP4 | Client facade `src/lib/search/`: typed builder → grammar string, result parsing, viewport geohash cover | golden vectors pass in `bun test`; same fixture as WP3 |
| WP5 | `useRelayEntitySearch` → all 5 entity kinds via facade; popover facets; mention picker gets relay entity search | manual UAT: picker finds unloaded Story by name; mention inserts naddr |
| WP6 | Chat tools `search_entities` + `query_entities_in_area` (query_osm_* family style; attachedGeometry as query shape; compact naddr results) | registry tests; UAT: "what sightings are in this polygon I drew" |
| WP7 | Ops hardening: disk budget check + write refusal threshold, size metrics, log rotation notes in VPS_OPS | relay refuses writes (logged once) past threshold instead of crash-looping |

Gates per repo convention: `bun test`, `bun run build`, biome; `go build` + `go test` for
the relay (tsc has a known ~305-error baseline and is not a gate).

## 7 Risks

- **Monorepo churn:** no tags; pinned commit may need code changes on bump. Mitigation: pin
  + record commit hash here; bump deliberately.
- **bleve geoshape edge cases:** CW polygons, antimeridian, Circle/Envelope false
  positives. Mitigation: normalization at ingest + regression fixtures for known cases.
- **Index growth (the original sin):** mitigated structurally — coordinate doc IDs
  (replaceables overwrite), expiry GC, `--reindex` escape hatch, WP7 disk budget refusal.
  Watch segment counts on the VPS after deploy.
- **Storage migration:** LMDB replaces SQLite; dev/VPS data is re-seeded, not migrated.
  `bun relay:reset` semantics unchanged.
- **Foreign-relay degradation:** extension tokens in `search` reach foreign relays as
  ignored tokens per NIP-50 — acceptable; facade feature-detects via NIP-11 and strips
  extensions when unsupported.

## 8 Explicitly out of scope (v1)

- Pairwise geometry predicates by ID on the relay (D-07 — client turf / ContextVM service).
- Fetching Blossom blobs at ingest to index full external geometry (D-12).
- `poly:` query shapes in the grammar (bbox covers the UI + AI flows; revisit if needed).
- Replacing the legacy `bun run seed` NDK scripts (separate agenda).
