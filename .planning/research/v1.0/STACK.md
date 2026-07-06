# Stack Research — AI-Driven Collaborative Mapping (Pillar 3 demo)

**Domain:** LLM-driven map authoring on top of an existing MapLibre + applesauce + ContextVM/MCP app
**Researched:** 2026-05-26
**Confidence:** HIGH (most recommendations are amendments to the existing stack, verified against the current codebase)

---

## TL;DR

**Earthly is not greenfield.** The Pillar 3 plumbing already exists and is more complete than a typical "AI mapping" research target:

- `src/features/chat/routstr.ts` — OpenAI-compatible streaming + tool-call transport, payment-aware (Cashu/RIP-01)
- `src/features/chat/tools/definitions.ts` (796 lines) — 20+ tools already defined in OpenAI function-calling shape, including `write_geojson_to_editor`, `add_feature_to_editor`, `query_osm_*`, `valhalla_route`, `valhalla_isochrone`, `capture_map_snapshot`, `search_location`, `reverse_lookup`
- `contextvm/server.ts` — ContextVM MCP server running Nominatim + Overpass + Valhalla + Wikipedia + web search + PMTiles tools over Nostr transport
- `src/features/chat/tools/context.ts` — `getMapContextSnapshot()` + `createMapContextSystemMessage()` already inject viewport, selection, feature counts, mode into every prompt
- `src/features/chat/tools/helpers.ts` (1322 lines) — geometry baking, dedup, content compaction for prompts

**The work for Pillar 3 is not "pick a stack." The work is:**

1. **Tighten the tool surface** (Zod-validated schemas, error feedback loops, repair retries)
2. **Add an explicit accept/reject preview layer** between tool-call → geometry-on-map → committed (the UX rewrite's "explicit verbs" applied to AI output)
3. **Harden the system prompt** with locked spatial-reasoning rules (use map context, never invent coordinates from training data)
4. **Decide whether to keep raw OpenAI-format tool schemas or upgrade to Zod-derived MCP-style schemas** to unify the editor's local tools and the remote ContextVM MCP tools

This document is prescriptive about each of those decisions. **What NOT to use** sections call out the most tempting wrong turns (Vercel AI SDK swap-in, custom Anthropic SDK, abandoning Routstr).

---

## Recommended Stack

### Core Technologies (keep + amend)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Routstr (existing)** | `src/features/chat/routstr.ts` | OpenAI-compatible streaming chat completions over Nostr + Cashu | Drop-in OpenAI SDK shape, model-agnostic, micropayments-native, aligns with the "Nostr is plumbing" doctrine. Replacing this would discard the wallet/payment surface and the model selection UI. |
| **`@modelcontextprotocol/sdk`** | `1.29.0` (current) | MCP server + client primitives used by `contextvm/server.ts` | Already wired. v1.29 is the current stable; v2 stable target is Q1 2026 but v1.x receives bug fixes for 6+ months after v2 ships. **Do not upgrade speculatively.** |
| **`@contextvm/sdk`** | `^0.9.1` (current) | Nostr transport for MCP — server & client | This is the bridge that makes the MCP server reachable from the browser via a relay rather than HTTP. Switching to plain HTTP-MCP would lose the "decentralizable" property and require a CORS/proxy story. |
| **`zod`** | `^3.23.x` (already transitive via `@contextvm/sdk`; pin it directly) | Schema definition + runtime validation for tool inputs *and* outputs | Promote zod from transitive to direct dependency. Use it to define editor-side tool argument schemas; auto-convert to OpenAI function-calling JSON via `zod-to-json-schema` or zod's built-in `.toJSONSchema()` (v4). Allows tool definitions and runtime validation to share a single source of truth. See § Tool-schema unification. |
| **MapLibre GL** | `5.24.0` (current) | Map rendering + the editor's geometry layer | Already locked. Mention here only because the "preview layer" pattern uses MapLibre's source/layer system — not a fork or alt-renderer. |
| **Turf.js** | `7.3.5` (current) | Geometry validation and repair on LLM-produced GeoJSON | Already present. Use `bbox`, `booleanValid`, `cleanCoords`, `simplify`, `nearestPointOnLine`, `truncate` for the post-tool-call validator. |
| **AJV** | `^8.20.0` (current) | JSON Schema validation for full GeoJSON FeatureCollections returned by tools | Already present for map context validation. Reuse for GeoJSON RFC 7946 validation of LLM output. The `@yaga/geojson-schema` JSON Schema files plug straight into AJV. |

### Supporting Libraries (add)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **`zod-to-json-schema`** | `^3.23.x` | Convert Zod schemas to OpenAI `function.parameters` JSON Schema | Use to make Zod the **canonical** tool definition. Editor tools (`src/features/chat/tools/definitions.ts`) become Zod schemas; OpenAI-format is derived at module init. Replaces 800 lines of hand-written JSON Schema. |
| **`@yaga/geojson-schema`** | `^1.x` (latest stable) | RFC 7946 JSON Schema for GeoJSON validation | Validate LLM-produced GeoJSON in `executeToolCall` before committing to editor. Surface failures back to the model as a tool error message (repair loop). |
| **`best-effort-json-parser`** *or* **`partial-json`** | `^1.x` / latest | Parse partial JSON during tool-call argument streaming | Routstr streams `tool_calls[].function.arguments` as token deltas. Use this to render an in-flight preview ("Claude is drawing a polygon with 4/~6 vertices…") instead of waiting for the full argument string. Pick `partial-json` if the project wants more aggressive recovery; `best-effort-json-parser` for minimal surface. |
| **`overpass-ts`** | `^1.x` (latest) | Typed Overpass QL client | Earthly's Overpass calls go through the MCP server today (`contextvm/server.ts:tools/overpass.ts`). If/when adding browser-side OSM queries that *don't* need the MCP server's chunking, `overpass-ts` gives a clean TS API. Not required for v1. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Bun test runner | Tool schema → JSON Schema round-trip tests | Pin a test that asserts Zod-derived schemas produce identical OpenAI tool definitions to the current hand-written ones during the migration. |
| Bun snapshot tests | System prompt content stability | The system prompt in `tools/context.ts:114-138` is load-bearing. Snapshot it so accidental edits are visible in PR review. |
| Storybook? **No.** | UI development | Project already declines this kind of overhead. Build the preview affordance directly in the running app. |

---

## What Already Exists — Don't Rebuild

This block exists because the most common research failure mode here would be recommending a parallel stack (Vercel AI SDK, LangChain, an "agent framework") when the existing surface is more aligned with the project's constraints.

| Concern | Existing implementation | Status |
|---------|-------------------------|--------|
| LLM transport | `src/features/chat/routstr.ts` — OpenAI Chat Completions shape, SSE streaming, tool calling | Production. Keep. |
| Tool execution dispatcher | `src/features/chat/tools/execute.ts` (821 lines) | Keep. Add validation + repair layer. |
| Editor tool bridge | `src/features/geo-editor/commands.ts` via `editorCommandTools` | Keep. Migrate schemas to Zod. |
| Map context for prompt | `src/features/chat/tools/context.ts` | Keep. Add explicit "coordinates must come from tools, not memory" guard rule. |
| MCP server | `contextvm/server.ts` running over Nostr | Keep. Adding more tools here is the lever for "find me a cafe with outdoor seating" — the Overpass tool there already supports the `concept` argument that maps semantic intent to OSM tag families. |
| Nominatim / Overpass / Valhalla | All present in `contextvm/tools/` | Keep. v1 has `query_osm_nearby` with `filters: {"amenity":"cafe","outdoor_seating":"yes"}` shape — verified by reading the system prompt and tool definitions. |
| Map snapshot for vision models | `capture_map_snapshot` tool + `CachedMapSnapshot` | Keep. Underused. Pillar 3 demo should exercise this for "what's on the map right now?". |
| Streaming tool-call parsing | Partial in `ChatPanel.tsx` | Augment with `best-effort-json-parser` for richer in-flight UI. |

---

## Net-New Additions for Pillar 3

These are the actual additions the milestone needs.

### 1. **Drawing preview layer + accept/reject affordance**

The UX rewrite's "explicit verbs" rule applies to AI output too. Today, `write_geojson_to_editor` and `add_feature_to_editor` commit directly to the editor (`replaceExisting: false` by default — see `definitions.ts:91-97`). Under the UX rewrite, AI-produced geometry should land in a **proposal layer**, not the editor's main feature set, until the user explicitly accepts.

**Implementation sketch:**
- New MapLibre source `ai-proposal` rendered above editor layers with distinct styling (dashed stroke, accent color).
- New store slice `aiProposalSlice` with `pendingFeatures`, `acceptProposal`, `rejectProposal`, `editProposalGeometry` actions.
- The `write_geojson_to_editor` / `add_feature_to_editor` tools route to the proposal slice instead of `editor.setFeatures()` when `stance === 'author'` and the chat is bound to the active draft (per UX_REWRITE.md §6 binding chip).
- Accept = move features from proposal to editor, fire normal change events. Reject = clear proposal slice. Edit = transfer to editor as a starting point.
- The "binding chip" in the chat panel doubles as the affordance: when proposal features exist, the chip becomes "Pending — Accept / Edit / Reject".

This is **the Pillar 3 UX**, and it's the single most important addition. Without it, the LLM is silently mutating the user's draft — which violates the "no implicit mode promotion" rule in UX_REWRITE.md §8 just as much as the deleted `setViewMode('edit')` calls did.

**Confidence: HIGH.** Pattern is well-established in HITL agent literature ([LangChain HITL middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop), [the "Permission Loop" specification](https://medium.com/@mbonsign/the-permission-loop-a-design-specification-for-tool-to-llm-confirmation-ff10f2b0cbce)). Application to MapLibre is straightforward — it's the same source/layer pattern Earthly already uses for comments and proposals.

### 2. **Tool-schema unification: Zod as the source of truth**

Today, `src/features/chat/tools/definitions.ts` hand-writes OpenAI function-calling JSON Schema for 20+ tools (796 lines, much of it boilerplate). The MCP server in `contextvm/server.ts` uses its own Zod schemas (`geo-schemas.ts`, `web-schemas.ts`). These two surfaces must agree on the *shape* of every tool, but they're independently maintained.

**Recommendation:**
- Define every editor tool with Zod (`z.object({ ... })`).
- Auto-derive `function.parameters` via `zod-to-json-schema` (or zod v4's `.toJSONSchema()`).
- At tool-execution time, `safeParse` the LLM-provided arguments. On failure, return a tool result with the Zod error and let the model retry — the standard repair-loop pattern documented in the AI SDK community ([Zod for LLM Agents](https://dev.to/ethan_thunderbit/designing-reliable-tool-schemas-with-zod-for-llm-agents-21ha)). Cap retries at 3.
- Reuse the same Zod schemas in the MCP server: copy the editor-side schemas into a shared `src/features/chat/tools/schemas/` directory and import from both `definitions.ts` and `contextvm/server.ts` where they overlap.

**Why not just leave hand-written JSON Schema?** Because every drift between editor-side and MCP-server-side definitions becomes a silent runtime failure — the model sends a payload that matches one shape but not the other. Zod-as-source-of-truth removes that class of bug.

**Confidence: HIGH.** Standard pattern; Earthly's MCP server already does it for half the tools.

### 3. **GeoJSON validation + repair layer**

LLM output for coordinates is the canonical hallucination case ([GDELT analysis on LLM geocoders](https://blog.gdeltproject.org/generative-ai-experiments-the-surprisingly-poor-performance-of-llm-based-geocoders-geographic-bias-why-gpt-3-5-gemini-pro-outperform-gpt-4-0-in-underrepresented-geographies/); [GeoJSON Agents paper, accuracy 85.71% function-calling vs 48.57% baseline](https://arxiv.org/abs/2509.08863)). The model will:
- Invent coordinates from training data when no map context is supplied
- Produce polygons with non-closed rings, wrong winding order, antimeridian-crossing without splitting
- Swap lat/lon order, especially under translation pressure
- Emit `Position` arrays with 3+ values where 2 are expected (altitude leakage)
- Truncate precision below the meter threshold

**Recommendation: a 3-stage validation pipeline in `executeToolCall` for geometry-producing tools:**

1. **Schema validation (Zod + AJV with GeoJSON JSON Schema).** Rejects structural failures. Repair attempt: send the Zod error back to the model as `role: 'tool', content: '<error>'`. Up to 3 retries.
2. **Semantic validation (Turf.js).**
   - `turf.cleanCoords` — remove duplicate vertices
   - `turf.booleanValid` for polygons — reject self-intersecting or wrong-wound
   - `turf.bbox` sanity check — reject features outside the viewport unless the user asked for global geometry
   - Coordinate-order heuristic: if any `Position[0]` is in `[-90, 90]` and `Position[1]` is outside, flag a likely lat/lon swap
   - `turf.truncate({ precision: 6, coordinates: 2 })` — strip altitude leakage and bound precision
3. **Anchor-to-map-context.** If the LLM emits a feature without using a known landmark from `getMapContextSnapshot()`, log a warning. Prefer tools that *return* coordinates (`search_location`, `query_osm_nearby`) over tools that *accept* coordinates (`write_geojson_to_editor`) — the system prompt should bias toward the former.

**Confidence: HIGH for schema validation, MEDIUM for the anchor rule** (it's a heuristic; tune by demo iteration).

### 4. **System prompt hardening for spatial reasoning**

`tools/context.ts:114-138` is the current system prompt. It's good — explicit, opinionated, lists tool selection rules. Pillar 3 needs to add coordinate-discipline rules:

- "Never invent coordinates from training data. To draw at a place you haven't been given coordinates for, first call `search_location` or `reverse_lookup`."
- "When the user references something visible on the map ('this lake', 'the selected polygon'), use `get_editor_state` or the attached selection — do not guess from the name."
- "Coordinate order is `[lon, lat]` in GeoJSON. Confirm before producing any Position array."
- "If a drawing request would produce more than 200 vertices, prefer importing from OSM (`query_osm_*` with `toEditor=true`) rather than generating coordinates."
- "When user asks for a route, always use `valhalla_route`. Do not interpolate path coordinates."

These rules are cheap (tokens are cheap, model fidelity is not) and worth their weight at the demo bar.

**Confidence: HIGH.** Matches published guidance ([Coordinates from Context paper](https://arxiv.org/html/2510.08741v1); [On the Use of LLMs for GIS-Based Spatial Analysis](https://www.mdpi.com/2220-9964/14/10/401)).

### 5. **Streaming tool-call argument preview**

Routstr streams `function.arguments` as token deltas (see `StreamToolCall` type in `routstr.ts:90-98`). Today these are accumulated and parsed only at `content_block_stop`. With `best-effort-json-parser`, the chat panel can render mid-stream "Drawing a polygon with vertices… 3, 4, 5…" feedback, and — combined with the preview layer in (1) — render geometry on the map as it streams.

**Why this matters for the demo:** "draw a hiking trail from Hallstatt to Dachstein" is a slow tool call (many coordinates). A static spinner is bad demo footage; an animated trail building vertex-by-vertex is good demo footage.

**Confidence: MEDIUM.** The pattern is documented and library options exist, but Anthropic's docs warn that partial JSON from fine-grained tool streaming can be malformed mid-stream ([Anthropic Streaming Messages](https://docs.anthropic.com/en/api/messages-streaming?debug_url=1&debug=1&debug=true), [Handling invalid JSON in Anthropic's fine-grained tool streaming](https://andyjakubowski.com/engineering/handling-invalid-json-in-anthropic-fine-grained-tool-streaming)). Implementer must accept "preview may flicker" as a constraint.

---

## Installation

```bash
# Promote zod from transitive to direct
bun add zod zod-to-json-schema

# Add GeoJSON schema
bun add @yaga/geojson-schema

# Add partial JSON parsing (pick one — partial-json has wider download share)
bun add partial-json
```

No other dependencies needed. Notably absent: no LLM SDK swap, no agent framework, no parallel MCP client.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **Routstr (existing)** | Vercel AI SDK 6 + direct provider keys | If Earthly were *not* Nostr-native and *not* using Cashu micropayments, AI SDK 6's `Agent` abstraction + first-class MCP tool support would be the obvious choice. Earthly's value prop is the opposite: payment-private, decentralizable, model-pluggable. Switching costs > value. |
| **Routstr (existing)** | `@anthropic-ai/sdk` 0.98.0 directly | If the project committed to Claude exclusively and abandoned the model-marketplace doctrine. Same reasoning as above. |
| **OpenAI function-calling format** | MCP-native tool surface for editor-side tools | MCP's `outputSchema` (added in spec 2025-11-25) is appealing because it'd let editor and remote tools share one shape. But Routstr's transport is OpenAI Chat Completions, and the LLM speaks function-calling, not MCP directly. Bridging MCP tool definitions back to OpenAI shape via `zod-to-json-schema` (as recommended) gets the benefit without restructuring the transport. |
| **Preview-then-commit (recommended)** | Direct-commit with undo | Direct-commit is the current behavior. Undo works, but it puts the user in the "what did the AI just do?" loop. Preview-then-commit puts the user in the "this is what the AI proposes" loop, which is the right framing for the UX_REWRITE.md "no implicit transitions" rule. |
| **Turf.js + AJV pipeline** | Just-trust-the-LLM + visual inspection | This is what Pillar 3 has today. It's why "60-second demo runs end-to-end without manual intervention" is in the Active list rather than Validated. |
| **Add new tools to existing MCP server** | Spin up a second MCP server for new POI sources | Single MCP server keeps the transport story simple. The current server (`contextvm/server.ts`) already aggregates Nominatim, Overpass, Valhalla, Wikipedia, web search — adding more is additive. |
| **`partial-json` for tool-call streaming** | `best-effort-json-parser` | Pick `best-effort-json-parser` if you want fewer LOC and tolerate slightly cruder recovery on malformed deltas. Both are ~1KB. Marginal choice. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Vercel AI SDK 6 (`ai` package)** as a Routstr replacement | Would orphan the Cashu payment surface, the model selection UI, and the "Nostr is plumbing" doctrine. AI SDK 6 is genuinely good, but its value (provider abstraction, agent abstraction, devtools) is value Routstr + the existing chat panel already provide in a domain-aligned way. | Keep Routstr. Borrow patterns from AI SDK 6 docs (especially streaming, tool-call partial inputs) without taking the dependency. |
| **LangChain / LangGraph** | Same reason. Adds an agent framework on top of an app that already has explicit tool dispatch. Increases bundle size 2-3MB. Introduces a second mental model for tool definitions. | Existing dispatcher in `tools/execute.ts`. Add the HITL pattern manually (it's <100 LOC). |
| **`@modelcontextprotocol/sdk` v2 betas** | v2 stable lands Q1 2026 per the project's roadmap. Beta APIs will churn. v1.29 is the current stable and is what `@contextvm/sdk` builds against. | Stay on `@modelcontextprotocol/sdk@1.29.0`. Revisit after v2 stable + ContextVM SDK update. |
| **Nominatim public endpoint directly from the browser** | 1 req/sec rate limit, no CORS, [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits high-volume browser use. | Earthly already routes through the MCP server — keep it that way. The MCP server can hit a self-hosted Nominatim or LocationIQ. |
| **MCP Apps / mcp-ui for the proposal UI** | [MCP Apps](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) is new (announced Jan 2026) and conceptually appealing — interactive iframes from MCP servers. But it's designed for *hosting* MCP UIs *inside* a chat client (Claude desktop, VS Code). Earthly *is* the host application. Rendering map geometry as an iframe inside the chat would lose all editor integration. | Render the proposal directly on the MapLibre map as a new layer source. The chat panel just shows the accept/reject affordance. |
| **GeoJSON validators that "automatically fix" geometries (e.g. chrieke/geojson-validator)** | Auto-fix can silently change LLM intent (closing a ring the model intentionally left open, reversing a winding order that was correct for an interior hole). Better to validate and reject than mutate. | Use AJV for schema, Turf for booleanValid checks, repair via *the model* by sending the error back as a tool result. |
| **Custom JSON Schema for tool parameters** | 800 LOC of hand-written, drift-prone schemas. | Zod + `zod-to-json-schema`. |
| **Adding a separate vector tile or AI-tile service** for map context | The map context the LLM needs (viewport, visible layers, feature counts, selection) is already in `getMapContextSnapshot()`. Sending the model a vector tile would 100x the prompt token cost for no clarity gain. | Use the existing JSON snapshot. For visual reasoning, use `capture_map_snapshot` and a vision-capable model when available. |
| **Single-shot prompts that ask the model to produce both intent and geometry** | This is the failure mode that drops accuracy to ~48% per the GeoJSON Agents paper. | Multi-step: intent → tool selection → tool call → validation → preview → user accept. The system prompt and tool surface already encode this. Resist any prompt-engineering temptation to "just ask the model to draw it." |

---

## External POI / Geocoding — for "find me a cafe with outdoor seating"

This is the everyday-utility use case. The existing surface is already correct:

**Tool: `query_osm_nearby`** (in `tools/definitions.ts:217`)
- Accepts `lat`, `lon`, `radius`, `filters: {"amenity":"cafe","outdoor_seating":"yes"}`, `concept` (semantic shortcut), `toEditor` (commit-on-fetch), `limit`, `includeRelations`.
- Backed by Overpass via the MCP server (`contextvm/tools/overpass.ts`).
- Returns features the model can read and the editor can display.

**What's needed for the demo to be reliable:**
1. **Geocode the user's reference point first.** "near me" → `geolocation.getCurrentPosition()` if granted, else fall back to viewport center. "in Vienna" → `search_location` then center.
2. **Concept expansion is the gold path.** The `concept` argument in `query_osm_nearby` already maps semantic intent ("cafe with outdoor seating") to OSM tag families. Audit and extend the concept mappings in `contextvm/tools/overpass.ts`.
3. **No need for a paid POI API for v1.** Overpass + Nominatim cover the use case if rate-limited via the MCP server. If the MCP server proves a bottleneck, [LocationIQ](https://locationiq.com/) (5k req/day free, CORS-friendly) or [MapTiler](https://www.maptiler.com/) (100k/month free) are CORS-friendly drop-ins, but neither replaces the *Overpass* (filtered POI) side, only Nominatim (geocode) — and they're behind the MCP server anyway.
4. **For routing/isochrone answers** ("cafe within 10 minutes walk"): `valhalla_isochrone` + `query_osm_area` with the isochrone as the search polygon. The chain is already supported by the existing tools.

**What's deferred (per PROJECT.md Out of Scope):**
- Compound routing scenarios ("parliament → museum → cafe → ice cream → park")
- Preference modeling beyond simple OSM tag filters

---

## Stack Patterns by Variant

**If the LLM produces a tool call we can validate cheaply (geometry < 200 vertices, single feature):**
- Render directly to the proposal layer.
- Show inline preview in the chat panel.
- Accept/reject via binding chip.

**If the LLM produces a tool call we can't validate cheaply (large FeatureCollection, complex MultiPolygon):**
- Run the validation pipeline async.
- Stream "validating geometry…" status in the chat panel.
- On failure, return error to model, retry (max 3).
- On success, commit to proposal layer.

**If the LLM produces a query (read-only) tool call (`get_editor_state`, `query_osm_nearby` without `toEditor`):**
- Execute, return result to model, no proposal layer involved.
- This is the "find me a cafe" path. Result is rendered in chat (list of cafes), not on the map, unless the user clicks "Show on map" — explicit verb.

**If the LLM calls a tool with both query + side-effect semantics (`query_osm_*` with `toEditor=true`):**
- Treat the side-effect as a proposal.
- Default `toEditor=false` in the system prompt; require the model to set it explicitly only when the user asked to *add* features.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.29.0` | `@contextvm/sdk@^0.9.1` | Verified — current pairing in `package.json`. Pin both; do not bump in this milestone. |
| `zod@^3.23` | `zod-to-json-schema@^3.23` | zod-to-json-schema's major version tracks zod's. zod v4 has a built-in `.toJSONSchema()`, but v4 release is recent; staying on v3 avoids the migration. |
| `@turf/turf@7.3.5` | GeoJSON `0.5.0` (already direct dep) | Compatible. |
| `ajv@^8.20` + `ajv-formats@^3.0` | `@yaga/geojson-schema` | The GeoJSON schemas are JSON Schema draft-07; AJV 8 handles draft-07 + 2020-12 by default. |
| `maplibre-gl@5.24` | All recommended additions | None of the additions touch MapLibre. The proposal layer uses the same MapLibre source/layer API the existing editor uses. |
| `partial-json@^1.x` | Bun + browser | Pure JS, no Node-specific APIs. Verified browser-compatible. |

---

## Confidence Assessment

| Recommendation | Confidence | Reason |
|----------------|------------|--------|
| Keep Routstr | **HIGH** | Aligned with PROJECT.md constraints; replacement cost > value. |
| Keep MCP + ContextVM + Nostr transport | **HIGH** | Working, documented, version-stable. |
| Zod-as-source-of-truth for tool schemas | **HIGH** | Established pattern; project already does it for half the tools. |
| Preview layer + accept/reject UX | **HIGH** | Aligned with UX_REWRITE.md §8 "no implicit transitions"; standard HITL pattern. |
| 3-stage GeoJSON validation pipeline | **HIGH** for schema/semantic; **MEDIUM** for anchor heuristic | Schema validation is uncontroversial; anchor-to-map-context is a tuning lever. |
| System prompt hardening | **HIGH** | Cheap to add, matches published spatial-LLM guidance. |
| Streaming tool-call argument preview | **MEDIUM** | Adds polish but mid-stream partial JSON is known-fragile per Anthropic docs. Demo-quality, not foundation-quality. |
| No SDK swap (no AI SDK, no LangChain) | **HIGH** | Cost/value analysis is clear; the existing surface is more aligned with the project than the replacements. |
| Don't use MCP Apps / mcp-ui for proposal UI | **HIGH** | Architectural fit is wrong — Earthly is the host, not a chat-client embedder. |
| `partial-json` vs `best-effort-json-parser` | **LOW** | Both work; marginal choice. Verify with a single integration spike. |

---

## Sources

- **Existing codebase (HIGH confidence — read directly):**
  - `/Users/schlaus/workspace/earthly/src/features/chat/routstr.ts` — Routstr API client + types
  - `/Users/schlaus/workspace/earthly/src/features/chat/tools/definitions.ts` — 20+ tool definitions in OpenAI function-calling shape
  - `/Users/schlaus/workspace/earthly/src/features/chat/tools/context.ts` — `getMapContextSnapshot()` + system prompt
  - `/Users/schlaus/workspace/earthly/src/features/chat/tools/types.ts` — tool, snapshot, bake types
  - `/Users/schlaus/workspace/earthly/contextvm/server.ts` — MCP server hosting Nominatim/Overpass/Valhalla/web tools
  - `/Users/schlaus/workspace/earthly/package.json` — pinned dependencies

- **Official documentation (HIGH confidence):**
  - [Model Context Protocol — Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) — structured output + outputSchema
  - [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/) — v1.29.0 current; v2 Q1 2026
  - [Routstr Core Documentation](https://docs.routstr.com/) — OpenAI-compatible API, Cashu micropayments
  - [Anthropic Streaming Messages](https://docs.anthropic.com/en/api/messages-streaming?debug_url=1&debug=1&debug=true) — `input_json_delta`, partial JSON warning
  - [Turf.js docs](https://turfjs.org/docs/api/nearestPointOnLine) — geometry helpers
  - [Valhalla Docs](https://valhalla.github.io/valhalla/api/) — routing + isochrone API
  - [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/) — 1 req/sec rate limit
  - [AI SDK Core: Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling) — pattern reference, not a dependency recommendation
  - [AI SDK 6 — Vercel](https://vercel.com/blog/ai-sdk-6) — pattern reference for partial input streaming
  - [MCP Apps — modelcontextprotocol.io blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) — verified as wrong fit for this project

- **Research/practitioner sources (MEDIUM confidence; published 2024-2026):**
  - [GeoJSON Agents: function calling vs code generation (arxiv 2509.08863)](https://arxiv.org/abs/2509.08863) — 85.7% accuracy for function-calling vs 48.6% baseline
  - [Coordinates from Context (arxiv 2510.08741)](https://arxiv.org/html/2510.08741v1) — LLMs grounding location references
  - [On the Use of LLMs for GIS-Based Spatial Analysis (MDPI)](https://www.mdpi.com/2220-9964/14/10/401) — system prompt patterns for spatial tasks
  - [GDELT on LLM geocoders](https://blog.gdeltproject.org/generative-ai-experiments-the-surprisingly-poor-performance-of-llm-based-geocoders-geographic-bias-why-gpt-3-5-gemini-pro-outperform-gpt-4-0-in-underrepresented-geographies/) — coordinate hallucination evidence
  - [Designing Reliable Tool Schemas with Zod for LLM Agents](https://dev.to/ethan_thunderbit/designing-reliable-tool-schemas-with-zod-for-llm-agents-21ha)
  - [Handling invalid JSON in Anthropic's fine-grained tool streaming](https://andyjakubowski.com/engineering/handling-invalid-json-in-anthropic-fine-grained-tool-streaming)
  - [LangChain HITL middleware docs](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) — pattern reference for accept/edit/reject
  - [The Permission Loop: A Design Specification for Tool-to-LLM Confirmation](https://medium.com/@mbonsign/the-permission-loop-a-design-specification-for-tool-to-llm-confirmation-ff10f2b0cbce)
  - [OpenAI Structured Outputs vs Zod (DEV)](https://dev.to/whoffagents/openai-structured-outputs-vs-zod-which-to-use-for-llm-response-validation-in-2026-366m)

---

*Stack research for: AI-driven collaborative mapping (Pillar 3 demo, on top of existing Earthly stack)*
*Researched: 2026-05-26*
*Author: research agent (Opus 4.7 1M)*
