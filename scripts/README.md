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
into a new immutable SQLite search snapshot. Run it only from a full source
checkout: production release archives intentionally omit the builder and its
reviewed legal source documents. Upload the verified SQLite output into the
host's persistent catalog directory; see
[`docs/operations/geocatalog.md`](../docs/operations/geocatalog.md).
`purge-old-seeds.sh` is a manual recovery tool for old public-relay fixture
events; it is intentionally not part of ordinary development or deployment.

Tests remain beside the script whose interface they verify. One-off planning
documents and completed migration programs do not belong here.

## Local WW1 Story styling demo

See [the authoring and styling guide](../docs/WW1-STORY-DEMO.md) for the demo
links, manual editor workflow, and an example Story Thread prompt.

`bun run seed:ww1 --dry-run` builds five Maps and one Story entirely offline.
`bun run seed:ww1` adds only those six events to the existing
`ws://localhost:3334` relay. It never resets the relay, deletes anything, updates
profiles, or accepts a public relay. The only alternative relay hosts are
`127.0.0.1` and `[::1]`, still on port 3334.

All geometry and prose are explicitly labeled **synthetic styling demo**, not
accurate historical data. Four chronological cues (1914, 1916, spring 1918 and
armistice) demonstrate selective foreign Map references, multiple render
instances of the same source, style/opacity overrides, inline feature mentions,
and cue/figure/both views. A deliberately different figure-only comparison must
not affect the next scrolling cue.

The command prints reader and Story links for `http://localhost:3001`;
`--app-url http://localhost:3002` changes only the link origin. Use
`--format=json` for machine-readable event plans and URLs.

Unchanged reruns publish nothing. A differing existing demo at one of the six
stable `ww1-demo-*` addresses stops the entire run before publication. To
deliberately replace those demo events, pass `--update-existing`; replacements
receive a timestamp strictly newer than the current event. Unrelated Maps,
Stories and profiles are never changed.

The network-free `buildWw1StoryFixture()` export in
[`fixtures/ww1-story.ts`](fixtures/ww1-story.ts) returns `events`, `maps`,
`presentation`, `views`, `markdown` and `story` paths. Browser tests can inject
`events` into their page-local EventStore without publishing or seeding a relay.
The Story uses the existing Earthly Curator development identity; its source
Maps belong to the existing Mara Holzer development identity.

Run the bounded tests with:

```sh
bun test scripts/fixtures/ww1-story.test.ts scripts/seed-ww1.test.ts
```
