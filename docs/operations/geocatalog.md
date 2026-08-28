# GeoCatalog operations

GeoCatalog is Earthly's fast, self-hosted geography lookup layer. It runs inside
the existing geo ContextVM and exposes one source-neutral `query_geography`
tool. Remote OpenStreetMap queries remain available only for detail that the
installed snapshot does not contain.

The runtime never queries Overture directly. An operator builds a release-pinned
SQLite file ahead of time, verifies it, and promotes that immutable file. This
keeps chat latency independent of Overture, DuckDB, S3, and Overpass availability.

## Snapshot contents

The first Overture importer accepts newline-delimited GeoJSON exports for:

- `divisions/division_area` — administrative and locality boundaries;
- `places/place` — named places and POIs;
- `transportation/segment` — road, rail, and water-transport segments plus
  derived named corridors;
- `base/water` — named, reviewed rivers, streams, canals, and water bodies;
- `base/infrastructure` — an explicit allowlist of useful transport, utility,
  emergency, border, and communications infrastructure.

Infrastructure is allowlisted rather than copied wholesale. Every stored entry
keeps its Overture record id and release. Snapshot metadata records the source,
attribution, and licenses. Earthly's existing bundled world layers remain the
preferred source for generalized coastlines, major rivers, lakes, and global
analytical work; Overture water-transport segments are not presented as a
complete river network.

The builder retains every raw transportation segment. In addition, it groups
segments with a strong route identity (Wikidata, or network plus reference) and
connectivity-scopes weaker reference/name matches. A derived corridor is a
deterministically ordered `MultiLineString`: member boundaries and real gaps
remain visible, so Earthly never implies that disconnected source segments form
one stitched line. Corridors store a member count and membership digest rather
than a potentially enormous list of member ids.

Semantic classifications are indexed separately from free-text names. Place
entries include the basic category, the full Overture taxonomy hierarchy and
alternates, and legacy category alternates when present. Administrative entries
also expose Overture's source-neutral hierarchy level (`0` country, `1` first
subdivision, and so on).

## Prepare local exports

Pin one Overture release and export the desired themes to GeoJSONSeq or NDJSON,
one GeoJSON Feature per line. DuckDB is a practical build-time extractor because
it can read Overture's partitioned GeoParquet directly and apply spatial or
column filters before serialization. Keep DuckDB outside the runtime service.

Use the official Overture release paths and retrieval guidance:

- [Overture release downloads](https://docs.overturemaps.org/getting-data/)
- [Querying Overture with DuckDB](https://docs.overturemaps.org/getting-data/duckdb/)
- [Overture attribution requirements](https://docs.overturemaps.org/attribution/)

The builder intentionally rejects URLs. Download/export inputs first so a build
is reproducible and cannot change underneath a running import.

## Build

```bash
bun run geocatalog:build -- \
  --release 2026-08-19.0 \
  --snapshot-id overture-2026-08-19.0-v1 \
  --created-at 2026-08-28T00:00:00Z \
  --output data/geocatalog/overture-2026-08-19.0-v1.sqlite \
  --input division_area=/srv/overture/division_area.geojsonseq \
  --input place=/srv/overture/place.geojsonseq \
  --input segment=/srv/overture/segment.geojsonseq \
  --input water=/srv/overture/water.geojsonseq \
  --input infrastructure=/srv/overture/infrastructure.geojsonseq
```

The builder streams records into one transaction and retains only the current
input record plus the corridor currently being emitted in memory. Corridor
membership and connectivity are staged in a private on-disk SQLite database;
that staging directory is removed after both successful and failed builds. The
builder refuses to replace an existing output. A malformed record aborts the
build, reports the input file and record number, and removes only the incomplete
snapshot artifacts, leaving the same output name safe to retry after correcting
the input.

Use `--format json` for machine-readable counts. The report includes read,
written, and intentionally skipped records per Overture type.

## Verify and promote

Run the focused implementation tests, then query the newly built file before
promotion:

```bash
bun test contextvm/geocatalog

GEOCATALOG_PATH=data/geocatalog/overture-2026-08-19.0-v1.sqlite bun -e \
  "import { openSqliteGeoCatalog } from './contextvm/geocatalog'; const catalog = openSqliteGeoCatalog({ path: process.env.GEOCATALOG_PATH! }); console.log(await catalog.query({ text: 'Vienna', limit: 3 }))"
```

Install snapshots below the persistent `data/geocatalog/` directory. Production
releases already link `data/` to persistent storage, so application deployments
do not copy or delete the catalog. Promote a validated file to
`data/geocatalog/current.sqlite` using the host's atomic file or symlink switch,
then restart the geo ContextVM so it opens the new read-only snapshot.

The promoted snapshot is a production prerequisite. The geo ContextVM performs
a real one-entry catalog query before connecting to relays; a missing, invalid,
or empty snapshot keeps the service offline and causes the existing deployment
health check to fail instead of reporting a nominally healthy release.

Rollback is the same operation in reverse: point `current.sqlite` at the prior
immutable file and restart the geo ContextVM. Do not edit a promoted SQLite file
in place.

## Runtime behavior

`query_geography` combines text, stable ids, normalized kinds, exact semantic
categories, administrative hierarchy levels, country, bounding box, and
proximity filters. Filter groups use AND semantics; values within ids, kinds,
categories, and admin levels use OR semantics. Geometry is omitted by default
for inexpensive discovery and returned only when requested. When chat uses
`toEditor`, Earthly requests geometry once and passes that exact result through
the existing bound Dataset safety and persistence path; it does not repeat the
geographic query.

Discovery responses omit bulky source-document contents from the model-visible
result. Editor imports preserve each feature's native Overture source records
and add a compact pointer to a snapshot manifest. Earthly stores that manifest
once as a FeatureCollection-level property named
`earthly:geoCatalogSourceManifest:<snapshot-id>`. Its value is a JSON-encoded
manifest so it survives the editor's scalar metadata controls, local drafts,
and Nostr publication without repeating long legal text on every feature. The
manifest includes release attribution, license document URLs, and the full
Foursquare Places NOTICE when Places data is present. If later imports use a
different immutable snapshot, its manifest is stored under its own key; older
features therefore keep a resolvable source pointer.

Do not strip these collection-level manifest properties or feature-level
`sourceRecords` when transforming/exporting a catalog-derived dataset. Overture
release attribution can change between releases, so snapshot builds must use
the release's current [attribution manifest](https://docs.overturemaps.org/attribution/)
and must be reviewed before promotion.

Canonical Nostr geometry references are a separate, deferred design. GeoCatalog
currently returns ordinary GeoJSON for editing and publication.
