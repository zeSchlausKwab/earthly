---
phase: 08-spec-v2-foundation
plan: 02
subsystem: nostr
tags: [nostr, nip-32, nip-40, tags, model-version, expiry, applesauce, tdd-green]

# Dependency graph
requires:
  - phase: 08-spec-v2-foundation (08-01)
    provides: RED Wave-0 contracts pinning tags/modelVersion/expiry symbol names
provides:
  - Three new kind constants ARTICLE_KIND=37520 / LIVE_BEACON_KIND=37521 / TEMPORAL_SIGHTING_KIND=37522 (D-01)
  - Shared tags.ts seam (bbox/g/t/c/a read+write) consumed by geo-event + map-context with copy-paste removed (SPEC-02)
  - NIP-32 L/l paired-emit helper + EARTHLY_LABEL_NAMESPACE + FEATURE_CATEGORY_VOCAB + t/l disjointness guard (TAX-01)
  - hasCurrentModelVersion no-throw in-content discriminator + MODEL_VERSION='earthly/2' (SPEC-03)
  - isExpired/dropExpired NIP-40 client read filter (SPEC-05)
affects: [08-03, 08-04, article, live-beacon, temporal-sighting, group, story, sighting, beacon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One shared tags.ts seam owns bbox/g/t/c/a read+write; per-kind helpers delegate (no drift between geo-event and map-context shaped events)"
    - "Defensive JSON.parse no-throw guard (mirrors map-context/helpers.ts:75-85) for the model-version render-set gate"
    - "NIP-32 L/l emitted atomically as a paired set; t/l disjointness enforced at write time"

key-files:
  created:
    - src/lib/nostr/tags.ts
    - src/lib/nostr/modelVersion.ts
    - src/lib/nostr/expiry.ts
  modified:
    - src/lib/nostr/kinds.ts
    - src/lib/nostr/geo-event/helpers.ts
    - src/lib/nostr/map-context/helpers.ts
    - src/lib/nostr/index.ts

key-decisions:
  - "MODEL_VERSION literal chosen as 'earthly/2' (clean-break discriminator per RESEARCH A1)"
  - "setLabels THROWS on a t/l overlap rather than silently dropping — the Wave-0 test asserts toThrow(); setHashtags strips values already governed by l (the inverse lane, no throw)"
  - "isExpired/dropExpired take an explicit epoch-seconds `now` arg (per 08-01 contract) and read the NIP-40 timestamp via applesauce getExpirationTimestamp, comparing against the injected clock for determinism"
  - "Write setters centralized into tags.ts as pure string[][]->string[][] transformers; read getters in both shipped helpers now delegate (the byte-identical copy-paste bodies are gone)"
  - "tags.ts re-exported from the nostr barrel (src/lib/nostr/index.ts) alongside modelVersion + expiry"

requirements-completed: [SPEC-02, SPEC-03, SPEC-05, TAX-01]

# Metrics
duration: 11min
completed: 2026-06-25
---

# Phase 8 Plan 02: Shared Spec-v2 Foundation Seams Summary

**Stood up the five low-risk shared seams every new entity kind inherits — the three new kind constants (D-01), the extracted `tags.ts` (with both shipped kinds migrated onto it), the NIP-32 `L`/`l` paired-emit helper + starter vocab (TAX-01), the in-content `modelVersion` no-throw guard (SPEC-03), and the NIP-40 `isExpired`/`dropExpired` wrapper (SPEC-05) — turning the three shared-seam Wave-0 suites GREEN with no regression.**

## Performance

- **Duration:** ~11 min
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 4

## Accomplishments
- Added `ARTICLE_KIND=37520`, `LIVE_BEACON_KIND=37521`, `TEMPORAL_SIGHTING_KIND=37522` to `kinds.ts` as a contiguous block (D-01), mirroring the existing doc-comment style; left 37515/37517/37518/37519/34444 + status kinds untouched.
- Extracted `tags.ts`: shared cached read getters (`getBbox`/`getGeohash`/`getHashtags`/`getContextRefs`/`getReferencedAddresses`) with ONE `Symbol.for` per tag name (not per entity kind), plus pure `string[][]->string[][]` write setters. `setGeohash` derives the `g` hash from a `[lon,lat]` centroid via `lonLatToWorldGeohash` clamped to precision 5–7.
- Migrated `geo-event/helpers.ts` and `map-context/helpers.ts` so their bbox/`g`/`t`/`c`/`a` read getters delegate to `tags.ts` — keeping each module's existing exported function names as thin wrappers so no call site broke. The copy-pasted getter bodies (and now-unused per-kind memo symbols) are removed from both consumers.
- Added the NIP-32 taxonomy seam to `tags.ts` (TAX-01): `EARTHLY_LABEL_NAMESPACE='earthly'`, `FEATURE_CATEGORY_VOCAB`, `setLabels` (atomic `['L','earthly']` + one `['l',v,'earthly']` per value, empty set strips all `L`/`l`), `getLabels` (reads only earthly-namespaced `l`), and the `t`/`l` disjointness guard (`setLabels` throws on overlap; `setHashtags` strips values already governed by `l`).
- Created `modelVersion.ts` (SPEC-03): `MODEL_VERSION='earthly/2'` + `hasCurrentModelVersion` with the defensive `JSON.parse` try/catch returning `false` (never throwing) on parse failure or absence — so a `filter(hasCurrentModelVersion)` excludes legacy + malformed entries.
- Created `expiry.ts` (SPEC-05): `isExpired(event, now)` and `dropExpired(events, now)` against an explicit UTC epoch-seconds clock.
- Re-exported `tags.ts` / `modelVersion.ts` / `expiry.ts` from the nostr barrel.

## Task Commits

1. **Task 1: 3 kind constants + extract shared tags.ts (migrate both shipped consumers)** — `f34e972` (feat)
2. **Task 2: NIP-32 L/l + vocab + disjointness, modelVersion guard, NIP-40 expiry** — `7189cce` (feat)

## Files Created/Modified
- `src/lib/nostr/kinds.ts` — added ARTICLE/LIVE_BEACON/TEMPORAL_SIGHTING constants (D-01)
- `src/lib/nostr/tags.ts` (created) — shared bbox/g/t/c/a read+write + NIP-32 L/l + vocab + disjointness
- `src/lib/nostr/modelVersion.ts` (created) — MODEL_VERSION + hasCurrentModelVersion no-throw guard
- `src/lib/nostr/expiry.ts` (created) — isExpired/dropExpired NIP-40 read filter
- `src/lib/nostr/geo-event/helpers.ts` — read getters delegate to tags.ts; unused symbols removed
- `src/lib/nostr/map-context/helpers.ts` — read getters delegate to tags.ts; unused symbols removed
- `src/lib/nostr/index.ts` — re-export tags / modelVersion / expiry

## Decisions Made
- `MODEL_VERSION = 'earthly/2'` selected as the clean-break literal (RESEARCH A1 left the exact value to planner/executor discretion).
- `setLabels` enforces `t`/`l` disjointness by **throwing** when a requested label already exists as a freeform `t` hashtag — the Wave-0 test asserts `toThrow()`. The reverse lane (`setHashtags`) silently strips any value already governed by an `l` label, since promoting a controlled label out of `t` is the safe direction.
- Write setters were centralized into `tags.ts` (the two factories' setter shapes are byte-identical filter-out-then-append), exposed as pure transformers. Per honor of the tight-diff constraint, the shipped factories were **not** rewired in this plan — they keep their existing inline `modifyPublicTags` setters; the new four kinds (Plan 04) consume the `tags.ts` transformers. Read getters in both shipped helpers **were** migrated to delegate.
- `isExpired`/`dropExpired` accept an explicit `now` (epoch seconds) per the 08-01 contract and read the NIP-40 `expiration` via applesauce `getExpirationTimestamp`, comparing against the injected clock so the predicate is deterministic under a fixed test clock.

## Deviations from Plan
None — plan executed as written. Note on scope: the plan's Task-1 acceptance row expected `bun test src/lib/nostr/tags.test.ts` to pass the SPEC-02 rows after Task 1, but `tags.test.ts` imports the TAX-01 symbols (`setLabels`/`getLabels`/`FEATURE_CATEGORY_VOCAB`/`EARTHLY_LABEL_NAMESPACE`) at module scope, so the file cannot load until Task 2 lands those exports. The whole suite therefore turns GREEN at the end of Task 2 (as the plan's Task-2 acceptance row requires). Task 1 was instead validated by the SPEC-02 migration logic + zero regression on the 571-test baseline; biome + full suite were re-confirmed GREEN after Task 2.

## Issues Encountered
- The repo `bun run lint` script lints the whole tree (large pre-existing baseline error count, per MEMORY tsc/biome baseline) and ignores file arguments. Ran `bunx biome check` directly on the new/changed source files instead — all clean — consistent with the phase gate (biome on changed files, not a clean whole-tree run).

## Test Results
- `bun test src/lib/nostr/tags.test.ts src/lib/nostr/modelVersion.test.ts src/lib/nostr/expiry.test.ts` → 17 pass / 0 fail (GREEN).
- Full suite: **588 pass / 4 fail** — up from the 571-pass baseline. The 4 remaining RED files (`schemaWorker.test.ts` + the three per-kind suites `article`/`live-beacon`/`temporal-sighting`) are owned by Plans 08-03/08-04 and were intentionally left RED.
- `bun run build` → green (worker assets emit).
- `bunx biome check` → clean on all new/changed source files.

## Known Stubs
None — all three seams are fully wired (no placeholder data, no empty returns flowing to UI; these are pure library helpers consumed by later plans).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Plan 08-03 implements the remaining shared-validation seam (`schemaWorker.ts`); Plan 08-04 implements the three per-kind barrels (article/live-beacon/temporal-sighting), each consuming `tags.ts` transformers + `MODEL_VERSION` + the NIP-40 expiry seam.
- No blockers. The four foundation symbol sets are live and GREEN.

## Self-Check: PASSED

All three created files (`tags.ts`, `modelVersion.ts`, `expiry.ts`) exist on disk; both task commits (`f34e972`, `7189cce`) present in git history.

---
*Phase: 08-spec-v2-foundation*
*Completed: 2026-06-25*
