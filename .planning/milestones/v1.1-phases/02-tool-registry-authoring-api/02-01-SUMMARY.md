---
phase: 02-tool-registry-authoring-api
plan: 01
subsystem: testing
tags: [bun-test, geojson, maplibre, geo-editor, test-harness, fixtures]

# Dependency graph
requires:
  - phase: 01
    provides: encrypted settings persistence (independent; not consumed here)
provides:
  - createHeadlessEditor() + createMockMap() — instantiate real GeoEditor in bun:test with no DOM/WebGL
  - Shared GeoJSON fixtures (emptyFeatureCollection, singlePointCollection, dupIdCollection)
  - First passing test suite in a previously zero-test repository
affects: [02-02, 02-03, 02-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Headless editor harness via mock MapLibre Map (getStyle()->undefined keeps render a safe no-op)"
    - "Pure, import-free shared geo fixtures under src/lib/test-fixtures"
    - "Co-located *.test.ts with bun:test globals; harness is test-only (no production import)"

key-files:
  created:
    - src/lib/test-fixtures/geo.ts
    - src/lib/test-fixtures/geo.test.ts
    - src/features/geo-editor/core/test-harness.ts
    - src/features/geo-editor/core/test-harness.test.ts
  modified: []

key-decisions:
  - "Mock getStyle() returns undefined so LayerManager.isStyleReady() is false, making setupLayers/render safe no-ops without mocking layer/source internals."
  - "Harness installs a minimal window shim (addEventListener/removeEventListener/setTimeout/clearTimeout) because Bun's test runtime has no window; timers delegate to real globals."
  - "Mock cast to MapLibreMap via `as unknown as` at the harness boundary ONLY; GeoEditor's map: MapLibreMap field type was not loosened (T-02-01)."

patterns-established:
  - "Pattern: createHeadlessEditor(options?) returns a real GeoEditor — later behavior-preservation tests use the production class, not a stub."
  - "Pattern: shared fixtures are dependency-free data so any test layer can import them."

requirements-completed: [INFRA-03, TOOLS-01]

# Metrics
duration: 6min
completed: 2026-06-16
---

# Phase 2 Plan 01: Test Infrastructure (Headless Harness + Geo Fixtures) Summary

**Bootstrapped the repo's first test suite: a headless `GeoEditor` harness backed by a mock MapLibre `Map` (constructible in `bun:test` with no DOM/WebGL) plus three shared GeoJSON fixtures, unblocking the golden/mirror/boundary/primitive tests of later plans.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-16T18:12:10Z (approx, execution start)
- **Completed:** 2026-06-16
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- `src/lib/test-fixtures/geo.ts` exports `emptyFeatureCollection`, `singlePointCollection` (id `test-point-1`), and `dupIdCollection` (two features both `id: 'dup-id'`) — pure data, no `@/features` imports.
- `src/features/geo-editor/core/test-harness.ts` exports `createMockMap()` and `createHeadlessEditor(options?)`; the editor constructs on the first attempt with the mock map.
- 8 new passing tests; full repo suite is green (32 pass / 0 fail). `bun run build` still succeeds — zero production code touched.

## Mock Map Surface (for later tests)

`createMockMap()` implements exactly these `Map` members the editor + managers touch (enumerated via live grep of `core/`):

- Source/layer mutation (no-ops): `addSource`, `addLayer`, `removeLayer`, `removeSource`
- Getters: `getSource` (returns `{ setData: no-op }`), `getLayer` (`undefined`), `getStyle` (`undefined` — keeps `isStyleReady()` false), `getZoom` (`12`), `getCenter` (`{lat:52.5,lng:13.4}`), `getBounds` (stub with `getWest/getSouth/getEast/getNorth/toArray`), `getCanvas` (stub with `style.cursor` + `getBoundingClientRect`)
- Projection: `project`, `unproject`
- Queries: `queryRenderedFeatures` (`[]`)
- Interaction sub-controllers: `dragPan` and `doubleClickZoom`, each with stateful `isEnabled/enable/disable`
- Rendering: `triggerRepaint`
- Events: `on`, `off`, `once` (no-ops)

**Fixture ids:** `singlePointCollection` → `test-point-1`; `dupIdCollection` → both features `dup-id`.

## Construction quirks discovered during the spike

- Bun's test runtime has **no `window` and no `document`** (verified), but `navigator` exists. Only `window` is touched at construction (`setupEventListeners` → `window.addEventListener`), so the harness installs a minimal `window` shim; `document` is never reached by the headless paths exercised.
- `detectMultiSelectModifier()` already guards `navigator` with `typeof`, so it is safe.
- The constructor's `styleLoadHandler` is **not** invoked during construction because `isStyleReady()` is false (mock `getStyle()` returns `undefined`); thus `window.setTimeout` is not exercised at construct time, but the shim provides it anyway for robustness.
- `addFeature`/`setFeatures` call `render()` → `RenderingManager.render()` → `getGeoJSONSource()` which returns `undefined` when the style is not ready, so rendering is a clean no-op while feature storage, history, and event emission behave exactly as in production.

## Task Commits

1. **Task 1: Shared geo fixtures + self-test** - `abcc2b1` (test)
2. **Task 2: Headless GeoEditor harness + smoke test** - `78f5415` (test)

_No TDD multi-commit split: plan `type: execute` (tdd_mode disabled in config); each task committed once._

## Files Created/Modified
- `src/lib/test-fixtures/geo.ts` - Three shared, import-free GeoJSON FeatureCollection fixtures.
- `src/lib/test-fixtures/geo.test.ts` - Asserts fixture type/count and the dup-id pairing.
- `src/features/geo-editor/core/test-harness.ts` - `createMockMap()` + `createHeadlessEditor()`; minimal window shim; test-only.
- `src/features/geo-editor/core/test-harness.test.ts` - Smoke test: construct, addFeature/getAllFeatures round-trip, `create` event fires, `setFeatures` replaces.

## Decisions Made
- See `key-decisions` frontmatter. Core choice: keep the style "not ready" so render/layer paths are inert, avoiding the need to mock MapLibre layer internals while still using the real `GeoEditor` class.

## Deviations from Plan

None - plan executed exactly as written. The harness constructed on the first attempt (no manager threw on an unmocked method), so the budgeted construction-spike iteration was not needed.

## Issues Encountered
None. The only environmental gap (missing `window` in Bun test) was anticipated by the plan's "mock the MapLibre map + DOM" guidance and handled with a minimal shim.

## Threat Model Compliance
- T-02-01 (type-weakening): mitigated — mock cast `as unknown as MapLibreMap` only at the harness boundary; no production type loosened.
- T-02-02 (harness leaking into bundle): mitigated — boundary grep confirms no production module imports `core/test-harness`.
- T-02-SC (package installs): no installs; Bun test runner + `geojson`/`@types/geojson` already present.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 02 (boundary tests), 03 (golden behavior-preservation + read-mirror integrity), and 05 (primitive tests) can now import `createHeadlessEditor` and the shared fixtures.
- Harness surface documented above so downstream tests know which map methods are stubbed; any test needing an additional `Map` method should extend `createMockMap()` (do not weaken `GeoEditor`).

## Self-Check: PASSED
- Files verified present: `src/lib/test-fixtures/geo.ts`, `src/lib/test-fixtures/geo.test.ts`, `src/features/geo-editor/core/test-harness.ts`, `src/features/geo-editor/core/test-harness.test.ts`.
- Commits verified in git log: `abcc2b1`, `78f5415`.

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
