# Chat Feature Architecture

Multi-provider AI chat with tool-calling for map state, OSM/web retrieval, and direct geo-editor commands.

## Scope

The chat stack is a client-side orchestrator:

1. Send prompt to an OpenAI-compatible model endpoint.
2. Let the model call tools.
3. Execute tools locally (editor/store) or through MCP (`contextvm/server.ts` over Nostr).
4. Feed tool results back to the model until it returns a final answer.

No backend middleware is required for chat orchestration.

## Core Modules

| File | Purpose |
|------|---------|
| `src/features/chat/routstr.ts` | Provider config, model discovery, OpenAI-compatible streaming client, SSE parsing |
| `src/features/chat/store.ts` | Zustand orchestration for message flow, tool-call loop, context budgeting, diagnostics |
| `src/features/chat/tools.ts` | OpenAI tool schemas + tool executors (editor + MCP tools) |
| `src/features/chat/ChatPanel.tsx` | Chat UI with diagnostics, reasoning/tool disclosures, copy/debug affordances |
| `src/features/geo-editor/commands.ts` | Headless editor command registry, exposed as `editor_*` AI tools |
| `contextvm/server.ts` | MCP server exposing geo + web tools over Nostr transport |

## Providers

All providers use `/v1/chat/completions`.

| Provider | Base URL | Payment |
|----------|----------|---------|
| `routstr` | `https://api.routstr.com/v1` | Cashu prepay + refund |
| `lmstudio` | `http://localhost:1234/v1` | Free |
| `ollama` | `http://localhost:11434/v1` | Free |
| `custom` | user-provided | Free (API key optional) |

Provider switch triggers `GET /models` and model list reload.

## End-to-End Flow

```text
User message
  -> store.sendMessage()
    -> append user message
    -> compute prompt budget / context guardrails
    -> inject map-context system message (when tools enabled)
    -> stream completion
      -> accumulate content, reasoning_content, tool_calls
      -> if tool_calls:
           append assistant(tool_calls)
           execute each tool
           append tool messages
           loop
      -> else:
           append final assistant answer
           done
```

Loop guardrail: `MAX_TOOL_CALL_ROUNDS = 10`.

## Routstr Payment Flow

For `routstr`, each request uses prepay + automatic refund:

1. Estimate max cost from prompt token estimate + reserved completion tokens.
2. Mint Cashu token via NIP-60 wallet and send as `X-Cashu` header.
3. Receive refund token from response headers (or structured error payloads) and redeem it back into wallet state.

Local/custom providers skip payment flow.

## Context and Token Budgeting

`store.ts` applies explicit context controls to reduce provider failures:

- Per-message sanitization/truncation by role.
- Prompt budget derived from effective context window minus completion reserve and safety margin.
- LM Studio hard context cap handling (`4096`) to avoid `n_keep >= n_ctx` failures.
- Emergency retry mode for context overflow with a reduced prompt window.
- Tool-enabled requests enforce a minimum completion budget (`MIN_TOOL_ENABLED_MAX_TOKENS = 1024`).

Diagnostics surfaced in UI:

- Effective context tokens.
- Prompt budget.
- Estimated prompt/completion token usage.
- Finish reason.
- Tool-call count.
- Streaming phase and stall time.

## Tooling Architecture

### Tool Families

### Map/editor state and write tools

- `get_editor_state` (`detail: compact|full`, default `compact`)
- `capture_map_snapshot`
- `write_geojson_to_editor`
- `add_feature_to_editor`

### OSM + location tools

- `search_location`
- `reverse_lookup`
- `query_osm_by_id`
- `query_osm_nearby`
- `query_osm_bbox`
- `import_osm_to_editor`

### Web context tools

- `web_search`
- `fetch_url`
- `wikipedia_lookup`

### Headless editor command tools (`editor_*`)

Generated dynamically from `src/features/geo-editor/commands.ts`:

- `editor_set_mode`
- `editor_undo`
- `editor_redo`
- `editor_toggle_snapping`
- `editor_delete_selected`
- `editor_duplicate_selected`
- `editor_merge_selected`
- `editor_split_selected`
- `editor_connect_selected_lines`
- `editor_start_boolean_union`
- `editor_start_boolean_difference`
- `editor_cancel_boolean_operation`
- `editor_finish_drawing`

This keeps toolbar/store actions and AI-callable actions on one command surface.

## Map Awareness Preflight

When tools are enabled, each request gets an ephemeral system message from `createMapContextSystemMessage()` with compact map state:

- editor readiness + mode
- feature/selection counts
- map center/zoom/bbox (`mapView`)
- geometry counts
- layer/dataset counts and short layer id list
- map source

Prompt-level instructions bias the model to:

- call tools instead of claiming it cannot edit maps
- generate GeoJSON directly for drawing/editing requests
- query OSM before import for ambiguous targets
- keep tool arguments strict JSON and compact

## Tool Argument Robustness

`parseToolCallArguments()` in `tools.ts` attempts resilient parsing:

- raw JSON parse
- fenced JSON extraction
- first-object extraction
- best-effort repair for likely truncated JSON objects

If parsing still fails, it returns a structured error with raw argument prefix for debugging.

## Tool Result Serialization

Tool results are serialized as full JSON strings (no model-side truncation wrapper in chat layer).  
UI handles readability via collapsible previews instead of truncating payload text in the protocol message.

For prompt construction, `store.ts` now applies a chat-only compaction pass for tool results:

- large `features` arrays are replaced with counts + subtype/geometry summaries + small samples
- raw tool payloads remain intact in chat history/UI and for bake-to-editor flows
- this keeps model context smaller without changing non-chat tool consumers

## MCP and Transport

Chat tools call `EarthlyGeoServerClient`, which talks to `contextvm/server.ts` over Nostr transport.

High-level data path:

```text
Chat tool call
  -> EarthlyGeoServerClient
    -> Nostr relay transport (@contextvm/sdk)
      -> contextvm/server.ts MCP tool
        -> external APIs (Nominatim / Overpass / web providers)
      -> structured response
```

`contextvm/server.ts` currently includes:

- OSM/location queries
- PMTiles extract/upload helpers
- web search + URL fetch + Wikipedia lookup

Transport constraints still apply (Nostr plaintext and payload budgets), so server-side response fitting/simplification is used when needed.

## Streaming and Stall Handling

`routstr.ts` parses SSE by event blocks (not single lines), preserving multiline `data:` payloads and reducing malformed streamed tool-argument assembly.

`store.ts` adds runtime protections:

- Stall warning after 15s without progress.
- Automatic failure after 45s without progress.
- User cancel via AbortController.
- Stream phase tracking (`requesting`, `streaming`, `executing_tools`, `recovering_context`, `finalizing`).

## Chat UI Transparency

`ChatPanel.tsx` provides debugging-first presentation:

- Collapsible reasoning block:
  - Tree-line rendering (`├` / `└`)
  - Collapsed view keeps recent lines visible
  - Expanded view supports auto-scroll toggle (default on)
- Collapsible tool-result block:
  - 2-line preview when collapsed
  - Scrollable full payload when expanded
- Copy buttons on user/assistant/tool-call/tool-result/reasoning bubbles
- Approx token estimate per bubble
- Top diagnostic pills (context/budget/finish/tool-count)

## Known Operational Limits

- Tool loops are bounded at 10 rounds.
- Large geometry/tool payloads can still hit model context or transport limits depending on provider/model.
- Some providers require assistant tool-call messages to include `reasoning_content`; store contains provider-specific compatibility handling for this.

## OSM Retrieval Lessons

Recent evaluation runs surfaced a few stable rules for geo retrieval:

1. Use semantic concept expansion before raw OSM tag guessing.
   - `concept="military installation"` expands to multiple military-related tag families.
   - This is more robust than expecting the model to rediscover OSM ontology on each turn.

2. Keep area-constrained queries area-constrained.
   - If the user says "within Saudi Arabia" or "within this polygon", the recovery path must not degrade into a plain bbox import.
   - Failed constrained queries should retry with the same area constraint or report failure explicitly.

3. Large country-scale bbox queries need tiling.
   - `query_osm_area` and large `query_osm_bbox` requests now split big bboxes into smaller tiles, merge results, and dedupe features locally.
   - This materially reduces Overpass timeouts for country-level prompts.

4. Overpass query syntax matters.
   - Array-valued tag filters generate regex filters.
   - Invalid regex grouping caused hard 400 failures; the query builder must stay within Overpass-compatible regex syntax.

5. Limit/radius caps must match the server schema.
   - The chat-side limit clamp now matches the MCP schema (`<=100`) to avoid pointless validation failures.
   - Nearby radius is still capped tightly to avoid pathological broad-area scans.

6. Presentation and storage should diverge when useful.
   - For "points only" prompts, retrieval can preserve canonical geometry semantics while presenting/importing representative points.
   - On the map, small polygons can collapse to proxy points at low zoom without losing the original polygon geometry.

7. Attached chat geometry must be executor-readable.
   - Transient polygon attachments cannot live only as prompt text.
   - `query_osm_area` now reads attached geometry directly for the current request, even when no editor feature is selected.

8. Spatial wording should map to explicit spatial filters.
   - When the user says "actually inside", use `spatialFilter="point_within"` instead of `intersects`.
   - This is the correct default for point imports inside an attached polygon.

9. Nostr transport size is a hard systems constraint.
   - Large geometry responses can fail before the chat client can compact or bake them.
   - Geometry-producing MCP tools need aggressive server-side fitting, truncation, or omission to stay below encrypted Nostr payload limits.

## Prompt Cookbook (AI + Chat + Map)

Use direct, imperative prompts that encourage tool action.

### Map import and extraction

- `Import the Rhine river features currently visible on my map into the editor.`
- `Find Vienna state boundary from OSM, import it as polygon, and name the feature "Vienna Boundary".`
- `In my current viewport, import all military bases and keep only point features with name/operator metadata.`
- `Load all hospitals in the visible bbox and set a property source=osm_hospital_import on each feature.`

### Direct geometry generation

- `Draw a 5-point star centered on the current map center with ~500m radius.`
- `Create a 2km buffer polygon around the currently selected point feature.`
- `Add a polygon approximating a 15-minute walk shed around the map center using a simple circle approximation.`
- `Create a polyline route between the two selected points and tag it with route_type=manual.`

### Editor command orchestration

- `Switch to draw_polygon mode, then remind me to click points and finish drawing.`
- `Duplicate selected features and then merge compatible ones.`
- `Undo the last two operations and return to select mode.`
- `Enable snapping, split selected multi-geometries, then connect selected lines if possible.`

### Visual + map-context reasoning

- `Capture a snapshot of my current viewport and tell me what major land-use patterns you see.`
- `What am I likely looking at near the map center? Use reverse lookup and one supporting OSM query.`
- `Given current bbox + zoom, suggest three likely POI categories worth importing.`

### Research-assisted geo workflows

- `Find recent news about flood risk in the visible region and summarize implications for mapping.`
- `Use web search + Wikipedia to identify historically significant places in this viewport, then import matching OSM features.`
- `Fetch a source page about protected areas in this region and propose OSM filters to map them.`

### Prompt patterns that usually work best

- `Do the work directly with tools. Ask me only if absolutely required.`
- `Use compact tool arguments. One feature per add_feature_to_editor call unless bulk import is better.`
- `Before importing by name, first verify candidates with query_osm_* and only then import.`
- `After editing, summarize exactly what was changed (counts + geometry types + key properties).`
