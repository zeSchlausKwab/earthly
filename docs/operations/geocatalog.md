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

- `divisions/division` — settlement and administrative label points;
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

The builder retains every raw transportation and base-water segment. In
addition, it groups transport segments with a strong route identity (Wikidata,
or network plus reference), connectivity-scopes weaker reference/name matches,
and assembles connected named base-water fragments. Water fragments may join
only at a shared source endpoint or connector and must also share a conservative
identity: a normalized primary/common alias, a feature-specific name after a
recognized hydronym suffix (such as `River` or `Khola`) is removed, or a strong
upstream identifier such as Wikidata or an identical provider record id. This
allows multilingual and punctuation/type variants to form one useful river
corridor without joining unrelated waterways merely because they meet at a
confluence. A derived corridor is a deterministically assembled
`MultiLineString`. Exact shared endpoints are oriented and stitched only along
an unambiguous degree-two chain. A branch terminates each path rather than
letting the builder choose an arbitrary mainline. A prospective join that would
repeat an exact source segment in either direction remains a separate part. The
guard is an incremental segment-key lookup, so long corridors do not pay for
pairwise intersection tests. Source-authored crossings are retained;
byte-identical or reversed duplicate source lines appear once in the derived
geometry, while their raw entries remain untouched.

Corridor properties keep the hot query result bounded: `memberCount`, a
deterministic `memberIdSample` (at most 12 ids), its truncation flag, and the
membership digest summarize the source set without copying an unbounded member
ledger into every response. Complete ids, source records, and geometries remain
available as the raw catalog entries. Component, gap, path, branch,
stitched-join, prevented repeated-segment-join, and duplicate-member counts
state what the `MultiLineString` represents. No missing segment is synthesized,
no endpoint is snapped, and no raw Overture geometry is simplified, clipped,
repaired, or discarded.

Semantic classifications are indexed separately from free-text names. Place
entries include the basic category, the full Overture taxonomy hierarchy and
alternates, and legacy category alternates when present. Administrative entries
also expose Overture's source-neutral hierarchy level (`0` country, `1` first
subdivision, and so on).

Administrative `division` points are useful labels during discovery, but they
are not boundary geometry. They are marked `administrative-label` and excluded
from geometry-bearing queries; editable administrative results therefore come
from `division_area` entries marked `administrative-boundary`. Settlement
`division` points remain available for locality authoring.

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

Run the builder from a full Earthly source checkout, not from an installed
production release. The release archive deliberately contains only runtime
files; it does not contain `scripts/build-geocatalog.ts` or the reviewed legal
source documents used to assemble a snapshot manifest, including
`docs/legal/Apache-2.0.txt`. Build and verify the immutable SQLite file in a
pinned checkout, record the Earthly commit and Overture release, then upload
only the SQLite file and its SHA-256 checksum into the host's persistent
`data/geocatalog/` directory for promotion.

```bash
bun run geocatalog:build -- \
  --release 2026-08-19.0 \
  --snapshot-id overture-2026-08-19.0-v1 \
  --created-at 2026-08-28T00:00:00Z \
  --output data/geocatalog/overture-2026-08-19.0-v1.sqlite \
  --coverage 85.05,27.75,86.10,29.10 \
  --input division=/srv/overture/division.geojsonseq \
  --input division_area=/srv/overture/division_area.geojsonseq \
  --input place=/srv/overture/place.geojsonseq \
  --input segment=/srv/overture/segment.geojsonseq \
  --input water=/srv/overture/water.geojsonseq \
  --input infrastructure=/srv/overture/infrastructure.geojsonseq
```

Use `--coverage global` for a planet extract. For an area-of-interest snapshot,
pass the exact source-extract bounds as `west,south,east,north`. Wrapped
antimeridian bounds (`west > east`) are not supported in this snapshot format.
The query result then distinguishes a genuine miss inside the installed slice
from a request that falls outside it or asks for a kind the snapshot does not
contain.

The builder streams records into one transaction and retains only the current
input record plus the corridor currently being emitted in memory. Corridor
membership and connectivity are staged in a private on-disk SQLite database;
that staging directory is removed after both successful and failed builds. The
builder refuses to replace an existing output. A malformed record aborts the
build, reports the input file and record number, and removes only the incomplete
snapshot artifacts, leaving the same output name safe to retry after correcting
the input.

Use `--format json` for machine-readable counts. The report includes read,
written, and intentionally skipped records per Overture type, final snapshot
bytes, and corridor assembly totals: components, output paths, safe stitched
joins, prevented repeated-segment joins, duplicate geometry members, branch
points, and corridors with gaps.

## Scale gate before a planet build

Do not infer planet-build resource requirements from one small AOI. Before
building a global snapshot, run the same pinned builder against at least:

1. a dense metropolitan extract with roads, places, and infrastructure;
2. a country or multi-country extract with administrative areas and named
   transport/water corridors;
3. a sparse coastal or antimeridian-adjacent extract.

Record input bytes, `outputBytes`, records read/written/skipped, the corridor
assembly report, elapsed time, peak resident memory, temporary staging size,
and representative text/bbox/near query latency. Preserve those results with
the release/build notes. The first global snapshot should be a reviewed
planet-lite selection—global administrative geography plus selected places,
named waterways, and important transport corridors—not an automatic import of
every raw road, place, and infrastructure record. Rich regional snapshots can
provide denser authoring data without turning the embedded runtime catalog into
an unmeasured raw planet mirror.

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

The promoted snapshot is a production prerequisite. Places-bearing snapshots
built before the complete Foursquare NOTICE, Apache license, and Earthly
modification manifest are intentionally rejected; rebuild them under a new
immutable id with the current source checkout before promotion. The geo
ContextVM performs a real one-entry catalog query before connecting to relays;
a missing, invalid, incomplete, or empty snapshot keeps the service offline and
causes the existing deployment health check to fail instead of reporting a
nominally healthy release.

Rollback is the same operation in reverse: point `current.sqlite` at the prior
immutable file and restart the geo ContextVM. Retain at least one complete
Places-manifest snapshot for rollback because the new runtime deliberately will
not reopen a legacy incomplete one. Do not edit a promoted SQLite file in place.

## Runtime behavior

`query_geography` combines text, stable ids, normalized kinds, exact semantic
categories, administrative hierarchy levels, country, bounding box, and
proximity filters. Filter groups use AND semantics; values within ids, kinds,
categories, and admin levels use OR semantics. The ContextVM interface omits
geometry by default and returns it only when requested. Earthly chat deliberately
exposes a smaller choice: geometry is available only through `toEditor`, which
requests it once and passes that exact result plus its source manifest through
the existing bound Dataset safety and persistence path. It does not repeat the
geographic query or expose an intermediate geometry result that could be copied
without its collection provenance.

When an exact discovery query returns nothing, the catalog can recover a short
human search conservatively. A trailing administrative qualifier must itself
identify one unique exact administrative boundary; duplicate regional names are
rejected even when every match belongs to the same country. Only a unique
level-zero country boundary may recover with its ISO code alone. A regional
qualifier applies both its country code and exact boundary bbox on the first
attempt. For source records without country tags, recovery keeps the same
boundary constraint while dropping only the country-code filter.
Generic or type suffixes are removed only when their implied kind is compatible,
and bounded spacing or single-character variants are accepted only when exactly
one candidate becomes an exact stored name or alias. Diagnostics report the
effective text and the country or bbox constraint actually applied.

This recovery never runs for a request containing stable ids or
`includeGeometry: true`. Geometry authoring therefore remains a two-step flow:
discover a human-readable match, then resolve only its returned stable id.

Discovery responses omit bulky source-document contents from the model-visible
result. A single importable match includes an exact stable-id continuation only
when the result set is complete. If several matches remain, or the result set
was truncated, the response exposes the visible candidate ids and requires an
explicit selection instead of guessing or importing every result. Earthly
resolves only the selected ids with geometry when importing them into the bound
Dataset; it does not repeat the human-readable search. Editor imports
preserve each feature's native Overture source records
and add a compact pointer to a snapshot manifest. Earthly stores that manifest
once as a FeatureCollection-level property named
`earthly:geoCatalogSourceManifest:<snapshot-id>`. Its value is a JSON-encoded
manifest so it survives the editor's scalar metadata controls, local drafts,
and Nostr publication without repeating long legal text on every feature. The
manifest includes release attribution, license document URLs, the full
Foursquare Places NOTICE, and a full copy of the Apache 2.0 license when Places
data is present. Places manifests also state that Earthly filtered and
normalized the source records, while retaining native record identifiers and
per-feature source records. Those document bodies travel only with geometry/editor
requests; discovery responses retain their names and URLs but omit the bulky
text. If later imports use a different immutable snapshot, its manifest is
stored under its own key; older features therefore keep a resolvable source
pointer.

Do not strip these collection-level manifest properties or feature-level
`sourceRecords` when transforming/exporting a catalog-derived dataset. Overture
release attribution can change between releases, so snapshot builds must use
the release's current [attribution manifest](https://docs.overturemaps.org/attribution/)
and must be reviewed before promotion.

Canonical Nostr geometry references are a separate, deferred design. GeoCatalog
currently returns ordinary GeoJSON for editing and publication.
