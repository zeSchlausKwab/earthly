# Earthly Relay

A Nostr relay built on [khatru](https://pkg.go.dev/fiatjaf.com/nostr/khatru)
(the `fiatjaf.com/nostr` monorepo) with a purpose-built geo search index for
the Earthly entity model (SPEC.md kinds 37515–37522).

Design document: [docs/GEO_SEARCH_REWRITE.md](../docs/GEO_SEARCH_REWRITE.md)

## Architecture

- **Events:** a composite canonical store. LMDB
  (`fiatjaf.com/nostr/eventstore/lmdb`) retains indexes and ordinary events;
  a bbolt sidecar retains bodies above the upstream codec's 65,535-byte field.
  Reads rehydrate the byte-identical signed event before it leaves the store.
- **Size policy:** event content is accepted through 1 MiB and the same limit is
  advertised in NIP-11. Larger geographic datasets use Blossom references.
- **Search/geo:** bleve v2 with geoshape fields (`earthlysearch/` package) —
  derived data, rebuilt from the canonical store via `--reindex` or automatically
  when empty.
- **Expiry:** khatru's NIP-40 manager deletes expired events (beacons,
  sightings) from both stores; query paths additionally exclude them.
- **Disk budget:** below `--min-free-bytes` free space the relay refuses
  writes with a NOTICE instead of filling the disk.

## Query routing

| Filter | Backend |
|--------|---------|
| plain NIP-01 | LMDB |
| `#g` geohash tags | bleve (centroid geohash indexed at precisions 1–7) |
| `search` (NIP-50) | bleve via the Earthly extension grammar |

### Search grammar (version 1)

Free text plus `key:value` tokens: `bbox:w,s,e,n`, `point:lon,lat`,
`rel:intersects|contains|within`, `near:<geohash>`, `radius:2km`,
`label:<vocab>`, `tag:<hashtag>`, `ref:<kind:pubkey:d>`,
`start-after:/start-before:<epoch|YYYY-MM-DD>`,
`sort:relevance|distance|recent|scale`.

Examples:

```
playground bbox:16.1,48.1,16.7,48.4        # text + viewport
point:16.37,48.21 rel:contains             # what am I standing in
bbox:16.1,48.1,16.7,48.4 start-after:2026-06-01   # sightings this month
trails near:u2yh7 radius:2km sort:distance # proximity
```

Malformed grammar values reject the subscription with a CLOSED message.
Unknown `key:value` tokens stay in the free text (URLs are safe).

The grammar is pinned by golden vectors in
`../spec/search-grammar-vectors.json`, shared with the TypeScript facade in
`../src/lib/search/`. Capability advertisement: `GET /earthly-search`.

## Index document schema

Per-kind extraction in `earthlysearch/extract.go` (schema table in the design
doc §5): per-feature geometry as a geometrycollection (CCW-normalized),
feature names, title/summary/body, `t`/`l` facets, `a`+`c` refs, NIP-52
start/end, NIP-40 expiration, centroid + multi-precision geohashes, bbox
area. New-model kinds (37518/20/21/22) gate on `modelVersion:"earthly/2"` —
legacy events are stored but never indexed.

Doc IDs are address coordinates for addressable kinds, so replaceable
updates (beacon heartbeats) overwrite one document instead of accumulating
segments — the failure mode that killed the old Bluge index.

## Development

```bash
make dev            # go run . --port 3334
make build          # build bin/relay
go test ./...       # unit + integration tests
```

See QUICKSTART.md for all flags.
