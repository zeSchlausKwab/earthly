---
phase: 07-geometry-optimization
verified: 2026-06-23T10:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 3/3
  gaps_closed:
    - "optimize() on a realistic few-large-features dataset completes well under a hard time bound — near-linear, not quadratic"
    - "runOptimize() NEVER re-runs optimize() synchronously on the main thread for a large dataset on a hung worker — timeout terminates the worker and size gate rejects"
    - "workerBroken / no-worker fast paths go through settleWithoutWorker() which keeps the size gate (WR-01 code-review fix)"
    - "bytesAfter <= bytesBefore guaranteed by code, not incidental (WR-04 fix)"
    - "terminateOptimizeWorker() rejects in-flight pendings (IN-03 fix)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Load a real oversized dataset (e.g. the 12MB West Pacific Trail) into the editor, ask the AI to optimize it, review the before/after diff headline and the metrics, and then publish successfully."
    expected: "The optimize_geometry tool runs off-thread (no UI freeze for normal-sized data), returns a ToolError with a relayable message for truly pathological oversized inputs, the diff disclosure shows the metrics headline (bytes/vertices/features/joins), the result is under the 1MB publish limit, topology is preserved visually, and the normal publish flow completes."
    why_human: "End-to-end publish round-trip with a live Nostr relay, real browser Worker execution, visual quality judgment, and confirming the ToolError message surfaces correctly to the model for pathological inputs cannot be exercised in the test runner."
---

# Phase 7: Geometry Optimization Verification Report (Re-verification after 07-05 gap closure)

**Phase Goal:** A user can take an oversized, messy GeoJSON the publish/city dialog rejects, have the AI shrink it toward a byte budget without visibly degrading it, and then publish it.
**Verified:** 2026-06-23T10:00:00Z
**Status:** human_needed — all 5 must-haves verified at code level; one live round-trip UAT item deferred from the original verification remains open
**Re-verification:** Yes — after 07-05 gap closure (crash fix + code-review resolution commit c6ff708)

---

## Re-verification Summary

The previous verification (2026-06-22) found status `human_needed` with 3/3 automated truths passing and one live-browser UAT item blocking final sign-off. Human UAT then revealed a BLOCKER: invoking `optimize_geometry` on a real large dataset crashed the tab (OOM). Gap-closure plan 07-05 was executed to fix the two compounding root causes (quadratic `optimize()` + unsafe main-thread sync fallback on timeout), and a follow-up code-review commit (c6ff708) closed the remaining runtime-safety findings (WR-01/WR-04/WR-05/IN-03).

This re-verification confirms all 07-05 must-haves are satisfied at the code level. The live optimize→publish round-trip remains the one open human-verification item.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The AI can reduce an oversized GeoJSON toward a byte budget using simplify + merge-to-multi + microgap stitching, executed off the main thread without freezing the app | VERIFIED | `optimize.ts` implements all three stages (stitch → merge → binary-search-simplify with `highQuality:false`); `optimizeClient.ts` spawns via `workerUrl('optimize')`; 571/0 full suite green; acceptance test passes (`>1MB → <BLOSSOM_UPLOAD_THRESHOLD_BYTES`); worker emitted as `dist/workers/optimize.worker.js` (17K) |
| 2 | Optimization reports before/after metrics and validates topology — no new self-intersections or zero-area collapse, per-feature properties preserved through merge, microgap join count shown | VERIFIED | `OptimizeReport` carries all required fields; `validateBelowThreshold()` implements the bounded topology guard; `buildOptimizeHeadline(report)` surfaces metrics; `introduceNewTopologyProblems()` uses validate-once-at-end strategy with one-step back-off; all topology + merge + acceptance tests green |
| 3 | A dataset that previously exceeded the publish/city-dialog size limit can be brought under the limit and published | VERIFIED (automated) / NEEDS HUMAN (live publish) | Automated: acceptance test confirms >1MB fixture → `bytesAfter < BLOSSOM_UPLOAD_THRESHOLD_BYTES`, `microgapJoins > 0`, `verticesAfter < verticesBefore`; full suite 571/0; live in-browser publish round-trip is human-gated |
| 4 | `optimize()` on a realistic few-large-features dataset (~100k+ vertices) completes well under a hard time bound — near-linear, not quadratic | VERIFIED | `optimize.perf.test.ts` added (`makeFewLargeFeaturesFixture`: 4 features × 40k verts = ~160k total); Test 1 asserts `elapsed < 10_000ms`; passes in ~1.5s total for 7 tests; TOPOLOGY_VALIDATION_MAX_VERTICES=5000 prevents O(V²) `turf.kinks` per-iteration; `highQuality:false` in `simplifyAll()` replaces the old expensive variant |
| 5 | `runOptimize()` NEVER re-runs `optimize()` synchronously on the main thread for a large dataset when the worker hangs or breaks — timeout terminates the worker and size gate rejects; `workerBroken` path also goes through the size gate | VERIFIED | `settleViaSync` is gone entirely; timeout fires `recycleWorker()` (no `workerBroken` latch) then `settleSizeGated()`; `workerBroken` path routes through `settleWithoutWorker()` which keeps the `SYNC_FALLBACK_MAX_BYTES` gate; Tests B/C/D in `optimizeClient.test.ts` all pass; code-review fix c6ff708 confirmed in git |

**Score:** 5/5 truths verified

---

### 07-05 Must-Have Checklist

| Must-Have | Status | Evidence |
|-----------|--------|----------|
| `optimize.ts` uses `highQuality: false` in binary search | PASS | `optimize.ts:302` — `turf.simplify(f as Feature, { tolerance, highQuality: false })`; grep pattern `highQuality:\\s*false` matches |
| `TOPOLOGY_VALIDATION_MAX_VERTICES` constant defined; per-iteration kinks NOT run over high-vertex features | PASS | `optimize.ts:84` — `const TOPOLOGY_VALIDATION_MAX_VERTICES = 5_000`; `validateBelowThreshold()` filters to `<= 5000` vert features; binary search loop has NO `introducesNewTopologyProblems()` call inside it (validate-once-at-end strategy) |
| `optimize.perf.test.ts` exists with `makeFewLargeFeaturesFixture` and 10s hard bound | PASS | File created at `src/features/chat/geometry/optimize.perf.test.ts`; exports `makeFewLargeFeaturesFixture`; Test 1 asserts `elapsed < 10_000`; 3 tests pass in ~1.5s |
| `optimizeClient.ts` timeout calls `recycleWorker()` (terminate without `workerBroken` latch) + `settleSizeGated()` | PASS | `optimizeClient.ts:275-276` — `recycleWorker(); settleSizeGated(stuck)` in the timeout callback; `recycleWorker()` does not set `workerBroken`; `settleViaSync` is absent (0 grep matches) |
| `SYNC_FALLBACK_MAX_BYTES` gate in `settleSizeGated()` — over-threshold rejects, under-threshold syncs | PASS | `optimizeClient.ts:61` — `const SYNC_FALLBACK_MAX_BYTES = 256 * 1024`; `settleSizeGated()` at line 114 applies the gate; `tooLargeError()` message matches `/timed out\|too large/i` |
| `workerBroken` / no-worker fast paths go through `settleWithoutWorker()` (size gate preserved — WR-01) | PASS | `optimizeClient.ts:242-245` — `if (workerBroken)` routes to `settleWithoutWorker()`; `settleWithoutWorker()` distinguishes `typeof Worker === 'undefined'` (SSR/test, all sizes) from real browser (size gate applies); Test D passes |
| `optimizeClient.test.ts` contains Tests A/B/C/D | PASS | All four test labels confirmed at lines 104, 119, 144, 163; 7/7 tests in the two new files pass |
| A3 boundary — optimize.ts grep prints 0 | PASS | `grep -cE "@/features/geo-editor/api[^/]\|geo-editor/core/GeoEditor\|from 'pino'\|@nostr" optimize.ts` → 0 |
| A3 boundary — optimizeClient.ts grep prints 0 | PASS | `grep -cE "@/features/geo-editor/api[^/]\|from 'pino'\|@nostr" optimizeClient.ts` → 0 |
| `bun test` full suite — 571 pass / 0 fail | PASS | Confirmed: 571 pass / 0 fail / 3019 expect() calls, 10.23s |
| `bun run build` emits `dist/workers/optimize.worker.js` | PASS | Build completed in ~1028ms; `dist/workers/optimize.worker.js` = 17K |
| Biome clean on 07-05 changed files | PASS | `npx biome check` on 4 files → "No fixes applied" (wider project has pre-existing issues; 07-05 files are clean) |
| All 5 commit hashes present in git | PASS | `15f9380` (RED perf), `06caff0` (GREEN optimize bound), `ab3c791` (RED safe-timeout), `a28d98c` (GREEN client), `c6ff708` (code-review fixes) all confirmed in git log |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/chat/geometry/optimize.ts` | Bounded near-linear `optimize()` — `highQuality:false` search, validate-once-at-end topology | VERIFIED | Line 302: `highQuality: false`; line 84: `TOPOLOGY_VALIDATION_MAX_VERTICES = 5_000`; topology validation call (`introducesNewTopologyProblems`) is outside the binary-search loop; WR-04 fix: lines 464-466 guard against byte inflation |
| `src/features/chat/geometry/optimizeClient.ts` | Safe timeout — terminate worker + size-gated reject; `workerBroken` path size-gated | VERIFIED | `recycleWorker()` at line 275 (no `workerBroken` latch); `settleSizeGated()` at line 276; `settleWithoutWorker()` at lines 243, 253; `settleViaSync` absent; IN-03 fix: `terminateOptimizeWorker()` rejects in-flight pendings (lines 291-294) |
| `src/features/chat/geometry/optimize.perf.test.ts` | Regression: few-large-features (~100k+ verts) completes under a hard time bound | VERIFIED | Created; exports `makeFewLargeFeaturesFixture` (4 lines × 40k verts); 3 tests: wall-clock < 10s, honest report, no new self-intersections; all pass |
| `src/features/chat/geometry/optimizeClient.test.ts` | Tests A/B/C/D pinning safe-timeout + size-gate invariants | VERIFIED | Tests A (sync no-Worker), B (large + hung worker → reject), C (small + hung worker → sync), D (broken worker → large rejects, small syncs); all 4 pass |

### Key Link Verification

All previously-verified key links from the original verification hold. Added links from 07-05:

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `optimizeClient.ts` timeout | `recycleWorker()` | timeout fires → `recycleWorker()` (no `workerBroken` latch), then `settleSizeGated()` | WIRED | Lines 274-276 confirmed |
| `optimizeClient.ts` workerBroken path | `settleWithoutWorker()` | `if (workerBroken) → settleWithoutWorker()` | WIRED | Lines 242-245 confirmed |
| `settleWithoutWorker()` | size gate | `typeof Worker === 'undefined' OR bytes < SYNC_FALLBACK_MAX_BYTES` → sync; else reject | WIRED | Lines 135-143 confirmed |
| `terminateOptimizeWorker()` | in-flight pendings | iterate `pendingRequests`, `clearTimeout`, `pending.reject(...)` | WIRED | Lines 291-294 confirmed |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Few-large-features perf bound (< 10s) | `bun test src/features/chat/geometry/optimize.perf.test.ts` | 3 pass, ~1.5s total | PASS |
| Safe-timeout Tests A/B/C/D | `bun test src/features/chat/geometry/optimizeClient.test.ts` | 4 pass | PASS |
| Full geometry suite (acceptance + unit) | `bun test src/features/chat/geometry/` | All tests pass | PASS |
| Full test suite (no P5/6 regressions) | `bun test` | 571 pass / 0 fail | PASS |
| Build emits optimize worker | `bun run build` | Success; `dist/workers/optimize.worker.js` 17K emitted | PASS |
| A3 boundary — optimize.ts | `grep -cE "..."` | 0 | PASS |
| A3 boundary — optimizeClient.ts | `grep -cE "..."` | 0 | PASS |
| Biome clean on 07-05 files | `npx biome check` on 4 files | No fixes applied | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GEO-01 | 07-01, 07-02, 07-03, 07-04, 07-05 | AI reduces oversized GeoJSON toward byte budget off main thread | SATISFIED | `optimize.ts` (bounded near-linear); `optimizeClient.ts` (safe timeout, never blocks main thread for large inputs); `optimize_geometry` tool registered; 571/0 tests |
| GEO-02 | 07-02, 07-03, 07-04 | Reports before/after metrics, validates topology | SATISFIED | `OptimizeReport` has all fields; validate-once-at-end topology guard; `buildOptimizeHeadline` surfaces metrics in diff disclosure; all topology/merge tests pass |
| GEO-03 | 07-01, 07-03, 07-04 | Dataset that exceeded publish limit can be brought under it and published | SATISFIED (automated) / HUMAN (live) | Acceptance test: >1MB → `bytesAfter < BLOSSOM_UPLOAD_THRESHOLD_BYTES`; live publish round-trip is human-gated |

### Anti-Patterns in 07-05 Modified Files

No TBD/FIXME/XXX debt markers in any 07-05 modified file. No stubs, no placeholder returns. The code-review report (07-05-REVIEW.md) found 5 warnings and 3 info items in the original 07-05 diff; the critical runtime-safety ones (WR-01, WR-04, WR-05, IN-03) were all fixed in c6ff708. Accepted as sign-off:

| Finding | Disposition | Impact |
|---------|-------------|--------|
| WR-02: `gentlest` variable name/comment inverted — tracks most-aggressive candidate | Accepted (sign-off) | Behavior is arguably correct (get closest to budget when unreachable); only name + comments are misleading. No behavior regression. |
| WR-03: topology guard is a no-op when all features exceed 5k verts (the documented honest D-06 relaxation) | Accepted (sign-off) | Intentional per plan 07-05 — SIMPLIFY_TOLERANCE_MAX ceiling is the remaining shred-guard; "no crash" outranks per-iteration guard on pathological inputs |
| IN-01: stitch unconditionally snaps all coordinates even when no microgaps exist | Info, pre-existing | OUT of scope for crash fix; no regression introduced |
| IN-02: perf test's D-06-intent case doesn't exercise the backoff branch with a provably-kinking fixture | Info | Coverage gap only; does not affect whether the phase goal is achieved |

---

### Human Verification Required

#### 1. Live West Pacific Trail import → optimize_geometry → publish round-trip

**Test:** Import a real oversized dataset (the ~12MB "West Pacific Trail" or equivalent large GeoJSON) that the publish/city-dialog rejects due to size. In the chat, ask the AI to run `optimize_geometry`. Review the before/after inline diff block.

**Expected:**
- For a normal-sized oversized dataset (e.g. 1–3MB): the `optimize_geometry` tool runs without freezing the UI (it runs off-thread in the browser Worker), completes within the 30s timeout, and returns a gated diff block
- The diff block's collapsed headline shows the metrics summary (e.g. `12.0MB → 0.9MB · 41k→3.2k pts · 312→18 features · 175 joins`) instead of the generic `+N added · ~N changed · −N deleted`
- After the user applies the diff, the publish dialog no longer rejects the dataset for size
- Visual quality of the map layer is preserved (no obvious geometry shredding visible at the relevant zoom level)
- For a truly pathological dataset (many-MB, mostly large individual features): the tool returns a ToolError with a message matching "timed out" / "too large" that the model can relay to the user (instead of crashing the tab)
- If the budget is unreachable for a processable dataset, the headline shows `· still over limit` and the Blossom external-upload path is still available

**Why human:** Live browser Worker execution with a real dataset, live Nostr relay publish, visual quality judgment, and confirming the graceful ToolError path surfaces correctly to the model for pathological inputs cannot be exercised in the test runner.

---

### Gaps Summary

No gaps. All five 07-05 must-haves are satisfied at the code level:

1. `optimize()` is bounded to near-linear cost (`highQuality:false` + validate-once-at-end topology with `TOPOLOGY_VALIDATION_MAX_VERTICES=5000`). Confirmed by `optimize.perf.test.ts` (4×40k-vert fixture completes in ~1.5s, far under the 10s hard bound).
2. `runOptimize()` timeout fires `recycleWorker()` (terminate, no `workerBroken` latch) then `settleSizeGated()` — large inputs reject, small inputs sync. `settleViaSync` is gone.
3. The `workerBroken` fast path routes through `settleWithoutWorker()` which keeps the `SYNC_FALLBACK_MAX_BYTES` gate (WR-01 code-review fix). Test D pins this invariant.
4. `bytesAfter <= bytesBefore` is guaranteed by the inflation guard at `optimize.ts:464-466` (WR-04 fix).
5. `terminateOptimizeWorker()` rejects in-flight pendings so they never hang (IN-03 fix).

The only remaining item is the live in-browser optimize→publish round-trip (UAT item above), which was the original human-gated item before the UAT crash was discovered. The crash blocker is now closed at the code level.

---

_Verified: 2026-06-23T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — after 07-05 gap closure + code-review resolution (c6ff708)_
