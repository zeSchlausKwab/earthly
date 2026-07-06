---
phase: 05-dataset-aware-safe-editing
plan: 02
subsystem: geo-editor
tags: [safe-editing, undo, snapshot, sandbox, dos-cap, geo-editor, quickjs, wr-04, safe-06]

# Dependency graph
requires:
  - phase: 02-tool-registry-authoring-api
    provides: createAuthoring facade, runInterceptors seam, REPLAYABLE_AUTHORING_OPS allow-list
  - phase: 04-code-interpreter-sandbox
    provides: runSandbox boundary, recordedCalls write channel, outputCapture console cap, createHeadlessEditor harness
provides:
  - "DatasetSnapshotManager — bounded, metadata-aware snapshot/undo stack (SAFE-06)"
  - "Snapshot-first GeoEditor.undo() with ordered-timeline precedence (Cmd+Z + chat accessor)"
  - "editor.pushDatasetSnapshot(label) seam for the Phase 5 safe-editing gate (Plan 04)"
  - "editor.undoLastDatasetSnapshot() chat-callable accessor (Plan 05)"
  - "WR-04 recorded-call write-channel cap (MAX_RECORDED_CALLS / MAX_RECORDED_ARG_BYTES) + pre-replay rejection"
affects: [05-04 (gate calls pushDatasetSnapshot), 05-05 (chat undo-last-AI-edit), 06 (bulk destructive tools rely on snapshot reversibility)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate bounded snapshot stack mirroring HistoryManager's IManager shape (not overloading it)"
    - "Metadata bridge (provider/applier injection) keeps editor core free of the Zustand store import (no store<->core cycle)"
    - "Ordered-timeline undo precedence: compare snapshot-top timestamp vs HistoryManager peekUndoTimestamp()"
    - "Worker write-channel cap mirroring the console cap idiom; flag threaded to host for whole-batch pre-replay rejection"

key-files:
  created:
    - src/features/geo-editor/core/managers/DatasetSnapshotManager.ts
    - src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts
  modified:
    - src/features/geo-editor/core/GeoEditor.ts
    - src/features/geo-editor/core/managers/HistoryManager.ts
    - src/features/geo-editor/components/Editor.tsx
    - src/features/chat/sandbox/transport/sandbox.worker.ts
    - src/features/chat/sandbox/transport/types.ts
    - src/features/chat/sandbox/sandboxHost.ts
    - src/features/chat/sandbox/runCode.ts
    - src/features/chat/sandbox/runCode.test.ts

key-decisions:
  - "DatasetSnapshotManager is a PURE stack: returns the snapshot for GeoEditor.undo to restore, never calls setFeatures/setCollectionMeta itself (no editor dependency, trivially unit-testable)"
  - "Metadata read/write injected via setMetadataBridge(provider, applier) installed in Editor.tsx — editor core never imports useEditorStore, avoiding the store<->core cycle that crashed under the dev bundler in Phase 2"
  - "Undo precedence is a single ordered timeline: a dataset snapshot wins iff its top timestamp >= the geometry history's next-undoable action timestamp; proven by the manual-edit-between-applies interleave test"
  - "WR-04 caps chosen as MAX_RECORDED_CALLS=2000 and MAX_RECORDED_ARG_BYTES=4MiB (on the order of the console caps; bytes above 256KiB because one legitimate writeGeoJSON FeatureCollection can be large)"
  - "Over-budget batch rejection is whole-batch (T-05-08, no silent partial apply) and counts against the run_code circuit breaker; host-side count re-validation (MAX_REPLAY_CALLS) is defence-in-depth for a foreign/unflagged batch"

patterns-established:
  - "Snapshot push shallow-copies each feature ({...f}) — decouples from in-place property reassignment (A1) while sharing nested geometry by reference (the memory ceiling, no deep coordinate clone)"
  - "New worker response flags thread types.ts -> sandboxHost SandboxRunResult -> runCode.ts before the replay loop"

requirements-completed: [SAFE-06]

# Metrics
duration: ~35min
completed: 2026-06-21
---

# Phase 5 Plan 02: Dataset Snapshot/Undo + WR-04 Write-Channel Cap Summary

**A bounded, metadata-aware dataset snapshot/undo stack (SAFE-06) wired snapshot-first into Cmd+Z, plus a worker-level cap on the recorded-authoring write channel rejected before host replay (WR-04).**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-21T07:00:00Z (approx)
- **Completed:** 2026-06-21T07:07:00Z (approx)
- **Tasks:** 3
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `DatasetSnapshotManager`: a SEPARATE bounded snapshot/undo stack holding `{ features, collectionMeta, label, timestamp }` per confirmed apply — so an AI edit that renames a dataset OR restyles a feature reverts as ONE undo step, where the geometry-only `HistoryManager` could not.
- `GeoEditor.undo()` now consults the snapshot stack first via ordered-timeline precedence, restoring geometry + metadata together, and falls through to geometry undo otherwise. Cmd+Z and a chat-callable `undoLastDatasetSnapshot()` share one mechanism.
- The recorded-authoring write channel (`recordedCalls`) is bounded at the worker by call count AND total serialized arg bytes, mirroring the console cap; an over-budget batch is rejected as a whole BEFORE any host replay, closing the WR-04 asymmetric write-path DoS.

## Task Commits

Each task was committed atomically:

1. **Task 1: DatasetSnapshotManager — bounded snapshot stack** - `e22ac57` (feat, tdd: RED test + GREEN impl committed together since the harness requires the class to exist)
2. **Task 2: Wire snapshot-first undo into GeoEditor.undo() / Cmd+Z** - `3db712c` (feat)
3. **Task 3: WR-04 — cap the recorded-call write channel at the worker** - `371e2ef` (feat, tdd: RED tests then GREEN impl)

## Files Created/Modified

- `src/features/geo-editor/core/managers/DatasetSnapshotManager.ts` (created) - The bounded snapshot/undo stack (pure, IManager-shaped, default depth 20).
- `src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts` (created) - 11 tests: features+metadata restore, LIFO, bounded depth, empty no-op, A1 decoupling, Cmd+Z + chat accessor, manual-edit-between-applies interleave.
- `src/features/geo-editor/core/GeoEditor.ts` - Owns `datasetSnapshots`; `pushDatasetSnapshot`/`undoLastDatasetSnapshot`/`setMetadataBridge`; snapshot-first `undo()` with timeline precedence; clear/destroy wiring.
- `src/features/geo-editor/core/managers/HistoryManager.ts` - Added `peekUndoTimestamp()` for the ordered-timeline comparison.
- `src/features/geo-editor/components/Editor.tsx` - Installs the metadata bridge (reads/writes store `collectionMeta` via `setCollectionMeta`) after editor construction.
- `src/features/chat/sandbox/transport/sandbox.worker.ts` - `MAX_RECORDED_CALLS` / `MAX_RECORDED_ARG_BYTES`; bounded recording loop that latches `recordedCallsOverBudget`; `serializedByteLength` helper; flag on all three return paths.
- `src/features/chat/sandbox/transport/types.ts` - `recordedCallsOverBudget?` on `SandboxWorkerResponse`.
- `src/features/chat/sandbox/sandboxHost.ts` - `recordedCallsOverBudget` on `SandboxRunResult` + mapping.
- `src/features/chat/sandbox/runCode.ts` - `MAX_REPLAY_CALLS` defence-in-depth; pre-replay over-budget rejection (whole batch, counts against circuit breaker).
- `src/features/chat/sandbox/runCode.test.ts` - 6 WR-04 tests (count + byte rejection via synthetic transport AND real engine; zero mutation on reject; within-budget unchanged).

## Decisions Made

See `key-decisions` in frontmatter. Summary: pure-stack manager + injected metadata bridge to avoid the store<->core cycle; single ordered undo timeline; whole-batch pre-replay rejection; cap values on the order of the console caps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Metadata bridge injection instead of a direct store import in GeoEditor.undo()**
- **Found during:** Task 2 (wiring snapshot-first undo).
- **Issue:** The plan suggested `GeoEditor.undo()` call `useEditorStore.getState().setCollectionMeta(...)` directly. The editor core (`core/`) does NOT import the store today; the store imports types from `core/`, so a static store import in `GeoEditor.ts` would form a store<->core runtime cycle — the exact dev-bundler circular-import class STATE.md records as a Phase 2 startup crash.
- **Fix:** Added `setMetadataBridge(provider, applier)` on GeoEditor (inert no-op defaults so the headless editor works without a store) and installed the bridge in `Editor.tsx` (which already imports the store). Snapshot capture reads `collectionMeta` via the provider; restore writes via `setCollectionMeta` through the applier. Behaviour is exactly the plan's intent, just cycle-free.
- **Files modified:** src/features/geo-editor/core/GeoEditor.ts, src/features/geo-editor/components/Editor.tsx
- **Verification:** Cmd+Z + chat-accessor tests assert metadata restore through an in-memory bridge; full build (`bun run build`) green (no cycle).
- **Committed in:** `3db712c` (Task 2 commit)

**2. [Rule 3 - Blocking] Reworded a worker doc-comment so the A3 boundary scan stays green**
- **Found during:** Task 3 (post-implementation full-suite run).
- **Issue:** A new block-comment in `sandbox.worker.ts` contained the literal `authoring.addFeature(...)`; the A3 boundary test (`boundary.test.ts`) strips only `//` line comments, so the `.addFeature(` substring inside a `/* */` comment tripped the AI-write-path scan (3 offenders, full suite 1 fail).
- **Fix:** Reworded the comment to "a million-iteration loop of recorded authoring calls" — no behaviour change, no functional code touched.
- **Files modified:** src/features/chat/sandbox/transport/sandbox.worker.ts
- **Verification:** `bun test src/features/geo-editor/api/boundary.test.ts` 12/0; full suite 434/0.
- **Committed in:** `371e2ef` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking).
**Impact on plan:** Both preserve the plan's intent exactly; the metadata-bridge avoids re-introducing a known startup-crash cycle and is strictly safer. No scope creep.

## Issues Encountered

- **A1 verification (in-place mutation grep):** The plan asked to confirm `EditorFeature` immutability. Grep found `GeoEditor.normalizeFeature` (line ~1635) and `updateActiveStates` (~1646) DO reassign `feature.properties` in place on stored feature objects (e.g. toggling `active` on selection change). Per the plan's contingency, `DatasetSnapshotManager.push` shallow-copies each feature (`{...f}`) — the HistoryManager ceiling — so a later in-place property reassignment cannot leak into a captured snapshot. Nested geometry stays shared by reference (no deep coordinate clone, Pitfall 3). A dedicated test (`snapshot is decoupled from later selection-driven in-place property mutation`) asserts the snapshot feature is NOT the same object reference as the live stored feature while geometry IS shared.

## Known Stubs

None. The snapshot stack is fully functional; `pushDatasetSnapshot` is the seam Plan 04's gate will call (the gate itself is out of this plan's scope by design). No placeholder data or hardcoded empty values were introduced.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes were introduced. The two threats this plan owns (T-05-06 WR-04 DoS, T-05-07 snapshot memory) are mitigated as planned; T-05-08 (silent partial apply) and T-05-09 (irreversible AI edit) are mitigated by the whole-batch rejection and the metadata-aware snapshot respectively. T-05-10 (modify/delete not added to the sandbox replay surface) was respected — `AUTHORING_METHODS` / `REPLAYABLE_AUTHORING_OPS` unchanged.

## TDD Gate Compliance

Tasks 1 and 3 are `tdd="true"`. Task 3 followed RED (4 failing WR-04 tests confirmed) → GREEN (caps + flag + rejection) cleanly. Task 1's RED was confirmed via the module-not-found failure before the implementation existed; because the test harness imports the class directly, the RED test and GREEN implementation were committed in one commit (`e22ac57`) rather than two — the failing-first state was verified in the working tree prior to creating the implementation file. No `test(...)`-only commit precedes it; this is noted here for transparency.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 04 (safe-editing gate):** `editor.pushDatasetSnapshot(label)` is the ready seam to snapshot before a gated apply.
- **Plan 05 (chat undo affordance):** `editor.undoLastDatasetSnapshot()` is the ready chat-callable accessor sharing the Cmd+Z mechanism.
- **No blockers.** Full suite 434/0, `bun run build` green, changed files biome-clean (pre-existing baseline lint in GeoEditor.ts/HistoryManager.ts unchanged — zero new errors introduced, verified by before/after count).

## Self-Check: PASSED

- Created files exist: DatasetSnapshotManager.ts, DatasetSnapshotManager.test.ts — FOUND.
- Commits exist: e22ac57, 3db712c, 371e2ef — FOUND.
- Artifact contents: `class DatasetSnapshotManager` + `collectionMeta` present; `MAX_RECORDED_CALLS`/`MAX_RECORDED_ARG_BYTES` present; `setCollectionMeta` in the Editor.tsx bridge — all OK.

---
*Phase: 05-dataset-aware-safe-editing*
*Completed: 2026-06-21*
