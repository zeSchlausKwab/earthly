---
phase: 13-cross-cutting
plan: 02
subsystem: routing
tags: [routing, naddr, deep-link, nip-19, beacon, comments]

# Dependency graph
requires:
  - phase: 13-cross-cutting
    plan: 01
    provides: "focusCommentId prop on BeaconViewPanelProps + <CommentsPanel target={beacon}> mount (the seam Task 2 supplies a value for)"
  - phase: 12-live-beacon-37521
    provides: "useBeaconController.handleInspectBeacon + /beacon/:naddr thin route; throwaway-pubkey naddr"
  - phase: 11-temporal-sighting-37522
    provides: "useSightingEditor focusCommentId thread (WR-06) — the exact pattern mirrored for beacon"
provides:
  - "SHARE_ROUTES prefix→{focusType,sidebarView} lookup + one generic dispatch body replacing the 5 cloned per-kind parser blocks in useRouting.parsePathSegments (D-08)"
  - "parsePathSegments exported + useRouting.dispatch.test.ts pinning all 5 share prefixes + /comment suffix + scoped-context branch + malformed-naddr non-crash byte-for-byte (D-09/D-11)"
  - "beaconFocusCommentId thread: handleInspectBeacon(beacon, commentId?) → hook state → GeoEditorView → GeoEditorInfoPanel → BeaconViewPanel focusCommentId (D-10 — all five kinds now honor /:naddr/comment/:id)"
affects: [13-03-map-stack, XCUT-02, verify-phase-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Table-driven route dispatch: a closed Record<prefix,{focusType,sidebarView}> replaces N cloned per-kind if-blocks; the next kind is one table row (Pitfall P-5 paid down)"
    - "comment-deep-link thread = commentId? param on handleInspect* → hook-state focusCommentId (survives navigate* wiping the URL /comment segment) → view-panel focusCommentId prop; mirrored beacon off sighting"

key-files:
  created:
    - src/features/geo-editor/hooks/useRouting.dispatch.test.ts
    - .planning/phases/13-cross-cutting/deferred-items.md
  modified:
    - src/features/geo-editor/hooks/useRouting.ts
    - src/features/geo-editor/hooks/useBeaconController.ts
    - src/features/geo-editor/GeoEditorView.tsx
    - src/components/GeoEditorInfoPanel.tsx

key-decisions:
  - "D-08 — one SHARE_ROUTES table + one generic dispatch body; the 5 byte-identical parser blocks deleted"
  - "D-09 — URL shapes preserved byte-for-byte; the dispatch test is the parity oracle (12 assertions GREEN against the pre-refactor parser, then still GREEN after)"
  - "D-10 — beacon comment deep-link closed by mirroring the Sighting focusCommentId thread; parity across all five kinds"
  - "T-13-02-MALNADDR — the parser treats segments[1] (naddr) as opaque and never decodes it, so a malformed naddr cannot throw (test-pinned)"
  - "Rule-3 deviation: beaconFocusCommentId is forwarded through GeoEditorInfoPanel because BeaconViewPanel is rendered there, not directly in GeoEditorView as the plan assumed"

patterns-established:
  - "Beacon comment-focus wiring is a byte-parallel of the Sighting path (useSightingEditor L69/L114/L225 ↔ useBeaconController; sightingFocusCommentId ↔ beaconFocusCommentId at both GeoEditorInfoPanel mounts)"

requirements-completed: [XCUT-02]

# Metrics
duration: ~15min
completed: 2026-07-02
---

# Phase 13 Plan 02: XCUT-02 Route Dispatcher + Beacon Comment Deep-Link Summary

**The five byte-identical per-kind route parsers collapsed into one `SHARE_ROUTES` lookup + one generic dispatch body (D-08), pinned byte-for-byte by a new dispatch test (D-09/D-11); and the beacon `/:naddr/comment/:id` gap closed by mirroring the Sighting `focusCommentId` thread (D-10) — so all five kinds now honor comment deep links, with every URL shape preserved exactly.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-02T13:16Z
- **Completed:** 2026-07-02T13:20Z
- **Tasks:** 2
- **Files modified:** 6 (4 modified, 2 created)

## Accomplishments
- **Task 1 (D-08/D-09/D-11):** Added a module-level `SHARE_ROUTES: Record<string, {focusType, sidebarView}>` mapping the five prefixes (`geoevent→datasets`, `mapcontext→contexts`, `story→stories`, `sighting→sightings`, `beacon→beacons`) and replaced the five `if (first === '<kind>' && segments[1])` blocks (old L110-160) with one generic body: `const share = SHARE_ROUTES[first]; if (share && segments[1]) return {...}`. Everything else (the `/context` scoped branch, `/user`, `isSidebarViewMode` tail, `parseLocation` hash fallback, `upgradeLegacyHashRoute`, the naddr encoders) is byte-for-byte untouched. `parsePathSegments` is now exported for the test.
- **Byte-for-byte parity oracle:** `useRouting.dispatch.test.ts` (12 tests) asserts the exact parse output for all five prefixes, the `/comment/:id` suffix (present + missing-id), the unchanged scoped `/context/:naddr/:view` branch (contextNaddr set, NOT a share match), and the D-11 malformed-naddr non-crash + unknown-prefix-doesn't-match-SHARE_ROUTES cases. The tests passed against the pre-refactor parser AND after the refactor — proving the collapse changed no behavior.
- **Task 2 (D-10):** `useBeaconController` gained a `focusCommentId` hook-state, a `commentId?` param on `handleInspectBeacon` (with `setFocusCommentId(commentId)`), a `setFocusCommentId(undefined)` reset in `clearBeaconView`, and a returned `beaconFocusCommentId`. `GeoEditorView` threads `route.commentId` at the beacon dispatch (`handleInspectBeacon(beacon, route.commentId)`), destructures `beaconFocusCommentId`, and passes it to both `GeoEditorInfoPanel` mounts. `GeoEditorInfoPanel` forwards it (as `beaconFocusCommentId ?? focusCommentId`) plus the comment/mention props to `<BeaconViewPanel focusCommentId={...}>`, reaching full parity with the Sighting render.

## Task Commits

Each task was committed atomically:

1. **Task 1: Collapse the 5 per-kind parsers into a SHARE_ROUTES dispatcher + byte-for-byte test** — `f171eea` (feat) — TDD: the dispatch test was written first and passed against the pre-refactor parser (locking current behavior), then stayed GREEN through the collapse.
2. **Task 2: Close the beacon commentId gap — mirror the Sighting focusCommentId thread** — `153db09` (feat)

_TDD note (Task 1): because the test encodes the CURRENT (pre-refactor) parse output exactly, it was GREEN before the refactor — the "RED→GREEN" here is inverted: the test is a parity oracle, not a failing spec. This is the correct shape for a behavior-preserving refactor (the risk is silent output drift, which a GREEN-stays-GREEN oracle catches). Landed as a single feat commit._

## Files Created/Modified
- `src/features/geo-editor/hooks/useRouting.ts` — added `SHARE_ROUTES` + generic dispatch body; deleted the 5 cloned blocks; exported `parsePathSegments`.
- `src/features/geo-editor/hooks/useRouting.dispatch.test.ts` — new; 12 tests, byte-for-byte parity + `/comment` suffix + scoped-context + malformed-naddr non-crash + unknown-prefix miss.
- `src/features/geo-editor/hooks/useBeaconController.ts` — `focusCommentId` state, `commentId?` param on `handleInspectBeacon`, `setFocusCommentId` in inspect + clear, `beaconFocusCommentId` in the return.
- `src/features/geo-editor/GeoEditorView.tsx` — destructured `beaconFocusCommentId`; threaded `route.commentId` at the beacon dispatch; passed `beaconFocusCommentId` to both `GeoEditorInfoPanel` mounts.
- `src/components/GeoEditorInfoPanel.tsx` — added the `beaconFocusCommentId` prop + destructure; forwarded it (and the comment/mention props) to `<BeaconViewPanel>` (see Deviation 1).
- `.planning/phases/13-cross-cutting/deferred-items.md` — new; logs 2 pre-existing biome a11y errors (out of scope).

## Decisions Made
- Followed the plan as specified for D-08/D-09/D-10. The one structural clarification was where BeaconViewPanel is actually rendered (Deviation 1 below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] beaconFocusCommentId must route through GeoEditorInfoPanel, not straight into GeoEditorView**
- **Found during:** Task 2
- **Issue:** The plan's action says "pass `focusCommentId={beaconFocusCommentId}` to every BeaconViewPanel mount (the ~L2205 and ~L2547 region)". But `BeaconViewPanel` is NOT rendered at those GeoEditorView lines — those lines render `GeoEditorInfoPanel`, which renders `BeaconViewPanel` internally (GeoEditorInfoPanel.tsx:709-719). The ~L2205/~L2547 `focusCommentId={focusCommentId}` there is the *generic* route prop, not the beacon one. Without threading a dedicated `beaconFocusCommentId` prop through GeoEditorInfoPanel, the value never reaches the panel and D-10 would silently no-op (the URL `/comment/:id` segment is wiped by `navigateTo` before the generic `focusCommentId` could carry it — the exact reason the Sighting path holds `sightingFocusCommentId` in hook state).
- **Fix:** Added a `beaconFocusCommentId?: string` prop to `GeoEditorInfoPanelProps` (mirroring the existing `sightingFocusCommentId` prop, comment and all), destructured it, and forwarded `focusCommentId={beaconFocusCommentId ?? focusCommentId}` (plus the comment/mention props) to `<BeaconViewPanel>`. This is the byte-parallel of how `sightingFocusCommentId` already reaches `SightingViewPanel`.
- **Files modified:** `src/components/GeoEditorInfoPanel.tsx` (not in the plan's files_modified — added because it is the actual render host for BeaconViewPanel).
- **Commit:** `153db09`

### Out-of-scope discoveries (logged, NOT fixed)

- `src/components/GeoEditorInfoPanel.tsx:969` and `:1022` — two pre-existing `lint/a11y/noLabelWithoutControl` biome errors (from commits `25ec4ec4` / `3510c175`, months old) on unattached-context label rows my diff never touches. They block a whole-file biome check on GeoEditorInfoPanel.tsx but NOT on the two plan-specified Task-2 files (`useBeaconController.ts`, `GeoEditorView.tsx`), which are clean; the lines I added to GeoEditorInfoPanel.tsx also pass biome. Logged in `deferred-items.md` per the SCOPE BOUNDARY rule.

## Threat Model Outcomes
- **T-13-02-MALNADDR (mitigate):** satisfied. The dispatcher never decodes `segments[1]` — it is passed opaque. The test `parsePathSegments(['beacon', 'not-a-valid-naddr'])` asserts no throw + focusType `beacon` + naddr passed through. No naddr validation was added to the parser (would diverge from the 5 clones, which also passed it opaque).
- **T-13-02-MISROUTE (mitigate):** satisfied. `SHARE_ROUTES` is a closed `Record` keyed only by the five known prefixes; the test proves an unknown prefix does NOT match (falls through to focusType `none`). No focusType/sidebarView is derived from the URL segment.
- **T-13-02-URLBREAK (mitigate):** satisfied. D-09 byte-for-byte parse assertions for all five prefixes + the `/comment` suffix are GREEN; `src/index.ts` (the server-side OG redirects) was NOT modified — the client parser preserving all five prefixes is what keeps shared links + OG cards resolving.
- **T-13-02-GPS (mitigate):** satisfied. The beacon naddr-resolution block (GeoEditorView L1964-1966, the account-free `{authors,#d}` fallback) is byte-for-byte unchanged — only the `handleInspectBeacon` CALL gained a second arg (`route.commentId`). `git diff` confirms no change to the `beacons.find`/`routedBeacons.find`/`encodeBeaconNaddr` resolution lines. The commentId carries only a comment d-tag; it does not alter how the beacon position resolves or renders.

## Known Stubs
None. Every symbol introduced is wired end-to-end (SHARE_ROUTES is consumed by parsePathSegments; beaconFocusCommentId flows controller → view → panel).

## Verification Evidence
- `bun test src/features/geo-editor/hooks/useRouting.dispatch.test.ts` → 12 pass / 0 fail.
- `bun test` (full suite) → 772 pass / 0 fail (up from the 760 Plan-01 baseline: +12 new dispatch tests; no regression). The optimize-worker log lines are an intentional worker-failure simulation inside a passing test.
- `bun run build` → succeeds (client + server + 5 workers), twice (once per task).
- `bunx biome check` on the three plan-specified source files (useRouting.ts, useBeaconController.ts, GeoEditorView.tsx) → clean.
- Acceptance greps — Task 1: `SHARE_ROUTES` = 3 (≥2); 5 cloned blocks = 0; `upgradeLegacyHashRoute|decodeContextCoordinateFromNaddr` = 5 (≥2). Task 2: `beaconFocusCommentId` in useBeaconController = 1, in GeoEditorView = 3 (≥2); `handleInspectBeacon(beacon, route.commentId)` = 1; `commentId` in useBeaconController = 3; `BeaconViewPanel.tsx` diff = empty (untouched).
- D-09 URL preservation: `src/index.ts` NOT in files_modified and NOT edited; the OG server redirects resolve because the client parser still recognizes all five prefixes.

## Issues Encountered
The whole-file `bunx biome check src/components/GeoEditorInfoPanel.tsx` reports 2 pre-existing a11y errors unrelated to this plan (logged, deferred). No other issues.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- XCUT-02 routing generalization is code-complete: one dispatcher, byte-for-byte URLs, beacon comment parity. XCUT-02 as a ROADMAP requirement is marked complete by this plan (D-08/D-09/D-10 all satisfied); note the phase also carries the Map Stack unification (13-03/13-04) under the broader XCUT tags.
- The route dispatcher is now trivially extensible — a new kind is one `SHARE_ROUTES` row + one `focusType` union member.
- Beacon comment deep-linking is fully wired; the 4-kind comment×route×share matrix (D-11 UAT) can now be exercised for all four kinds.

## Self-Check: PASSED

- FOUND: src/features/geo-editor/hooks/useRouting.dispatch.test.ts
- FOUND: src/features/geo-editor/hooks/useRouting.ts (modified)
- FOUND: src/features/geo-editor/hooks/useBeaconController.ts (modified)
- FOUND: src/features/geo-editor/GeoEditorView.tsx (modified)
- FOUND: src/components/GeoEditorInfoPanel.tsx (modified)
- FOUND: .planning/phases/13-cross-cutting/deferred-items.md
- FOUND: commit f171eea (Task 1)
- FOUND: commit 153db09 (Task 2)

---
*Phase: 13-cross-cutting*
*Completed: 2026-07-02*
