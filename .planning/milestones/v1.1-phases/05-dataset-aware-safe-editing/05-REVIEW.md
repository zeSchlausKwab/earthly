---
phase: 05-dataset-aware-safe-editing
reviewed: 2026-06-21T07:50:47Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - src/features/chat/ChatPanel.tsx
  - src/features/chat/safeEditing/AuthoringGate.ts
  - src/features/chat/safeEditing/BindingChip.tsx
  - src/features/chat/safeEditing/DatasetDiffDisclosure.tsx
  - src/features/chat/safeEditing/PendingDiffList.tsx
  - src/features/chat/safeEditing/binding.ts
  - src/features/chat/safeEditing/fixAll.ts
  - src/features/chat/safeEditing/gateEditorImport.ts
  - src/features/chat/safeEditing/gateRunCode.ts
  - src/features/chat/safeEditing/pendingDiffStore.ts
  - src/features/chat/safeEditing/safetyAccess.ts
  - src/features/chat/sandbox/runCode.ts
  - src/features/chat/sandbox/sandboxHost.ts
  - src/features/chat/sandbox/transport/sandbox.worker.ts
  - src/features/chat/sandbox/transport/types.ts
  - src/features/chat/settingsExport.ts
  - src/features/chat/settingsStorage.ts
  - src/features/chat/store.ts
  - src/features/chat/tools/registry.ts
  - src/features/chat/useChatSettingsSync.ts
  - src/features/geo-editor/api/authoring.ts
  - src/features/geo-editor/api/diff.ts
  - src/features/geo-editor/api/interceptor.ts
  - src/features/geo-editor/components/Editor.tsx
  - src/features/geo-editor/core/GeoEditor.ts
  - src/features/geo-editor/core/managers/DatasetSnapshotManager.ts
  - src/features/geo-editor/core/managers/HistoryManager.ts
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-21T07:50:47Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Reviewed the Phase 5 "dataset-aware safe editing" implementation: the host-side
`AuthoringGate`, the diff classifier (`diff.ts`), the `DatasetSnapshotManager`
undo stack, the `pendingDiffStore` ↔ React bridge, the two gate-wiring helpers
(`gateEditorImport`, `gateRunCode`), the WR-04 write-channel caps in
`sandbox.worker.ts` / `runCode.ts`, and the settings-persistence path.

The AI-trust-boundary design is solid: the `REPLAYABLE_AUTHORING_OPS` host
allow-list (runCode.ts), the worker's `AUTHORING_METHODS` surface, the
`editorCommand` exclusion (CR-01), and the WR-04 count/byte caps are
defence-in-depth done well, and the safety-level normalization
(`normalizeSafetyLevel`) correctly fails closed to Level 2. The snapshot
manager's shallow-copy ceiling and bounded depth are correctly reasoned.

The one BLOCKER is a React-correctness defect in the `pendingDiffStore` →
`useSyncExternalStore` bridge that will trip React's "getSnapshot should be
cached" loop. The warnings center on: unbounded growth of the pending-diff Map,
a Level-1 → Level-2 silent downgrade in the "Just accept" toggle, the run_code
gate applying mutations to the LIVE editor before the user confirms, and a
snapshot/undo aliasing hazard. Several findings are correctness edge cases the
adversarial trace surfaced.

## Critical Issues

### CR-01: `getAllPendingDiffs` returns a fresh array every call → `useSyncExternalStore` infinite-loop / cached-snapshot violation

**File:** `src/features/chat/safeEditing/pendingDiffStore.ts:86-88` (consumed at `src/features/chat/safeEditing/PendingDiffList.tsx:19`)
**Issue:** `getAllPendingDiffs()` does `return [...pendingDiffs.values()]`, allocating a brand-new array on every invocation. `PendingDiffList` passes it directly as BOTH the `getSnapshot` and `getServerSnapshot` arguments to `useSyncExternalStore`. React calls `getSnapshot` on every render and compares the result to the previous value with `Object.is`; because a new array reference is returned each time even when nothing changed, React concludes the store "changed" on every render. In React 19 this throws/warns "The result of getSnapshot should be cached to avoid an infinite loop" and can drive a render loop (each render schedules another because the snapshot is never stable). This is the primary always-visible safe-editing surface (`PendingDiffList` is mounted in the transcript), so it degrades the whole chat panel.
**Fix:** Cache the array and only recompute it when the underlying Map mutates. Return the cached reference from `getAllPendingDiffs` and invalidate it inside `notify()`:
```ts
let snapshotCache: PendingDiffEntry[] = []
let snapshotDirty = true

function notify(): void {
	snapshotDirty = true
	for (const fn of subscribers) fn()
}

export function getAllPendingDiffs(): PendingDiffEntry[] {
	if (snapshotDirty) {
		snapshotCache = [...pendingDiffs.values()]
		snapshotDirty = false
	}
	return snapshotCache
}
```
(Also set `snapshotDirty = true` in `clearPendingDiffs` / wherever the map is mutated outside `notify`.) Verify the snapshot is referentially stable across renders when no entry changed.

## Warnings

### WR-01: Pending-diff entries are never pruned — unbounded Map growth across a session

**File:** `src/features/chat/safeEditing/pendingDiffStore.ts:53,73-78`
**Issue:** `emitDiffBlock` adds an entry to the module-level `pendingDiffs` Map for EVERY apply unit (every gated AI write, including Level-3 immediate applies). `clearPendingDiffs` is only ever called from tests (confirmed: no production caller). Each `DatasetDiff` retains `added`/`modified`/`deleted` arrays of `EditorFeature` (full geometry by reference). Over a long chat session with many AI edits this grows without bound, both as memory and as an ever-growing list rendered by `PendingDiffList` (every historical diff block stays in the transcript region forever, and `getAllPendingDiffs` maps over all of them). This is the same unbounded-growth class the snapshot manager was explicitly bounded against.
**Fix:** Bound the store (e.g. keep the most-recent N resolved entries, evicting oldest like `DatasetSnapshotManager`), or clear/evict entries when a chat is switched/cleared/deleted (wire a `clearPendingDiffs()` call into the chat lifecycle in `store.ts` `clearMessages`/`switchChat`/`deleteChat`/`createChat`). At minimum, drop resolved entries older than the snapshot depth so the transcript and memory stay bounded.

### WR-02: "Just accept" toggle silently downgrades a Level-1 user to Level 2

**File:** `src/features/chat/safeEditing/BindingChip.tsx:82` (and props at 50, 40)
**Issue:** The toggle computes `autoAcceptOn = safetyLevel === 3` and `onCheckedChange={(checked) => onToggleAutoAccept(checked ? 3 : 2)}`. A user who has deliberately chosen the STRICTEST posture (Level 1 = confirm all, incl. adds) sees the toggle rendered as OFF (since `1 !== 3`). If they toggle it ON (→ 3) and then OFF again, the OFF path hard-codes `2`, silently relaxing their gating from "confirm everything" to "confirm destructive only" without their intent. Even without toggling, the chip presents Level 1 and Level 2 identically (both OFF), hiding the fact that a stricter level is active.
**Fix:** Preserve the pre-toggle non-3 level instead of hard-coding 2. Either remember the prior level (`onCheckedChange={(checked) => onToggleAutoAccept(checked ? 3 : priorLevel)}` where `priorLevel` is the last non-3 value) or, if Level 1 is reachable only elsewhere, restore to the user's configured baseline rather than the global default. Surface Level 1 distinctly in the chip so the strict posture is visible (T-05-20 visibility intent).

### WR-03: run_code gate mutates the LIVE editor BEFORE the user confirms (Level 1)

**File:** `src/features/chat/safeEditing/gateRunCode.ts:68-94`
**Issue:** Unlike `AuthoringGate` (which dry-runs against a clone and only commits on Apply), `gateRunCodeBatch` calls `replay()` for real (line 71) BEFORE awaiting `requestConfirm` (line 91). At Level 1 the AI's geometry is therefore applied to the editor, rendered on the map, and mirrored into the Zustand store while the "Apply/Cancel" prompt is still pending. Only on Cancel is it rolled back via `undoLastDatasetSnapshot()`. The module doc claims "the same guarantee the buffer-then-apply gate gives," but it is NOT equivalent: there is a visible window where un-confirmed AI edits are live, and any concurrent reader (autosave, publish, another tool, a snapshot taken by a second batch) observes the un-confirmed state. The "zero net mutation on cancel" claim only holds if nothing else touches the editor during the await.
**Fix:** Document the divergence prominently, OR make the run_code path buffer like the AuthoringGate (compute proposed against a clone). If the live-apply-then-rollback approach is kept, guard against interleaving: block other applies while a run_code confirm is pending, and confirm that an autosave/publish cannot fire mid-await. Add a test that asserts no second snapshot/apply can interleave between `replay()` and the confirm resolution.

### WR-04: Concurrent gated applies corrupt the LIFO snapshot/undo mapping

**File:** `src/features/chat/safeEditing/gateRunCode.ts:68,94`; `src/features/chat/safeEditing/PendingDiffList.tsx:34-36`
**Issue:** Snapshots are a single LIFO stack (`DatasetSnapshotManager`), but gated applies can be in flight concurrently (the chat loop awaits `requestConfirm`, and nothing serializes multiple pending diff blocks — the user can resolve them in any order). If batch A pushes snapshot S_A, then batch B pushes S_B, then the user Cancels A first, `gateRunCodeBatch` for A calls `editor.undoLastDatasetSnapshot()` which pops S_B (the top), reverting B's still-pending edit instead of A's. Likewise the "Undo last AI edit" button (`PendingDiffList.tsx:34`) always pops the top snapshot regardless of WHICH diff block it sits under, so clicking Undo on an older applied block reverts the most-recent apply. The snapshot stack has no per-apply handle.
**Fix:** Either serialize gated applies (one pending diff at a time — disable/queue new applies while one awaits), or give each apply a snapshot id/handle and make Cancel/Undo target that specific snapshot rather than blindly popping the top. Add a test with two interleaved batches resolved out of order.

### WR-05: `requestConfirm` resolver is overwritten if `requestConfirm(id)` is called twice for the same id (leaked promise)

**File:** `src/features/chat/safeEditing/pendingDiffStore.ts:95-103`
**Issue:** `requestConfirm(id)` does `resolvers.set(id, resolve)` unconditionally. If it is ever invoked twice for the same id while still pending (e.g. a re-render path or a retry that re-awaits), the first resolver is overwritten in the Map and its Promise will never settle — a permanently-hung `await` in the gate, leaving the chat loop stuck in `executingTools`. There is no guard that an id has at most one outstanding awaiter.
**Fix:** Guard against an existing resolver: if `resolvers.has(id)`, either return the same pending Promise or reject/replace deterministically. Document the one-awaiter-per-id invariant and assert it in a test.

### WR-06: `Editor.tsx` initialization effect omits dependencies and uses brittle effect chains

**File:** `src/features/geo-editor/components/Editor.tsx:36-156,169-182`
**Issue:** The init `useEffect` depends only on `[map, isLoaded]` but closes over many setters (`setEditor`, `setFeatures`, `setMetadataBridge` reads via `useEditorStore.getState()`, etc.); biome's exhaustive-deps is effectively being ignored without an explicit ignore comment (unlike the documented ignores in `useChatSettingsSync.ts`). The reverse-sync effect (169-182) does a full `JSON.stringify(current) !== JSON.stringify(storeFeatures)` deep compare on every feature-set change — O(n) serialization of the whole dataset per store update — and relies on a `suppressReverseSyncRef` boolean that is fragile under React 19 concurrent/double-invocation in StrictMode (the flag can be consumed by the wrong run). This is the sync layer the snapshot-restore path (`setFeatures` → `features.replace`) flows through, so a missed/duplicated sync corrupts what the user sees after an undo.
**Fix:** Add an explicit biome ignore with justification (matching the project convention) or stabilize deps. Replace the `JSON.stringify` deep-compare with a reference/length+id check, and document the StrictMode double-invocation behavior of `suppressReverseSyncRef` (or replace the ref-flag with an explicit "source" tag on the store update).

### WR-07: `serializedByteLength` undercounts arg bytes, weakening the WR-04 byte cap

**File:** `src/features/chat/sandbox/transport/sandbox.worker.ts:371-377,355-363`
**Issue:** WR-04's byte budget relies on `serializedByteLength(args)`, which sums `Buffer.byteLength(stringifyDump(arg))`. `stringifyDump` falls back to `String(value)` when `JSON.stringify` throws (a cyclic arg) — for a large cyclic object `String(value)` is `"[object Object]"` (15 bytes), so a megabyte-scale cyclic payload counts as ~15 bytes and sails under the 4 MiB cap. The host replay then serializes the same arg through `createAuthoring` (which JSON-handles it) — the very write-path payload the cap is meant to bound. The count cap (`MAX_RECORDED_CALLS`) still applies, but the byte cap (the defence against few-but-huge `writeGeoJSON` calls) is bypassable.
**Fix:** When `JSON.stringify` throws, charge a conservative LARGE cost (e.g. treat the arg as `MAX_RECORDED_ARG_BYTES` so it immediately trips the cap) rather than its short string fallback, or reject non-serializable args outright (they cannot be faithfully replayed anyway). Add a test with a cyclic/huge arg asserting the over-budget flag latches.

## Info

### IN-01: `fixAll.ts` is dead code in Phase 5 (no caller)

**File:** `src/features/chat/safeEditing/fixAll.ts:59`
**Issue:** `runFixAllRule` is documented as "the SEAM + one proof" with the model-facing tool deferred to Phase 6. It has no production caller in this phase. Carrying an unused exported mutation path increases surface area (it routes real `modifyFeature` writes but is NOT wired through the AuthoringGate, so if a future caller forgets the gate it bypasses confirmation).
**Fix:** Acceptable as a documented seam, but add a test asserting it is gate-routed when wired, and consider marking it `@internal` / excluding it from the public barrel until Phase 6 wires the gate around it.

### IN-02: `gateEditorImport` falls back to silent Cancel when `pendingId` is null

**File:** `src/features/chat/safeEditing/gateEditorImport.ts:77-78`
**Issue:** `requestConfirm: () => pendingId === null ? Promise.resolve('cancel') : requestConfirm(pendingId)`. The gate always calls `emitDiffBlock` before `requestConfirm`, so `pendingId` should be set — but if that invariant ever breaks (refactor, exception in `emitDiffBlock`), the import silently cancels with no user-visible reason, and the model is told `cancelled: true` for an edit the user never declined. A silent cancel is hard to diagnose.
**Fix:** Throw/log a developer-facing error if `requestConfirm` runs with `pendingId === null` (it indicates a broken gate contract), rather than masquerading it as a user cancel.

### IN-03: `consecutiveFailures` counts an over-budget batch as a failure of a successful run

**File:** `src/features/chat/sandbox/runCode.ts:262,273-280`
**Issue:** On a successful sandbox run the counter is reset to 0 (line 262), then immediately re-incremented (line 274) if the batch is over-budget. The increment is intended (a runaway over-budget loop should hit the breaker), but the reset-then-increment ordering means a single over-budget run leaves the counter at 1 even though the prior failure streak was legitimately cleared by the successful execution. Minor: the breaker semantics for "ran fine but wrote too much" are slightly muddled vs. "the script errored."
**Fix:** Increment without the preceding reset for the over-budget case, or move the reset after the over-budget check, so the counter reflects only genuine consecutive failures plus over-budget rejections — not a reset immediately undone.

### IN-04: `deepEqual` treats key ORDER-independent but not prototype/NaN edge cases

**File:** `src/features/geo-editor/api/diff.ts:38-63`
**Issue:** `deepEqual` returns `a === b` early, so `NaN` coordinates compare unequal to themselves (`NaN !== NaN`), classifying an unchanged feature with a `NaN` coordinate (degenerate but possible from bad turf input) as `modified` every time. It also does not special-case `Date`/typed arrays, but those don't occur in plain GeoJSON so that's fine. Low impact (NaN coords are already broken geometry), noting for completeness.
**Fix:** If NaN-coordinate robustness matters, normalize/guard before classify; otherwise document that NaN geometry always classifies as modified.

### IN-05: `BindingChipContainer` recomputes `resolveBinding` on every editor-store change without memoization

**File:** `src/features/chat/safeEditing/BindingChip.tsx:104-117`
**Issue:** `resolveBinding({...})` is called inline in render on every `collectionMeta`/`featureCount`/`activeGeoEditDraftId`/`isDirty` change. `resolveBinding` is cheap (pure string/boolean ops) so this is not a perf problem, but the inline object literal `{ name: collectionMeta.name }` and the result are new each render. Harmless today; flagged only because the chip is always-mounted and re-renders on every feature add during AI edits.
**Fix:** Optional `useMemo` over the four inputs if profiling shows churn; otherwise leave as-is (pure + cheap).

---

_Reviewed: 2026-06-21T07:50:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
