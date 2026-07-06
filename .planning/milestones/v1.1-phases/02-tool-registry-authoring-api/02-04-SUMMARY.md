---
phase: 02-tool-registry-authoring-api
plan: 04
subsystem: chat-tools-registry
tags: [tool-registry, tool-error, unified-dispatch, infra-01, d-01, d-03, d-04, d-06, d-16]

# Dependency graph
requires:
  - phase: 02
    plan: 02
    provides: createAuthoring(editor) — geometry-mutation facade the editor writers dispatch into
  - phase: 02
    plan: 03
    provides: importFeaturesToEditor rerouted through createAuthoring (the only editor.addFeature caller) + A3 boundary test
provides:
  - "D-01 unified typed registry — register/unregister/dispatch/advertise + ToolEntry{name,schema,handler,kind,origin?}; the execute.ts switch + default throw deleted"
  - "INFRA-01 — unknown tool name returns a structured ToolError(unknown_tool), never a silent no-op or bare throw"
  - "D-16 ToolError contract (unknown_tool | handler_error) fed to the model loop AND surfaced distinctly in chat UI; origin attached for remote-mcp failures"
  - "D-03 mandatory `kind` on every entry (compile error if omitted); D-04 dynamic registry; D-06 advertise() serialization decoupled from dispatch"
  - "schemas.ts — dependency-free static OpenAI schema source (breaks the registry<->definitions cycle)"
affects: [02-05, 02-06, "Phase 4 (sandbox plugs into the ToolError self-correction pattern)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single dispatch chokepoint: model → registry.dispatch(name, args, context) → result | ToolError (the LLM→host trust boundary)"
    - "Self-registration: editor_* commands register themselves into the central registry via getEditorAiToolDefinitions()/executeEditorAiTool (kind:'editor')"
    - "Decoupled serialization (D-06): advertise() maps live registry entries → Tool[] without running any handler"
    - "Co-located schema+handler+kind entry generalized from commands.ts EditorCommandDefinition"

key-files:
  created:
    - src/features/chat/tools/registry.ts
    - src/features/chat/tools/errors.ts
    - src/features/chat/tools/schemas.ts
    - src/features/chat/tools/registry.test.ts
    - src/features/chat/tools/errors.test.ts
    - src/features/geo-editor/commands.test.ts
  modified:
    - src/features/chat/tools/execute.ts
    - src/features/chat/tools/definitions.ts
    - src/features/chat/ChatPanel.tsx

key-decisions:
  - "[02-04]: Extracted the hand-authored OpenAI schemas into a dependency-free schemas.ts so registry.ts (which imports schemas) and definitions.ts (which now imports advertise() from registry) don't form an import cycle. definitions.ts collapses to `geoTools = advertise()`."
  - "[02-04]: Tool handler signature is (args, context?) — query_osm_area's attached-geometry path needs the ToolExecutionContext, so dispatch threads context through. All other handlers ignore it."
  - "[02-04]: Geometry writers (write_geojson_to_editor / add_feature_to_editor / import_osm_to_editor) keep calling importFeaturesToEditor, which Plan 03 already rerouted through createAuthoring — so the registry dispatches INTO the Authoring API, never editor.* directly. The A3 boundary test stays green."
  - "[02-04]: write_geojson_to_editor / add_feature_to_editor tagged kind:'editor' (they mutate editor geometry); get_editor_state / capture_map_snapshot tagged kind:'host-builtin'; all OSM/valhalla/web/wiki/fetch tagged kind:'remote-mcp' with origin=SERVER_PUBKEY; editor_* tagged kind:'editor'."
  - "[02-04]: ToolError serialized as raw JSON.stringify(toolError) into the role:'tool' content envelope (preserving tool_call_id + content shape execute.ts:806-820 used) — store.ts model-loop feedback contract untouched; ChatPanel re-parses it via isToolError for distinct rendering."
  - "[02-04]: V5 input validation preserved — parseToolCallArguments (truncation repair) at the dispatch boundary; MAX_GEOJSON_TEXT_CHARS cap + numeric clamps live inside the migrated handler bodies (parseGeoJsonArg, clampLimit, clampRadiusMeters, clampPositiveInt). No zod added to the hot path (T-02-11)."

requirements-completed: [INFRA-01]

# Metrics
duration: 8min
completed: 2026-06-16
---

# Phase 2 Plan 04: Unified Tool Registry + ToolError Contract Summary

**Collapsed the two ad-hoc dispatch systems — the 24-case `switch` in `execute.ts` and the separate `editor_*` registry in `commands.ts` — into ONE typed registry (`registry.ts`) where every entry co-locates its OpenAI schema, handler, and a mandatory `kind` (D-01/D-03). All ~34 advertised tools now dispatch through `registry.dispatch`; the advertised list is derived from live registry state via `advertise()` (D-04/D-06). Unknown tool names and handler failures become a structured `ToolError` (INFRA-01/D-16) fed back to the model loop AND surfaced distinctly in the chat UI — the bare `throw` at `execute.ts:786` is gone.**

## Registry surface (for Plans 05/06 — wire to this)

```ts
type ToolKind = 'editor' | 'host-builtin' | 'remote-mcp' | 'authoring-primitive' | 'nostr-scroll'

interface ToolEntry {
  name: string
  schema: Tool                 // OpenAI function schema
  handler: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<unknown> | unknown
  kind: ToolKind               // REQUIRED — compile error if omitted (D-03)
  origin?: string              // remote-mcp: SERVER_PUBKEY
}

register(entry: ToolEntry): void
unregister(name: string): boolean
dispatch(name, args, context?): Promise<unknown | ToolError>   // unknown → ToolError(unknown_tool); throw → ToolError(handler_error)
advertise(): Tool[]                                            // derived from live registry, never runs a handler (D-06)
registry: Map<string, ToolEntry>                               // exported for orphan-schema / kind assertions
```

`ToolError` (errors.ts):
```ts
interface ToolError {
  kind: 'unknown_tool' | 'handler_error'
  toolName: string
  message: string
  origin?: string          // remote-mcp attribution (D-12)
  argumentsPreview?: string
}
isToolError(x): x is ToolError
```

## `kind` assignment table (all ~34 migrated tools)

| Tool | kind | origin |
|------|------|--------|
| get_editor_state | host-builtin | — |
| capture_map_snapshot | host-builtin | — |
| write_geojson_to_editor | editor | — (dispatches into authoring) |
| add_feature_to_editor | editor | — (dispatches into authoring) |
| search_location | remote-mcp | SERVER_PUBKEY |
| reverse_lookup | remote-mcp | SERVER_PUBKEY |
| query_osm_by_id | remote-mcp | SERVER_PUBKEY |
| query_osm_nearby | remote-mcp | SERVER_PUBKEY |
| query_osm_bbox | remote-mcp | SERVER_PUBKEY |
| query_osm_area | remote-mcp | SERVER_PUBKEY |
| resolve_osm_entity | remote-mcp | SERVER_PUBKEY |
| get_osm_relation_geometry | remote-mcp | SERVER_PUBKEY |
| get_country_boundary | remote-mcp | SERVER_PUBKEY |
| valhalla_route | remote-mcp | SERVER_PUBKEY |
| valhalla_isochrone | remote-mcp | SERVER_PUBKEY |
| import_osm_to_editor | remote-mcp | SERVER_PUBKEY (imports via authoring) |
| web_search | remote-mcp | SERVER_PUBKEY |
| fetch_url | remote-mcp | SERVER_PUBKEY |
| wikipedia_lookup | remote-mcp | SERVER_PUBKEY |
| editor_set_mode | editor | — |
| editor_undo | editor | — |
| editor_redo | editor | — |
| editor_toggle_snapping | editor | — |
| editor_delete_selected | editor | — |
| editor_duplicate_selected | editor | — |
| editor_merge_selected | editor | — |
| editor_split_selected | editor | — |
| editor_connect_selected_lines | editor | — |
| editor_dissolve_selected_lines | editor | — |
| editor_start_boolean_union | editor | — |
| editor_start_boolean_difference | editor | — |
| editor_cancel_boolean_operation | editor | — |
| editor_finish_drawing | editor | — |
| editor_simplify_selected | editor | — |

(19 static schemas + 15 self-registered editor commands = 34 advertised tools.)

## ToolError serialization in the role:'tool' envelope

`execute.ts` serializes a ToolError with `JSON.stringify(toolError)` into the existing `{ tool_call_id, role:'tool', content }` shape. The model loop (`store.ts:1474-1487`) consumes `.content` + `.tool_call_id` unchanged. `ChatPanel.MessageBubble` re-parses `content` via `parseToolErrorContent` → `isToolError`; on a hit it renders a red error-toned bubble (`toolName` + `message` + `origin` when present), otherwise the normal `ToolResultDisclosure`.

## What Shipped

### Task 1 — Unified registry + ToolError + migrate all tools — commit `a86a2b8`
- `errors.ts` (ToolError + isToolError), `registry.ts` (register/unregister/dispatch/advertise; all 19 static-schema tools migrated; OSM bbox tiling helpers moved out of execute.ts), `schemas.ts` (dependency-free static schemas).
- `execute.ts` rewritten: `parse args → registry.dispatch → if isToolError serialize typed error else serialize result + preserve toEditor baking`. Switch (173-787) + default throw (786) deleted.
- `definitions.ts` collapsed to `geoTools = advertise()`; `executeEditorAiTool` re-export removed.
- `editor_*` commands self-register (kind:'editor') in `registerEditorCommands()`.
- Tests: `registry.test.ts` (unknown→ToolError, handler-throw→ToolError(handler_error)+origin, advertise⇄handler no-orphans, ~30 surface, kind-required), `errors.test.ts` (shape + guard), `commands.test.ts` (characterization: duplicate/delete/merge/simplify still return the same EditorCommandExecutionResult after self-registration, using createHeadlessEditor).

### Task 2 — Surface ToolError distinctly in chat UI — commit `1347de8`
- `ChatPanel.tsx` `MessageBubble`: `parseToolErrorContent` + `isToolError` branch renders an error-styled bubble distinct from normal tool output; model-loop feedback path untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted schemas.ts to break a registry↔definitions import cycle**
- **Found during:** Task 1
- **Issue:** The plan had `registry.ts` pull schemas from `definitions.ts`, but `definitions.ts` must now import `advertise()` from `registry.ts` (derived list) — a circular import. With ESM module-init order, the registry's `schemaFor()` would see an undefined `geoTools` during its bootstrap side-effect.
- **Fix:** Moved the hand-authored static OpenAI schemas into a new dependency-free `schemas.ts` (`geoStaticToolSchemas`). `registry.ts` imports schemas from there; `definitions.ts` imports only `advertise()` from `registry.ts`. No cycle.
- **Files modified:** `src/features/chat/tools/schemas.ts` (new), `registry.ts`, `definitions.ts`
- **Commit:** `a86a2b8`

**2. [Rule 1 - Lint] Removed redundant Boolean() cast in execute.ts toEditor guard**
- **Found during:** Task 1 (biome)
- **Issue:** `Boolean(args.toEditor)` flagged by biome `noExtraBooleanCast` in the new dispatch path (the value is already coerced by `&&`).
- **Fix:** `if (args.toEditor && TO_EDITOR_COMPATIBLE_TOOLS.has(...))`.
- **Commit:** `a86a2b8`

## Boundary grep confirmation

`bun test src/features/geo-editor/api/boundary.test.ts` — 8 pass / 0 fail. The A3 assertion (no `editor.addFeature` outside `api/` + `core/GeoEditor.ts`) still passes: the registry's geometry writers route through `importFeaturesToEditor` → `createAuthoring`, never `editor.*` directly.

## Threat Model Compliance
- **T-02-10 (unknown tool silent no-op):** mitigated. `dispatch('unknown', {})` → `ToolError(unknown_tool)`; asserted in registry.test.ts; surfaced in UI (Task 2). Block-on-red gate green.
- **T-02-11 (malformed/oversized LLM args):** mitigated. `parseToolCallArguments` at the dispatch boundary; `MAX_GEOJSON_TEXT_CHARS` cap + numeric clamps retained inside handlers. No zod added.
- **T-02-12 (remote-mcp failure not attributable):** mitigated. `ToolError.origin = SERVER_PUBKEY` set on every remote-mcp handler error (asserted in registry.test.ts handler-throw case).
- **T-02-13 (tool with no kind):** mitigated. `ToolEntry.kind` is a required field (compile error if omitted); every advertised entry asserted to carry a non-empty kind.
- **T-02-SC (package installs):** none this plan.

## Gates
- `bun test src/features/chat/tools src/features/geo-editor` — 49 pass / 0 fail.
- `bun test` (full repo) — 76 pass / 0 fail.
- `bun run build` — succeeds (~640ms).
- `bunx biome lint` on all 9 changed files — clean, no diagnostics.
- Source assertions: `execute.ts` contains no `switch (toolCall.function.name)` and no `throw ... Unknown tool` (both grep to 0).

## Known Stubs
None introduced. `search_location` / `reverse_lookup` remain hardcoded (registered as kind:'remote-mcp') — Plan 06 (D-05 mcp-sync) makes the remote-mcp list dynamic. This is the documented plan boundary, not a goal-blocking stub.

## Next Phase Readiness
- Plan 05 (primitives, TOOLS-01) registers circle/buffer entries with `kind:'authoring-primitive'` via `register(...)` — the dynamic API is in place.
- Plan 06 (mcp-sync, D-05) calls `register({kind:'remote-mcp', origin: SERVER_PUBKEY})` / `unregister(...)` on poll-based `client.listTools()` refresh; `advertise()` will pick up the live set automatically.
- Phase 4's sandbox plugs into the ToolError self-correction pattern (handler_error fed back to the model loop).

## Self-Check: PASSED
- Files verified present: `registry.ts`, `errors.ts`, `schemas.ts`, `registry.test.ts`, `errors.test.ts` (chat/tools); `commands.test.ts` (geo-editor); modified `execute.ts`, `definitions.ts`, `ChatPanel.tsx`.
- Commits verified in git log: `a86a2b8` (Task 1), `1347de8` (Task 2).

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
