---
phase: 07-geometry-optimization
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/features/chat/geometry/optimize.ts
  - src/features/chat/geometry/optimizeClient.ts
  - src/features/chat/geometry/optimize.perf.test.ts
  - src/features/chat/geometry/optimizeClient.test.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: resolved
resolved_commit: c6ff708
resolved_at: 2026-06-23
---

# Phase 7 (07-05): Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 4
**Status:** resolved (runtime-safety findings fixed in `c6ff708`; WR-02/WR-03 accepted as sign-off)

## Resolution (2026-06-23, commit `c6ff708`)

Runtime-safety findings fixed and regression-tested (`bun test` 571/0, build + biome green):

- **WR-01 — FIXED.** The timeout path now `recycleWorker()`s (terminate, no `workerBroken`
  latch) so the next call re-spawns off-thread; the `workerBroken` / no-worker fast paths
  route through a new `settleWithoutWorker()` that keeps the 256 KiB size gate — a large
  input on a broken-after-load worker now REJECTS instead of running `optimize()` on the
  main thread. Only the genuine no-Worker env (`typeof Worker === 'undefined'`, SSR/tests)
  syncs at all sizes. New regression **Test D** pins the invariant.
- **WR-04 — FIXED.** `optimize()` returns the original input if the stitch/merge pipeline
  ever inflated bytes, so `bytesAfter <= bytesBefore` is guaranteed, not incidental.
- **WR-05 — FIXED.** A synchronous `new Worker` construction failure now latches
  `workerBroken` (no repeated failing construction per call).
- **IN-03 — FIXED.** `terminateOptimizeWorker()` now rejects in-flight pendings (cancelled)
  instead of leaving their promises forever unsettled.

Accepted as sign-off (behavior-defensible / documented, out of crash-fix scope):

- **WR-02 (gentlest naming/comments)** — the binary-search best-effort floor returns the
  most-aggressive under-budget candidate, which is the correct "get closest to budget when
  unreachable" behavior; only the variable name + comments are misleading. Left unchanged to
  avoid churning the search semantics in a crash-fix commit; flagged for a future cleanup.
- **WR-03 (topology guard no-op when every feature exceeds 5k verts)** — this is the
  documented honest D-06 relaxation from plan 07-05 (the `turf.kinks` O(V²) cost is the
  pathology being removed); `SIMPLIFY_TOLERANCE_MAX` remains the shred-guard. Accepted.
- **IN-01/IN-02** — pre-existing stitch snapping / a coverage gap in the backoff-branch test;
  noted for follow-up, not crash-fix scope.

---

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (original review — see Resolution block above)

## Summary

Focused adversarial review of the 07-05 "optimize geometry crash fix" diff across
`optimize.ts` (bounded binary search + validate-once/backoff) and `optimizeClient.ts`
(safe-timeout size-gate + worker termination + timer capture). The two test files were
reviewed for coverage gaps, not flagged for style.

The crash-fix core is sound: the binary search always settles (`MAX_ITERS`-bounded, never
throws, falls through to `merged` in the worst case), the worker boundary is clean
(leaf-only imports verified: `optimize.worker.ts` imports only `./optimize`+`./types`;
`optimize.ts` imports turf + `featureHelpers`/`geometry` leaves + the `geometryValidation`
DEEP path, whose transitive imports are turf + `EditorFeature` type + `predicate` (type-only)
— NO editor/api-barrel/DOM/worker/pino/Nostr), and the timeout path terminates the worker
and size-gates the fallback. All 6 tests pass; the perf fixture (4x40k verts) completes well
under the 10s bound because every feature exceeds the kinks threshold and the per-iteration
`turf.kinks` is gone.

No BLOCKERs found — no data-loss, no crash, no unbounded main-thread block, no double-settle,
no timer leak in the changed code. However, the changed logic ships several WARNING-level
robustness/correctness gaps and naming/comment defects that obscure the actual behavior and
weaken the stated invariants. The most important is that the `workerBroken` latch
re-opens the exact "large input runs synchronously on the main thread" hole the size gate was
added to close.

## Warnings

### WR-01: `workerBroken` latch bypasses the size gate for ALL future large inputs

**File:** `src/features/chat/geometry/optimizeClient.ts:202-206` (and the latch set at `125-129`, `163`, `232`)
**Issue:** The entire point of 07-05 (per the file header and `settleSizeGated`) is that a
large dataset must NEVER reach a main-thread synchronous `optimize()` after a worker
hang/failure — that unbounded block is the UAT crash. But `killWorker()` latches
`workerBroken = true` permanently, and it is called both from `onerror` AND from the
timeout path (`line 232`). Once latched, the early-return at `line 202` routes **every
subsequent** `runOptimize` call — including over-threshold ones — through `runSync` with
**no size gate at all**. So the sequence "worker hangs once → timeout fires → user retries
with another large dataset" runs the second large dataset synchronously on the main thread,
which is precisely the path the size gate was written to forbid. The bounded near-linear
`optimize()` means this is a multi-second UI freeze rather than the original OOM minutes-long
hang, but it still violates the invariant asserted in the header ("It NEVER re-runs
`optimize()` synchronously on the main thread for an over-threshold dataset").
**Fix:** Apply the size gate on the `workerBroken` fast path too — only sync-run when under
`SYNC_FALLBACK_MAX_BYTES`, otherwise reject with `tooLargeError()`. Keep the unconditional
sync path only for the genuine no-Worker environment (SSR/tests, where `typeof Worker === 'undefined'`),
which is distinguishable from a worker that loaded-then-broke:
```ts
if (workerBroken) {
  return new Promise<OptimizeResult>((resolve, reject) => {
    const pending = { ...pendingBase, resolve, reject }
    if (typeof Worker === 'undefined') runSync(pending)        // SSR/test: no UI to freeze
    else if (collectionBytes(featureCollection) < SYNC_FALLBACK_MAX_BYTES) runSync(pending)
    else reject(tooLargeError())                                // a real worker broke: keep the gate
  })
}
```

### WR-02: `gentlest` is misnamed and its comments are inverted — it tracks the MOST AGGRESSIVE candidate

**File:** `src/features/chat/geometry/optimize.ts:392-407, 438-452`
**Issue:** The variable is documented as "the gentlest (smallest-tolerance) candidate seen,
as the D-07 best-effort floor" (lines 392, 402), but the tracking condition is
`if (bytes < gentlestBytes)` — it keeps the candidate with the **fewest bytes**, which under
weakly-monotonic simplify is the **largest tolerance / most aggressive** candidate, the exact
opposite of "gentlest." The over-budget D-07 fallback at `line 444` then returns this
most-aggressive candidate, which is arguably the correct behavior ("get as close to budget as
possible when budget is unreachable"), but the code, the variable name, and three comments all
claim the opposite intent. A future maintainer reading "gentlest VALID candidate" (line 438)
and "best-effort gentlest-valid" will reason about the code incorrectly. This is a
correctness-of-understanding defect: the behavior and its documentation disagree.
**Fix:** Rename `gentlest`/`gentlestTolerance`/`gentlestBytes` to
`mostAggressive`/`...Tolerance`/`mostAggressiveBytes` (or `bestEffortUnderBudget`), and rewrite
the comments to state the real intent: "track the smallest-byte (most-aggressive) candidate as
the best-effort result when the budget is unreachable." If the *actual* intent was the literal
gentlest, the condition must change to track smallest tolerance instead — but that would make
`reachedBudget:false` results needlessly far from budget. Decide and align name + comment +
condition.

### WR-03: topology guard is silently a no-op when every feature exceeds the vertex threshold

**File:** `src/features/chat/geometry/optimize.ts:320-347, 382`
**Issue:** `validateBelowThreshold` filters to features with `<= TOPOLOGY_VALIDATION_MAX_VERTICES`
(5000) vertices. For a dataset composed ENTIRELY of high-vertex features (the perf fixture: 4
features of 40k verts each; and the real UAT dataset), `checkable` is empty, so
`validateGeometryFeatures([])` returns `{ selfIntersections: 0, zeroArea: 0 }` for BOTH baseline
and candidate, and `introducesNewTopologyProblems` can only ever return `false`. The topology
shred-guard is therefore **completely disabled** for exactly the class of dataset most prone to
developing self-intersections under aggressive simplification, leaving only the fixed
`SIMPLIFY_TOLERANCE_MAX = 1e-3` ceiling as protection. The header documents this as "the honest
D-06 relaxation," so it is an intentional trade-off rather than an accidental bug — but it is a
real correctness gap worth surfacing for sign-off, because a single fixed tolerance ceiling does
not scale with feature coordinate range (a 1e-3 ° tolerance shreds a city-block line far more
than a continental one).
**Fix:** At minimum, record in the `OptimizeReport` whether topology validation was actually
performed (e.g. `topologyValidated: checkable.length > 0`) so callers/UAT can tell a "validated
clean" result from a "could not afford to check" result. Consider sub-sampling kinks on
high-vertex features (every Nth segment) to retain a cheap probabilistic guard instead of zero
guard. Longer term, a per-feature relative tolerance (fraction of the feature's bbox diagonal)
would make `SIMPLIFY_TOLERANCE_MAX` scale-invariant.

### WR-04: report invariant `bytesAfter <= bytesBefore` is asserted by tests but not guaranteed by the code

**File:** `src/features/chat/geometry/optimize.ts:208-219, 441-455`; assertion at `optimize.perf.test.ts:103`
**Issue:** `optimize.perf.test.ts:103` asserts `report.bytesAfter <= report.bytesBefore`, but no
code path enforces it. In the worst-case fallbacks (`resultFeatures = merged` at line 454, or the
gentler-pass fallbacks at 451-452), the result is the post-stitch/merge collection with little or
no simplification. STAGE 1 (`stitchMicrogaps`) re-emits every part with a NEW, longer id
(`` `${owner.id}-stitch-${idx}` ``, line 216) and can, on a degenerate input where the merge
collapses nothing (differing props) and simplify is a no-op (already-minimal geometry), produce a
serialized collection LARGER than the input. The unconditional coordinate snapping in
`normalizeLineCoordinates` usually shrinks bytes enough to mask this, but the invariant the test
depends on is incidental, not guaranteed. If the inflation ever triggers, the report lies
(`bytesAfter > bytesBefore`) and downstream "did optimize help?" logic mis-decides.
**Fix:** Guard the final result against inflation — if `bytesOf(resultFeatures) > bytesBefore`,
return the original `inputFeatures` (or clamp the report so `bytesAfter`/`verticesAfter` never
exceed the before-values). Concretely:
```ts
const candidateBytes = bytesOf(resultFeatures)
if (candidateBytes > bytesBefore) resultFeatures = inputFeatures  // never inflate
```

### WR-05: `getWorker()` creation-failure does not latch `workerBroken`, so every call re-attempts a failing `new Worker`

**File:** `src/features/chat/geometry/optimizeClient.ts:167-170`
**Issue:** When `new Worker(...)` throws (caught at line 167), the function logs and returns
`null` but does NOT set `workerBroken = true`. Unlike the `onerror` path (which calls
`killWorker()`), a synchronous construction failure leaves `workerBroken === false`, so the
NEXT `runOptimize` call re-enters `getWorker()` and re-attempts the failing `new Worker(...)`
again — repeated console warnings and repeated construction attempts on every request for a
permanently-unconstructable worker. Functionally it still falls back to sync (so no hang), but
it is wasteful and noisy, and it diverges from the `onerror` failure handling.
**Fix:** Set `workerBroken = true` in the catch block before returning null:
```ts
} catch (error) {
  console.warn('Failed to create optimize worker:', error)
  workerBroken = true
  return null
}
```

## Info

### IN-01: STAGE 1 stitch unconditionally snaps every coordinate to the ~1m microgap grid even when nothing is stitched

**File:** `src/features/chat/geometry/optimize.ts:159-222` (via `normalizeLineCoordinates` at `186`)
**Issue:** Whenever there are ≥2 line features, `stitchMicrogaps` runs `normalizeLineCoordinates`
(snap to `MICROGAP_TOLERANCE = 1e-5 °`, ~1m, + dedup) over EVERY line part, then re-emits parts
with rewritten ids — even when zero microgaps exist to join. So a dataset with two unrelated,
already-clean lines silently has all its vertices quantized to a ~1m grid and its feature ids
mutated. This is the documented dissolve precedent and is STAGE-1 logic not introduced by 07-05,
so it is out of the crash-fix scope — noted only because it interacts with WR-04 (id growth) and
WR-03 (the snap can itself introduce self-intersections that the disabled guard won't catch).
**Fix:** Out of scope for 07-05; if revisited, only snap/rewrite parts that actually participate
in a join, passing untouched parts through verbatim.

### IN-02: perf test's "does not introduce new self-intersections" case does not actually exercise the guard

**File:** `src/features/chat/geometry/optimize.perf.test.ts:107-118`
**Issue:** The D-06-intent test uses `pointsPerLine: 3_000` to keep its own `countSelfIntersections`
call bounded. 3000 < `TOPOLOGY_VALIDATION_MAX_VERTICES` (5000), so this is the ONE case where the
guard is active — good. But the fixture lines are deliberately non-crossing and near-collinear, so
`kinks(input) === 0` and any simplification trivially keeps it at 0; the assertion
`kinks(result) <= kinks(input)` passes even if the guard were entirely removed. There is no test
where simplification WOULD introduce a kink and the backoff path (`optimize.ts:426-434`) catches
it. The validate-once/backoff branch is effectively uncovered.
**Fix:** Add a fixture with a near-self-touching line/polygon where aggressive simplify provably
creates a self-intersection, assert the result's kink count does not exceed baseline, and assert
the backoff branch executed (e.g. via `reachedBudget`/tolerance observation).

### IN-03: `terminateOptimizeWorker()` does not reject in-flight pending requests, leaving their promises forever unsettled

**File:** `src/features/chat/geometry/optimizeClient.ts:239-249`
**Issue:** Teardown clears each pending's timer and `pendingRequests.clear()`, but never calls
`resolve`/`reject` on the cleared pendings. Any request that was in-flight (timer pending, worker
not yet replied) when `terminateOptimizeWorker()` is called has its promise left permanently
unsettled — the timer that would have settled it is cleared, and the map entry is dropped, so a
late `onmessage` finds no pending (`line 145` returns) and nothing ever resolves/rejects it. In
the tests this is masked because `afterEach` teardown runs after each test already awaited its
result. In app teardown (e.g. unmount mid-optimize) a caller `await`ing `runOptimize` hangs
forever. This contradicts the file's headline "the optimize promise ALWAYS settles."
**Fix:** Reject (or resolve via size-gated sync) each pending before clearing:
```ts
for (const pending of pendingRequests.values()) {
  if (pending.timer) clearTimeout(pending.timer)
  pending.reject(new Error('Geometry optimization cancelled (worker terminated)'))
}
pendingRequests.clear()
```

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
