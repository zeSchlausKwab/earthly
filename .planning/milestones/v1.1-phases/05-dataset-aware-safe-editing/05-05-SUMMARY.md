---
phase: 05-dataset-aware-safe-editing
plan: 05
subsystem: chat-safe-editing
tags: [safe-editing, binding-chip, diff-disclosure, auto-accept, chat-loop, ui]

requires:
  - phase: 05-dataset-aware-safe-editing
    plan: 03
    provides: resolveBinding resolver + safetyLevel/setSafetyLevel persistence
  - phase: 05-dataset-aware-safe-editing
    plan: 04
    provides: createAuthoringGate(editor, deps) async buffer-then-apply gate + GateProposal contract
  - phase: 05-dataset-aware-safe-editing
    plan: 01
    provides: classifyMutation + DatasetDiff shape
  - phase: 05-dataset-aware-safe-editing
    plan: 02
    provides: editor.pushDatasetSnapshot / undoLastDatasetSnapshot accessors
provides:
  - "BindingChip + BindingChipContainer — always-visible bound-target chip + Just accept (Level 3) toggle (SAFE-01 / D-03 / D-12)"
  - "DatasetDiffDisclosure + buildDatasetDiffSummary — inline counts-headline diff with Apply/Cancel + resolved-status view (SAFE-03 / D-04/D-05/D-08)"
  - "pendingDiffStore bridge — emitDiffBlock/requestConfirm/resolvePendingDiff between the host gate and the React transcript"
  - "Chat-loop wiring: createAuthoringGate fronts write_geojson_to_editor/add_feature_to_editor; gateRunCodeBatch fronts the run_code recorded batch; Undo last AI edit affordance (SAFE-06 surface)"
affects:
  - "src/features/chat/ChatPanel.tsx"
  - "src/features/chat/store.ts"
  - "src/features/chat/sandbox/runCode.ts"
  - "src/features/chat/tools/registry.ts"

tech-stack:
  added: []
  patterns:
    - "Injectable safety-level getter (safetyAccess) to break the runCode->store->registry import cycle (mirrors the existing register-injection pattern)"
    - "Framework-light module-level pending-diff bridge (Map + subscriber set, mirroring tools/context.ts mapSnapshotCache) so the host gate imports it without React"
    - "Snapshot-then-classify-then-rollback for the append-only run_code batch (the facade replay cannot be dry-run purely, so Cancel restores via the shared snapshot stack — same zero-net-mutation guarantee as the buffer-then-apply gate)"

key-files:
  created:
    - "src/features/chat/safeEditing/BindingChip.tsx"
    - "src/features/chat/safeEditing/BindingChip.test.tsx"
    - "src/features/chat/safeEditing/DatasetDiffDisclosure.tsx"
    - "src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx"
    - "src/features/chat/safeEditing/pendingDiffStore.ts"
    - "src/features/chat/safeEditing/pendingDiffStore.test.ts"
    - "src/features/chat/safeEditing/gateRunCode.ts"
    - "src/features/chat/safeEditing/gateEditorImport.ts"
    - "src/features/chat/safeEditing/safetyAccess.ts"
    - "src/features/chat/safeEditing/PendingDiffList.tsx"
  modified:
    - "src/features/chat/ChatPanel.tsx"
    - "src/features/chat/store.ts"
    - "src/features/chat/sandbox/runCode.ts"
    - "src/features/chat/tools/registry.ts"

key-decisions:
  - "Gated the run_code recorded batch with a bespoke gateRunCodeBatch (not createAuthoringGate's pure computeProposed) because run_code geometry (circle/buffer) is produced INSIDE the facade and cannot be dry-run without duplicating makeCircle/makeBuffer; the batch is append-only, so we snapshot-then-replay and roll back on Cancel for the same zero-net-mutation guarantee."
  - "Routed the direct import tools (write_geojson_to_editor / add_feature_to_editor) through createAuthoringGate via gateEditorImport — these became async handlers; computeProposed mirrors toEditorFeature normalization so the dry-run matches the real apply."
  - "Added safetyAccess injectable getter (default Level 2) so runCode.ts reads safetyLevel without a static import of the chat store (the runCode->store->tools->registry->runCode cycle the dev HMR bundler crashes on)."
  - "PendingDiffList renders all bridge entries in a dedicated transcript region via useSyncExternalStore, rather than threading a diffId onto each role:'tool' message — minimal ChatPanel surface, one render path for both pending and resolved blocks."

requirements-completed: [SAFE-01, SAFE-03, SAFE-04]

metrics:
  duration: ~13min
  completed: 2026-06-21
---

# Phase 5 Plan 05: Binding Chip + Diff Disclosure + Chat-Loop Wiring Summary

**The user-visible and integration half of the safe-editing gate: an always-visible binding chip (SAFE-01), an inline Apply/Cancel counts-headline diff block (SAFE-03), a prominent "Just accept" Level-3 toggle (SAFE-04 / D-12), and the chat-loop wiring that connects Plan 04's `createAuthoringGate` to the live import-tool and run_code paths so the gate fires, renders, and applies — with an "Undo last AI edit" affordance (SAFE-06 surface).**

## What Was Built

### Task 1 — BindingChip + "Just accept" toggle (SAFE-01 / D-03 / D-12)
- `BindingChip` is a thin presentational chip (never returns null — SAFE-01 visibility is the security property) rendering the resolved `name` (with `Untitled draft` fallback), an unsaved indicator, and `· N features`.
- A prominent `Switch` labelled "Just accept" sits in the same row, ON iff `safetyLevel === 3`, calling `onToggleAutoAccept(checked ? 3 : 2)`; a tooltip explains it applies edits without confirmation but keeps the diff + undo.
- `BindingChipContainer` reads `useEditorStore` identity, feeds Plan-03 `resolveBinding`, reads `safetyLevel` from `useChatStore`, and wires `setSafetyLevel` as the toggle handler. Mounted in the ChatPanel header (near the Tools status row) so it is always visible.
- Proven by `BindingChip.test.tsx` (5 tests): identity, fallback, toggle ON=3/OFF=2, always-visible at zero features.

### Task 2 — DatasetDiffDisclosure (SAFE-03 / D-04 / D-05 / D-08)
- Clones `CodeRunDisclosure`'s collapse idiom (`useState` + `aria-expanded` + `▸/▾` + `useMemo` summary + the `rounded-lg border bg-violet-50` shell).
- `buildDatasetDiffSummary(diff)` → `+N added · ~N changed · −N deleted` headline (incl. zero case).
- Expandable body lists per-feature Added/Changed/Deleted entries (name → id fallback).
- Inline `Apply` (primary) + `Cancel` (ghost) buttons — no modal/portal. A `status` prop (`pending`/`applied`/`cancelled`) renders the resolved outcome label instead of live buttons (Level-3 auto-apply shows the diff with status `applied`, D-12).
- Proven by `DatasetDiffDisclosure.test.tsx` (8 tests).

### Task 3 — Chat-loop integration + transcript bridge + undo (SAFE-03/04/06)
- `pendingDiffStore.ts` — the framework-light bridge: `emitDiffBlock(diff, opts?)` registers a pending (or pre-resolved `applied`) entry; `requestConfirm(id)` returns the awaitable `'apply'|'cancel'` Promise; `resolvePendingDiff(id, decision)` settles it (idempotent — second resolve is a no-op, T-05-23); `subscribePendingDiffs`/`getAllPendingDiffs` feed the React transcript.
- `gateEditorImport.ts` — routes `write_geojson_to_editor` / `add_feature_to_editor` through `createAuthoringGate(editor, { getSafetyLevel, emitDiffBlock, requestConfirm })` and `await gate.review(proposal)` BEFORE the real `importFeaturesToEditor` apply; `computeProposed` mirrors `toEditorFeature` normalization. The two handlers are now `async`.
- `gateRunCode.ts` — `gateRunCodeBatch` fronts the run_code recorded-batch replay as ONE apply unit (one snapshot, one diff, one undo, D-11): snapshot → replay → classify add-intent diff → Level 3/non-destructive keep (emit status `applied`) / Level 1 await confirm; on Cancel `undoLastDatasetSnapshot()` rolls the batch back (zero net mutation, T-05-24). Read-only runs (no recorded calls) are ungated.
- `safetyAccess.ts` — injectable `getSafetyLevel` (default Level 2) installed once by the chat store, so `runCode.ts` reads the persisted level without the import cycle.
- `runCode.ts` — replay loop refactored into a `replayBatch` closure fronted by the gate.
- `PendingDiffList.tsx` — subscribes via `useSyncExternalStore`, renders each entry as a `DatasetDiffDisclosure` with Apply/Cancel wired to `resolvePendingDiff`, and an "Undo last AI edit" button (calls `editor.undoLastDatasetSnapshot()`) near each applied block. Mounted in the ChatPanel transcript.
- Proven by `pendingDiffStore.test.ts` (5 tests): register, resolve applied/cancelled, status-flip + no double-resolve, Level-3 auto-apply registration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] run_code batch cannot be dry-run purely → bespoke gate**
- **Found during:** Task 3 (wiring the run_code path).
- **Issue:** The plan's preferred seam is `createAuthoringGate`'s pure `computeProposed(current)` dry-run, but a run_code recorded batch's geometry (`circle`/`buffer`) is produced INSIDE the facade; reproducing it in `computeProposed` would duplicate `makeCircle`/`makeBuffer`/normalization and risk drift. The recorded ops are also append-only (the `REPLAYABLE_AUTHORING_OPS` allow-list has no modify/delete).
- **Fix:** Added `gateRunCodeBatch` (snapshot → real replay → classify from before/after → Level-gated confirm → roll back via `undoLastDatasetSnapshot()` on Cancel). This preserves the gate's invariants (one batch = one snapshot = one diff = one undo, D-11; Cancel = zero net mutation, T-05-24) using the shared snapshot stack rather than a pure clone dry-run.
- **Files:** `src/features/chat/safeEditing/gateRunCode.ts`, `src/features/chat/sandbox/runCode.ts`
- **Commit:** 6b0404f

**2. [Rule 3 - Blocking] static store import in runCode.ts would re-introduce a circular-import startup crash**
- **Found during:** Task 3.
- **Issue:** `import { useChatStore } from '@/features/chat/store'` inside `runCode.ts` closes the `runCode → store → tools → registry → runCode` loop the dev HMR bundler resolves to null (the same hazard the run_code module header documents for `register`; project memory records a prior Phase-2 startup crash from exactly this class of cycle).
- **Fix:** Added `safetyAccess.ts` — a tiny injectable getter (default Level 2) the chat store installs once via `setSafetyLevelProvider`. `runCode.ts` imports only the getter, no store.
- **Files:** `src/features/chat/safeEditing/safetyAccess.ts`, `src/features/chat/store.ts`, `src/features/chat/sandbox/runCode.ts`
- **Commit:** 6b0404f

**3. [Rule 2 - Missing critical functionality] resolved-status flip for immediate-apply blocks**
- **Found during:** Task 3 (gateEditorImport).
- **Issue:** When the gate applies immediately (Level 3 / non-destructive), `emitDiffBlock` registers the block `pending` but the gate never goes through `resolvePendingDiff`, so the transcript would show stale Apply/Cancel buttons on an already-applied edit.
- **Fix:** After `gate.review`, settle the emitted block to match the gate result (`resolvePendingDiff(id, result.status)`) when still pending, so the transcript shows the resolved outcome (D-12: the diff stays visible).
- **Files:** `src/features/chat/safeEditing/gateEditorImport.ts`
- **Commit:** 6b0404f

## Authentication Gates

None.

## Threat Model Outcome

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-05-20 (destructive AI edit without awareness) | mitigate | BindingChip never returns null; every gated apply emits a `DatasetDiffDisclosure` (Level 3 emits status `applied`, D-12). The import path cannot apply without `emitDiffBlock` registering the diff first; run_code snapshots + emits the diff for every batch. |
| T-05-21 (Just accept silently downgrading) | mitigate | The toggle is in the visible ChatPanel header (not settings), reads ON directly from `safetyLevel === 3`, and a tooltip states it keeps the diff + undo. No hidden Level-3 state. |
| T-05-22 (gate bypassing the interceptor) | mitigate | Apply routes through `createAuthoring`/`importFeaturesToEditor`/run_code replay (→ `runInterceptors`); the only direct editor call added is the shared `undoLastDatasetSnapshot()` restore on Cancel. The A3 boundary test (`boundary.test.ts`) stays green. |
| T-05-23 (double/forged apply) | mitigate | `resolvePendingDiff` is idempotent — a second resolve on a settled entry is a no-op (asserted in `pendingDiffStore.test.ts`); one apply unit = one diff = one resolve. |
| T-05-24 (Cancel leaves partial state) | mitigate | Import-path Cancel returns with zero editor mutation (the gate's buffer-then-apply); run_code Cancel restores the pre-batch snapshot (zero net mutation). |

## Known Stubs

None. The "Undo last AI edit" affordance calls the Plan-02 `undoLastDatasetSnapshot()` accessor directly; the binding chip and diff blocks are fully wired to live store/gate state.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes; all new surface is host-side UI + orchestration over existing seams.

## Verification

- `bun test src/features/chat/safeEditing/BindingChip.test.tsx src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx src/features/chat/safeEditing/pendingDiffStore.test.ts` — green (5 + 8 + 5).
- `bun test src/features/chat/safeEditing/` — 39 pass / 0 fail.
- `bun test src/features/geo-editor/api/boundary.test.ts` — 12 pass / 0 fail (A3 still clean; no new editor bypass).
- `bun test src/features/chat/sandbox/` — 75 pass / 0 fail (run_code replay intact at default Level 2).
- `bun test` (full suite) — 480 pass / 0 fail across 47 files (baseline 462 + 18 new).
- `bun run build` — succeeds (workers + WASM emitted).
- `bunx biome check` on all 14 changed files — clean.

## TDD Gate Compliance

The three `tdd="true"` tasks followed RED → GREEN:
- Task 1: RED confirmed (module-not-found on `./BindingChip`) → GREEN; committed together as `45d94dc` (component + mount + passing test).
- Task 2: RED confirmed (module-not-found on `./DatasetDiffDisclosure`) → GREEN `a7f73c5`.
- Task 3: RED confirmed (module-not-found on `./pendingDiffStore`) → GREEN `6b0404f`.

The RED was observed and recorded in-session before each implementation; per-task commits bundle RED+GREEN (the failing-then-passing transition was verified, not committed as a separate red commit).

## Self-Check: PASSED

- All 10 created files present on disk (FOUND).
- Commits 45d94dc, a7f73c5, 6b0404f present in git log (FOUND).
- `createAuthoringGate` + `gate.review` present on the import path (`gateEditorImport.ts`); `gateRunCodeBatch` gates the run_code batch; `DatasetDiffDisclosure` rendered from `PendingDiffList` in ChatPanel; `setSafetyLevel(3|2)` driven by the BindingChip toggle.

---
*Phase: 05-dataset-aware-safe-editing — final plan*
*Completed: 2026-06-21*
