---
status: complete
phase: 02-tool-registry-authoring-api
source: [02-VERIFICATION.md]
started: 2026-06-16T19:58:36Z
updated: 2026-06-16T20:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Unknown tool call renders a red error bubble in chat
expected: Trigger an unknown tool call from chat (e.g. ask the AI to call a tool that does not exist). The chat UI renders a visually distinct red error bubble showing "Unknown tool: <tool_name>" and the error message (not a blank message or silent failure).
result: pass
note: "App loads cleanly after the circular-import fix (startup blocker resolved). Tool dispatch confirmed live — the model has its advertised tool list and correctly identified that 'frobnicate_widget' is not available, declining the call and explaining rather than producing a silent no-op (Success Criterion #1 satisfied at the dispatch level). The unknown_tool/handler_error red-bubble RENDER path could not be visually triggered because the model (correctly) won't emit a tool call for a non-advertised tool, and gracefully handled the deliberate failing call too. Accepted by user as pass; the ToolError render branch is covered by registry.test.ts/errors.test.ts unit tests."

### 2. AI draws a parametric circle on the map
expected: Open the editor and ask a chat tool to draw on the map (e.g. "draw a circle of radius 500m around Paris"). A Polygon feature appears on the map with no behavior regression from the old flow.
result: pass

### 3. Sidebar stays in sync after a bulk replace
expected: Use a chat tool that bulk-replaces features (e.g. write_geojson_to_editor with replaceExisting:true). The sidebar/feature list updates to show ONLY the newly imported features — no stale previous features remain.
result: pass

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "App loads without a runtime crash so the tool registry can be exercised"
  status: fixed
  severity: blocker
  test: 1
  reason: "User reported on first load: TypeError: Cannot read properties of null (reading 'register') at registerPrimitiveTools (primitives-tools.ts:148), thrown from bootstrapRegistry(). Root cause: circular import registry.ts <-> primitives-tools.ts — registry imports registerPrimitiveTools, primitives-tools imported `register` back from registry; under Bun's dev HMR bundler the cyclic `./registry` reference is null at bootstrap time. bun test + bun build use the native ESM loader and resolve the cycle, so gates were green while the dev runtime crashed."
  fix: "Commit 2ba04e6 — inject `register` into registerPrimitiveTools(register) and make primitives-tools import only `type ToolEntry` from ./registry (erased at runtime). Cycle is now one-way (registry -> primitives-tools). bun test 112/0, build + biome green. Awaiting user hard-reload to confirm the crash is gone."
  artifacts:
    - path: "src/features/chat/tools/primitives-tools.ts"
      issue: "imported runtime `register` from ./registry, completing the cycle (now type-only import + injected param)"
    - path: "src/features/chat/tools/registry.ts"
      issue: "bootstrapRegistry now passes register into registerPrimitiveTools(register)"

(Note: INFRA-02 is intentionally Partial — the Authoring API create seam is closed,
but editor.updateFeature/deleteFeatures reroute is deferred to a facade-expansion plan
before Phase 5. Tracked in 02-VERIFICATION.md "Deferred Items" and REQUIREMENTS.md.)
