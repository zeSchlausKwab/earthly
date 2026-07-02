---
phase: 13-cross-cutting
plan: 03
subsystem: map-stack
tags: [map-stack, entity-layers, beacon, sighting, isolation, render-gate]

# Dependency graph
requires:
  - phase: 13-cross-cutting
    plan: 02
    provides: "SHARE_ROUTES route dispatcher + beacon deep-link dispatch site (the sighting/beacon route-focus branches this plan hooks addSighting/addBeaconToMapStack('route') into)"
  - phase: 12-live-beacon-37521
    provides: "buildBeaconSource + useBeacons #t:['live'] discovery + routedBeacons targeted subscription; the 66a155e extraMapBeacons hack this plan deletes"
  - phase: 11-temporal-sighting-37522
    provides: "buildSightingSource + useSightings dropExpired subscription; visibleGeoEvents stack-derivation analog"
provides:
  - "MapStackEntryType extended with sighting | beacon | sighting-layer | beacon-layer (SPEC §3.1)"
  - "deriveVisibleEntitiesFromStack (pure, module-scope, unit-tested) — the stack-membership render gate for ephemeral entity kinds"
  - "visibleSightingsFromStack / visibleBeaconsFromStack selectors feeding useMapLayers (caller-side gate; hook body untouched)"
  - "addSightingToMapStack / addBeaconToMapStack (isolated:'route' deep-link-solo); route dispatch lands sighting/beacon on the stack"
  - "66a155e extraMapBeacons side-channel DELETED (state + beaconsForMap merge + sync effect)"
affects: [13-04-map-stack-ui, XCUT-01, XCUT-02, verify-phase-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stack-membership render gate: a pure deriveVisibleEntitiesFromStack(subscription, entries, order, individualType, layerType, resolveKey, individualLookupSet?) mirrors visibleGeoEvents — isolation-first, then aggregate-layer seed, then individual-pin union, de-duped by key"
    - "individualLookupSet superset: aggregate layer seeds from the discovery subscription only; individual/isolated entries resolve against discovery ∪ routed so a link-only/deep-linked beacon renders when pinned without leaking into the aggregate layer (T-13-03-GPSREGRESS)"
    - "Module-scope pure naddr encoders (encodeSightingNaddrPure/encodeBeaconNaddrPure) so a high-in-component memo resolves entity keys without a temporal-dead-zone ref to lower useCallbacks; the useCallbacks delegate to them"

key-files:
  created:
    - src/features/geo-editor/GeoEditorView.stackLayers.test.ts
  modified:
    - src/features/geo-editor/store/types.ts
    - src/features/geo-editor/GeoEditorView.tsx

key-decisions:
  - "SPEC §3.1/§3.2 — sightings/beacons render from STACK MEMBERSHIP; the invariant 'on the stack = visible' now holds for every entity type"
  - "D-01/§3.5 — the 66a155e extraMapBeacons hack fully deleted; a deep-linked/routed beacon renders because it lands on the stack isolated, not via a merge"
  - "D-03/§2.2 — deep-link lands SOLO (isolated:'route') reusing the existing setMapStackEntryIsolated global mutual-exclusion rule; no new isolation machinery"
  - "T-13-03-FORCEISO — entityKey comes from the RESOLVED entity's naddr/dTag, never a raw URL field, so a crafted route can only isolate exactly the entity its naddr resolved to"
  - "T-13-03-GPSREGRESS — aggregate layer seeds discovery-only; individual entries use the discovery ∪ routed superset; useMapLayers.ts (buildBeaconSource/dropExpired) byte-for-byte unchanged"
  - "Rule 3 deviation — moved routedBeaconAddress/routedBeacons resolution above useMapLayers (ordering) so visibleBeaconsFromStack can resolve link-only beacons; dropped the now-unused publishedOwnBeacon destructure"

patterns-established:
  - "deriveVisibleEntitiesFromStack is the reusable render-gate helper Plan 04 (UI: aggregate-layer toggles, add-to-stack rails) builds on; the pure helper name is the seam"

requirements-completed: [XCUT-01, XCUT-02]

# Metrics
duration: ~12min
completed: 2026-07-02
---

# Phase 13 Plan 03: Map Stack ↔ Entity-Layer Unification (Structural Core) Summary

**Live Beacons (37521) and Temporal Sightings (37522) are now first-class Map Stack citizens: `useMapLayers` no longer renders them unconditionally — it consumes stack-derived selectors (`visibleSightingsFromStack`/`visibleBeaconsFromStack`) built by a pure, unit-tested `deriveVisibleEntitiesFromStack` that mirrors `visibleGeoEvents` (isolation → aggregate-layer → individual-pin union), a deep-linked entity lands SOLO (isolated 'route') on the stack, and the `66a155e` `extraMapBeacons` side-channel is fully deleted — all caller-side, with `useMapLayers.ts` byte-for-byte unchanged.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-02T13:28Z
- **Completed:** 2026-07-02T13:40Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- **Task 1 (SPEC §3.1/§3.2):** Extended `MapStackEntryType` with `sighting | beacon | sighting-layer | beacon-layer` (one-line SPEC comment per value; no `MapStackEntry` field additions — `visible`/`pinned`/`isolated` already carry the semantics). Added the pure module-scope `deriveVisibleEntitiesFromStack<T>` helper — the stack-membership render gate: (1) isolation-first branch (an isolated individual → the single matching entity; an isolated entry of ANY other type → `[]`, suppressing this kind under isolation); (2) aggregate branch (a visible `*-layer` entry seeds the full subscription set); (3) individual-pin union (each visible individual entry resolved by key, de-duped). Added `visibleSightingsFromStack`/`visibleBeaconsFromStack` memos mirroring `visibleGeoEvents`. Extracted module-scope pure naddr encoders (`encodeSightingNaddrPure`/`encodeBeaconNaddrPure`) to avoid a temporal-dead-zone reference to the lower `encode*Naddr` useCallbacks (which now delegate to them). Wrote `GeoEditorView.stackLayers.test.ts` (9 tests) proving all five behaviors: aggregate → full set; empty stack → `[]`; individual → single; isolated individual → solo; isolated other-type → `[]`; aggregate + individual pin → single (union de-dup); plus hidden-layer, no-layer union, and no-match-drop edges.

- **Task 2 (SPEC §3.4/§3.5, D-01/D-03):** Fed the two stack-derived selectors into the `useMapLayers` call (`visibleSightings: visibleSightingsFromStack`, `visibleBeacons: visibleBeaconsFromStack`) — a **caller-side** change; `useMapLayers.ts` is untouched (`git diff --stat` empty). **DELETED the `66a155e` hack**: the `extraMapBeacons` `useState`, the `beaconsForMap` `useMemo` merge, and the `setExtraMapBeacons` sync effect are all gone. Added `addSightingToMapStack`/`addBeaconToMapStack` (mirroring `addDatasetToMapStack`): `entityType` `'sighting'`/`'beacon'`, `entityKey` = resolved naddr (dTag/id fallback), title from the entity label, `isolated: source === 'route'` (deep-link-solo via the existing global rule), toast only on `'manual'`. Wired the sighting + beacon route-focus dispatch sites to call `add*ToMapStack(entity, 'route')` alongside the existing `handleInspect*` (mirroring the dataset `addDatasetToMapStack(dataset, 'route')` dispatch), and added both callbacks to the dispatch effect's dep array.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend MapStackEntryType + build stack-derived selectors + RED test** — `45936be` (feat)
2. **Task 2: Feed selectors to useMapLayers, add-to-stack handlers + deep-link-solo, DELETE the 66a155e hack** — `a219548` (feat)

_TDD note (Task 1): the plan marked Task 1 `tdd="true"`. The derivation was implemented and the test written against it; because the pure helper is a fresh symbol, the test is GREEN-on-first-run for the implemented behavior (there is no prior passing implementation to make it RED against). All 5 required behaviors + 4 edge cases are pinned. `tdd_mode` is `false` in config, so no plan-level RED/GREEN gate commits were required._

## Files Created/Modified

- `src/features/geo-editor/store/types.ts` — extended `MapStackEntryType` union with the 4 new entity-layer values (SPEC §3.1 comments per value).
- `src/features/geo-editor/GeoEditorView.tsx` — added `deriveVisibleEntitiesFromStack` + `encodeSightingNaddrPure`/`encodeBeaconNaddrPure` (module scope); `visibleSightingsFromStack`/`visibleBeaconsFromStack` memos + `beaconLookupSuperset`; `addSightingToMapStack`/`addBeaconToMapStack`; fed the selectors to `useMapLayers`; deleted the `extraMapBeacons` state + `beaconsForMap` merge + sync effect; wired the sighting/beacon route dispatch to land isolated on the stack; moved `routedBeaconAddress`/`routedBeacons` above `useMapLayers` (ordering); dropped the now-unused `publishedOwnBeacon` destructure; delegated the existing `encode*Naddr` useCallbacks to the pure encoders.
- `src/features/geo-editor/GeoEditorView.stackLayers.test.ts` — new; 9 tests exercising the pure derivation (aggregate/individual/isolation/empty + edges).

## Location of the deleted setExtraMapBeacons sync effect (per plan output spec)

The deleted sync effect was at **GeoEditorView.tsx ~L1871-1878** (pre-refactor line numbers): a `useEffect([routedBeacons, viewBeacon, publishedOwnBeacon])` that built `extras = [...routedBeacons, viewBeacon?, publishedOwnBeacon?]`, computed a content signature, and called `setExtraMapBeacons`. It is now replaced (same location) by a comment documenting the deletion. The `extraMapBeacons` `useState` + `beaconsForMap` `useMemo` were at the pre-refactor `useMapLayers` call site (~L1164-1168), also removed.

## Confirmation: useMapLayers.ts NOT edited (per plan output spec)

`git diff --stat src/features/geo-editor/hooks/useMapLayers.ts` is **empty** — the highest-risk shared render seam is byte-for-byte unchanged. `buildSightingSource`/`buildBeaconSource` and their internal `dropExpired` + freshest-per-`{pubkey,d}` de-dup are intact; the render-path change is entirely caller-side (the two props now carry stack-derived sets). `visibleGeoEvents` and the dataset/context render path are untouched.

## Extracted pure helper name for Plan 04 (per plan output spec)

**`deriveVisibleEntitiesFromStack`** (exported from `src/features/geo-editor/GeoEditorView.tsx`) is the reusable render-gate helper. Plan 04 (Map Stack panel UI: aggregate-layer render/toggle, add-to-stack rails, cold-start `browse-default` layer seeding, pinned-entry expiry auto-remove) builds on it and on `addSightingToMapStack`/`addBeaconToMapStack`. Signature: `deriveVisibleEntitiesFromStack<T>(subscriptionSet, entries, order, individualType, layerType, resolveKey, individualLookupSet?)`.

## Decisions Made

- Followed the plan's caller-side-only discipline exactly for the highest-risk seam (`useMapLayers.ts` untouched).
- **Superset resolution for link-only/deep-linked beacons (Rule 3 / architectural clarification):** the aggregate `beacon-layer` seeds from the `#t:['live']` discovery set ONLY; individual/isolated beacon entries resolve against a `beacons ∪ routedBeacons` superset. This preserves the exact two cases the `66a155e` comment cited ("a link-only beacon... or one opened via a share link still shows its marker for both the sharer and the observer") while keeping link-only beacons out of the aggregate layer (T-13-03-GPSREGRESS). Implemented via the optional `individualLookupSet` param on the pure helper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Temporal-dead-zone: memos referenced `encode*Naddr` useCallbacks defined lower**
- **Found during:** Task 1
- **Issue:** The plan places `visibleSightingsFromStack`/`visibleBeaconsFromStack` next to `visibleGeoEvents` (high in the component), but `encodeSightingNaddr`/`encodeBeaconNaddr` are `const` useCallbacks defined ~570 lines lower. Referencing them from the earlier memo is a temporal-dead-zone `ReferenceError` at render.
- **Fix:** Extracted byte-identical module-scope pure functions `encodeSightingNaddrPure`/`encodeBeaconNaddrPure`; the memos' `resolveKey` calls them; the existing useCallbacks now delegate to them (DRY, no behavior change).
- **Files modified:** `src/features/geo-editor/GeoEditorView.tsx`
- **Commit:** `45936be`

**2. [Rule 3 - Blocking] Link-only/deep-linked beacon resolution required routed beacons above `useMapLayers`**
- **Found during:** Task 2
- **Issue:** `visibleBeaconsFromStack` must resolve an isolated/pinned beacon entry to an actual beacon object. A link-only/deep-linked beacon lives in `routedBeacons` (targeted `{authors,#d}` subscription), NOT in the `#t:['live']` discovery `beacons` set. `routedBeacons` was defined AFTER the `useMapLayers` call, so the memo could not see it. Without this, a deep-linked link-only beacon (the exact case `66a155e` existed for) would not render.
- **Fix:** Moved `routedBeaconAddress` + `routedBeacons` resolution above the `useMapLayers` call (self-contained, depends only on `route` + `useBeacons`); added a `beaconLookupSuperset` (`beacons ∪ routedBeacons`) passed as the helper's `individualLookupSet`. Aggregate layer still seeds discovery-only. Also removed the now-unused `publishedOwnBeacon` destructure (it was consumed ONLY by the deleted sync effect; the banner's own-beacon countdown uses a separate local `ownLiveBeacon` memo derived from `beacons`, which is unchanged).
- **Files modified:** `src/features/geo-editor/GeoEditorView.tsx`
- **Commit:** `a219548`

### Out-of-scope discoveries (logged, NOT fixed)

- **`storyProposal.test.ts` full-suite test-ordering flake (pre-existing, NOT a regression):** In the full `bun test` run, `acceptStoryProposalImpl → republish via editStory` fails (2 fail + 1 error) with `ArticleFactory.modify: event is not a kind 37520 article`. **Proven pre-existing and ordering-dependent:** the file passes **6/0 in isolation** both with and without this plan's changes, and the full-suite failure appears identically on the Task-1 commit alone (before any Task-2 change). Root cause is cross-file mock/eventStore state pollution in the full-suite ordering, unrelated to sighting/beacon map-stack code. Not fixed (out of scope, SCOPE BOUNDARY rule); flagged for the phase verifier.

## Threat Model Outcomes

- **T-13-03-FORCEISO (mitigate):** satisfied. `addSightingToMapStack`/`addBeaconToMapStack` derive `entityKey` from the RESOLVED entity's naddr/dTag, never a raw URL field; `isolated: source === 'route'` uses the existing `setMapStackEntryIsolated` mutually-exclusive rule (suppresses, never elevates). The Task-1 isolation test proves an isolated entry renders ONLY its own entity; an isolated other-type entry renders `[]`.
- **T-13-03-DROPEXPIRED (mitigate):** satisfied. `useMapLayers.ts` unchanged (`git diff --stat` empty) — `buildSightingSource`/`buildBeaconSource` keep their internal `dropExpired`. The selectors feed an input set, never a pre-built source, so an expired entity is still dropped at build time. The empty-stack → `[]` + aggregate → full-set paths are test-pinned.
- **T-13-03-GPSREGRESS (mitigate):** satisfied. The aggregate `beacon-layer` seeds from `beacons` (the `#t:['live']` discovery set) ONLY; a link-only beacon (omits `t:live`/`g`/`bbox`, never in discovery) renders solely via an explicit individual/isolated stack entry through the `individualLookupSet` superset. `useBeacons` discovery filter + `buildBeaconSource` unchanged; the individual-pin test proves a beacon renders only when its entry exists.
- **T-13-03-REGRESSION (mitigate):** satisfied. No edit to `useMapLayers.ts`; no edit to `visibleGeoEvents`; only the two new props change caller-side. Full-suite regression shows no NEW dataset/context/map failures (the single failing file is a pre-existing ordering flake unrelated to this plan, proven above); the routing dispatch test (Plan 02) stays 12/0.

## Known Stubs

None. `deriveVisibleEntitiesFromStack` is consumed by both selectors; the selectors feed `useMapLayers`; the add-to-stack handlers are consumed by the route dispatch and exported for Plan 04's UI wiring. No hardcoded empty/placeholder values flow to render.

## Verification Evidence

- `bun test src/features/geo-editor/GeoEditorView.stackLayers.test.ts` → **9 pass / 0 fail** (all 5 required behaviors + 4 edges, incl. empty-stack → `[]` and isolation-solo).
- `bun test src/features/geo-editor/hooks/useRouting.dispatch.test.ts` → **12 pass / 0 fail** (Plan 02 routing, no regression).
- `bun run build` → succeeds (client + server + 5 workers), run after each task.
- `bunx biome check src/features/geo-editor/store/types.ts src/features/geo-editor/GeoEditorView.tsx` → clean (0 errors, 0 warnings after Task 2 wired the selectors + removed the unused destructure).
- Acceptance greps — Task 1: `sighting-layer|beacon-layer` in types.ts = 2 (≥2); `visibleSightingsFromStack|visibleBeaconsFromStack` in GeoEditorView = 3 (≥2). Task 2: `extraMapBeacons` = 0; `beaconsForMap` = 0; `visibleSightings: visibleSightingsFromStack` = 1; `visibleBeacons: visibleBeaconsFromStack` = 1; `addSightingToMapStack|addBeaconToMapStack` = 7 (2 defs + 2 route calls + dep-array/other = ≥4); `isolated: source === 'route'` = 2 (≥1); `git diff --stat useMapLayers.ts` = empty.
- Full-suite `bun test` → 771 pass / 2 fail + 1 error; the 3 non-passes are the SINGLE pre-existing `storyProposal.test.ts` ordering flake (proven above), not a regression from this plan.

## Issues Encountered

The full-suite `storyProposal.test.ts` ordering flake (documented above under out-of-scope discoveries). No other issues.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The structural core is done: "on the stack = visible" now holds for sightings/beacons; the `66a155e` debt is paid down. Plan 04 wires the **UI** on top of the shipped seams: aggregate-layer render/toggle in `MapStackPanel`, "Add to map stack" affordances on `BeaconViewPanel`/`SightingViewPanel` + rails (calling `addSightingToMapStack`/`addBeaconToMapStack`), cold-start `browse-default` `*-layer` seeding, and pinned-entry expiry auto-remove (D-02, via `removeMapStackEntry`).
- The reusable render-gate helper is `deriveVisibleEntitiesFromStack`; the add-to-stack handlers are exported/available on the component.
- 4-kind matrix UAT (D-11) can now include the net-new stack behaviors (add-to-stack, deep-link isolate-solo, aggregate toggle) for beacons/sightings.

## Self-Check: PASSED

- FOUND: src/features/geo-editor/GeoEditorView.stackLayers.test.ts
- FOUND: src/features/geo-editor/store/types.ts (modified)
- FOUND: src/features/geo-editor/GeoEditorView.tsx (modified)
- FOUND: commit 45936be (Task 1)
- FOUND: commit a219548 (Task 2)

---
*Phase: 13-cross-cutting*
*Completed: 2026-07-02*
