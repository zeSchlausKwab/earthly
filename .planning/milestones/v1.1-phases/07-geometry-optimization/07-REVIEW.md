---
phase: 07-geometry-optimization
reviewed: 2026-06-22T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/features/chat/geometry/optimize.ts
  - src/features/chat/geometry/optimize.worker.ts
  - src/features/chat/geometry/optimizeClient.ts
  - src/features/chat/geometry/types.ts
  - src/features/chat/geometry/fixture.ts
  - src/features/chat/safeEditing/pendingDiffStore.ts
  - src/features/chat/safeEditing/gateBulkEdit.ts
  - src/features/chat/safeEditing/DatasetDiffDisclosure.tsx
  - src/features/chat/safeEditing/PendingDiffList.tsx
  - src/features/chat/tools/geometry-tools.ts
  - src/features/chat/tools/schemas.ts
  - src/features/chat/tools/registry.ts
  - src/lib/workers/workerAssets.ts
  - src/features/chat/geometry/optimize.test.ts
  - src/features/chat/geometry/optimize.acceptance.test.ts
  - src/features/chat/geometry/optimizeClient.test.ts
  - src/features/chat/safeEditing/gateBulkEdit.test.ts
  - src/features/chat/safeEditing/pendingDiffStore.test.ts
  - src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx
  - src/features/chat/tools/geometry-tools.test.ts
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-22
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 7 adds an off-thread geometry optimizer (pure `optimize()` pipeline + worker + always-settling RPC client), an `optimize_geometry` chat tool routed through the Phase-5/6 safe-editing gate, and an additive optional `headline`/`intent` plumbing change in `gateBulkEdit`/`pendingDiffStore`.

The high-leverage safety properties hold:
- **Worker boundary is clean (T-07-08).** `optimize.worker.ts` imports only `./optimize` + `./types`; `optimize.ts` reaches `geometryValidation` via its deep path, whose transitive imports are turf + type-only `EditorFeature`/`Predicate` — no editor/DOM/Nostr/pino leaks into the worker bundle.
- **RPC client always settles (T-07-07).** `workerBroken` latch, `onerror` sync-fallback, no-worker sync path, and per-request timeout fallback all converge on the shared pure `optimize()`. No hang path found.
- **Gate plumbing is backward-compatible.** `headline`/`intent` are strictly optional on `EmitDiffBlockOptions` / `GateBulkDeps` / `DatasetDiffDisclosureProps`; Phase 5/6 callers pass nothing and behave identically. The dropped-id detection correctly extends the destructive/no-op checks for the optimizer's id-minting modify.

No BLOCKERS. The findings below are correctness/robustness concerns (notably a binary-search candidate-selection bug that contradicts its own D-07 spec, and a documented-but-lossy property attribution in the stitch stage) plus quality cleanups.

## Warnings

### WR-01: `gentlestValid` selects the MOST-aggressive candidate, contradicting the D-07 "gentlest valid" intent

**File:** `src/features/chat/geometry/optimize.ts:325-356`
**Issue:** The over-budget best-effort path is documented (line 22-23, 325, 339, 354) to return "the gentlest VALID candidate" — i.e. the *least* simplified (smallest tolerance ⇒ largest bytes ⇒ best visual fidelity). But the tracking logic keeps the candidate with the **smallest bytes**:
```ts
if (bytes < gentlestValidBytes) { gentlestValid = candidate; gentlestValidBytes = bytes }
```
Smallest bytes corresponds to the **largest** tolerance — the *most* aggressively simplified valid candidate, the opposite of "gentlest." When the budget is unreachable, the function therefore returns the most-shredded valid result rather than preserving visual quality. The acceptance test (`optimize.test.ts:126-133`) only asserts `bytesAfter < bytesBefore`, which both interpretations satisfy, so the test does not catch this. Either the code or the D-07 spec/comments are wrong; as written the behavior degrades fidelity exactly when the user most wants it preserved.
**Fix:** Decide the intended semantic and make code + comment agree. If D-07 ("gentlest", preserve quality) is correct, track the largest-bytes valid candidate:
```ts
let gentlestValid: EditorFeature[] | null = null
let gentlestValidBytes = Number.NEGATIVE_INFINITY
// ...
if (bytes > gentlestValidBytes) { gentlestValid = candidate; gentlestValidBytes = bytes }
```
If "maximum reduction when over budget" is actually intended, keep the logic but rename `gentlestValid`/`gentlestValidBytes` and rewrite the comments/docstring so a maintainer is not misled.

### WR-02: Microgap stitch silently drops properties of all-but-one feature when differing-property lines merge

**File:** `src/features/chat/geometry/optimize.ts:171-186`
**Issue:** When two LineString features with DIFFERENT user properties touch within `MICROGAP_TOLERANCE`, `mergeLinePartsBySharedEndpoints` collapses them into one part and the stitch attributes the joined part to a single owner (start-endpoint owner, else end-endpoint owner, else `lineFeatures[0]`). The non-owning feature's properties are discarded with no record. The docstring frames this as "the dissolve precedent," but the module headline (line 12-13, D-05) markets the pipeline as *lossless* per-feature property preservation. For genuinely-joined differing-prop lines this is lossy. Stage 1 runs before the lossless merge (Stage 2), so once props are dropped here they are unrecoverable downstream.
**Fix:** This may be acceptable by design, but the loss should at minimum be made visible: count merged-with-conflicting-props joins and surface them in the report (e.g. a `lossyJoins`/`droppedPropertyFeatures` metric) so the headline/UAT can flag it, OR restrict the microgap stitch to only join parts whose owners share an identical `canonicalPropsKey` (consistent with the lossless contract). Confirm against the GEO-03 acceptance bar that fidelity expectations are met.

### WR-03: Binary search can return a candidate that DEGRADES bytes vs the post-merge baseline when no valid candidate fits

**File:** `src/features/chat/geometry/optimize.ts:329-356`
**Issue:** If `introducesNewTopologyProblems` rejects every probed tolerance (every `mid` is too aggressive), both `best` and `gentlestValid` stay null and the result falls back to `merged`. That is correct. But the loop only sets `hi = mid` on a topology reject and only records a candidate when it is NOT rejected. Because `mid` is the geometric mean and `SIMPLIFY_TOLERANCE_MIN` is `1e-8`, the very first probe can already introduce problems; the search then keeps shrinking `hi` and may never find ANY valid simplified candidate, returning `merged` unsimplified. That is the safe outcome, but the report still advertises `reachedBudget:false` with `bytesAfter == bytes(merged)` — which can be LARGER than the raw input only if stitch/merge expanded it (rare). More practically, there is no lower bound asserting `bytesAfter <= bytesBefore`; a pathological collection where stitch/merge increases serialized size (e.g. id rewriting `-stitch-N` suffixes lengthen ids) yields `bytesAfter > bytesBefore` while reporting an "optimization."
**Fix:** Guard the final result so the optimizer never reports a result larger than the input: if `bytesOf(resultFeatures) > bytesBefore`, fall back to (and report) the original `inputFeatures` with `reachedBudget:false`. Add a test asserting `report.bytesAfter <= report.bytesBefore` across fixtures including tiny/degenerate inputs.

### WR-04: Stitch id rewriting can collide and can inflate serialized size

**File:** `src/features/chat/geometry/optimize.ts:181-185`
**Issue:** Each stitched part is emitted with `id: \`${owner.id}-stitch-${idx}\``. Two different owners can produce the same suffix only if ids collide, but more importantly the rewritten ids are strictly longer than the originals and are counted by `bytesOf` (which serializes the full feature including `id`). For a 300-line fixture this measurably inflates `bytesAfter`, working against the budget the search is trying to hit, and the longer ids persist into the editor via `writeGeoJSON({replace:true})`. Also, `idx` is the output-part index, so a single unchanged line that passed through the merge gets a new synthetic id rather than keeping its own — breaking id stability for features that were not actually joined.
**Fix:** Preserve the original `owner.id` for parts that map 1:1 to a single source feature (only mint a new id for genuinely-merged parts), and keep synthetic ids short/stable. At minimum, document that id stability is not preserved through stitch and confirm no downstream consumer relies on pre-optimize ids.

### WR-05: `terminateOptimizeWorker()` does not cancel in-flight timeouts; pending timers fire after teardown

**File:** `src/features/chat/geometry/optimizeClient.ts:167-184`
**Issue:** The per-request `setTimeout` handle is never stored or cleared. On a normal worker success the timer still fires at 30s (harmless no-op because the entry is gone). But `terminateOptimizeWorker()` clears `pendingRequests` and resets `workerBroken=false` without clearing outstanding timers; a timer that fires after termination is a no-op for that id, yet a NEW request reusing the worker-recreated path could in theory interleave. More concretely, every call leaks one live 30s timer until it fires even on the happy path, which in a long-lived tab with many optimize runs accumulates timers. This mirrors `ingestClient` (same latent issue) so it is consistent, not novel.
**Fix:** Capture `const timer = setTimeout(...)` and `clearTimeout(timer)` in `worker.onmessage` when the matching pending resolves, and in `terminateOptimizeWorker()`. Store the timer on the `PendingRequest` so `settleViaSync`/teardown can clear it.

### WR-06: `applyOptimizedCollection` replace-in-place is not rolled back if `writeGeoJSON` partially applies before throwing

**File:** `src/features/chat/tools/geometry-tools.ts:110-115`, `src/features/chat/safeEditing/gateBulkEdit.ts:95-100`
**Issue:** `gateBulkApply` wraps `apply()` in try/catch and calls `editor.undoLastDatasetSnapshot()` on throw, which is the right guard. But `applyOptimizedCollection` calls `createAuthoring(editor).writeGeoJSON(result.features, { replace: true })` — a whole-collection clear+set. If `writeGeoJSON` throws AFTER clearing but BEFORE setting (replace semantics: "clears and sets"), the snapshot restore depends on `pushDatasetSnapshot` having captured the pre-clear state, which it does (taken before `apply()`), so this is likely safe. However the optimizer's whole-collection replace is the single largest mutation in the codebase routed through this gate; there is no test exercising a mid-`writeGeoJSON` throw to prove the snapshot restores the FULL prior collection (not an empty one). 
**Fix:** Add a `gateBulkApply` test where `apply()` throws after a partial replace and assert `editor.getAllFeatures()` equals the pre-apply set (zero net mutation). Confirm `writeGeoJSON({replace:true})` is atomic or that the snapshot predates the clear.

## Info

### IN-01: Dead variable `partSource` in `stitchMicrogaps`

**File:** `src/features/chat/geometry/optimize.ts:148,156`
**Issue:** `partSource: EditorFeature[]` is declared and `.push(f)`-ed in the loop but never read — property attribution uses `endpointOwner`/`partsBefore` instead. Dead code.
**Fix:** Remove `partSource` and its `push`.

### IN-02: Module-global `requestId`/`counter` are process-lifetime monotonic, not reset by terminate

**File:** `src/features/chat/geometry/optimizeClient.ts:52`, `src/features/chat/safeEditing/pendingDiffStore.ts:92`
**Issue:** `requestId` (client) and `counter` (diff store) keep incrementing for the app's whole lifetime. `terminateOptimizeWorker()` resets `workerBroken` but not `requestId`. This is harmless (ids only need uniqueness, which monotonic growth guarantees) but worth noting for test isolation — tests relying on a specific id format should not assume reset.
**Fix:** No action required; optionally reset `requestId = 0` inside `terminateOptimizeWorker()` for deterministic test ids.

### IN-03: `buildOptimizeHeadline` omits the "joins" segment when `microgapJoins === 0` but always shows feature counts

**File:** `src/features/chat/tools/geometry-tools.ts:86-100`
**Issue:** Minor UX inconsistency: when stitch produced zero joins, the headline drops the joins segment (good), but a no-op optimize (already under budget, nothing changed) still renders `XB → XB · Nk→Nk pts · N→N features` which reads like work was done. Not incorrect, just potentially confusing.
**Fix:** Optional — when before/after are identical across all metrics, render a short "already optimized" note instead.

### IN-04: `formatCount` rounds 100k+ to integer-k but 1k–100k to one decimal — boundary at exactly 100_000 is correct but undocumented

**File:** `src/features/chat/tools/geometry-tools.ts:74-78`
**Issue:** The two-tier formatting (`>= 100_000` → `Math.round(n/1000)k`, `>= 1000` → `(n/1000).toFixed(1)k`) is fine, but a value like `99_950` renders `100.0k` and `100_001` renders `100k`, a small visual discontinuity around the boundary. Cosmetic only.
**Fix:** None required; documented here for awareness.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
