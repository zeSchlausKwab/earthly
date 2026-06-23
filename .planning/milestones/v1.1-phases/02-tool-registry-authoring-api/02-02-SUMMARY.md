---
phase: 02-tool-registry-authoring-api
plan: 02
subsystem: authoring-api
tags: [authoring-facade, mutation-result, interceptor, boundary-test, geo-editor, infra-02]

# Dependency graph
requires:
  - phase: 02
    plan: 01
    provides: createHeadlessEditor() + shared geo fixtures (emptyFeatureCollection, singlePointCollection, dupIdCollection)
provides:
  - createAuthoring(editor) — the single geometry-mutation facade (D-10/INFRA-02); the only path Phases 3-7 route geometry writes through
  - MutationResult / MutationIntent contract (D-11) — every mutating method returns structured results, never void
  - runInterceptors + Interceptor scaffold (D-12) — no-op middleware fold for Phase 5's SAFE-01..06 gate
  - boundary.test.ts — D-07 import-boundary + geometry-only-surface enforcement
affects: [02-03, 02-04, 02-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closure-captured editor reference: createAuthoring(editor) holds the GeoEditor internally, never re-exposes it (V4 access-control / T-02-03)"
    - "Verbatim reuse of toEditorFeature + dedup-by-id from importFeaturesToEditor (no normalization reimplementation — Pitfall 4 / T-02-04)"
    - "fs-scan boundary test: readdirSync over api/*.ts asserting zero forbidden imports (standalone-lib invariant)"

key-files:
  created:
    - src/features/geo-editor/api/authoring.ts
    - src/features/geo-editor/api/authoring.test.ts
    - src/features/geo-editor/api/boundary.test.ts
  modified:
    - src/features/geo-editor/api/index.ts
    - src/features/geo-editor/commands.ts

key-decisions:
  - "[02-02]: editorCommand passthrough returns the native EditorCommandExecutionResult (NOT a MutationResult) deliberately — it is a command-dispatch scaffold, not a geometry-write method; Plan 04's registry wires real dispatch + validation."
  - "[02-02]: Append dedup-by-id checks editor.getAllFeatures() (live editor state), so pre-existing ids are skipped too — first-write-wins, matching importFeaturesToEditor verbatim."
  - "[02-02]: Replace path calls editor.setFeatures(normalized) which does NOT emit create/update today; the facade does not depend on the emit — Plan 03 must add the emit before the replace path's store mirror works."
  - "[02-02]: Exported EditorCommandArgs from commands.ts (was a private type alias) so the facade's editorCommand passthrough can type its args without re-declaring."

requirements-completed: [INFRA-02, INFRA-03]

# Metrics
duration: continuation
completed: 2026-06-16
---

# Phase 2 Plan 02: Authoring API (Pure Geometry-Mutation Facade) Summary

**Built `createAuthoring(editor)` — the single, pure, AI/framework-agnostic geometry-mutation seam (INFRA-02/D-10) that Phases 3-7 route every editor write through — exposing `addFeature`, `writeGeoJSON(replace|append)`, and an `editorCommand` passthrough scaffold, each returning a structured `MutationResult` (D-11), with a `boundary.test.ts` that fs-scans `api/` for zero chat/registry/Nostr imports and a geometry-only surface (D-07/T-02-03).**

## Authoring Interface (for Plans 03/04/05 — wire to this, do not re-read source)

`createAuthoring(editor: GeoEditor): Authoring`, where:

```ts
interface Authoring {
  addFeature(feature: Feature, source?: string): MutationResult   // source default 'chat_tool'
  writeGeoJSON(features: Feature[], options: { replace: boolean }): MutationResult
  editorCommand(id: EditorCommandId, args?: EditorCommandArgs): EditorCommandExecutionResult
}

interface MutationResult {
  ok: boolean
  intent: MutationIntent              // 'add' | 'modify' | 'delete' (this plan only emits 'add')
  featureIds: string[]
  counts: { created: number; updated: number; deleted: number; skippedDuplicates: number }
}
```

**Behavior contracts (verified):**
- `addFeature(f)` → normalize via `toEditorFeature(f, source)`, `editor.addFeature`, `{ ok:true, intent:'add', featureIds:[id], counts.created:1 }`. `importSource` preserved on the stored feature (proves `toEditorFeature` reuse).
- `addFeature(null)` (or any non-Feature / geometry-less input) → `{ ok:false, intent:'add', featureIds:[], counts all 0 }`, editor untouched.
- `writeGeoJSON(features, { replace:true })` → `editor.setFeatures(normalized)`; `counts.created === normalized.length`; previous feature set dropped.
- `writeGeoJSON(features, { replace:false })` → append with **dedup-by-id**; skips any id already in `editor.getAllFeatures()`; `counts.skippedDuplicates` increments per skip; `featureIds` lists only newly added ids.

**Dedup rule (verbatim from `importFeaturesToEditor`):** build `new Set(editor.getAllFeatures().map(f => f.id))`; for each normalized feature, if its id is already in the set, increment `skippedDuplicates` and `continue`; otherwise `editor.addFeature(feature)`, add to set, record id. First-write-wins.

## Store-mirror caveat for Plan 03 (load-bearing)

`editor.setFeatures` (the replace path) does **not** emit a `create`/`update` event today (confirmed against `GeoEditor.ts:1493-1501` — `setFeatures` has no emit). Therefore the replace path does NOT drive the Zustand store mirror. This facade deliberately does NOT depend on that emit. **Plan 03 must add the emit-on-bulk-replace (D-09 one-way read-mirror) before the replace path's store sync works.** The append path uses `editor.addFeature`, which DOES emit `create` (`GeoEditor.ts:1116`).

## Boundary / surface enforcement (D-07 / T-02-03)

`boundary.test.ts`:
- (a) fs-scans every `api/*.ts` (excluding `*.test.ts`) and asserts no import line matches `@/features/chat`, `chat/tools`, `@/lib/ndk`, `@/lib/nostr`, `'nostr…'`, `applesauce`, `@modelcontextprotocol`, `@contextvm`.
- (b) asserts the live `Authoring` surface keys are exactly `['addFeature', 'editorCommand', 'writeGeoJSON']` — no `signer`/`wallet`/`store`/`getState`/`editor`/`eventStore`/`accounts`.

## Task Commits

1. **Task 1 (pre-completed by prior executor):** `0cf8504` — `feat(02-02): add MutationResult + intent + interceptor scaffold (D-11, D-12)` — results.ts, interceptor.ts, interceptor.test.ts, index.ts.
2. **Task 2:** `3461470` — `feat(02-02): add Authoring facade + boundary test (D-07/D-10/INFRA-02)` — authoring.ts, authoring.test.ts, boundary.test.ts, index.ts (barrel), commands.ts (export EditorCommandArgs).

## Files Created/Modified
- `src/features/geo-editor/api/authoring.ts` — `createAuthoring` facade + `Authoring` interface.
- `src/features/geo-editor/api/authoring.test.ts` — add/replace/append + dedup + null-guard + source-preservation coverage (headless editor + fixtures).
- `src/features/geo-editor/api/boundary.test.ts` — D-07 import-scan + geometry-only-surface assertions.
- `src/features/geo-editor/api/index.ts` — barrel re-exports `Authoring` + `createAuthoring`.
- `src/features/geo-editor/commands.ts` — `EditorCommandArgs` promoted from private alias to `export type` (consumed by the facade's `editorCommand` passthrough).

## Deviations from Plan

None — plan executed as written. (This was a continuation run: Task 1 was already committed; the Task 2 working-tree draft left by the crashed executor was verified to fulfill the plan exactly — correct `toEditorFeature` reuse, verbatim dedup-by-id, structured `MutationResult`s, boundary test — and required no fixes. The `commands.ts` `EditorCommandArgs` export was confirmed genuinely needed by `authoring.ts` and kept, not reverted.)

## Gates

- `bun test src/features/geo-editor/api` — 17 pass / 0 fail (interceptor no-op + authoring add/replace/append/dedup/null-guard + boundary import-scan + surface).
- `bun test` (full repo) — 49 pass / 0 fail.
- `bun run build` — succeeds (api/ new, no consumer wired yet).
- `bunx biome lint` on all 5 changed files — clean, no diagnostics.

## Threat Model Compliance
- **T-02-03 (EoP — surface leaking editor internals):** mitigated. `boundary.test.ts` enforces (a) no chat/Nostr/NDK/applesauce/MCP imports in `api/` and (b) geometry-only surface. Editor reference is closure-captured, never re-exposed.
- **T-02-04 (Tampering — normalization/dedup drift):** mitigated. `toEditorFeature` + dedup-by-id reused verbatim; `authoring.test.ts` asserts `importSource`/id/`skippedDuplicates` parity. Plan 03 adds the full OLD-vs-NEW golden gate.
- **T-02-05 (DoS — malformed/oversized GeoJSON):** partially mitigated as scoped. Null/undefined/geometry-less feature → `{ ok:false }`; the `MAX_GEOJSON_TEXT_CHARS` cap + numeric-clamp is deferred to the registry dispatch boundary (Plan 04) where raw LLM text arrives — forward-coupling noted.
- **T-02-SC (package installs):** no installs this plan.

## Known Stubs
- `editorCommand(id, args)` is an intentional thin passthrough scaffold delegating to the existing `executeEditorCommand`. Plan 04's registry wires real dispatch + validation. Documented in the plan as scaffold-only; not a goal-blocking stub.

## Next Phase Readiness
- Plan 03 can now reroute the chat dual-write and the 3 UI mutation sites through `createAuthoring`, add the D-09 store read-mirror (must add the `setFeatures` emit first — see caveat above), and run the binding behavior-preservation golden gate.
- Plans 04 (registry) and 05 (primitives) build on the `Authoring` surface documented above.

## Self-Check: PASSED
- Files verified present: `api/authoring.ts`, `api/authoring.test.ts`, `api/boundary.test.ts`, `api/index.ts`, `commands.ts`.
- Commits verified in git log: `3461470` (Task 2), `0cf8504` (Task 1).

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
