---
phase: 05-dataset-aware-safe-editing
plan: 01
subsystem: api
tags: [safe-editing, authoring-api, diff-classification, geo-editor, interceptor, threat-boundary]

# Dependency graph
requires:
  - phase: 02-tool-registry-authoring-api
    provides: createAuthoring facade (addFeature/writeGeoJSON/circle/buffer), runInterceptors chain, MutationResult contract, boundary.test.ts A3 scan
  - phase: 04-code-interpreter-sandbox
    provides: run_code replay path (sandbox host) that routes geometry writes through createAuthoring
provides:
  - "classifyMutation(current, proposed, intent) → DatasetDiff: pure add/modify/delete diff by feature id (SAFE-02 mechanism)"
  - "authoring.modifyFeature / authoring.deleteFeatures: interceptor-routed modify/delete verbs (INFRA-02)"
  - "classifyIntentInterceptor: synchronous intent-classification tagging hook"
  - "A3 boundary scan tightened to all four write verbs, scoped to the AI trust boundary"
affects: [05-02-snapshot-undo, 05-03-binding-safety-level, 05-04-confirm-gate, 05-05-diff-disclosure]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-module diff classifier mirroring interceptor.ts idiom (single type + pure fold, zero chat/Nostr imports)"
    - "AI-trust-boundary-scoped static scan with documented allow-list (vs whole-tree scan)"

key-files:
  created:
    - src/features/geo-editor/api/diff.ts
    - src/features/geo-editor/api/diff.test.ts
  modified:
    - src/features/geo-editor/api/authoring.ts
    - src/features/geo-editor/api/interceptor.ts
    - src/features/geo-editor/api/interceptor.test.ts
    - src/features/geo-editor/api/authoring.test.ts
    - src/features/geo-editor/api/boundary.test.ts

key-decisions:
  - "D-12 / Task 3: A3 boundary scan scoped to the AI trust boundary (features/chat/** + **/sandbox/**), NOT the whole src/ tree — INFRA-02's real guarantee is that the AI/sandbox path provably cannot bypass createAuthoring"
  - "Manual-UI / annotation-draft / dataset-load direct-write sites (~35) are documented out-of-scope, NOT rerouted through the facade"
  - "ChatGeometryAttachment.tsx allow-listed with rationale (manual annotation-draft composer, not an AI write path)"
  - "modify/delete are host-tool-only this phase — NOT added to worker AUTHORING_METHODS / REPLAYABLE_AUTHORING_OPS (decision A5)"
  - "Interceptor stays synchronous; MutationResult never becomes a Promise (Pitfall 1)"

patterns-established:
  - "Pattern: AI-boundary-scoped bypass scan — a static test asserts the AI/sandbox write path routes exclusively through the facade, with a self-validating documented allow-list for acknowledged non-AI direct-write homes"
  - "Pattern: pure diff classifier — classifyMutation buckets by feature id, deep-compares only the matched pair across geometry + canonical style keys + properties"

requirements-completed: [SAFE-02, INFRA-02]

# Metrics
duration: 7min
completed: 2026-06-21
---

# Phase 5 Plan 01: Diff Classifier + Modify/Delete Facade + Tightened A3 Boundary Summary

**Landed the SAFE-02 add/modify/delete diff classifier and the Phase-2-deferred modify/delete verbs on the Authoring facade, then tightened the A3 bypass scan to all four write verbs scoped to the AI trust boundary — the AI/sandbox path now provably cannot mutate editor geometry without routing through createAuthoring.**

## Performance

- **Duration:** ~7 min (Task 3 continuation segment; full plan spanned Tasks 1-3)
- **Started:** 2026-06-21T06:43:44Z (Task 1 RED)
- **Completed:** 2026-06-21T06:50:59Z (Task 3 commit)
- **Tasks:** 3 completed
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- **Task 1 (SAFE-02):** Pure `classifyMutation(current, proposed, intent) → DatasetDiff` in `diff.ts`, buckets add/modify/delete by feature id; modify detected on geometry / canonical style key / properties change; `deleted` only populated for `intent:'delete'`; add-intent collisions are not modify. Proven by `diff.test.ts`; passes the api/ import-boundary scan.
- **Task 2 (INFRA-02):** `modifyFeature` / `deleteFeatures` added to the `Authoring` interface and returned object, both routed through `runInterceptors` with `intent:'modify'`/`'delete'`. `modifyFeature` preserves id, throws loud on non-geometry input, quiet no-op on unknown id. `deleteFeatures` filters to present ids (no crash). Added `classifyIntentInterceptor` (synchronous tagging hook). MutationResult stays synchronous.
- **Task 3 (INFRA-02 / T-05-01):** A3 scan rewritten to flag direct `editor.{addFeature,setFeatures,updateFeature,deleteFeatures,deleteFeature}(` across the AI trust boundary, with a self-validating documented allow-list; surface assertion extended to include `modifyFeature` + `deleteFeatures`.

## Task 3 Detail (continuation segment)

The prior executor stopped at a Rule 4 architectural decision checkpoint on Task 3. The plan's literal Task 3 instruction was to scan the *whole tree* for all four verbs and **reroute** any chat/UI bypass site through `createAuthoring`. The scan surfaced ~35 direct-write sites — but the overwhelming majority are legitimate non-AI homes: manual feature-editing UI (`info-panel/*`), annotation-draft composers (`chat/ChatGeometryAttachment.tsx`, `social/comments/*`), and dataset load/clear + store-mirror plumbing (`useDatasetManagement`, `Editor.tsx`, `sessionSyncSlice`, `commands.ts`, `GeoEditorView.tsx`). Rerouting those would have been an out-of-scope architectural change to manual-editing code paths, so the executor escalated.

**User decision (implemented exactly):** scope the A3 scan to the AI trust boundary — `src/features/chat/**` (the AI tool + sandbox replay path) and any `**/sandbox/**` — asserting those route exclusively through `createAuthoring`. The only direct-verb file inside that scope is `ChatGeometryAttachment.tsx` (a transient manual draft-canvas composer), which is explicitly allow-listed with a one-line rationale. The AI tool path (`chat/tools/helpers.ts`) already routes through `createAuthoring`, and `chat/sandbox/**` has zero direct verb calls — so the scan finds zero offenders. The ~35 manual-UI/draft/dataset-load sites were NOT rerouted (rejected as out of scope).

This keeps the plan `api/`-only and faithful to INFRA-02's real intent: the AI/sandbox path provably cannot bypass createAuthoring.

## Key Implementation Notes

- **A3 scan scope (`isAiWritePath`):** matches `features/chat/` prefix OR any `**/sandbox/**` segment. The facade itself (`features/geo-editor/api/`) and the GeoEditor core class remain always-allowed homes.
- **Self-validating allow-list:** a second test asserts every `A3_ALLOW_LIST` entry is in-scope (`isAiWritePath` true), carries a non-empty rationale, and still actually performs a direct write — so a stale/dead entry that could hide a real bypass fails the build.
- **Surface assertion:** `Object.keys(authoring).sort()` now expects `addFeature, buffer, circle, deleteFeatures, editorCommand, getDatasetMetadata, modifyFeature, setDatasetMetadata, writeGeoJSON`; the `forbidden` list (signer/wallet/store/getState/editor/eventStore/accounts) is intact.

## Deviations from Plan

### Decision (Rule 4 — architectural, user-approved)

**1. [Decision] A3 scan scoped to the AI trust boundary + documented allow-list (Option 1) instead of whole-tree reroute**
- **Found during:** Task 3
- **Decision context:** The literal plan text said "reroute genuine bypass sites in chat/UI code through createAuthoring (do NOT widen the allow-list to hide them)". The whole-tree scan surfaced ~35 sites, almost all in legitimate manual-editing / annotation-draft / dataset-load code that is NOT an AI write path. Rerouting them would be an out-of-scope structural change to manual-editing UI.
- **Resolution (user-authoritative):** Scope the A3 scan to the AI trust boundary (`features/chat/**` + `**/sandbox/**`), excluding the manual draft composer `ChatGeometryAttachment.tsx` via a documented allow-list. Add an explicit allow-list documenting WHY the acknowledged non-AI homes (info-panel manual UI, chat/social annotation-draft composers, dataset load/clear + store-mirror plumbing) stay direct. Do NOT reroute the ~35 manual-UI/draft/dataset-load sites.
- **Why:** INFRA-02's real guarantee is that the *AI/sandbox* path cannot bypass `createAuthoring`. The manual-editing UI is a separate, user-driven trust context outside that boundary. Scoping the scan keeps the plan `api/`-only and avoids destabilizing ~35 manual-editing call sites.
- **Files modified:** `src/features/geo-editor/api/boundary.test.ts`
- **Commit:** 3e11a64

### Auto-fixed Issues

**None for Task 3.** The Biome formatter collapsed one pre-existing multi-line `readFileSync` call (the unrelated D-09 test block) into a single line when formatting the changed file — cosmetic, no behavior change.

## Threat Model Outcome

| Threat ID | Disposition | Outcome |
|-----------|-------------|---------|
| T-05-01 (bypass sites) | mitigate | A3 scan tightened to all four verbs, scoped to the AI trust boundary; AI/sandbox path proven to route through createAuthoring; allow-list documents the single in-scope manual-draft exception |
| T-05-02 (silent mis-write) | mitigate | modifyFeature throws loud on non-geometry input (Task 2) |
| T-05-03 (crash on unknown id) | mitigate | modifyFeature quiet no-op / deleteFeatures filters present ids (Task 2) |
| T-05-04 (info disclosure) | mitigate | surface assertion `forbidden` list intact; import-boundary scan covers diff.ts |
| T-05-05 (async interceptor) | mitigate | interceptor synchronous; `grep Promise<MutationResult>` in api/ returns zero |

## Verification

- `bun test src/features/geo-editor/api/boundary.test.ts` — 12 pass / 0 fail
- `bun test src/features/geo-editor/api/` — 98 pass / 0 fail
- `bun test` (full suite) — 418 pass / 0 fail across 40 files
- `bun run build` — succeeds (workers + WASM emitted)
- `grep -rn "Promise<MutationResult>" src/features/geo-editor/api/` — zero matches
- `bunx biome check` on `boundary.test.ts` — clean after format

## Notes for Downstream Plans

- **05-02 (snapshot/undo)** and **05-05 (diff disclosure)** consume `DatasetDiff` from `diff.ts`.
- **05-04 (confirm gate)** sits on top of `classifyIntentInterceptor` / the intent classification — the async gate lives at the chat layer, NOT in the interceptor (which stays synchronous).
- modify/delete remain host-tool-only this phase (not in worker AUTHORING_METHODS / REPLAYABLE_AUTHORING_OPS).

## Self-Check: PASSED

- FOUND: src/features/geo-editor/api/diff.ts
- FOUND: src/features/geo-editor/api/boundary.test.ts
- FOUND commit b66db42 (Task 1 RED), 85f8fd5 (Task 1 GREEN)
- FOUND commit c28e9f4 (Task 2 RED), 69be379 (Task 2 GREEN)
- FOUND commit 3e11a64 (Task 3)
