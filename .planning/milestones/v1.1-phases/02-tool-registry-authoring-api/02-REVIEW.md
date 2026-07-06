---
phase: 02-tool-registry-authoring-api
reviewed: 2026-06-16T19:45:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - src/ctxcn/EarthlyGeoServerClient.ts
  - src/features/chat/ChatPanel.tsx
  - src/features/chat/store.ts
  - src/features/chat/tools/definitions.ts
  - src/features/chat/tools/errors.test.ts
  - src/features/chat/tools/errors.ts
  - src/features/chat/tools/execute.ts
  - src/features/chat/tools/helpers.ts
  - src/features/chat/tools/index.ts
  - src/features/chat/tools/mcp-sync.test.ts
  - src/features/chat/tools/mcp-sync.ts
  - src/features/chat/tools/primitives-tools.ts
  - src/features/chat/tools/registry.test.ts
  - src/features/chat/tools/registry.ts
  - src/features/chat/tools/schemas.ts
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/api/authoring.golden.test.ts
  - src/features/geo-editor/api/authoring.test.ts
  - src/features/geo-editor/api/authoring.ts
  - src/features/geo-editor/api/boundary.test.ts
  - src/features/geo-editor/api/index.ts
  - src/features/geo-editor/api/mirror.test.ts
  - src/features/geo-editor/api/primitives.test.ts
  - src/features/geo-editor/api/primitives.ts
  - src/features/geo-editor/commands.test.ts
  - src/features/geo-editor/commands.ts
  - src/features/geo-editor/components/Editor.tsx
  - src/features/geo-editor/core/GeoEditor.ts
  - src/features/geo-editor/core/test-harness.test.ts
  - src/features/geo-editor/core/test-harness.ts
  - src/features/geo-editor/core/types/index.ts
  - src/features/geo-editor/hooks/useOsmQuery.ts
  - src/lib/test-fixtures/geo.test.ts
  - src/lib/test-fixtures/geo.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-16T19:45:00Z
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Reviewed the tool registry / Authoring API phase: the unified registry + dispatch
(`registry.ts`, `execute.ts`, `errors.ts`), poll-based MCP sync (`mcp-sync.ts`,
`EarthlyGeoServerClient.ts`), the Authoring facade (`authoring.ts`,
`primitives.ts`), and the one-way store mirror (`Editor.tsx`).

The architecture is sound and the test coverage is genuinely strong (72 passing
tests across the phase, golden-gate equality, boundary enforcement, graceful MCP
degradation). The error contract, radius/distance DoS bounds, and the reverse-loop
guard are all well-implemented.

However, two BLOCKER-level defects stand out: (1) MCP poll-sync **silently
overwrites the rich hand-written remote-mcp handlers** with thin passthroughs that
drop all semantic expansion / tiling / area-filtering orchestration, and (2) the
`EarthlyGeoServerClient` source no longer type-checks — `CreateMapExtract` has a
required parameter after an optional one (TS1016), which is a hard compile error
for that method's signature. Several WARNING-level robustness gaps follow.

## Critical Issues

### CR-01: MCP poll-sync clobbers rich hardcoded remote-mcp handlers with thin passthroughs

**File:** `src/features/chat/tools/mcp-sync.ts:130-171` (and `registerSyncedTool` 109-120)
**Issue:** `syncMcpTools()` calls `registerSyncedTool()` for **every** tool in the
live manifest. `register()` (registry.ts:88-90) does `registry.set(entry.name, entry)`
— it overwrites by name. The live server manifest contains the same names the
bootstrap registered with rich handlers (`search_location`, `query_osm_bbox`,
`query_osm_area`, `import_osm_to_editor`, `query_osm_nearby`, …). After the first
successful sync (or the interval poll started by `startMcpToolPolling`), those rich
handlers — which do semantic-concept expansion (`expandOsmSemanticQuery`), bbox
tiling (`queryOsmBboxWithFallback`), name matching, polygon-area filtering, search
fallback, and `importFeaturesToEditor` baking — are **replaced** by
`(args) => client.callRemoteTool(tool.name, args)`, a bare passthrough.

Concretely: after sync, calling `query_osm_bbox` no longer tiles large bboxes, no
longer applies concept expansion, and `import_osm_to_editor` no longer imports into
the editor at all (the passthrough returns the raw MCP result and never calls
`importFeaturesToEditor`). This is a silent behavior regression triggered by a
background timer, not by any user action. The module doc claims sync only
"converges the registry's `kind:'remote-mcp'` entries," but it makes no attempt to
avoid stomping the bootstrap's specially-handled names.

**Fix:** Maintain a reserved-name set of the hand-written remote-mcp tools and skip
them during sync (only register manifest tools that are NOT already specially
handled), or namespace synced-only tools. For example:

```ts
const HAND_WRITTEN_REMOTE_TOOLS = new Set([
  'search_location', 'reverse_lookup', 'query_osm_by_id', 'query_osm_nearby',
  'query_osm_bbox', 'query_osm_area', 'resolve_osm_entity',
  'get_osm_relation_geometry', 'get_country_boundary', 'valhalla_route',
  'valhalla_isochrone', 'import_osm_to_editor', 'web_search', 'fetch_url',
  'wikipedia_lookup',
])
// in syncMcpTools, only register/track names NOT in HAND_WRITTEN_REMOTE_TOOLS:
const syncableTools = validTools.filter((t) => !HAND_WRITTEN_REMOTE_TOOLS.has(t.name))
```

Also re-scope `liveNames`/unregister so the convergence diff only operates over the
synced-only set (it already only unregisters names in `syncedToolNames`, so once the
register side is fixed the unregister side is safe).

### CR-02: `EarthlyGeoServerClient.CreateMapExtract` has a required parameter after an optional one (TS1016) — invalid method signature

**File:** `src/ctxcn/EarthlyGeoServerClient.ts:1090-1097` (declaration) and `718` (interface)
**Issue:** `tsc --noEmit` reports a hard error on this file:

```
src/ctxcn/EarthlyGeoServerClient.ts(718,3): error TS1016: A required parameter cannot follow an optional parameter.
src/ctxcn/EarthlyGeoServerClient.ts(1096,3): error TS1016: A required parameter cannot follow an optional parameter.
```

Both the `EarthlyGeoServer` interface (line 712-719) and the class method
(1090-1097) declare `maxZoom?: number` followed by required `blossomServer: string`.
This is illegal TypeScript — the signature is malformed, and any caller of
`CreateMapExtract` cannot satisfy it correctly (you cannot omit `maxZoom` while
supplying `blossomServer` positionally). This is in the exact module the MCP-sync
layer depends on (`listTools`, `callRemoteTool`). While the project carries a tsc
baseline, this is a structurally broken public API signature in a phase-touched file.

**Fix:** Make `blossomServer` optional, or (better) reorder so required params come
first / pass an options object:

```ts
CreateMapExtract: (
  west: number, south: number, east: number, north: number,
  blossomServer: string, maxZoom?: number,
) => Promise<CreateMapExtractOutput>
```

and update the implementation body's `this.call('create_map_extract', {...})` call
order accordingly.

## Warnings

### WR-01: `useOsmQuery` passes a narrowly-typed editor into `createAuthoring`, which needs the full `GeoEditor`

**File:** `src/features/geo-editor/hooks/useOsmQuery.ts:8-11, 96`
**Issue:** `tsc` reports:
`useOsmQuery.ts(96,20): error TS2345: Argument of type '{ addFeature: (f: EditorFeature) => void; }' is not assignable to parameter of type 'GeoEditor'.`
The hook types `editor` as `{ addFeature: (f: EditorFeature) => void } | null`, but
`createAuthoring(editor).writeGeoJSON(features, { replace: false })` (the append
path) calls `editor.getAllFeatures()` and `editor.addFeature()` internally
(authoring.ts:150-159). It only works today because the call site
(GeoEditorView.tsx:1434) happens to pass the full store `GeoEditor` instance. The
type is a lie: a genuinely partial editor would throw `editor.getAllFeatures is not
a function` at runtime. This is a phase-introduced regression (the file was rewritten
to use `createAuthoring`).
**Fix:** Type the param as `GeoEditor | null` (import the type) so the contract
matches what `createAuthoring` actually requires.

### WR-02: `writeGeoJSON` append fires one mirror emission per feature — N store writes / N renders for a bulk append

**File:** `src/features/geo-editor/api/authoring.ts:154-162`; `core/GeoEditor.ts:1111-1117`
**Issue:** The append path loops `editor.addFeature(feature)`, and each `addFeature`
emits a `'create'` event (GeoEditor.ts:1116) which the mirror catches and calls
`setFeatures(editor.getAllFeatures())` (Editor.tsx:49-52). Importing 500 OSM
features therefore triggers 500 store writes and 500 `render()` calls. The
`mirror.test.ts` only asserts the single-add case (line 79-89) and the
single-genuine-add dedup case — it never exercises a multi-feature append, so this
went unnoticed. The replace path correctly uses one `features.replace`. (Note:
performance is out of v1 review scope, but this is also a *correctness/robustness*
concern because each intermediate `getAllFeatures()` snapshot is pushed to the store,
and `suppressReverseSyncRef` is a single boolean — see WR-03.)
**Fix:** Add a batch-append primitive to `GeoEditor` (set all, then emit one
`features.replace`/`create`-batch event), and route `writeGeoJSON` append through it.

### WR-03: Reverse-sync suppression flag is a single boolean — coalesced/rapid editor events can leave it stuck or let a reverse push through

**File:** `src/features/geo-editor/components/Editor.tsx:18, 49-52, 158-171`
**Issue:** `suppressReverseSyncRef` is set `true` in `updateFeatures` and consumed
(`false`) in the reverse-sync effect. React batches/coalesces state updates: if two
editor events fire before React runs the effect (e.g. the multi-add of WR-02, or a
`create` + `selection.change` pairing), `setFeatures` may run once but the flag was
set twice — or the effect may run for an unrelated `storeFeatures` dependency change
and consume a flag meant for a different push. The comment acknowledges "render
churn," but the failure mode is subtler: a genuine external store write that arrives
in the same tick as an editor-originated one can be silently swallowed (flag
consumed, reverse push skipped) leaving the editor stale. A boolean cannot track
"how many suppressions are pending."
**Fix:** Use a generation counter or compare-by-value: set a `lastMirroredFeatures`
ref in `updateFeatures` and, in the reverse effect, skip only when `storeFeatures`
is reference-equal/deep-equal to that snapshot, rather than relying on a one-shot
boolean.

### WR-04: `dispatch` cannot distinguish a structured `ToolError` from a handler that legitimately returns a ToolError-shaped object

**File:** `src/features/chat/tools/execute.ts:40`; `src/features/chat/tools/errors.ts:27-35`
**Issue:** `executeToolCall` treats any dispatch result for which `isToolError()` is
true as a failure envelope. `isToolError` only checks `kind ∈ {unknown_tool,
handler_error} && typeof toolName === 'string' && typeof message === 'string'`. A
remote MCP tool (synced via `callRemoteTool`) that returns
`{ kind: 'handler_error', toolName: '...', message: '...' }` as legitimate *data*
would be misinterpreted as a tool failure and never baked / surfaced as success.
With CR-01's passthrough returning arbitrary server JSON, the blast radius widens.
**Fix:** Have `dispatch` wrap failures in a private sentinel (e.g. a class instance
or a unique `__toolError: Symbol` brand) rather than a structurally-guessable shape,
and key `isToolError` off the brand.

### WR-05: Singleton geo client auto-connects to live Nostr relays at import time — leaks into the test runner

**File:** `src/ctxcn/EarthlyGeoServerClient.ts:780-783`; `src/features/chat/tools/helpers.ts:39-44`
**Issue:** The constructor calls `this.client.connect(this.transport)` unconditionally,
and `getGeoClient()` lazily news up the singleton. Running the phase test suite opens
a real connection to `wss://relay.earthly.city` (visible in the test output:
`"Connected to Nostr relays"`). Tests that exercise registry bootstrap / `getGeoClient`
therefore make live network connections, which is non-deterministic, slow, and can
hang CI when the relay is unreachable. There is no opt-out for test/headless contexts.
**Fix:** Gate auto-connect behind a constructor option (default on for app, off in
tests) or lazy-connect on first `call()`. At minimum, ensure `getGeoClient` in tests
is injectable (the mcp-sync tests already accept an injected client — apply the same
pattern to the registry remote handlers).

### WR-06: `extractFirstJsonObject` ignores brace depth going negative — malformed args can parse the wrong object

**File:** `src/features/chat/tools/helpers.ts:599-636`
**Issue:** In `extractFirstJsonObject`, a stray `}` before the first `{` is impossible
(scan starts at `indexOf('{')`), but a payload like `{"a":1}} {"b":2}` will return
`{"a":1}` correctly — however a payload that opens with `{` then has an unbalanced
extra `}` mid-object drives `depth` negative and the function returns at the first
`depth === 0`, potentially truncating a valid larger object the model intended. The
repair path (`repairLikelyTruncatedJsonObject`) is tried as a separate candidate so
this is partially mitigated, but the candidate ordering means the truncated extract
can win if it parses first. This is defensive-parsing of untrusted model output, so
correctness matters.
**Fix:** Bail out (`return null`) if `depth` ever goes negative, so the repair
candidate is preferred for malformed input.

## Info

### IN-01: Debug `console.log` left in the hot dispatch path

**File:** `src/features/chat/tools/execute.ts:63`
**Issue:** `console.log('tool result', result)` runs on every successful tool call,
logging full (possibly large GeoJSON) results to the console in production.
**Fix:** Remove it or gate behind a debug flag.

### IN-02: `lastSyncSucceeded` module global is not reset to reflect a degraded state cleanly across clients

**File:** `src/features/chat/tools/mcp-sync.ts:42, 169, 174-176`
**Issue:** `isMcpSyncActive()` reflects only the *last* call's outcome. With interval
polling, a single transient failure flips it to `false` even though the last-known
tool set is still live and serving. Downstream `definitions.ts` reasoning about
"sync active vs fallback" can momentarily report the wrong state. Minor; document
the semantics or track "ever-succeeded" separately.
**Fix:** Consider a separate `everSynced` flag, or document that `isMcpSyncActive`
means "last poll applied a manifest."

### IN-03: `buffer_feature` indexes `result.featureIds[1]` assuming exactly the by-id composition layout

**File:** `src/features/chat/tools/primitives-tools.ts:179`; `api/authoring.ts:224`
**Issue:** `bufferedFeatureId: sourceId ? result.featureIds[1] : result.featureIds[0]`
hard-codes the `[sourceId, newId]` ordering produced by `authoring.buffer`. If the
composition in `authoring.ts:224` ever changes (e.g. multiple new ids), this silently
returns the wrong id. Fragile coupling between two files via array position.
**Fix:** Have `authoring.buffer` return a structured `{ sourceId, newIds }` on the
result (or a typed field) instead of positional packing into `featureIds`.

### IN-04: `splitBboxIntoTiles` can emit zero-width tiles for degenerate bboxes

**File:** `src/features/chat/tools/registry.ts:176-201`
**Issue:** When `lonSpan` or `latSpan` is 0 (a point bbox), `lonStep`/`latStep` is 0
and the single tile is `[west, south, west, south]` — a zero-area query. Harmless
(server returns nothing) but wasteful and could confuse downstream count logic.
**Fix:** Early-return the original bbox when either span is 0.

---

_Reviewed: 2026-06-16T19:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
