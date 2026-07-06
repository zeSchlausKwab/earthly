---
phase: 11-temporal-sighting
plan: 01
subsystem: testing
tags: [bun-test, nostr, kind-37522, nip-52, nip-40, geojson, turf, tdd, red-baseline]

# Dependency graph
requires:
  - phase: 08-spec-v2-foundation
    provides: TemporalSightingFactory/Cast/helpers scaffold (kind 37522), shared expiry.ts (isExpired/dropExpired), tags.ts (setBbox/setGeohash/setContextRefs), GeoCommentFactory.root (runtime rootKind, no allowlist)
provides:
  - "RED test pinning the 37522 content `geometry` field + bbox/g turf-derivation (SIGHT-01)"
  - "RED test pinning the publishSighting lifecycle round-trip (.sighting.geometry deep-equal)"
  - "RED test pinning the classifyObservationState live/upcoming/past classifier (D-06)"
  - "GREEN tests pinning the defensive geometry-absent parse, c-emit + modify-d invariants (SIGHT-02)"
  - "GREEN tests pinning per-read-path dropExpired over 37522 at a fixed UTC clock, epoch-seconds units (SIGHT-03)"
  - "GREEN test pinning GeoCommentFactory.root K/k = 37522 (SIGHT-04 — no allowlist change)"
affects: [11-02, 11-03, 11-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nyquist Wave-0 RED baseline: pin net-new seams as failing tests before implementation"
    - "Bare-sign vs EventSigner contract split: EntityFactory accepts a bare sign-fn; EventFactory (GeoCommentFactory) needs a real EventSigner mock (getPublicKey + signEvent)"

key-files:
  created:
    - src/lib/nostr/temporal-sighting/observationState.test.ts
    - src/lib/nostr/geo-comment/sightingComment.test.ts
  modified:
    - src/lib/nostr/temporal-sighting/temporal-sighting.test.ts
    - src/lib/nostr/expiry.test.ts

key-decisions:
  - "sightingComment.test.ts signs via a real EventSigner mock (getPublicKey + signEvent), not the EntityFactory bare-sign fn — GeoCommentFactory extends applesauce EventFactory whose sign() requires a signer (matched storyProposal.test.ts pattern)"
  - "bbox derivation asserted exactly against turf bbox(Point); g geohash asserted present + non-empty (encoding internals stay implementation-private)"

patterns-established:
  - "RED-on-the-seam discipline: failures attributable to the missing geometry/lifecycle/classifier symbols, never to syntax"
  - "Epoch-seconds units guard in expiry tests (assert fixtures < 1e11) to catch a ms-vs-s regression (T-11-01-DOC)"

requirements-completed: []  # Wave-0 pins contracts; SIGHT-01..04 close when Plans 02–04 turn these GREEN.

# Metrics
duration: 18min
completed: 2026-06-28
---

# Phase 11 Plan 01: Temporal Sighting RED Baseline Summary

**Nyquist Wave-0 RED baseline for kind 37522 — failing tests pin the net-new `geometry`-on-content + bbox/g derivation, the publishSighting lifecycle round-trip, and the observation-state classifier; passing tests pin the c-emit/modify-d, per-read-path expiry (SIGHT-03), and comment root-kind (SIGHT-04) contracts.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-28T06:14Z
- **Completed:** 2026-06-28
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 extended)

## Accomplishments

- **Task 1** — Extended `temporal-sighting.test.ts` with five Phase-11 cases: two RED (publishSighting bbox/g derivation from a Point `content.geometry`; castEvent round-trip `.sighting.geometry` deep-equal) and three GREEN against the Phase-8 scaffold (defensive geometry-absent parse → `geometry: undefined` no-throw; `contextReferences` emits a `c` tag — SIGHT-02; `modify(existing)` preserves `d` — no lineage fork).
- **Task 2** — Created `observationState.test.ts` (RED on the missing `classifyObservationState` classifier — live/upcoming/past + no-end-live + no-start-default branches, D-06); extended `expiry.test.ts` with a 37522 per-read-path `dropExpired` block at a fixed UTC clock incl. an epoch-seconds units guard (SIGHT-03, T-11-01-DOC, GREEN); created `sightingComment.test.ts` pinning `GeoCommentFactory.root` K/k = '37522' + A/a/P/p rooting with no allowlist change (SIGHT-04, GREEN).
- Confirmed the exact intended baseline: **16 pass / 3 fail + 1 error** across the four files — failures isolated to the missing `publishSighting` lifecycle (2) and the missing `classifyObservationState` export (1 module-load error). `bun run build` green and unaffected; all four files biome-clean.

## Task Commits

1. **Task 1: 37522 geometry seam + lifecycle derivation** - `2cbb37d` (test)
2. **Task 2: observation-state classifier RED + expiry/comment pins** - `0e7d2a4` (test)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created/Modified

- `src/lib/nostr/temporal-sighting/temporal-sighting.test.ts` (MODIFIED) — +5 cases: geometry derivation (RED), round-trip (RED), defensive parse (GREEN), c-emit (GREEN), modify-d (GREEN). Adds a `mock.module('@/lib/nostr')` publish stub + `bareSign` helper mirroring `story/lifecycle.test.ts`.
- `src/lib/nostr/temporal-sighting/observationState.test.ts` (NEW) — RED stub for `classifyObservationState(start?, end?, now)` covering all three states + the no-end-live and no-start-default edges.
- `src/lib/nostr/expiry.test.ts` (MODIFIED) — +37522 Sighting `dropExpired` describe block at the fixed UTC clock; expired drops, future + no-expiration survive; epoch-seconds units guard.
- `src/lib/nostr/geo-comment/sightingComment.test.ts` (NEW) — pins `GeoCommentFactory.root({ kind: 37522, ... })` K/k = '37522' and A/a/P/p coordinate rooting; signs via a real `EventSigner` mock.

## Decisions Made

- **EventSigner vs bare-sign:** `GeoCommentFactory` extends applesauce `EventFactory`, whose `sign()` calls `signer.getPublicKey()` / `signer.signEvent()`. The EntityFactory bare-sign fn (used for `TemporalSightingFactory`) is rejected by it. Resolved by using a real `EventSigner` mock (`getPublicKey` + `signEvent`) exactly as `geo-proposal/storyProposal.test.ts` does. Caught at first run (initial bare-sign attempt failed with `signer.getPublicKey is not a function`), fixed inline within Task 2.
- **bbox vs geohash assertion strength:** bbox is asserted exactly against `turf bbox(Point)` (well-defined `[lon,lat,lon,lat]`); the `g` geohash tag is asserted present + non-empty rather than recomputed, keeping the geohash encoding (`lonLatToWorldGeohash`, precision-clamped) an implementation detail Plan 02 owns.

## Deviations from Plan

None — plan executed exactly as written. The plan's success criteria explicitly require these tests to be RED on the missing geometry/lifecycle/classifier seams; that RED state is the intended, documented outcome (not a failure).

## Issues Encountered

- **sightingComment signing:** initial draft signed with the EntityFactory bare-sign fn, which `EventFactory.sign` rejects. Switched to a real `EventSigner` mock per the storyProposal precedent → both cases GREEN. No scope impact.

## RED State (intended — Wave-0 baseline)

`bun test src/lib/nostr/temporal-sighting src/lib/nostr/expiry.test.ts src/lib/nostr/geo-comment/sightingComment.test.ts` → **16 pass / 3 fail / 1 error / 19 tests**:

- **RED (turns GREEN in Plan 02/04):**
  1. `publishing a Point sighting derives bbox + g tags from content.geometry` — `publishSighting is not a function` (Plan-02 lifecycle missing).
  2. `round-trips: castEvent(signed).sighting.geometry deep-equals the input Point` — same missing lifecycle + content `geometry` field.
  3. `observationState.test.ts` — module-load error: `Export named 'classifyObservationState' not found` (Plan-02 classifier missing).
- **GREEN (pin shipped seams + the SIGHT-03/04 contracts):** isTemporalSighting guard, factory create, cast dTag, defensive geometry-absent parse, c-emit (SIGHT-02), modify-d, all expiry cases incl. the 37522 per-read-path block (SIGHT-03), both comment root-kind cases (SIGHT-04).

These turn GREEN as Plans 02–04 land `content.geometry` + `publishSighting` + `classifyObservationState`.

## Next Phase Readiness

- Plan 02 (data layer): implement `content.geometry` on `TemporalSightingContent` + `publishSighting`/`editSighting` lifecycle (bbox/g re-derive via turf) + `classifyObservationState` — turning cases 1–3 GREEN.
- No production source touched this plan; no blockers. `gsd-tools` not on PATH — STATE/ROADMAP updated manually (the established v1.2 pattern).

## Self-Check: PASSED

- All 4 test files present on disk (2 created, 2 modified) + SUMMARY.md present.
- Both task commits present in git log: `2cbb37d` (Task 1), `0e7d2a4` (Task 2).

---
*Phase: 11-temporal-sighting*
*Completed: 2026-06-28*
