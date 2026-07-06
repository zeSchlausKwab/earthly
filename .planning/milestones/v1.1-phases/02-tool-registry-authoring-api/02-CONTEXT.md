# Phase 2: Tool Registry & Authoring API - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Collapse today's two ad-hoc tool-dispatch paths — a 25+ case `switch` in `src/features/chat/tools/execute.ts` plus a separate `editor_*` command registry in `src/features/geo-editor/commands.ts` (invoked via `executeEditorAiTool()`) — into **one typed, dynamic tool registry** where schema + handler are co-located. Route **every** editor-geometry mutation through **one Authoring API seam** (`src/features/geo-editor/api/`, does not exist yet), proven behavior-preserving against today's chat. Ship parametric **circle + buffer** primitives as the first capability built on the new API.

**This is the load-bearing foundation phase** — Phase 3 (ingest), Phase 4 (sandbox), Phase 5 (safe-editing gate), Phase 6 (bulk transform), and Phase 7 (geometry optimization) all route through these two seams. Getting the contracts right here avoids rewrites later.

**Requirements:** INFRA-01 (typed registry, unknown tool = hard error), INFRA-02 (single Authoring API is the only geometry-mutation path), INFRA-03 (existing write paths reimplemented on it with no behavior change), TOOLS-01 (circle + buffer as both API methods and registered AI tools).

**Locked scope decisions (not re-litigated):**
- All ~30 existing tools migrate into the registry **this phase** (not incrementally).
- UI draw paths, chat tools, and (future) sandbox all reach geometry **only** through the Authoring API.
- **Live MCP hot-reload is pulled into scope** this phase (see D-05) — a deliberate expansion beyond the bare INFRA requirements, sequenced as its own wave.

</domain>

<decisions>
## Implementation Decisions

### Tool registry — unification & dispatch
- **D-01:** **One unified typed registry.** Fold the chat-tools `switch` and the `editor_*` command registry into a single dispatch where each entry co-locates its JSON-schema definition and its handler. Editor commands self-register into the central registry (keep editor concerns owned in `geo-editor/`, registered centrally).
- **D-02:** **Migrate all ~30 tools this phase** — OSM queries, valhalla routing, web/wiki search, editor reads, editor writes. Fully satisfies INFRA-01's "every chat tool dispatches through the typed registry." Larger behavior-preservation surface, but no second migration.
- **D-03:** **Tool-kind/source metadata is mandatory on every entry.** Each entry carries a `kind` enum — `editor | host-builtin | remote-mcp | authoring-primitive | nostr-scroll` (extensible) — plus optional **origin** metadata (e.g. which MCP server / pubkey). The chat and UI use this to contextualize behavior ("calling a remote MCP server" vs "running a local editor op"). Rationale: the user requires the chat to stay *aware of the nature* of each tool.
- **D-04:** **The registry is dynamic.** It exposes `register()` / `unregister()` and the model's advertised tool list is **derived from current registry state** (reactive), not a frozen compile-time array. Runtime tool changes must propagate to what the model sees. Anticipates nostr-scrolls (later milestone, NIP-5C) as ad-hoc runtime tool contributors.
- **D-05:** **Live MCP hot-reload is in scope, as its own wave.** The registry actively pulls tools from connected MCP client(s) and updates when a server's manifest changes. ⚠ **FLAG for research/planning:** today's "MCP" tools (`search_location`, `reverse_lookup`) are **hardcoded** in `definitions.ts`, *not* discovered from the ContextVM server — so this is a genuine new capability. The planner MUST verify early whether `EarthlyGeoServerClient` / ContextVM exposes tool-discovery (list-tools); if it does not, that is a dependency/risk to surface before committing the wave. This is the riskiest part of the phase — sequence it last and keep it isolable so it can be deferred without sinking INFRA-01/02/03 + TOOLS-01.
- **D-06:** **Keep tool-definition serialization decoupled from dispatch.** There must be a clean "how tools are advertised to the model" layer separate from "how a call is handled," so a future token-compression wrapper (see Deferred Ideas) can intercept the advertised definitions without touching handlers.

### Authoring API — layering & contract
- **D-07:** **STRICT ONE-WAY LAYERING (hard architectural constraint).**
  1. **GeoEditor** — MapLibre rendering/state (exists).
  2. **Authoring API** (`geo-editor/api/`) — a **pure, AI-agnostic, framework-agnostic geometry-mutation facade** over GeoEditor. **ZERO imports from chat / tool-registry / Nostr.** This is the layer that could ship as a **standalone editor library** (the user's explicit concern: the editor/toolbar may be shipped standalone, usable without any AI integration). It holds the parametric primitives, the result objects, and the interceptor/gate pipeline.
  3. **Tool registry + chat tools** — the AI layer, a **separable consumer** of the Authoring API. Delete it and the editor + toolbar + API still work.
- **D-08:** **The Authoring API is the single mutation seam — UI included.** Refactor the interactive draw-mode / toolbar write paths (`editor.addFeature()` direct calls) onto the Authoring API **this phase**, alongside chat tools. This is *safe* precisely because the API has no AI coupling — the UI depends only on a clean geometry library. Satisfies success criterion #3 literally with no bypass left for Phase 5's gate to miss.
- **D-09:** **Callers never write the Zustand store directly.** The store becomes a **downstream read-mirror** fed by GeoEditor's existing `create`/`update`/`delete` events (one subscription, replacing today's scattered dual-writes in `importFeaturesToEditor`, `helpers.ts:747-748`). The left edit sidebar / feature list updates exactly as today — this is purely an internal sync change, and it creates the single chokepoint Phase 5's gate will hook. This *is* the "no reaching across into the Zustand store" INFRA-02 demands.
- **D-10:** **Single facade-instance shape** (`authoring.*`) — one cohesive object holding the editor reference internally. Natural host for the interceptor, easy to pass into the sandbox and to mock. Not free-functions (which would leak the editor handle into every signature).
- **D-11:** **Mutating methods return structured result objects** (created/affected feature ids, counts) — never void. Enables Phase 4 sandbox composition ("buffer the circle I just drew") and Phase 5 diff reporting; makes the API package-export-clean.
- **D-12:** **Structural gate scaffolding now, not Phase 5 features.** Build the interceptor/middleware pipeline + the intent-classification types/enum (`add | modify | delete`) **in the Authoring API** now (these belong to the standalone editor — non-AI undo/confirm/diff want them too; only AI-*specific* labeling is a consumer concern). Do **NOT** build Phase 5's diff/preview UI, safety-level persistence, or dataset-level undo here. The researcher MUST read Phase 5's SAFE-01…SAFE-06 to scaffold the shape those will need so Phase 5 drops into the slot without restructuring.

### Parametric primitives (TOOLS-01)
- **D-13:** **Circle + buffer are Authoring API methods first, registered AI tools second.** They ride along in the standalone-lib layer (D-07).
- **D-14:** **Meters canonical.** API methods take a numeric distance + a `units` param (default `meters`); the AI tool schema exposes the unit explicitly so the model states it. turf handles m/km/mi natively. **No magic default radius** — the caller/model must specify.
- **D-15:** **Buffer targets by feature id primarily** (`buffer(featureId, distance)` — composes with returned ids per D-11), **and also accepts raw GeoJSON geometry** for programmatic/sandbox use. Circle is center + radius. Both **draw immediately AND return result objects**.

### Error contract
- **D-16:** **One unified structured tool-error contract** covering both **unknown-tool-name** and **registered-handler-runtime-failure**. Errors are **fed back into the model tool-loop** (so the AI self-corrects) **AND surfaced visibly in the chat UI** (so the user knows). This sets the self-correction pattern Phase 4's sandbox runtime-error feedback plugs straight into. Replaces today's bare throw (`execute.ts:786`).

### Claude's Discretion
- Exact registry file layout / module structure (planner picks against codebase conventions).
- Circle/buffer **segment/steps count** — turf defaults are fine.
- Behavior-preservation **verification strategy** (golden/snapshot tests of existing write paths before/after vs UAT) — planner's call, but criterion #2 ("identical map results") is binding.
- Precise interceptor/middleware API signature (must satisfy D-12's scaffolding intent).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — INFRA-01, INFRA-02, INFRA-03, TOOLS-01 (full requirement text + phase mapping).
- `.planning/ROADMAP.md` — Phase 2 goal + four success criteria (verbatim acceptance conditions), and the dependency note that Phases 3–7 all route through these seams.
- `.planning/PROJECT.md` — milestone goal; the Pillar-3 "Toolbar drawing API" item ("designed as if it were a future package export, no internal map-state coupling") that motivates D-07/D-10; note that nostr-scrolls / NIP-5C are explicitly **deferred to a later milestone**.

### Existing code to refactor (the two seams)
- `src/features/chat/tools/execute.ts` — the 25+ case dispatch `switch` (lines ~173–787); unknown-tool throw at ~786. The registry replaces this.
- `src/features/chat/tools/definitions.ts` — `geoTools` array, OpenAI function-calling schemas (lines ~21–796); also where MCP-ish tools (`search_location`, `reverse_lookup`) are currently **hardcoded** (relevant to D-05).
- `src/features/chat/tools/helpers.ts` — `importFeaturesToEditor()` (lines ~735–776), the current unified chat write path that **dual-writes** editor + store (the cross-reaching D-09 eliminates); existing turf imports (lines ~16–25).
- `src/features/geo-editor/commands.ts` — the separate `editor_*` command registry + `getEditorAiToolDefinitions()` / `executeEditorAiTool()` that D-01 folds in (~17 editor commands).
- `src/features/geo-editor/core/GeoEditor.ts` — `addFeature()` (~1111–1117), `setFeatures()`, and the `create`/`update`/`delete` event emission D-09's store-mirror subscribes to.
- `src/features/geo-editor/store/editorCoreSlice.ts` — `setFeatures` action + draft persistence (~21–43); becomes a read-mirror, not a write target.
- `src/features/geo-editor/GeoEditorView.tsx` — direct `editor.addFeature()` UI call sites (~1249, 1413, 2120) that D-08 reroutes through the Authoring API.
- `src/features/geo-editor/components/toolbar/DrawButtonGroup.tsx` — toolbar draw-mode UI (the direct-UI write path in scope per D-08).
- `src/ctxcn/EarthlyGeoServerClient.ts` — the ContextVM/MCP client; D-05's live hot-reload depends on whether it exposes tool-discovery (planner must verify).

### Codebase maps (context)
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/CONVENTIONS.md` — pre-existing architecture, concerns, and Biome/style conventions to match.

### Forward-coupled phase (read before scaffolding the gate)
- `.planning/REQUIREMENTS.md` — SAFE-01…SAFE-06 (Phase 5 Dataset-Aware Safe Editing). D-12's interceptor + intent-classification scaffolding must anticipate these.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`@turf/turf@^7.3.5`** — already installed and imported in `helpers.ts` (bbox, intersects, centroid, lineSplit…). `circle` and `buffer` are available but unused — direct basis for TOOLS-01 (D-13/D-15).
- **`importFeaturesToEditor()`** — the current single chat write path; its `toEditorFeature()` normalization (source metadata + stable ids) is reusable, but the **dual-write to the store must be removed** in favor of the event-mirror (D-09).
- **GeoEditor event emission** (`create`/`update`/`delete`) — already exists; the store-mirror subscription (D-09) builds on it rather than inventing new events.
- **`executeEditorAiTool()` + `getEditorAiToolDefinitions()`** — the existing `editor_*` mini-registry; its schema+handler co-location pattern is the model for the unified registry (D-01), but it gets absorbed.

### Established Patterns
- **OpenAI function-calling tool schemas** — the registry's advertised-definition layer must emit this format (and stay decoupled per D-06).
- **Source-tagged features** — features carry a source (`'chat_tool'`, etc.); preserve this through the Authoring API.
- **applesauce / Zustand split** — GeoEditor instance is source of truth, store mirrors for UI reactivity; D-09 formalizes this as strictly one-way.

### Integration Points
- Chat tool-call loop in `src/features/chat/` consumes the registry (dispatch + the D-16 error contract).
- The Authoring API is the sole consumer-facing geometry seam: chat tools, the new primitives, UI draw modes, and (Phase 4) sandbox all call it.
- ContextVM MCP client (`EarthlyGeoServerClient.ts`) is the integration point for D-05's dynamic remote-tool registration.

</code_context>

<specifics>
## Specific Ideas

- The user's standalone-lib concern — "is this a good idea if the editor toolbar could be shipped as a standalone lib later… without any AI integration" — is what drove the strict layering (D-07): the Authoring API is AI-free *by construction*, so routing UI through it (D-08) is safe and the editor stays independently shippable.
- The user's insistence that "the chat stays aware of the nature of the tools (remote MCP vs quick editor tool)" drove the mandatory kind/origin metadata (D-03).
- "We will probably wrap this registry via the lib" (the token-compression library) drove the decoupled-definition-serialization constraint (D-06).

</specifics>

<deferred>
## Deferred Ideas

- **Tool-definition compression library** — a repo/lib the user recalls (but couldn't locate) that compresses the advertised tool definitions into a more compact format to **radically cut token cost** when many tools are exposed to the model. To be researched later and likely wrapped around this registry. Design accommodation already locked (D-06: keep advertised-definition serialization decoupled from dispatch). No implementation this phase.
- **Nostr-scrolls (NIP-5C) ad-hoc tools** — runtime-generated WASM tools that register dynamically; explicitly a *later milestone* per PROJECT.md. The dynamic registry (D-04) anticipates them as contributors but does not implement them.
- **Trust/cost per-tool metadata** (paid/sats tools) — considered as part of the descriptor; deferred in favor of the leaner `kind` + `origin` shape (D-03). Revisit when paid remote tools land.

</deferred>

---

*Phase: 2-Tool Registry & Authoring API*
*Context gathered: 2026-06-16*
