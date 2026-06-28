---
phase: 11-temporal-sighting
plan: 02
subsystem: nostr-data-layer
tags: [kind-37522, nip-52, nip-40, geojson, turf, applesauce-cast, expiry, tdd-green, sight-01, sight-02, sight-03]

# Dependency graph
requires:
  - phase: 08-spec-v2-foundation
    provides: TemporalSightingFactory/Cast/helpers (kind 37522), shared tags.ts (setBbox/setGeohash/setContextRefs), expiry.ts (dropExpired/isExpired), EntityFactory bare-sign base
  - phase: 11-temporal-sighting
    plan: 01
    provides: RED tests pinning content.geometry + bbox/g derivation, publishSighting round-trip, classifyObservationState
provides:
  - "content.geometry (Point|LineString|Polygon) on TemporalSightingContent (D-02) with bbox/g derived every publish (SIGHT-01)"
  - "publishSighting/editSighting/deleteSighting single source-of-truth lifecycle (turf-derived discovery tags; editSighting preserves d; expiry independent of observation end)"
  - "classifyObservationState(start,end,now) live/upcoming/past classifier (D-06)"
  - "readSightingDraft/writeSightingDraft/clearSightingDraft local-first draft + NEW_SIGHTING_DRAFT_KEY (D-04 draft)"
  - "useSightings() subscription — isTemporalSighting filter-before-cast + dropExpired at the read path (SIGHT-03)"
  - "eventStore singleton extracted to src/lib/nostr/store.ts (barrel re-exports)"
affects: [11-03, 11-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lifecycle derives lossy bbox/g discovery tags from precise content.geometry via turf on every publish (mirrors geo-event computeBboxFor/computeGeohashFor try/catch)"
    - "Lifecycle stamps the returned signed event with the EventStore parent reference (EventStoreSymbol) so castEvent(signed) is store-free immediately — production publish() also adds to the store after sig-verification"
    - "Read-path expiry: filter-before-cast (P-2) THEN dropExpired(unixNow()) (P-1) THEN cast, in the useMemo"

key-files:
  created:
    - src/lib/nostr/store.ts
    - src/lib/nostr/temporal-sighting/lifecycle.ts
    - src/lib/nostr/temporal-sighting/observationState.ts
    - src/lib/nostr/temporal-sighting/draft.ts
    - src/lib/hooks/useSightings.ts
  modified:
    - src/lib/nostr/temporal-sighting/helpers.ts
    - src/lib/nostr/temporal-sighting/index.ts
    - src/lib/nostr/index.ts

key-decisions:
  - "eventStore extracted to its own module (src/lib/nostr/store.ts) so the lifecycle can import the real store DIRECTLY — the Plan-01 round-trip test mocks the @/lib/nostr barrel down to just `publish`, so a barrel import of eventStore would be undefined. The barrel re-exports the same singleton, so all ~existing `import { eventStore } from '@/lib/nostr'` consumers are unchanged; only the construction site moved."
  - "publishSighting/editSighting stamp the signed event with EventStoreSymbol (attachStore) rather than eventStore.add(): the store's default verifyEvent (coreVerifyEvent) rejects the Plan-01 fixtures' fake sigs (sig='c'*128) and returns null, so add() never attaches the parent reference under test. Stamping is honest (the event belongs to our store); production publish() additionally runs eventStore.add with the real sig."
  - "Open-ended freshness window = 30 days in classifyObservationState (matches the conservative D-04 expiry default direction): a start-set/no-end sighting is 'live' within 30d of start, 'past' after. No-start sighting classifies 'live' (never 'upcoming') per the Plan-01 contract."
  - "publishSighting signature is (options: {content, expiration?, groupCoords?}, signer) — the Plan-01 test calls publishSighting({ content: {...} }, bareSign), so content is nested under an options object (not passed bare)."

patterns-established:
  - "Per-publish bbox/g re-derivation from content.geometry — the single chokepoint that keeps the lossy discovery tags from drifting from the precise coordinates (SIGHT-01/D-02)"
  - "SIGHT-03 multi-site invariant enforced at the subscription useMemo; UI read paths (Plans 03/04) mount onto an already-correct dropExpired path"

requirements-completed: []  # SIGHT-01/02/03 data-layer seams shipped + GREEN; the requirements close when Plans 03/04 wire the authoring/reading/map UI onto these seams.

# Metrics
duration: ~30min
completed: 2026-06-28
---

# Phase 11 Plan 02: Temporal Sighting Data Layer Summary

**The kind-37522 data layer: a precise `geometry` field on content (D-02) with bbox/g derived every publish, a clone-from-Story lifecycle/draft/subscription spine, and the net-new observation-state classifier (D-06) — turning the Plan-01 RED tests for SIGHT-01/02/03 GREEN and giving Plans 03/04 one tested publish/read seam.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-28
- **Tasks:** 2
- **Files:** 8 (5 created, 3 modified)

## Accomplishments

- **Task 1 — geometry + lifecycle + classifier (`ad1b9aa`):**
  - Added `geometry?: Point | LineString | Polygon` to `TemporalSightingContent` (helpers.ts); the defensive getter is unchanged — a geometry-less 37522 still parses to `geometry: undefined` with no throw and no migration (backward-tolerant, current seed shape).
  - New `lifecycle.ts` cloning `story/lifecycle.ts`'s three-function shape: `publishSighting`/`editSighting`/`deleteSighting`. Every publish derives `box = bbox(geometry)` and the `[lon,lat]` centroid via turf, wrapped in try/catch returning undefined on invalid/oversized geometry (mirrors `computeBboxFor`/`computeGeohashFor`; T-11-02-03 — derivation failure degrades to no bbox/g, never throws), then chains `.bbox().geohash().expiration().contextReferences().sign()`. `expiration` is INDEPENDENT of the observation `end` (Pitfall P-4). `editSighting` uses `TemporalSightingFactory.modify` (preserves `d`, no fork). `deleteSighting` clones `deleteStory` (DeleteFactory.fromEvents). The service does NOT cast.
  - New `observationState.ts`: pure, total `classifyObservationState(start, end, now)` → `'live'|'upcoming'|'past'` (no throw on undefined; no-start ⇒ live; open-ended ⇒ live within a 30-day freshness window).
  - Extracted the `eventStore` singleton to `src/lib/nostr/store.ts` (barrel re-exports it) — see Decisions.
  - Barrel re-exports lifecycle + classifier.
- **Task 2 — draft + subscription (`4b8d47c`):**
  - New `draft.ts` cloning `story/draft.ts`: `SightingDraft = Pick<TemporalSightingContent,'title'|'description'|'start'|'end'|'geometry'> & {updatedAt}`; base key `'earthly:sighting:drafts:v1'`; `NEW_SIGHTING_DRAFT_KEY` sentinel; `readDraftMap` defensively copies `start`/`end` (number guards) + `geometry` (object guard), returns `{}` on any malformed value and never throws (T-11-02-04, accept). Pubkey-scoped via the existing `readScopedStorage`/`writeScopedStorage` primitives.
  - New `useSightings.ts` cloning `useStories.ts`: `{kinds:[37522]}` subscription whose `useMemo` does `dropExpired(events.filter(isTemporalSighting), unixNow()).map(e => castEvent(e, TemporalSighting, eventStore))` — `isTemporalSighting` filter BEFORE cast (Pitfall P-2 / T-11-02-01: the cast ctor throws on a legacy/forged 37522) and `dropExpired` at the subscription (SIGHT-03 / Pitfall P-1 / T-11-02-02; `unixNow()` epoch-seconds, never `Date.now()` ms).
  - Barrel re-exports the draft functions.

## Task Commits

1. **Task 1: 37522 geometry content + bbox/g lifecycle + observation-state classifier** — `ad1b9aa` (feat)
2. **Task 2: local-first sighting draft + useSightings subscription** — `4b8d47c` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created/Modified

- `src/lib/nostr/temporal-sighting/helpers.ts` (MODIFIED) — `geometry?: Point|LineString|Polygon` added to `TemporalSightingContent`; geojson type import; defensive getter untouched.
- `src/lib/nostr/temporal-sighting/lifecycle.ts` (NEW) — publish/edit/delete; turf bbox/centroid derivation (try/catch-guarded); `attachStore` stamps the returned event with the store parent reference.
- `src/lib/nostr/temporal-sighting/observationState.ts` (NEW) — `classifyObservationState` + `ObservationState` type.
- `src/lib/nostr/temporal-sighting/draft.ts` (NEW) — local-first sighting draft over scoped storage.
- `src/lib/hooks/useSightings.ts` (NEW) — kind-37522 subscription, filter-before-cast + dropExpired.
- `src/lib/nostr/temporal-sighting/index.ts` (MODIFIED) — re-exports lifecycle, observationState, draft.
- `src/lib/nostr/index.ts` (MODIFIED) — `eventStore` construction moved to `./store`; barrel imports + re-exports the same singleton.
- `src/lib/nostr/store.ts` (NEW) — the `eventStore` singleton, importable without the barrel.

## Decisions Made

- **eventStore extraction (`store.ts`):** The Plan-01 round-trip test does `castEvent(signed, TemporalSighting, undefined as never)` and mocks `@/lib/nostr` down to `{ publish }`. applesauce's `castEvent` throws "Event is not attached to an event store" unless the event carries the parent-store symbol. The lifecycle needs the REAL store to stamp that reference, but a barrel import would be the mock's `undefined`. Extracting the singleton to `src/lib/nostr/store.ts` (barrel re-exports it) lets the lifecycle import the real store directly; every existing `import { eventStore } from '@/lib/nostr'` consumer is unchanged. Build + full suite confirm no regression from the move.
- **`attachStore` vs `eventStore.add`:** The store's default `verifyEvent` (`coreVerifyEvent`) rejects the Plan-01 fixtures' fake sigs and `add()` returns `null` (no attachment). So the lifecycle stamps `EventStoreSymbol` directly on the returned event (the event genuinely belongs to our store). Production `publish()` additionally runs `eventStore.add` with the real signature, so reactivity/dedup is intact on the live path.
- **`publishSighting` options shape:** `(options: { content, expiration?, groupCoords? }, signer)` — dictated by the Plan-01 call `publishSighting({ content: {...} }, bareSign)`.
- **Freshness window:** 30 days for open-ended sightings in the classifier, matching the conservative D-04 expiry direction; no-start sightings classify `live`, never `upcoming` (Plan-01 contract).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Extracted `eventStore` to a dedicated module so the lifecycle can stamp the store reference under the Plan-01 barrel mock**
- **Found during:** Task 1 (the `castEvent` round-trip RED test).
- **Issue:** The Plan-01 round-trip test casts a freshly-signed event with `undefined` store and mocks `@/lib/nostr` to only `{ publish }`. applesauce `castEvent` requires the event to carry a parent EventStore; a barrel import of `eventStore` is `undefined` under the mock, and `eventStore.add` returns `null` for the fixtures' fake sigs (signature verification). The plan said "Publish via `publish(...)`" and cloned the Story lifecycle (which never casts, so never hit this), so the store-attachment seam was unspecified.
- **Fix:** Created `src/lib/nostr/store.ts` owning `new EventStore()`; the barrel imports and re-exports it (no consumer change). The lifecycle imports the store directly and stamps `EventStoreSymbol` on the returned event via `attachStore` (production `publish()` still adds with the real sig). This is a correctness requirement for the SIGHT-01 round-trip contract.
- **Files modified:** `src/lib/nostr/store.ts` (new), `src/lib/nostr/index.ts`, `src/lib/nostr/temporal-sighting/lifecycle.ts`.
- **Commit:** `ad1b9aa`.

No other deviations — the geometry field, classifier, draft, and subscription were implemented as written.

## Authentication Gates

None — pure data-layer work, no signer/login surface touched (the bare-sign contract is satisfied by `EntityFactory`'s `SignerLike`).

## Test Results (success criteria)

- **Temporal Sighting test set** (`src/lib/nostr/temporal-sighting` + `expiry.test.ts` + `geo-comment`): **23 pass / 0 fail / 31 expect() calls**. The three Plan-01 RED cases are now GREEN:
  1. `publishing a Point sighting derives bbox + g tags from content.geometry` (SIGHT-01).
  2. `round-trips: castEvent(signed).sighting.geometry deep-equals the input Point` (SIGHT-01).
  3. `classifyObservationState` live / upcoming / past / no-end-live / no-start-default (D-06).
  The Plan-01 GREEN pins (c-emit, modify-d, defensive geometry-absent parse, per-read-path dropExpired, comment root-kind) remain GREEN.
- **Full suite** (`bun test`): **717 pass / 0 fail / 3284 expect() calls / 81 files** — no regression from the `eventStore` extraction.
- **`bun run build`:** green (client + server + workers).
- **`biome check`** over the plan scope (`src/lib/nostr/temporal-sighting`, `src/lib/hooks/useSightings.ts`, `src/lib/nostr/store.ts`): clean, no fixes applied.

## Known Stubs

None. The data layer is fully wired; geometry round-trips, every publish derives bbox/g, expiry filters at the subscription, drafts persist defensively. The UI surfaces (authoring panel, view panel, map marker, rail, OG route) are Plans 03/04 by design.

## Next Phase Readiness

- **Plan 03/04 (UI):** mount `SightingEditorPanel`/`SightingViewPanel`/`SightingsPanel` + the map marker + `/sighting/:naddr` route + OG card onto `publishSighting`/`editSighting`/`useSightings`/the draft helpers/`classifyObservationState`. The SIGHT-03 expiry invariant is already enforced at the subscription; the remaining read paths (map-layer source build, Group foreign lane, OG server fetch) still each need their own `dropExpired` per Pitfall P-1 — flag for Plans 03/04.
- No blockers. `gsd-tools` not on PATH — STATE/ROADMAP updated manually (the established v1.2 pattern).

## Self-Check: PASSED

- All 5 created files present on disk (`store.ts`, `lifecycle.ts`, `observationState.ts`, `draft.ts`, `useSightings.ts`); 3 modified files updated.
- Both task commits present in git log: `ad1b9aa` (Task 1), `4b8d47c` (Task 2).

---
*Phase: 11-temporal-sighting*
*Completed: 2026-06-28*
