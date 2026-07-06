---
phase: 05-dataset-aware-safe-editing
plan: 04
subsystem: chat-safe-editing
tags: [safe-editing, gate, async-confirm, fix-all, chat, snapshot, classify]

# Dependency graph
requires:
  - phase: 05-dataset-aware-safe-editing
    plan: 01
    provides: classifyMutation diff classifier + modifyFeature/deleteFeatures facade verbs + intent enum
  - phase: 05-dataset-aware-safe-editing
    plan: 02
    provides: editor.pushDatasetSnapshot(label) seam + DatasetSnapshotManager undo stack
  - phase: 05-dataset-aware-safe-editing
    plan: 03
    provides: safetyLevel (1|2|3, default 2) persistence + resolveBinding resolver
provides:
  - "createAuthoringGate(editor, deps) — host-side async buffer-then-apply confirm gate (SAFE-03/04): snapshot → classify → safety-level decision → apply/await"
  - "GateProposal contract (intent + computeProposed dry-run + commit) — whole tool call = one apply unit (D-11)"
  - "runFixAllRule(editor, { predicate, transform }) — SAFE-05 host-side rule runner over editor.getAllFeatures() (never the compacted model view)"
affects: [05-05 (Apply/Cancel disclosure UI + chat-loop wiring consume createAuthoringGate; BindingChip + undo affordance), 06 (TOOLS-02 bulk attribute-edit tool builds on runFixAllRule seam)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Gate ONE LAYER UP at the async chat path — the sync facade interceptor (Pitfall 1) stays sync; the async confirm wraps it, never makes MutationResult a Promise"
    - "Dry-run-against-a-clone: computeProposed(current) is a pure function so classification never touches the real editor (T-05-18)"
    - "Inverted fix-all contract — model supplies the RULE (predicate+transform), host supplies the LIST via getAllFeatures() (SAFE-05 / Pitfall 2 / A3)"
    - "Injectable decision/UI deps (getSafetyLevel / emitDiffBlock / requestConfirm) keep the gate headlessly testable with zero React"

key-files:
  created:
    - src/features/chat/safeEditing/AuthoringGate.ts
    - src/features/chat/safeEditing/AuthoringGate.test.ts
    - src/features/chat/safeEditing/fixAll.ts
    - src/features/chat/safeEditing/fixAll.test.ts
  modified: []

key-decisions:
  - "GateProposal splits the dry-run (computeProposed: pure (current)=>proposed) from the real commit (commit(authoring,current)) so the dry-run provably runs against a clone and the apply provably routes through createAuthoring → runInterceptors (T-05-17/T-05-18)"
  - "requestConfirm resolves 'apply'|'cancel' (injected); the actual disclosure-button wiring + auto-create-and-bind land in Plan 05 — the gate exposes ensureBinding as an OPTIONAL dep (headless default = already-bound)"
  - "Diff is emitted for EVERY apply unit (immediate or buffered, even pre-cancel) so the action is always visible/recorded (D-12)"
  - "fixAll routes per-feature changes through modifyFeature (not editor.updateFeature) so it is interceptor-routed and gate/snapshot-aware under the AuthoringGate (A3 clean)"
  - "fixAll takes NO features array argument — the only way to scope it is the live getAllFeatures() set (Pitfall 2 / A3 guard)"

patterns-established:
  - "Pattern: async confirm gate above a synchronous mutation facade — the gate buffers, classifies, awaits, then commits through the sync facade, leaving the interceptor/MutationResult contract untouched"
  - "Pattern: host-owns-the-list rule runner — a 'fix all' derives its set from the canonical id-keyed store, never from the model's sampled view"

requirements-completed: [SAFE-05]
requirements-partial:
  - "SAFE-03: the diff classification + emit-preview MECHANISM (the data path the user-facing preview consumes) ships here via the gate's emitDiffBlock; the visible inline diff-disclosure UI is Plan 05's scope, so SAFE-03 is left Pending in REQUIREMENTS.md until that UI renders"

# Metrics
duration: ~4min
completed: 2026-06-21
---

# Phase 5 Plan 04: AuthoringGate + fixAll Rule Runner Summary

**The host-side async buffer-then-apply confirm gate (SAFE-03/04) and the fix-all rule runner over the full id-keyed dataset (SAFE-05) — the two orchestration seams that turn Wave-1's classifier + snapshot + safety-level into actual safe-editing behavior, both proven headlessly.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-21T07:22:44Z (Task 1 RED)
- **Completed:** 2026-06-21T07:27Z (Task 2 GREEN)
- **Tasks:** 2 completed
- **Files modified:** 4 (4 created, 0 modified)

## Accomplishments

- **Task 1 (SAFE-03 / SAFE-04):** `createAuthoringGate(editor, deps)` with an async `review(proposal)`. It ensures a binding (optional injected `ensureBinding`), dry-runs the proposal against a CLONE of the current set, `classifyMutation`s the result into add/modify/delete, emits the diff, then decides per the persisted safety level + D-07: pure-add OR Level 3 → snapshot + commit immediately; Level 1 (any change incl. adds) OR Level 2 with a destructive change (modify/delete) → buffer, await `requestConfirm`, and on Apply snapshot + commit / on Cancel discard with ZERO editor mutation. The real apply always routes through `createAuthoring` → `runInterceptors` (no bypass).
- **Task 2 (SAFE-05):** `runFixAllRule(editor, { predicate, transform })` iterates `editor.getAllFeatures()` (the full, un-compacted, id-keyed set — never the model's ≤6-id `sampleIds` view), applies each matching change through the `modifyFeature` facade verb, and returns `{ matched, modified, modifiedIds }`. The signature takes NO `features` array — the host owns the list, the model owns only the rule (Pitfall 2 / A3 guard). The proof test seeds 12 features and asserts an out-of-sample feature (f6/f8/f10) is modified.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 RED** — `e12d3ec` — `test(05-04): add failing AuthoringGate buffer/apply/cancel + level gating spec`
2. **Task 1 GREEN** — `dfec675` — `feat(05-04): implement AuthoringGate async buffer-then-apply gate (SAFE-03/04)`
3. **Task 2 RED** — `8e8c8c4` — `test(05-04): add failing fixAll rule-runner spec over full dataset (SAFE-05)`
4. **Task 2 GREEN** — `6e46d7f` — `feat(05-04): implement fixAll host-side rule runner over full dataset (SAFE-05)`

## Key Implementation Notes

- **Gate location (Pitfall 1):** the gate lives in `features/chat/safeEditing/` (NOT under the `api/` boundary), one layer above the synchronous facade. It MAY import from chat AND from `geo-editor/api`. `authoring.ts` / `MutationResult` / the interceptor were NOT touched — the facade stays synchronous; the async confirm wraps it on the already-async chat path.
- **One apply unit (D-11):** the whole tool call / recorded run_code batch is ONE `GateProposal` → one `pushDatasetSnapshot` → one `emitDiffBlock` → one undo step. `applyNow` snapshots BEFORE committing and re-reads `getAllFeatures()` so `commit` sees the live set.
- **Destructive = modify+delete only (D-07):** `hasDestructiveChange` returns true only for `modified`/`deleted`; a pure add never trips the Level-2 confirm path. `requiresConfirmation` encodes Level 3 → never await, Level 1 → always await, Level 2 → await iff destructive.
- **Dry-run isolation (T-05-18):** `computeProposed(current)` is a pure `(EditorFeature[]) => EditorFeature[]`; the test "the dry-run never mutates the editor before the apply decision" asserts the editor is byte-for-byte untouched at the moment `requestConfirm` is awaited (and identical object reference preserved on cancel).
- **fixAll facade routing (A3):** the only `getAllFeatures()` call is the source-of-truth read; every write is `authoring.modifyFeature(...)` — `grep 'editor.updateFeature(' fixAll.ts` returns only a doc-comment, no call site.

## Deviations from Plan

**None — plan executed exactly as written.** No bugs, missing functionality, or blocking issues encountered; no architectural decisions required. The only non-code adjustment was a Biome auto-format collapsing one multi-line `setFeatures([...])` array in `fixAll.test.ts` onto a single line (cosmetic, no behavior change).

## Authentication Gates

None.

## Threat Model Outcome

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-05-15 (destructive AI edit without awareness) | mitigate | Gate buffers modify/delete under Level 1-2 and awaits Apply/Cancel; Level 3 still snapshots + emits the diff (D-12) — proven by the Level 1/2/3 gating tests |
| T-05-16 (fix-all skipping out-of-context features) | mitigate | `runFixAllRule` iterates `getAllFeatures()`; the model supplies the rule, not the list; proof asserts out-of-sample f6/f8/f10 are modified |
| T-05-17 (gate bypassing the interceptor on apply) | mitigate | The real apply routes exclusively through `createAuthoring`/`modifyFeature` → `runInterceptors`; the gate never calls `editor.*` mutation methods directly (grep clean) |
| T-05-18 (Cancel leaving partial state) | mitigate | Cancel returns with zero editor mutation; the dry-run runs against a clone via the pure `computeProposed` — asserted by feature-count + object-identity-unchanged tests |
| T-05-19 (apply that cannot be undone) | mitigate | `applyNow` pushes a `pushDatasetSnapshot(label)` before every commit (one per apply unit, D-11); the snapshot-spy test asserts exactly one push per apply, including Level 3 |

## Known Stubs

None. The gate's `requestConfirm` / `emitDiffBlock` / `ensureBinding` are injectable deps (not stubs) — the Apply/Cancel disclosure UI, the auto-create-and-bind wiring, and the chat-loop wiring are intentionally Plan 05's scope, as the plan specifies ("the gate logic against an injectable decision callback so it is headlessly testable"). `runFixAllRule` is the SAFE-05 seam; the model-facing bulk attribute-edit tool is intentionally deferred to Phase 6 (TOOLS-02), per Open Question 1.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes introduced — both files are pure host-side orchestration over existing seams.

## Verification

- `bun test src/features/chat/safeEditing/AuthoringGate.test.ts` — 8 pass / 0 fail
- `bun test src/features/chat/safeEditing/fixAll.test.ts` — 5 pass / 0 fail
- `bun test src/features/chat/safeEditing/` — 21 pass / 0 fail
- `bun test` (full suite) — 462 pass / 0 fail across 44 files
- `bun run build` — succeeds (workers + WASM emitted)
- `bunx biome check` on all 4 changed files — clean
- Greps: `classifyMutation` + `pushDatasetSnapshot` present in `AuthoringGate.ts`; no direct `editor.{addFeature,setFeatures,updateFeature,deleteFeatures}(` call in either file; `getAllFeatures()` present in `fixAll.ts`; `runFixAllRule` signature is `(editor, rule)` with no `features` array arg

## TDD Gate Compliance

Both tasks are `tdd="true"` and followed RED → GREEN cleanly with separate commits:
- Task 1: RED `e12d3ec` (module-not-found / failing spec confirmed) → GREEN `dfec675`.
- Task 2: RED `8e8c8c4` (module-not-found confirmed) → GREEN `6e46d7f`.
No REFACTOR commit was needed (implementations landed clean).

## Next Phase Readiness

- **Plan 05 (diff disclosure + chat wiring):** `createAuthoringGate` is the ready seam — wire `emitDiffBlock` to the inline `DatasetDiffDisclosure`, `requestConfirm` to its Apply/Cancel buttons, `getSafetyLevel` to the persisted store field (Plan 03), and `ensureBinding` to the `resolveBinding`-driven auto-create-and-bind. `runFixAllRule` is ready for a "fix all" affordance.
- **Phase 6 (TOOLS-02):** the model-facing bulk attribute-edit tool builds on `runFixAllRule`.
- **No blockers.** Full suite 462/0, `bun run build` green, all changed files biome-clean.

## Self-Check: PASSED

- Created files exist: AuthoringGate.ts, AuthoringGate.test.ts, fixAll.ts, fixAll.test.ts — all FOUND.
- Commits exist: e12d3ec, dfec675, 8e8c8c4, 6e46d7f — all FOUND.
- Artifact contents: `createAuthoringGate` + `classifyMutation` + `pushDatasetSnapshot` present in AuthoringGate.ts; `runFixAllRule` + `getAllFeatures` present in fixAll.ts — all OK.

---
*Phase: 05-dataset-aware-safe-editing*
*Completed: 2026-06-21*
