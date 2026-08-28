# Repository scripts

Deployment and VPS runtime behavior lives in `ops/vps/`. This directory holds
repository-local build, development, release, data-generation, and verification
commands.

## Main interfaces

| Area | Package command / entrypoint |
|---|---|
| Production build | `bun run build:production` |
| Android install/release/E2E | `bun run tauri:android:*`, `bun run release:android:*`, `bun run e2e:android:*` |
| Unified seed data | `bun run seed <command>` |
| Local relay reset | `bun run relay:reset` |
| Architecture diagrams | `bun run docs:diagrams` |
| Immutable GeoCatalog snapshot | `bun run geocatalog:build -- ...` |
| PMTiles tool cache | `bun run tools:pmtiles` |
| Generated artifact preview | `bun run clean:artifacts` |

`fetch-world-data.ts` regenerates the committed world reference layers.
`build-geocatalog.ts` streams local, release-pinned Overture GeoJSONSeq exports
into a new immutable SQLite search snapshot; see
[`docs/operations/geocatalog.md`](../docs/operations/geocatalog.md).
`purge-old-seeds.sh` is a manual recovery tool for old public-relay fixture
events; it is intentionally not part of ordinary development or deployment.

Tests remain beside the script whose interface they verify. One-off planning
documents and completed migration programs do not belong here.
