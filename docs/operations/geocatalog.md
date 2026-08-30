# GeoCatalog operations

GeoCatalog is Earthly's fast, self-hosted geography lookup layer. It runs in
the existing geo ContextVM and exposes the source-neutral `query_geography`
tool. The runtime never queries Overture directly: a background build reads one
pinned Overture release, produces an immutable SQLite snapshot, validates it,
and atomically promotes it.

Production snapshots are built on the VPS. They are not uploaded from a
developer machine, so ordinary application releases remain small and a slow
local-to-VPS connection is not part of the catalog update path.

## Production contents and service boundaries

The reviewed planet-lite v2 policy exports five Overture feature types:

- `division_area` — named administrative boundaries at hierarchy levels 0–2;
- `division` — administrative labels and selected settlements;
- `place` — selected high-confidence transport, emergency, public-safety,
  government, and natural destinations;
- `water` — named reviewed inland-water and marine features with a strong
  upstream identity; and
- `infrastructure` — a narrow allowlist of useful named or canonically
  identified infrastructure.

The global snapshot deliberately does **not** import Overture
`transportation/segment`. This removes the largest upstream scan and avoids
turning GeoCatalog into a road graph. Valhalla is the production service for
network-following road, bus, bicycle, pedestrian, and truck routes. Valhalla
routes between known coordinates; it does not provide a named-road inventory,
complete road-relation geometry, or rail routing. Rail authoring therefore
needs geometry already supplied to the editor or a future reviewed rail data
source.

Earthly's bundled world layers remain the preferred source for generalized
coastlines, major rivers, lakes, and global analytical work. GeoCatalog water
features complement those layers; they are not presented as a complete river
network. Remote OpenStreetMap tools remain available for a genuine detail gap
or an exact OSM identifier supplied by the author. The intentional absence of
road and rail coverage in planet-lite v2 is not itself such a gap.

Administrative `division` points are useful labels during discovery, but they
are not boundary geometry. They are marked `administrative-label` and excluded
from geometry-bearing queries; editable administrative results therefore come
from `division_area` entries marked `administrative-boundary`. Settlement
`division` points remain available for locality authoring.

Every stored entry retains its Overture record id, pinned release, and native
source records. Snapshot metadata records attribution, license documents, the
selection policy, coverage, and the kinds actually installed. A query for a
kind that was intentionally omitted consequently returns `kind_unavailable`
rather than looking like a failed global search.

## Deployment lifecycle

`bun run deploy` is also the GeoCatalog lifecycle entry point:

```bash
# Normal application deploy
bun run deploy

# Explicitly rebuild the configured/default Overture release
bun run deploy -- --update-geocatalog

# Explicitly move to another pinned Overture release
bun run deploy -- --update-geocatalog=2026-08-19.0
```

A normal deploy behaves as follows:

| Catalog state | Deployment behavior |
|---|---|
| Valid snapshot present | Activate the application release and leave the snapshot unchanged. |
| Snapshot absent | Activate in temporary GeoCatalog bootstrap mode and queue one background build. |
| Snapshot present but invalid, empty, incomplete, or a dangling link | Fail activation; do not hide corruption by rebuilding or falling back. |

The missing-only bootstrap exception lets a first installation serve the rest
of Earthly while the global snapshot is built. `query_geography` reports the
catalog as unavailable during that window. An invalid catalog is different: it
still blocks deployment and the geo ContextVM fails closed.

`--update-geocatalog` is the only way a valid installed snapshot is replaced.
The existing snapshot stays live throughout export and assembly. Application
deploys made while a build is already running do not start a duplicate worker.

### Durable background worker

Activation stages a minimal, immutable build bundle under persistent shared
storage. The release archive contains the exporter, builder, GeoCatalog code,
and required legal documents, so the VPS does not need a source checkout. The
worker is managed by PM2 and survives the SSH/deploy session.

The worker:

1. takes an exclusive `flock` lock so only one build can write the catalog;
2. exports the five source types separately with DuckDB through `uv`;
3. runs export and assembly with reduced CPU and I/O priority via `nice` and
   `ionice`;
4. verifies each gzip export against its release, policy, feature type, and
   SHA-256 report before treating it as a reusable checkpoint;
5. builds the immutable SQLite snapshot in persistent staging storage;
6. performs the same production query preflight used by the ContextVM;
7. atomically changes `current.sqlite`, retaining the old target as
   `previous.sqlite`; and
8. restarts only `earthly-contextvm`, leaving the web, relay, Mapnolia, Cordn,
   and SearXNG services undisturbed.

Each source directory is an independent checkpoint. A failed or interrupted
run retains completed, verified sources and resumes at the first missing source
on the next explicit/default start. Incomplete or checksum-mismatched source
directories are moved aside for inspection rather than trusted. The worker
reserves 8 GiB by default on the VPS; set `GEOCATALOG_RESERVE_FREE_GIB` in the
production environment to choose a different safety margin. Keep a relative
`GEOCATALOG_PATH` under `data/geocatalog/`; deployment rejects release-local
catalog paths so release pruning cannot remove a snapshot or its job state.

Build state and current progress are written atomically to persistent JSON
files. The status command reports the live-catalog state, active snapshot,
worker PID, phase, target snapshot, record/byte progress when available, last
update, free disk, and log location.

## Remote progress and logs

Run these commands from the Earthly checkout on an operator machine; they use
the target configured in `.env.deploy`:

```bash
# One status snapshot
bun run geocatalog:vps:status

# Last 100 stdout/stderr lines
bun run geocatalog:vps:logs

# Follow both logs until interrupted
bun run geocatalog:vps:follow
```

The same information is available on the VPS:

```bash
cd "$VPS_PATH/current"
bash ops/vps/geocatalog.sh status "$VPS_PATH/shared" "$VPS_PATH/current"
bash ops/vps/geocatalog.sh logs "$VPS_PATH/shared" "$VPS_PATH/current"
bash ops/vps/geocatalog.sh logs "$VPS_PATH/shared" "$VPS_PATH/current" --follow
```

A failed build does not affect the current valid snapshot. Inspect the status
and logs, correct the underlying problem, and use an explicit update deploy to
retry. Verified source checkpoints are reused.

A deploy never interrupts an in-flight catalog build. Re-requesting the same
target is an idempotent no-op; requesting a different Overture release while a
job is active fails visibly so the newer request cannot be silently discarded.

## Catalog rollback

Promotion retains one previous immutable snapshot. Restore it on the VPS with:

```bash
cd "$VPS_PATH/current"
bash ops/vps/geocatalog.sh rollback "$VPS_PATH/shared" "$VPS_PATH/current"
```

Rollback atomically repoints `current.sqlite` and restarts only
`earthly-contextvm`. It does not rebuild or edit either SQLite file. Application
release rollback and GeoCatalog rollback are independent operations.

## VPS prerequisites

In addition to the normal Earthly runtime requirements, GeoCatalog builds need:

- `uv`, which supplies the pinned DuckDB environment declared by the exporter;
- `flock`, `ionice`, and `nice` (normally provided by `util-linux` and
  `coreutils`); and
- enough persistent disk for source checkpoints, build staging, the new
  snapshot, and the live/previous snapshots.

`bun run setup:vps` and activation check these commands before changing the
active release. Production must also configure a reachable `VALHALLA_URL`;
activation calls its status endpoint because road routing is deliberately not
inside the catalog.

## Manual and regional builds

The VPS lifecycle is the supported global production path. The same exporter
and builder can still create a local smoke or area-of-interest snapshot. The
exporter reads the official public Overture GeoParquet paths directly and
writes five gzip-compressed GeoJSONSeq files without downloading a raw planet
mirror. Pin the release and use the v2 policy/id:

```bash
bun run geocatalog:export-overture -- \
  --release 2026-08-19.0 \
  --output-dir data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2

bun run geocatalog:build -- \
  --release 2026-08-19.0 \
  --snapshot-id overture-2026-08-19.0-planet-lite-v2 \
  --created-at 2026-08-30T00:00:00Z \
  --output data/geocatalog/overture-2026-08-19.0-planet-lite-v2.sqlite \
  --coverage global \
  --corridor-source-fragments staging-only \
  --input division_area=data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2/division_area.geojsonseq.gz \
  --input division=data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2/division.geojsonseq.gz \
  --input place=data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2/place.geojsonseq.gz \
  --input water=data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2/water.geojsonseq.gz \
  --input infrastructure=data/geocatalog/source/overture-2026-08-19.0-planet-lite-v2/infrastructure.geojsonseq.gz
```

Use repeatable `--feature-type` arguments to export individual source
checkpoints, `--progress-file` for machine-readable progress, and
`--bbox west,south,east,north` for a regional scale gate. `--dry-run` reports
selection counts without creating output. Neither exporter nor builder replaces
an existing completed output.

The builder streams plain or `.gz` GeoJSONSeq/NDJSON records into one snapshot
transaction. Named water fragments with a conservative shared identity may be
assembled into deterministic `MultiLineString` corridors. No missing segment
is synthesized, no endpoint is snapped, and no retained Overture geometry is
simplified, clipped, or repaired. `--corridor-source-fragments staging-only`
uses selected line fragments during assembly but stores only useful derived
corridors; water points and polygons remain ordinary entries.

For an area-of-interest snapshot, pass exact source-extract bounds as
`west,south,east,north` to `--coverage`. Wrapped antimeridian bounds
(`west > east`) are not supported. Query diagnostics then distinguish a genuine
miss inside the slice from a request outside coverage or for an omitted kind.

## Runtime queries and provenance

`query_geography` combines text, stable ids, normalized kinds, exact semantic
categories, administrative hierarchy levels, country, bounding box, and
proximity filters. Filter groups use AND semantics; values within ids, kinds,
categories, and admin levels use OR semantics. Geometry is exposed to Earthly
chat through `toEditor`, which carries the exact result and its source manifest
through the bound-Dataset safety and persistence path.

Discovery responses omit bulky license-document bodies. Editor imports
preserve native Overture source records and add one collection-level manifest
property named `earthly:geoCatalogSourceManifest:<snapshot-id>`. The manifest
is JSON encoded so it survives scalar metadata controls, local drafts, and
Nostr publication. It includes release attribution, license URLs, the complete
Foursquare Places NOTICE, and the Apache 2.0 license when Places data is
present. Do not strip these collection-level manifest properties or
feature-level `sourceRecords` when transforming catalog-derived datasets.

Overture attribution can change between releases. Review the pinned release's
[attribution manifest](https://docs.overturemaps.org/attribution/) before an
explicit update. Canonical Nostr geometry references remain a deferred design;
GeoCatalog currently returns ordinary GeoJSON for editing and publication.
