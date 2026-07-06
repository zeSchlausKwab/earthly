---
phase: 02-tool-registry-authoring-api
verified: 2026-06-16T19:54:39Z
status: passed
score: 3/4
overrides_applied: 0
human_verification_resolved: "2026-06-16 — UAT 3/3 passed (02-UAT.md): app loads + unknown-tool dispatch (SC1), parametric circle draws (SC4), sidebar one-way mirror after bulk replace (SC2). A startup-crash blocker (registry<->primitives-tools circular import) was found and fixed mid-UAT (commit 2ba04e6). SC3/INFRA-02 modify+delete reroute remains intentionally deferred (see Deferred Items). NOTE: security review (/gsd-secure-phase 2) is still required before advancing to Phase 3."
human_verification:
  - test: "Trigger an unknown tool call from chat (e.g. ask the AI to call a tool that does not exist) and confirm the error appears as a red error bubble in the chat UI (not a blank message or silent failure)"
    expected: "Chat UI renders a visually distinct red error bubble showing 'Unknown tool: <tool_name>' and the error message"
    why_human: "The MessageBubble ToolError rendering branch (ChatPanel.tsx:1379-1406) is a pure React render path — it cannot be verified without a live browser with the chat open and an AI model connected"
  - test: "Open the editor, use a chat tool that draws on the map (e.g. ask 'draw a circle of radius 500m around Paris'), confirm a polygon feature appears on the map"
    expected: "A Polygon feature appears on the map. No behavior regression from the old flow."
    why_human: "End-to-end dispatch through registry -> authoring primitive -> editor -> map render requires a live MapLibre instance with WebGL; the full visual rendering path cannot be verified headlessly"
  - test: "Confirm the Zustand sidebar/feature-list stays in sync after a bulk replace (e.g. use 'write_geojson_to_editor' with replaceExisting:true) — sidebar should update to show only the newly imported features"
    expected: "After a bulk replace via chat, the sidebar feature list reflects ONLY the new set (no stale previous features)"
    why_human: "The one-way read-mirror (D-09) guarantees this in tests, but the visual sidebar update (editorCoreSlice.setFeatures -> React re-render) requires a live UI to confirm no stale state"
gaps:
  - truth: "Direct UI buttons, chat tools, and (future) sandboxed code all reach editor geometry only through the Authoring API; nothing reaches across into the Zustand store"
    status: failed
    reason: "The CREATE seam is closed (editor.addFeature enforced by passing A3 boundary test, zero bypass sites found). However, editor.updateFeature and editor.deleteFeatures are called directly by UI components (info-panel, GeometriesTable, Editor.tsx, GeoEditorView, chat/comment annotation paths) — not routed through the Authoring facade. The facade has no modify/delete surface yet. This is the documented INFRA-02 Partial in REQUIREMENTS.md."
    artifacts:
      - path: "src/components/info-panel/FeaturePropertiesSection.tsx"
        issue: "Multiple editor.updateFeature() direct calls (lines 49, 57, 68, 77, 92, 104)"
      - path: "src/components/info-panel/geometry/GeometriesTable.tsx"
        issue: "Multiple editor.updateFeature() and editor.deleteFeatures() direct calls"
      - path: "src/features/geo-editor/GeoEditorView.tsx"
        issue: "editor.deleteFeatures() at line 1286 (clear-all path)"
      - path: "src/features/geo-editor/components/Editor.tsx"
        issue: "editor.deleteFeatures() at line 134 (map-area cleanup)"
      - path: "src/features/chat/ChatGeometryAttachment.tsx"
        issue: "editor.updateFeature() + editor.setFeatures([]) direct calls"
      - path: "src/features/social/comments/GeoCommentForm.tsx"
        issue: "editor.updateFeature() + editor.setFeatures([]) direct calls"
    missing:
      - "Authoring facade needs modifyFeature/deleteFeatures methods"
      - "A3 boundary assertion must be extended from editor.addFeature to all four verbs once the facade surface covers them"
deferred:
  - truth: "Direct UI buttons, chat tools, and (future) sandboxed code all reach editor geometry only through the Authoring API; nothing reaches across into the Zustand store — for modify/delete paths"
    addressed_in: "Phase 5 (Dataset-Aware Safe Editing) or a follow-up facade-expansion plan"
    evidence: "REQUIREMENTS.md INFRA-02 explicitly marked Partial: 'updateFeature/deleteFeatures reroute deferred to facade-expansion'. 02-03-SUMMARY.md Deferred Issues table lists this explicitly. ROADMAP Phase 2 description acknowledges INFRA-02 partial. The interceptor scaffold (D-12) is already in place for Phase 5 to hook into once the facade surface expands."
---

# Phase 2: Tool Registry & Authoring API Verification Report

**Phase Goal:** The codebase has one typed tool-dispatch seam and one map-mutation seam, both proven behavior-preserving against today's chat, with parametric shape primitives available as the first new tools.
**Verified:** 2026-06-16T19:54:39Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every chat tool dispatches through the typed registry; unknown tool name returns a visible hard error | VERIFIED | `registry.dispatch('unknown_x', {})` returns `{kind:'unknown_tool', ...}` — asserted in registry.test.ts:43-47. execute.ts switch statement (24 cases) deleted. `dispatch()` function in registry.ts:103-126 handles both unknown-tool and handler-throw paths. 16/16 registry+errors tests green. |
| 2 | All existing editor write paths produce identical map results after Authoring API reimplementation | VERIFIED | `authoring.golden.test.ts` passes (6 test cases): OLD `importFeaturesToEditor` body vs NEW `authoring.writeGeoJSON` deep-equals feature sets (ids, geometry, importSource, skippedDuplicates) across replace/append/dup/empty fixtures. Boundary test confirms `importFeaturesToEditor` now calls `createAuthoring`. All 51 api/ tests green. |
| 3 | Direct UI buttons, chat tools, and sandboxed code all reach editor geometry only through the Authoring API; nothing reaches across into the Zustand store | FAILED (Partial) | CREATE seam VERIFIED: zero `editor.addFeature` bypass sites outside api/+GeoEditor core (A3 boundary test, no offenders). Store dual-write DELETED from helpers.ts. 3 GeoEditorView sites + 1 useOsmQuery site rerouted. Store is one-way read-mirror. FAILED for modify/delete: editor.updateFeature called directly in FeaturePropertiesSection, StylePropertiesSection, GeometriesTable (~12 sites), ChatGeometryAttachment, GeoCommentForm, Editor.tsx; editor.deleteFeatures in GeoEditorView, Editor.tsx, commands.ts. Authoring facade has no modify/delete surface. Non-import editor.setFeatures in useDatasetManagement, ChatGeometryAttachment, GeoCommentForm not yet routed through facade. |
| 4 | The AI can draw a parametric circle and a buffer around a feature; same primitives callable as direct API methods | VERIFIED | `draw_circle` and `buffer_feature` registered as `kind:'authoring-primitive'` (registry.ts via registerPrimitiveTools). `authoring.circle/buffer` methods exist in authoring.ts:180-226. primitives.ts exports `makeCircle`/`makeBuffer` wrapping turf. Integration test: `dispatch('draw_circle', {center:[13.4,52.5], radius:500, units:'meters'})` draws 1 Polygon feature on headless editor. `dispatch('buffer_feature', {featureId, distance:100, units:'meters'})` draws buffered feature (2 total). Degenerate/missing-id paths return structured ToolError, no crash. All 112 tests green. |

**Score:** 3/4 truths verified (truth #3 partially verified — create seam closed, modify/delete deferred)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | editor.updateFeature and editor.deleteFeatures routes through Authoring API facade | Future facade-expansion plan (pre-Phase 5) | REQUIREMENTS.md INFRA-02 "Partial — updateFeature/deleteFeatures reroute deferred to facade-expansion". 02-03-SUMMARY.md Deferred Issues table. ROADMAP Phase 2 completion note acknowledges INFRA-02 partial. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/geo-editor/core/test-harness.ts` | createHeadlessEditor() + createMockMap() | VERIFIED | Exists, exports both. 120+ lines. Implements all required MapLibre map surface methods. 5/5 smoke tests pass. |
| `src/lib/test-fixtures/geo.ts` | emptyFeatureCollection, singlePointCollection, dupIdCollection | VERIFIED | Exists, exports all three. 3/3 fixture tests pass. dupIdCollection.features[0].id === dupIdCollection.features[1].id confirmed. |
| `src/features/geo-editor/api/authoring.ts` | createAuthoring(editor) facade — addFeature, writeGeoJSON, circle, buffer | VERIFIED | 229 lines. Exports `createAuthoring` and `Authoring` interface. Implements addFeature, writeGeoJSON, editorCommand, circle, buffer. Zero imports from chat/registry/Nostr. |
| `src/features/geo-editor/api/results.ts` | MutationResult type | VERIFIED | Exists, exports MutationResult, MutationIntent, MutationCounts. |
| `src/features/geo-editor/api/interceptor.ts` | Middleware pipeline + intent enum scaffold | VERIFIED | Exists. Exports MutationIntent, Interceptor, runInterceptors. No-op empty-chain pass-through. |
| `src/features/geo-editor/api/boundary.test.ts` | INFRA-02 import-boundary + A3 surface assertions | VERIFIED | Exists. Scans all api/*.ts for forbidden imports (chat/registry/Nostr/NDK/applesauce). A3 fs-scan finds zero editor.addFeature bypass sites. Store dual-write removal assertion passes. Geometry-only surface assertion passes. |
| `src/features/geo-editor/api/authoring.golden.test.ts` | Binding behavior-preservation gate | VERIFIED | Exists. 6 test cases deep-equal OLD importFeaturesToEditor vs NEW authoring.writeGeoJSON across replace/append/dup/empty. importSource:'chat_tool' preservation confirmed. All pass. |
| `src/features/geo-editor/api/mirror.test.ts` | D-09 read-mirror integrity | VERIFIED | Exists. Asserts store.features === editor.getAllFeatures() after addFeature, writeGeoJSON(replace), writeGeoJSON(append+dedup), mixed sequences. No duplicate events. |
| `src/features/chat/tools/registry.ts` | Unified typed registry: register/unregister/dispatch/advertise + ToolEntry{kind} | VERIFIED | 1003 lines. Exports registry Map, register, unregister, dispatch, advertise, ToolKind, ToolEntry, isToolError. kind is required field. 34 tools registered via bootstrapRegistry(). |
| `src/features/chat/tools/errors.ts` | ToolError contract (unknown_tool / handler_error) | VERIFIED | Exists. Exports ToolError interface and isToolError guard. Both kinds implemented. |
| `src/features/chat/tools/execute.ts` | Switch replaced by registry.dispatch | VERIFIED | No switch statement on tool name. No `throw new Error('Unknown tool')`. Single `dispatch()` call at line 35. ToolError handling at lines 40-49. |
| `src/features/geo-editor/api/primitives.ts` | circle + buffer wrapping turf | VERIFIED | Exports makeCircle, makeBuffer. Uses turfCircle and turfBuffer. Validates radius/distance (InvalidPrimitiveArgError for NaN/Infinity/negative/zero/above MAX_DISTANCE_METERS=40,075,000m). Returns undefined un-coerced from makeBuffer for degenerate input. |
| `src/features/chat/tools/primitives-tools.ts` | draw_circle + buffer_feature registered AI tools | VERIFIED | Exports registerPrimitiveTools(). Both tools registered with kind:'authoring-primitive'. Schemas require radius/distance and expose explicit units enum. Handlers call authoring.circle/buffer via createAuthoring(editor). |
| `src/features/chat/tools/mcp-sync.ts` | Poll-based MCP tool discovery | VERIFIED | Exports syncMcpTools, startMcpToolPolling, stopMcpToolPolling. Preserves bootstrapped local handlers (CR-01 fix). No setNotificationHandler. Diff-converges over syncedToolNames only. Graceful fallback on listTools() failure. 8/8 tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `execute.ts` | `registry.ts` | `dispatch()` replaces switch | VERIFIED | `import { dispatch } from './registry'` at line 20; `await dispatch(toolCall.function.name, args, context)` at line 35; no switch present |
| `helpers.ts:importFeaturesToEditor` | `authoring.ts` | `createAuthoring(editor).writeGeoJSON(usable, {replace})` | VERIFIED | `import { createAuthoring } from '@/features/geo-editor/api'` at line 13; `createAuthoring(editor).writeGeoJSON(usable, { replace: replaceExisting })` at line 753 |
| `GeoEditorView.tsx` (3 sites) | `authoring.ts` | `createAuthoring(editor).writeGeoJSON(...)` | VERIFIED | lines 1251, 1415, 2122 all call `createAuthoring(editor).writeGeoJSON(...)` |
| `Editor.tsx` | `GeoEditor.ts` events | `editor.on('features.replace', updateFeatures)` | VERIFIED | Line 77 subscribes to 'features.replace'; GeoEditor.setFeatures emits 'features.replace' at line 1504 |
| `primitives-tools.ts` | `authoring.ts` | `authoring.circle/buffer` | VERIFIED | handlers call `resolveAuthoring()` then `authoring.circle(...)` or `authoring.buffer(...)` |
| `primitives-tools.ts` | `registry.ts` | `register({kind:'authoring-primitive',...})` | VERIFIED | registerPrimitiveTools() calls register() for both draw_circle and buffer_feature |
| `mcp-sync.ts` | `registry.ts` | `register/unregister` with local-handler preservation | VERIFIED | Lines 196-203: `isLocalHandler` check skips bootstrapped entries; syncedToolNames tracks only mcp-sync's own entries |
| `GeoEditor.ts:setFeatures` | emit | `this.emit('features.replace', {...})` | VERIFIED | Lines 1504-1507 emit 'features.replace' after render; EditorEventType includes 'features.replace' |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `authoring.golden.test.ts` | editor.getAllFeatures() | createHeadlessEditor() + toEditorFeature | Yes — real GeoJSON normalization | FLOWING |
| `registry.dispatch` | result from handler | registered handler returns real data | Yes — passes through to execute.ts | FLOWING |
| `mirror.test.ts` | store.features | editor events via Editor.tsx subscriber | Yes — from editor internal Map | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `bun test` | 112 pass, 0 fail | PASS |
| Build succeeds | `bun run build` | Build completed in 617.95ms | PASS |
| Unknown tool returns ToolError | `dispatch('unknown_x', {})` (asserted in registry.test.ts:43-47) | `{kind:'unknown_tool', toolName:'unknown_x', message:'Unknown tool: unknown_x'}` | PASS |
| draw_circle draws a Polygon | `dispatch('draw_circle', {center:[13.4,52.5], radius:500, units:'meters'})` (registry.test.ts:145-158) | editor.getAllFeatures().length === 1, geometry.type === 'Polygon' | PASS |
| buffer_feature buffers by id | `dispatch('buffer_feature', {featureId, distance:100, units:'meters'})` (registry.test.ts:161-182) | editor.getAllFeatures().length === 2, source+new ids distinct | PASS |
| A3 boundary: zero addFeature bypass | fs-scan in boundary.test.ts | 0 offenders | PASS |
| Golden gate: OLD-vs-NEW identical | authoring.golden.test.ts | deep-equal feature sets + counts across 6 cases | PASS |
| CR-01 fix: local handlers preserved | mcp-sync.test.ts (preservation test) | bootstrapped entry identity unchanged after syncMcpTools() | PASS |
| No switch in execute.ts | grep execute.ts | No `switch (toolCall.function.name)` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INFRA-01 | 02-04, 02-06 | All chat tools dispatch through typed registry; unknown tool = hard error | SATISFIED | registry.dispatch returns ToolError(unknown_tool) for unknown names. execute.ts switch gone. 34 tools registered. mcp-sync adds live remote tools. |
| INFRA-02 | 02-02, 02-03 | Single Authoring API is only path mutating editor geometry | PARTIAL | CREATE seam closed (addFeature, writeGeoJSON, setFeatures-import): verified by A3 boundary test (0 offenders) + golden gate. Modify/delete paths (updateFeature, deleteFeatures) not yet routed through facade — explicitly deferred. |
| INFRA-03 | 02-01, 02-02, 02-03 | Existing write paths reimplemented on Authoring API with no behavior change | SATISFIED | authoring.golden.test.ts: OLD importFeaturesToEditor body vs NEW authoring.writeGeoJSON deep-equal across replace/append/dup/empty. importSource preserved. 6/6 cases green. |
| TOOLS-01 | 02-05 | Parametric circle + buffer as Authoring API methods and registered AI tools | SATISFIED | authoring.circle/buffer implemented. draw_circle/buffer_feature registered kind:'authoring-primitive'. meters canonical, no magic default radius, bounded (V5). Integration tests green. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/chat/tools/execute.ts` | 63 | `console.log('tool result', result)` | Warning (IN-01) | Logs full (possibly large GeoJSON) tool results to console in production on every successful tool call. No functional impact; pre-existing review finding; no TBD/FIXME marker. |

No TBD, FIXME, or XXX markers found in any phase-touched file. The console.log is a warning-level logging issue noted in code review as IN-01 but is not a debt marker under the gate definition.

### Human Verification Required

#### 1. ToolError visible in chat UI

**Test:** Open the app in a browser with a chat model connected. Send a message that makes the AI call a tool that does not exist (e.g. "call the tool named nonexistent_tool_xyz") or trigger a handler failure. Observe the chat UI.
**Expected:** A red error bubble appears in the chat UI showing "Unknown tool: nonexistent_tool_xyz" and the error message, visually distinct from normal tool output (red border, AlertTriangle icon, red background per ChatPanel.tsx:1382-1406).
**Why human:** The MessageBubble rendering branch for ToolError is pure React/DOM — requires a live browser, connected model, and actual AI response.

#### 2. Parametric circle drawn on map via chat

**Test:** With the map editor open, ask the AI "draw a circle of 500 meters radius around coordinates 13.4, 52.5". Verify a Polygon feature appears on the map.
**Expected:** A Polygon feature appears on the map as a circle shape. The sidebar feature list updates. No behavior regression from the old flow.
**Why human:** End-to-end dispatch through registry → authoring primitive → editor → MapLibre rendering requires WebGL and a live browser. The integration test proves the logic path; the visual rendering requires human eyes.

#### 3. Sidebar sync after bulk replace

**Test:** With some features on the map, use the chat to run a `write_geojson_to_editor` tool call with `replaceExisting: true` and a different set of features. Observe whether the sidebar feature list updates to show ONLY the new features.
**Expected:** The sidebar shows only the newly imported feature set. No previously-existing features remain visible (one-way read-mirror D-09 propagated via the 'features.replace' event to editorCoreSlice.setFeatures).
**Why human:** The one-way read-mirror is verified in mirror.test.ts for the headless editor, but the visual React state update in the live sidebar requires a browser to confirm no stale rendering.

### Gaps Summary

**One gap blocks a success criterion:** INFRA-02 (success criterion #3) is partially met. The geometry-CREATE seam (addFeature / writeGeoJSON) is fully closed and enforced by a passing A3 boundary test — zero bypass sites. However, 15+ direct editor.updateFeature and editor.deleteFeatures calls remain outside the Authoring API across info-panel components, GeometriesTable, Editor.tsx, GeoEditorView, and chat/comment annotation paths.

This is not a regression from before Phase 2 — those paths never went through the facade (which didn't exist before this phase). The facade has no modifyFeature/deleteFeatures surface yet. The executors explicitly documented this as INFRA-02 Partial in REQUIREMENTS.md and as Deferred Issues in 02-03-SUMMARY.md, noting it requires a facade-expansion plan to add modifyFeature/deleteFeatures before the A3 assertion can be extended to all four verbs.

The other three success criteria (registry dispatch + unknown-tool hard error, behavior-preservation golden gate, parametric primitives) are fully verified with automated evidence.

**Recommended resolution:** A facade-expansion plan should add `modifyFeature(id, patches)` and `deleteFeatures(ids)` to the `Authoring` interface, reroute the ~15 direct updateFeature/deleteFeatures sites, extend the A3 boundary assertion to all four verbs, and mark INFRA-02 Complete in REQUIREMENTS.md. This is scoped out of Phase 2 per the executor decision and is appropriate before Phase 5 (SAFE-01 gate hooks need the full modify/delete seam).

---

_Verified: 2026-06-16T19:54:39Z_
_Verifier: Claude (gsd-verifier)_
