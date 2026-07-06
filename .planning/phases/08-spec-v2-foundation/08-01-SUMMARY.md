---
phase: 08-spec-v2-foundation
plan: 01
subsystem: testing
tags: [bun-test, nostr, nip-32, nip-40, ajv, json-schema, nyquist, tdd-red]

# Dependency graph
requires:
  - phase: 08-spec-v2-foundation (planning)
    provides: 08-VALIDATION.md Wave-0 test map + symbol contracts
provides:
  - Seven RED Wave-0 *.test.ts files pinning the exact export contracts of every Phase 8 foundation seam
  - Binding symbol names for tags.ts (getBbox/getGeohash/getHashtags/getLabels/getContextRefs/getReferencedAddresses + set* + FEATURE_CATEGORY_VOCAB/EARTHLY_LABEL_NAMESPACE)
  - Binding symbol names for modelVersion.ts (MODEL_VERSION, hasCurrentModelVersion)
  - Binding symbol names for expiry.ts (isExpired, dropExpired)
  - Binding symbol names for schemaWorker.ts (validateSchema + __compileCount/__resetCompileCount test hooks)
  - Binding per-kind barrel contracts for article (37520), live-beacon (37521), temporal-sighting (37522)
affects: [08-02, 08-03, 08-04, group, story, sighting, beacon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nyquist Wave-0: RED test stubs pin final symbol identifiers before any implementation lands"
    - "schemaWorker tests drive the synchronous fallback (no live Worker under bun test), mirroring quickjsWorker.ts:131"

key-files:
  created:
    - src/lib/nostr/tags.test.ts
    - src/lib/nostr/modelVersion.test.ts
    - src/lib/nostr/expiry.test.ts
    - src/lib/validation/schemaWorker.test.ts
    - src/lib/nostr/article/article.test.ts
    - src/lib/nostr/live-beacon/live-beacon.test.ts
    - src/lib/nostr/temporal-sighting/temporal-sighting.test.ts
  modified: []

key-decisions:
  - "RED is the success state: all 7 files fail on missing-module references, pinning contracts for Plans 02-04"
  - "isExpired/dropExpired take an explicit `now` (epoch seconds) arg so the predicate is deterministic against a fixed UTC clock"
  - "schemaWorker exposes __compileCount/__resetCompileCount test-only hooks so compile-once-per-schemaHash and $ref-rejected-before-compile are observable"
  - "Per-kind barrels also export their KIND constant (ARTICLE_KIND/LIVE_BEACON_KIND/TEMPORAL_SIGHTING_KIND) consumed by the guard/factory tests"

patterns-established:
  - "Pattern 1 naming honored: is<Entity> / <Entity>Factory / <Entity> cast (Article/LiveBeacon/TemporalSighting)"
  - "All tag reads route through the shared tags.ts seam — geo-event and map-context shaped events round-trip identically"

requirements-completed: [SPEC-02, SPEC-03, SPEC-04, SPEC-05, TAX-01]

# Metrics
duration: 9min
completed: 2026-06-25
---

# Phase 8 Plan 01: Nyquist Wave-0 Test Baseline Summary

**Seven RED `bun:test` files pin the exact export contracts of every Phase 8 foundation seam (tags, modelVersion, expiry, schemaWorker + the three per-kind barrels) before any implementation lands — establishing the Nyquist sampling baseline that Plans 02–04 turn GREEN.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-25T06:56Z
- **Completed:** 2026-06-25T07:05Z
- **Tasks:** 2
- **Files created:** 7

## Accomplishments
- Pinned the four shared-seam contracts (SPEC-02/03/04/05 + TAX-01) by their final symbol names — `tags.ts`, `modelVersion.ts`, `expiry.ts`, `schemaWorker.ts`.
- Pinned the three per-kind scaffold contracts (SPEC-02) for kinds 37520/37521/37522 using the `is<Entity>`/`<Entity>Factory`/`<Entity>` Pattern-1 naming, including LiveBeacon's NIP-40 `expiresAt`.
- All 7 files report RED (`Cannot find module` references), confirming the assertions execute against absent modules rather than vacuously passing (mitigates T-08-01-1 false-green).
- biome clean on all 7 new files; line counts exceed every `min_lines` floor in the plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin the four shared-seam test contracts** - `95c35a6` (test)
2. **Task 2: Pin the three per-kind scaffold test contracts** - `45a36f0` (test)

**Plan metadata:** committed separately with SUMMARY/STATE/ROADMAP (docs).

## Files Created/Modified
- `src/lib/nostr/tags.test.ts` - SPEC-02 bbox/t/c/a round-trip + shared-helper equality + TAX-01 L/l pairing, vocab, disjointness (127 lines)
- `src/lib/nostr/modelVersion.test.ts` - SPEC-03 guard truth table {new, legacy, malformed} + no-throw + render-set filter (67 lines)
- `src/lib/nostr/expiry.test.ts` - SPEC-05 isExpired/dropExpired against a fixed UTC clock (59 lines)
- `src/lib/validation/schemaWorker.test.ts` - SPEC-04 ReDoS/$ref/$dynamicRef/oversized fail-closed within timeout + compile-once-per-hash + $data-off via sync fallback (100 lines)
- `src/lib/nostr/article/article.test.ts` - SPEC-02 isArticle guard + ArticleFactory.create() d+modelVersion + Article cast dTag (65 lines)
- `src/lib/nostr/live-beacon/live-beacon.test.ts` - SPEC-02 isLiveBeacon guard + create() + LiveBeacon cast dTag + NIP-40 expiresAt (74 lines)
- `src/lib/nostr/temporal-sighting/temporal-sighting.test.ts` - SPEC-02 isTemporalSighting guard + create() + cast dTag (69 lines)

## Decisions Made
- `isExpired(event, now)` / `dropExpired(events, now)` accept an explicit epoch-seconds clock argument so SPEC-05 is deterministic against a fixed UTC time rather than `Date.now()`.
- schemaWorker exposes `__compileCount()` / `__resetCompileCount()` test-only hooks — the only way to assert compile-once-per-`schemaHash` and `$ref`-rejected-before-compile without a spy framework (Bun has no built-in module spy for this shape).
- Each per-kind barrel is expected to export its `*_KIND` constant alongside the guard/factory/cast; the tests import it to build synthetic events and to keep the kind number in one place.

## Deviations from Plan

None - plan executed exactly as written. RED is the intended baseline per the plan's critical-red note; no implementation modules were created.

## Issues Encountered
- The repo `bun run lint` script lints the entire tree (115 pre-existing baseline errors, per the tsc/biome baseline in MEMORY) and ignores file arguments. Resolved by running `bunx biome check` directly against the 7 new files to prove they are clean in isolation — consistent with the phase gate definition (biome on changed files, not a clean whole-tree run).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plans 02/03 implement `tags.ts`, `modelVersion.ts`, `expiry.ts`; Plan 04 implements `schemaWorker.ts` + the three per-kind barrels. Each must honor the exact symbol names pinned here to turn these files GREEN.
- No blockers. The contracts are live (RED), not vacuous.

## Self-Check: PASSED

All 7 test files + SUMMARY.md exist on disk; both task commits (95c35a6, 45a36f0) present in git history.

---
*Phase: 08-spec-v2-foundation*
*Completed: 2026-06-25*
