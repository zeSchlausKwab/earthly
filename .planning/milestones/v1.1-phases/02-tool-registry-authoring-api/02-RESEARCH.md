# Phase 2: Tool Registry & Authoring API - Research

**Researched:** 2026-06-16
**Domain:** AI tool-dispatch architecture, geometry-mutation facade design, MCP-over-Nostr tool-discovery, behavior-preservation testing
**Confidence:** HIGH (all architectural claims grounded in live file inspection; turf + MCP SDK capabilities verified by execution)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool registry — unification & dispatch**
- **D-01:** One unified typed registry. Fold the chat-tools `switch` (`execute.ts`) and the `editor_*` command registry (`commands.ts`) into a single dispatch where each entry co-locates its JSON-schema definition and its handler. Editor commands self-register into the central registry (editor concerns stay owned in `geo-editor/`, registered centrally).
- **D-02:** Migrate all ~30 tools this phase (OSM queries, valhalla routing, web/wiki search, editor reads, editor writes). No second migration.
- **D-03:** Tool-kind/source metadata mandatory on every entry. `kind` enum — `editor | host-builtin | remote-mcp | authoring-primitive | nostr-scroll` (extensible) — plus optional **origin** (which MCP server / pubkey). Chat + UI use it to contextualize behavior.
- **D-04:** Registry is dynamic — exposes `register()`/`unregister()`; the model's advertised tool list is **derived from current registry state** (reactive), not a frozen compile-time array.
- **D-05:** Live MCP hot-reload in scope, as its own wave. Registry pulls tools from connected MCP client(s), updates when a server's manifest changes. ⚠ Today's "MCP" tools are HARDCODED in `definitions.ts`, NOT discovered. Verify tool-discovery exists before committing the wave; sequence it last and keep it isolable.
- **D-06:** Keep tool-definition serialization decoupled from dispatch. A clean "how tools are advertised to the model" layer separate from "how a call is handled."

**Authoring API — layering & contract**
- **D-07:** STRICT ONE-WAY LAYERING. (1) GeoEditor → (2) Authoring API (`geo-editor/api/`, pure, AI-agnostic, framework-agnostic, ZERO imports from chat/tool-registry/Nostr — shippable standalone) → (3) Tool registry + chat tools (separable consumer).
- **D-08:** Authoring API is the single mutation seam — UI included. Refactor toolbar/draw write paths onto it this phase.
- **D-09:** Callers never write the Zustand store directly. Store becomes a downstream read-mirror fed by GeoEditor `create`/`update`/`delete` events (one subscription, replacing the scattered dual-writes in `importFeaturesToEditor` / `helpers.ts:747-748`).
- **D-10:** Single facade-instance shape (`authoring.*`) holding the editor reference internally. Not free-functions.
- **D-11:** Mutating methods return structured result objects (created/affected feature ids, counts) — never void.
- **D-12:** Structural gate scaffolding now (interceptor/middleware pipeline + intent-classification enum `add | modify | delete` in the Authoring API), NOT Phase 5's diff/preview UI, safety-level persistence, or dataset-level undo.

**Parametric primitives (TOOLS-01)**
- **D-13:** Circle + buffer are Authoring API methods first, registered AI tools second.
- **D-14:** Meters canonical; numeric distance + `units` param (default `meters`); AI tool schema exposes the unit explicitly. No magic default radius.
- **D-15:** Buffer targets by feature id primarily (`buffer(featureId, distance)`), AND also accepts raw GeoJSON geometry. Circle is center + radius. Both draw immediately AND return result objects.

**Error contract**
- **D-16:** One unified structured tool-error contract covering unknown-tool-name AND registered-handler-runtime-failure. Fed back into the model tool-loop AND surfaced visibly in chat UI. Replaces the bare throw at `execute.ts:786`.

### Claude's Discretion
- Exact registry file layout / module structure.
- Circle/buffer segment/steps count — turf defaults fine.
- Behavior-preservation verification strategy (golden/snapshot vs UAT) — planner's call, but criterion #2 ("identical map results") is binding.
- Precise interceptor/middleware API signature (must satisfy D-12 scaffolding intent).

### Deferred Ideas (OUT OF SCOPE)
- **Tool-definition compression library** — wraps the advertised-definition layer later (D-06 accommodates it). No implementation this phase.
- **Nostr-scrolls (NIP-5C) ad-hoc tools** — later milestone. D-04 anticipates them as contributors; do not implement.
- **Trust/cost per-tool metadata (paid/sats)** — deferred in favor of lean `kind` + `origin`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | All chat tools dispatch through a typed registry (schema + handler co-located); unknown tool name is a hard error, never a silent no-op. | Two existing dispatch surfaces mapped: `execute.ts` switch (24 named cases + `default` fallthrough to `executeEditorAiTool`) and `commands.ts` editor registry (15 `editor_*` commands). The `default` branch at `execute.ts:780-787` is the unification chokepoint and the only current hard-error site. Registry shape modeled on `commands.ts` co-location pattern. |
| INFRA-02 | A single Authoring API (`src/features/geo-editor/api/`) is the only path that mutates editor geometry; no reaching across into the Zustand store. | Dual-write sites identified: `importFeaturesToEditor` (`helpers.ts:735-776`) writes BOTH `editor.setFeatures()`/`editor.addFeature()` AND store `setFeatures()`. Three UI direct calls in `GeoEditorView.tsx:1249,1413,2120`. Event-mirror foundation already exists in `Editor.tsx:65-67`. |
| INFRA-03 | Existing editor write paths (`add_feature_to_editor`, `write_geojson_to_editor`, editor commands) reimplemented on the Authoring API with no behavior change. | All write paths route through `importFeaturesToEditor` → `editor.addFeature`/`editor.setFeatures`. Behavior-preservation strategy: golden tests on the pure normalization + dedup logic; see Validation Architecture. |
| TOOLS-01 | Parametric circle + buffer as both Authoring API methods and registered AI tools. | turf@7.3.5 `circle`/`buffer` verified present and unused; signatures confirmed by execution (see Code Examples). |
</phase_requirements>

## Summary

Phase 2 collapses two parallel AI-tool dispatch systems into one typed registry and introduces a pure geometry-mutation facade (`Authoring API`) that becomes the single write seam for chat, UI, and the future sandbox. Both seams already have strong precursors in the codebase: `commands.ts` is a textbook co-located schema+handler registry (the model for D-01), and `Editor.tsx` already subscribes to GeoEditor's `create`/`update`/`delete` events to mirror state into the store (the foundation for D-09's one-way read-mirror). The work is principally *consolidation and re-routing*, not greenfield invention — which is what makes the binding behavior-preservation criterion (#2) achievable.

The single highest-risk item, D-05 (live MCP hot-reload), resolves to a **qualified yes**: the MCP client (`@modelcontextprotocol/sdk@1.29.0`) DOES expose `listTools()` and `setNotificationHandler` — but today's `EarthlyGeoServerClient` never calls them; all 14 "MCP" tools are hand-transcribed in `definitions.ts`. Critically, the ContextVM Nostr transport runs in `isStateless: true` mode, where the `initialize` handshake is *emulated locally* and the durable server subscription needed for push `notifications/tools/list_changed` is not guaranteed. **Therefore: implement hot-reload as poll-based `listTools()` refresh, sequenced as the LAST, isolable wave, deferrable without sinking INFRA-01/02/03 + TOOLS-01.**

**Primary recommendation:** Build the Authoring API facade FIRST (it has zero AI coupling and unblocks everything), migrate the registry and re-route all dual-writes through it SECOND with golden tests proving identical map state, add circle+buffer THIRD, and gate the MCP `listTools()` discovery LAST as a deferrable wave.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool dispatch (name → handler) | Tool registry (AI layer) | — | The registry is the model-facing seam; it must NOT own geometry mutation. |
| Tool definition serialization (advertised schema) | Tool registry (AI layer) | — | D-06: decoupled from dispatch; future compression wraps here. |
| Geometry mutation (add/update/delete/replace) | Authoring API (`geo-editor/api/`) | GeoEditor | D-07/D-08: single pure seam; the only caller of `editor.addFeature` et al. |
| Parametric primitives (circle/buffer) | Authoring API | GeoEditor | D-13: lib-layer methods; AI tools are thin wrappers. |
| Map rendering / MapLibre state | GeoEditor (exists) | — | Already owns layers, rendering, history, selection. |
| UI reactivity (feature list, stats, sidebar) | Zustand store (read-mirror) | — | D-09: downstream of GeoEditor events only; never a write target. |
| MCP remote tool calls (OSM/valhalla/web/wiki) | Tool registry → `EarthlyGeoServerClient` | ContextVM transport | `kind: 'remote-mcp'` with origin = server pubkey. |
| MCP tool *discovery* (listTools) | Tool registry (MCP-sync wave) | `EarthlyGeoServerClient` | D-05: poll-based; isolable wave. |
| Intent classification (add/modify/delete) | Authoring API interceptor | — | D-12: belongs to standalone editor (non-AI undo/confirm want it). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@turf/turf` | 7.3.5 (installed) | `circle` + `buffer` geometry primitives (TOOLS-01) | Already a project dependency; `circle`/`buffer` present but unused. Industry-standard geospatial lib. `[VERIFIED: npm registry + local execution]` |
| `@modelcontextprotocol/sdk` | 1.29.0 (installed) | MCP `Client` with `listTools()` + `setNotificationHandler` (D-05) | Already used by `EarthlyGeoServerClient`. `listTools()` confirmed present. `[VERIFIED: local node_modules]` |
| `@contextvm/sdk` | 0.9.1 (installed) | Nostr transport for MCP (`NostrClientTransport`) | Already the transport. `isStateless` behavior verified (see Pitfalls). `[VERIFIED: local node_modules]` |
| Bun test runner | Bun 1.x (`@types/bun`) | Behavior-preservation golden tests | Project mandate (CLAUDE.md: `bun test`, not jest/vitest). `[CITED: CLAUDE.md + TESTING.md]` |
| `zustand` | installed | Read-mirror store (D-09) | Existing state layer; becomes downstream-only. `[VERIFIED: codebase]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `geojson` types | installed (`GeoJSON.*` global) | Feature/Geometry typing across the API | Authoring API method signatures (D-11 result objects). `[VERIFIED: codebase usage]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Poll-based `listTools()` (D-05) | Push `notifications/tools/list_changed` via `setNotificationHandler` | Push is event-driven (no poll interval) but UNRELIABLE over the current `isStateless: true` Nostr transport — the durable subscription that would carry server-initiated notifications is not guaranteed when initialize is emulated locally. Poll is deterministic. **Recommend poll; document push as a future optimization once a stateful/persistent transport mode is confirmed.** |
| New event type for bulk `setFeatures` | Reuse existing `create`/`update`/`delete` | `setFeatures()` currently emits NOTHING (`GeoEditor.ts:1493-1501`). D-09's read-mirror needs a bulk-replace signal. Cheapest fix: emit a `create`/`update` (or a new `features.replace`) event from the Authoring API replace path so the existing `Editor.tsx` mirror catches it — avoids the chat dual-write. |
| Hand-rolled JSON-schema validator | Existing per-handler arg parsing (`parseToolCallArguments`, `toFiniteNumber`, clamps) | Existing validators are battle-tested against real LLM malformed output (truncated JSON repair at `helpers.ts:638-698`). Reuse them; do NOT introduce zod into the dispatch hot path this phase. |

**Installation:** No new packages required. All dependencies already installed.

**Version verification:**
```bash
npm view @turf/turf version          # → 7.3.5 (modified 2026-05-17) [VERIFIED]
# @modelcontextprotocol/sdk 1.29.0, @contextvm/sdk 0.9.1 — confirmed in node_modules [VERIFIED]
```

## Package Legitimacy Audit

> All packages already installed and in production use. No new installs this phase.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@turf/turf` | npm | mature (v7.3.5, mod. 2026-05-17) | very high | github.com/Turfjs/turf | OK | Approved (already installed) |
| `@modelcontextprotocol/sdk` | npm | active | high | github.com/modelcontextprotocol | OK | Approved (already installed) |
| `@contextvm/sdk` | npm | newer (0.9.1) | low | contextvm | OK (already in prod use) | Approved (already installed) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**New packages this phase:** none — this is a refactor/consolidation phase.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────────┐
   CHAT (AI layer)      │  TOOL REGISTRY  (src/features/chat/tools/)   │
   user msg ──► model   │  ┌────────────────────────────────────────┐ │
        │               │  │ register()/unregister()  (D-04 dynamic)│ │
        ▼               │  │ entries: { schema, handler, kind,      │ │
   tool_call ───────────┼─►│           origin } co-located (D-01)   │ │
        │               │  └──────────────┬─────────────────────────┘ │
        │               │   advertise()   │   dispatch(name,args)      │
        │               │   (D-06 layer)  │   unknown ⇒ HARD ERROR     │
        │               └───────┬─────────┼───────────────(D-16)───────┘
        │                       │         │
   model loop ◄── error/result ─┘         │
   (self-correct, D-16)                   │
                                          ▼
                       kind=remote-mcp ─► EarthlyGeoServerClient ─► ContextVM (Nostr) ─► geo server
                       kind=host-builtin ► snapshot/context helpers
                       kind=editor ──────► AUTHORING API
                       kind=authoring-primitive (circle/buffer) ► AUTHORING API
                                          │
   ┌──────────────────────────────────────┼─────────────────────────────────────┐
   │  AUTHORING API  (src/features/geo-editor/api/)  ── pure, AI-agnostic (D-07)  │
   │  authoring.addFeature / writeGeoJSON / circle / buffer / editorCommand...    │
   │  ── interceptor/middleware pipeline (D-12) → intent {add|modify|delete}      │
   │  ── every mutating method returns a structured result (D-11)                 │
   └──────────────────────────────────────┬──────────────────────────────────────┘
                                          │ (the ONLY caller of editor mutations)
   DIRECT UI (toolbar draw, GeoEditorView add) ──► AUTHORING API   (D-08)
                                          ▼
                       ┌───────────────────────────────────┐
                       │  GeoEditor (MapLibre)             │
                       │  addFeature/updateFeature/delete  │
                       │  emits create/update/delete       │
                       └───────────────┬───────────────────┘
                                       │ events (one-way, D-09)
                                       ▼
                       Zustand store (READ-MIRROR ONLY) ──► sidebar / feature list / stats
```

Data-flow trace for "AI draws a circle": model emits `tool_call(draw_circle)` → registry `dispatch` finds entry `kind:authoring-primitive` → calls `authoring.circle(center,radius,{units})` → interceptor classifies `intent:add` → `editor.addFeature(circlePolygon)` → GeoEditor emits `create` → `Editor.tsx` mirror updates store → sidebar re-renders. The Authoring API returns `{ featureIds:[…], geometryType:'Polygon' }` (D-11) back through the registry to the model.

### Recommended Project Structure
```
src/features/geo-editor/
├── api/                       # NEW — Authoring API (D-07, pure, no AI/Nostr imports)
│   ├── authoring.ts           # single facade instance `authoring.*` (D-10)
│   ├── primitives.ts          # circle + buffer (D-13/14/15) wrapping turf
│   ├── interceptor.ts         # middleware pipeline + intent enum (D-12)
│   ├── results.ts             # structured result object types (D-11)
│   └── index.ts
├── commands.ts                # editor_* commands — self-register into central registry (D-01)
├── core/GeoEditor.ts          # unchanged mutation methods; consider emitting on setFeatures
└── store/editorCoreSlice.ts   # setFeatures becomes read-mirror sink (D-09)

src/features/chat/tools/
├── registry.ts                # NEW — unified typed registry: register/unregister/dispatch/advertise (D-01/04/06)
├── definitions.ts             # geoTools → derived from registry.advertise() (D-04)
├── execute.ts                 # switch → registry.dispatch(); default = hard error (D-16)
├── mcp-sync.ts                # NEW — poll listTools() → register kind:remote-mcp (D-05, LAST wave)
└── errors.ts                  # NEW — unified ToolError contract (D-16)
```

### Pattern 1: Co-located schema + handler registry entry (D-01)
**What:** Each registry entry bundles its OpenAI-function schema, its handler, and mandatory `kind`/optional `origin` metadata.
**When to use:** Every tool — editor, host-builtin, remote-mcp, authoring-primitive.
**Example:** The existing `commands.ts` `EditorCommandDefinition` already does exactly this and is the template:
```typescript
// Source: src/features/geo-editor/commands.ts:49-60 (existing pattern to generalize)
export interface EditorCommandDefinition {
  id: EditorCommandId
  label: string
  description: string
  canExecute?: (state) => boolean
  execute: (state, args) => EditorCommandExecutionResult   // handler
  ai?: { toolName: string; description: string; parameters?: EditorCommandToolParameters } // schema
}
// getEditorAiToolDefinitions() (commands.ts:567) derives advertised defs;
// executeEditorAiTool() (commands.ts:577) dispatches by toolName. Generalize this into the
// central registry with an added `kind` discriminator (D-03).
```

### Pattern 2: Event-driven one-way read-mirror (D-09)
**What:** GeoEditor is the single source of truth; the store subscribes to its events and never the reverse.
**When to use:** All geometry mutations.
**Example:** Already wired for interactive draws:
```typescript
// Source: src/features/geo-editor/components/Editor.tsx:43-67 (existing — extend, don't reinvent)
const updateFeatures = () => setFeatures(editor.getAllFeatures())
editor.on('create', updateFeatures)
editor.on('update', updateFeatures)
editor.on('delete', updateFeatures)
```
The gap: `editor.setFeatures()` (bulk replace) emits NO event (`GeoEditor.ts:1493`), so the chat path dual-writes. Fix by having the Authoring API replace-path emit an event (or add a `features.replace` event type) so this same mirror catches it — then delete the store-side write in `importFeaturesToEditor`.

### Pattern 3: Structured result objects, never void (D-11)
```typescript
// Authoring API method shape
interface MutationResult {
  ok: boolean
  intent: 'add' | 'modify' | 'delete'   // D-12 classification
  featureIds: string[]                    // created/affected ids — enables Phase 4 composition
  counts: { created: number; updated: number; deleted: number; skippedDuplicates: number }
  geometryTypeCounts?: Record<string, number>
}
```

### Anti-Patterns to Avoid
- **Letting any consumer call `editor.addFeature()` directly** — defeats INFRA-02. After this phase, grep for `editor.addFeature`/`editor.setFeatures` outside `api/` must return zero hits (except GeoEditor internals).
- **Importing chat/Nostr/registry types into `geo-editor/api/`** — breaks D-07 standalone-lib guarantee. Add a lint/test assertion (see Validation).
- **Making the advertised tool array a frozen const** — D-04 requires it derived from live registry state.
- **Building Phase 5 diff/preview UI** — D-12 explicitly scopes OUT the UI; build only the interceptor *shape*.
- **Adding a magic default radius to circle/buffer** — D-14 forbids it; caller/model must specify.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Circle / buffer geometry | Manual trig polygon generation | `@turf/turf` `circle()` / `buffer()` | Already installed; handles units, antimeridian, projection nuances. |
| MCP tool discovery | Custom Nostr event parsing for tool manifests | MCP SDK `client.listTools()` | The `Client` already speaks the protocol; `listTools()` is a standard request that goes over the wire. |
| Malformed LLM JSON args | New parser | Existing `parseToolCallArguments` (`helpers.ts:700`) + truncation repair | Battle-tested against real model output. |
| Feature normalization / stable ids | New id scheme | Existing `toEditorFeature()` (`utils.ts:263`) | Preserves source-tagging (`importSource: 'chat_tool'`) and customProperties mirroring. |
| Event emitter | New pub/sub | Existing `GeoEditor.on/off/emit` (`GeoEditor.ts:1542-1613`) | Already typed (`EditorEventType`) and consumed by `Editor.tsx`. |

**Key insight:** This phase is ~80% re-wiring existing, proven pieces into clean seams. The danger is *reinventing* the event mirror, the normalization, or the arg-parsing that already work — which would introduce behavior drift and fail criterion #2.

## Runtime State Inventory

> This is a refactor phase (re-routing write paths). The "renamed string" analogue here is "every site that mutates geometry or writes the store." Inventory of write/dual-write sites that must be re-routed:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Chat dual-write sites | `importFeaturesToEditor` (`helpers.ts:735-776`) calls `editor.setFeatures()` + store `setFeatures()` (line 747-748) AND `editor.addFeature()` (line 766) | Re-route through Authoring API; remove the store write (D-09). |
| UI direct mutation sites | `GeoEditorView.tsx:1249`, `:1413`, `:2120` (`editor.addFeature(...)`) | Re-route through `authoring.addFeature` (D-08). |
| Editor-command mutation sites | `commands.ts` 15 commands call `editor.*` (deleteFeatures, duplicate, combine, simplify, etc.) | Self-register into central registry (D-01); these already go through GeoEditor + emit events, so store mirror is fine — verify no store dual-write added. |
| Bulk-replace event gap | `GeoEditor.setFeatures()` (`GeoEditor.ts:1493`) emits NO event | Add emission OR have Authoring API replace-path emit, so read-mirror catches replace (D-09). |
| Store→editor reverse sync | `Editor.tsx:148-154` pushes store features back into editor via `JSON.stringify` diff | Audit: with one-way mirror, this reverse effect risks loops/double-render. Keep ONLY for genuine external loads (dataset open), or gate it so Authoring-API-originated changes don't round-trip. |
| Existing event mirror | `Editor.tsx:65-78` subscribes create/update/delete → store | REUSE as the D-09 chokepoint — do not reinvent. |
| Tool dispatch surfaces | `execute.ts:173-787` (24 cases + default) and `commands.ts` (15 editor_*) | Merge into one registry; the `default` branch (`execute.ts:780-787`) is the only current hard-error site. |
| Advertised tool array | `definitions.ts:21` `geoTools` (static) + `editorCommandTools` (`definitions.ts:10`, derived) | Make fully derived from registry state (D-04). |

**Nothing found in category — Stored data / OS-registered / secrets:** None — this phase touches only in-process dispatch and mutation routing; no databases, OS registrations, or secret keys are renamed. Verified by inspection of the listed files.

## Common Pitfalls

### Pitfall 1: `setFeatures()` emits no event → silent read-mirror miss
**What goes wrong:** Routing the chat "replace existing" path through `authoring.writeGeoJSON(..., replace=true)` → `editor.setFeatures()` updates the map but NOT the store, so the sidebar goes stale. This is *why* the current code dual-writes.
**Why it happens:** `GeoEditor.setFeatures()` (`GeoEditor.ts:1493-1501`) calls `render()` but never `emit()`.
**How to avoid:** Either (a) add `this.emit('update', {…})` to `setFeatures`, or (b) have the Authoring API replace-path explicitly emit through the editor's event bus. Then delete the store-side `setFeatures()` call in `importFeaturesToEditor`.
**Warning signs:** Feature list count diverges from map after an AI "replace" / `write_geojson_to_editor`.

### Pitfall 2: store↔editor sync loop (`Editor.tsx:148-154`)
**What goes wrong:** The store→editor reverse effect does a `JSON.stringify` deep-compare and pushes features back into the editor. With the new one-way mirror, an Authoring-API mutation fires `create` → store updates → this effect re-pushes into the editor → potential extra `render()`/`setFeatures` churn or feedback.
**Why it happens:** Two effects (editor→store via events, store→editor via deps) form a cycle guarded only by stringify-equality.
**How to avoid:** Mark Authoring-API-originated updates so the reverse effect skips them (e.g., a ref flag), OR narrow the reverse effect to fire only on explicit external loads (dataset open). Cover with a test.
**Warning signs:** Double `create` events, transient flicker, history recording duplicates.

### Pitfall 3: D-05 push-notification mirage over stateless transport
**What goes wrong:** Wiring `setNotificationHandler('notifications/tools/list_changed', …)` and assuming the registry auto-refreshes. It may never fire.
**Why it happens:** `EarthlyGeoServerClient` uses `isStateless: true` (`EarthlyGeoServerClient.ts:775`). In stateless mode the transport emulates `initialize` locally (`nostr-client-transport.js:176-184`) and the persistent server subscription that would deliver server-initiated notifications is not guaranteed.
**How to avoid:** Implement `listTools()` POLLING (e.g., on registry init + manual refresh + interval). Treat push as a future optimization. Keep this entire capability in its own wave that can be dropped.
**Warning signs:** Tools never appear/disappear at runtime despite server manifest changes.

### Pitfall 4: behavior drift in normalization breaks criterion #2
**What goes wrong:** Re-implementing `toEditorFeature` or dedup logic inside the Authoring API subtly changes ids, source tags, or skip-duplicate behavior → "identical map results" fails.
**Why it happens:** Temptation to "clean up" while moving code.
**How to avoid:** The Authoring API must CALL existing `toEditorFeature` (`utils.ts:263`) and reuse the dedup-by-id logic verbatim from `importFeaturesToEditor`. Golden-test before/after.
**Warning signs:** Diffs in `importSource`, `featureId`, or `skippedDuplicates` counts in golden tests.

### Pitfall 5: `kind` metadata omitted on migrated tools
**What goes wrong:** D-03 requires `kind` on EVERY entry; easy to forget on the 14 hand-transcribed MCP tools and the host-builtin snapshot/context tools.
**How to avoid:** Make `kind` a required field on the registry entry type (compile error if missing). Map: OSM/valhalla/web/wiki/fetch → `remote-mcp` (origin = `EarthlyGeoServerClient.SERVER_PUBKEY`); `get_editor_state`/`capture_map_snapshot`/`write_geojson_to_editor`/`add_feature_to_editor` → `host-builtin` or `editor`; circle/buffer → `authoring-primitive`; `editor_*` → `editor`.

## Code Examples

### Verified turf circle + buffer (TOOLS-01, D-14/15)
```typescript
// Source: @turf/turf 7.3.5 — verified by execution 2026-06-16
import { circle, buffer, point } from '@turf/turf'

// circle(center, radius, options) → Feature<Polygon>
// center = [lon, lat]; radius numeric; units explicit (D-14, no default radius)
const c = circle([13.4, 52.5], 1, { steps: 64, units: 'kilometers' })
// c.geometry.type === 'Polygon'; ring has steps+1 points (65) [VERIFIED]

// buffer(geojson, radius, options) → Feature<Polygon|MultiPolygon> | undefined
const b = buffer(point([13.4, 52.5]), 500, { units: 'meters' })
// b.geometry.type === 'Polygon' [VERIFIED]
// ⚠ buffer can return `undefined` for degenerate/empty input — Authoring API MUST
//   null-check and return { ok:false } rather than crashing (feeds D-16 error contract).
```
`units` accepts `'meters' | 'kilometers' | 'miles'` etc. — meters canonical per D-14. Buffer-by-id (D-15): resolve the feature from `editor.getFeature(id)`, pass its geometry to `buffer`, then `addFeature` the result and return both source and new ids (D-11).

### Unified error contract (D-16) — where errors flow today
```typescript
// Today: execute.ts:806-820 catches and returns { tool, error, argumentsPreview } as JSON in
// a role:'tool' message. The model SEES it (store.ts:1469-1479 appends it and loops/continues),
// but there is NO dedicated chat UI error surface — it is just JSON text.
// D-16 target: a typed ToolError fed back to the model AND rendered distinctly in chat.
interface ToolError {
  kind: 'unknown_tool' | 'handler_error'
  toolName: string
  message: string
  origin?: string            // for remote-mcp failures
  argumentsPreview?: string
}
// Replace the bare `throw new Error(\`Unknown tool: …\`)` at execute.ts:786 with a
// structured ToolError of kind:'unknown_tool'. Wrap handler runtime failures as kind:'handler_error'.
```

### Registry dispatch chokepoint (INFRA-01)
```typescript
// Today, two surfaces. After D-01:
// registry.dispatch(name, args) → looks up entry → runs handler → returns result | ToolError
// Unknown name ⇒ ToolError(unknown_tool)  (replaces execute.ts:786 throw — the ONLY hard-error site today)
// editor_* commands self-register so the execute.ts `default` fallthrough to executeEditorAiTool
// disappears.
```

## State of the Art

| Old Approach | Current Approach (this phase) | When Changed | Impact |
|--------------|-------------------------------|--------------|--------|
| Two dispatch systems (switch + editor registry) | One typed registry | Phase 2 | Single chokepoint; unknown-tool hard error. |
| MCP tools hand-transcribed in `definitions.ts` | Poll `client.listTools()` (D-05 wave) | Phase 2 (last wave) | Tools stay in sync with server manifest. |
| Dual-write editor + store | One-way event read-mirror | Phase 2 | INFRA-02 single seam; Phase 5 gate hook point. |
| Direct `editor.addFeature` from chat + UI | `authoring.*` facade | Phase 2 | Standalone-lib boundary; sandbox-ready. |

**Deprecated/outdated after this phase:**
- `geoTools` as a static array — becomes derived from registry.
- `importFeaturesToEditor`'s store write (`helpers.ts:747-748`) — removed.
- The `execute.ts` switch (`:173-787`) — replaced by `registry.dispatch`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The ContextVM geo SERVER actually advertises its tools via `tools/list` (client `listTools()` works end-to-end). The client SDK supports it; the server response is unverified (no live call made — would require network + signer). | D-05 / Standard Stack | If server doesn't implement `tools/list`, D-05 hot-reload cannot pull real tools — but this is isolated to the last wave and deferrable; INFRA-01/02/03 + TOOLS-01 unaffected. **Recommend a `checkpoint:human-verify` spike calling `listTools()` against the live server at the START of the D-05 wave.** |
| A2 | Server-initiated `notifications/tools/list_changed` is unreliable under `isStateless:true`. Inferred from transport code (initialize emulated locally; subscription lifecycle), not from a live push test. | Pitfall 3 / Alternatives | If push actually works, poll is merely suboptimal (still correct). Low risk. |
| A3 | No other geometry-mutation sites exist beyond the grep'd ones (`importFeaturesToEditor`, `GeoEditorView` x3, `commands.ts`, GeoEditor internals). | Runtime State Inventory | A missed write site would bypass the seam and fail INFRA-02. **Mitigation: post-migration grep assertion for `editor.addFeature|setFeatures|updateFeature|deleteFeatures` outside `api/` and GeoEditor core.** |
| A4 | turf `circle`/`buffer` defaults (steps) are acceptable per D-discretion. | TOOLS-01 | Cosmetic only. |

## Open Questions

1. **Does the live ContextVM geo server respond to `tools/list`?**
   - What we know: The client SDK (`@modelcontextprotocol/sdk@1.29.0`) exposes `listTools()`; the transport forwards request/response over Nostr.
   - What's unclear: Whether the specific Earthly geo server (pubkey `ceadb7d5…`) implements the `tools/list` MCP method.
   - Recommendation: Start the D-05 wave with a one-shot spike (`checkpoint:human-verify`) calling `getGeoClient().` + a new `listTools` passthrough against the live server. Gate the rest of the wave on its result. The 14 currently-hardcoded MCP tool names in `definitions.ts` are the expected baseline to compare against.

2. **Should the store→editor reverse effect (`Editor.tsx:148-154`) survive the D-09 change?**
   - What we know: It exists to push external dataset loads into the editor.
   - What's unclear: Whether dataset-load flows can be re-expressed as `authoring.writeGeoJSON` (making the reverse effect removable) or must remain.
   - Recommendation: Keep it but guard against Authoring-API-originated round-trips (ref flag); revisit removal in Phase 5 when the gate centralizes loads.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@turf/turf` | TOOLS-01 circle/buffer | ✓ | 7.3.5 | — |
| `@modelcontextprotocol/sdk` | D-05 listTools | ✓ | 1.29.0 | — |
| `@contextvm/sdk` | MCP transport | ✓ | 0.9.1 | — |
| Bun test runner | golden tests | ✓ | 1.x | — |
| Live ContextVM geo server | D-05 real tool discovery (runtime) | ? (unverified) | — | Keep hardcoded `definitions.ts` baseline as fallback; D-05 wave deferrable |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Live `tools/list` server support is unverified — fallback is the existing hardcoded MCP tool list (status quo), and the entire D-05 wave is isolable/deferrable.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`). Criterion #2 ("identical map results") is the binding gate.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun built-in test runner (`bun:test`), Jest-compatible `expect` |
| Config file | none — Bun auto-discovers `*.test.ts` |
| Quick run command | `bun test src/features/geo-editor/api` |
| Full suite command | `bun test` |

> ⚠ The repo currently has ZERO test files (`TESTING.md`). This phase establishes the first test suite. Co-locate `*.test.ts` next to source. Project gates are `bun test` + `bun run build` + `biome` (per MEMORY: tsc has ~305 pre-existing errors and is NOT a gate).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | Unknown tool name → structured hard error (not silent no-op) | unit | `bun test src/features/chat/tools/registry.test.ts` | ❌ Wave 0 |
| INFRA-01 | Every advertised tool resolves to a handler (no orphan schemas) | unit | `bun test src/features/chat/tools/registry.test.ts` | ❌ Wave 0 |
| INFRA-02 | No `editor.addFeature/setFeatures/updateFeature/deleteFeatures` calls outside `api/` + GeoEditor core | static/grep | `bun test src/features/geo-editor/api/boundary.test.ts` (asserts via fs scan) | ❌ Wave 0 |
| INFRA-02 | `geo-editor/api/` imports nothing from chat/registry/Nostr (D-07) | static/grep | same boundary test | ❌ Wave 0 |
| INFRA-03 | `add_feature_to_editor` produces identical editor feature set (id, source, props) before/after | golden | `bun test src/features/geo-editor/api/authoring.golden.test.ts` | ❌ Wave 0 |
| INFRA-03 | `write_geojson_to_editor` (replace + append) → identical features + dedup counts | golden | same | ❌ Wave 0 |
| INFRA-03 | editor commands (delete/duplicate/merge/simplify) → identical results | characterization | `bun test src/features/geo-editor/commands.test.ts` | ❌ Wave 0 |
| INFRA-03 | Store read-mirror reflects exactly the editor's features after each op (no divergence) | integration | `bun test src/features/geo-editor/api/mirror.test.ts` | ❌ Wave 0 |
| TOOLS-01 | `circle(center,radius,units)` returns Polygon with expected ring; draws + returns ids | unit | `bun test src/features/geo-editor/api/primitives.test.ts` | ❌ Wave 0 |
| TOOLS-01 | `buffer(featureId,distance,units)` and `buffer(geojson,…)` both draw + return ids; undefined-buffer handled | unit | same | ❌ Wave 0 |
| TOOLS-01 | circle/buffer registered as AI tools, dispatch reaches Authoring API | integration | `bun test src/features/chat/tools/registry.test.ts` | ❌ Wave 0 |
| D-16 | Handler runtime failure → typed ToolError fed back to model loop | unit | `bun test src/features/chat/tools/errors.test.ts` | ❌ Wave 0 |

**Behavior-preservation strategy (criterion #2 — recommended):** *Golden/characterization tests* on the pure transformation core, not screenshot diffing. The map output is a deterministic function of `editor.getAllFeatures()`; assert that the **feature set** (ids, geometry, `importSource`, `customProperties`, dedup counts) is byte-identical when the same GeoJSON is fed through the OLD path (call existing `importFeaturesToEditor` against a real headless editor) versus the NEW `authoring.*` path. Because GeoEditor is instantiable in tests with a mocked MapLibre map, and `toEditorFeature` is pure, this is cheap and deterministic. Supplement with one structured UAT pass through the live chat for the human-verify gate (config `human_verify_mode: end-of-phase`).

### Sampling Rate
- **Per task commit:** `bun test src/features/geo-editor/api` (+ the touched tool registry tests)
- **Per wave merge:** `bun test` (full) + `bun run build` + `bun run lint`
- **Phase gate:** Full suite green + one live-chat UAT (criterion #2 visual confirm) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/features/geo-editor/api/authoring.golden.test.ts` — INFRA-03 before/after feature-set equality (the binding test)
- [ ] `src/features/geo-editor/api/primitives.test.ts` — TOOLS-01 circle/buffer
- [ ] `src/features/geo-editor/api/mirror.test.ts` — D-09 read-mirror integrity
- [ ] `src/features/geo-editor/api/boundary.test.ts` — INFRA-02 + D-07 import-boundary assertions
- [ ] `src/features/chat/tools/registry.test.ts` — INFRA-01 dispatch + unknown-tool hard error + advertise/handler coverage
- [ ] `src/features/chat/tools/errors.test.ts` — D-16 contract
- [ ] `src/features/geo-editor/commands.test.ts` — editor-command characterization
- [ ] Shared fixture: `src/lib/test-fixtures/geo.ts` (empty FC, single-point FC, dup-id FC) — per TESTING.md recommendation
- [ ] Headless GeoEditor harness (mock MapLibre `map`) — required for golden/mirror tests; **first-of-its-kind, allow spike time**

## Security Domain

> `security_enforcement: true`, ASVS level 1, block on high. This phase is internal dispatch/geometry refactor — limited external attack surface, but the seam being built is the future host boundary for the Phase 4 sandbox, so input-validation discipline set here matters downstream.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth changes; MCP signer reused unchanged. |
| V3 Session Management | no | — |
| V4 Access Control | partial | The Authoring API becomes the privilege boundary the sandbox (Phase 4) is confined to — design it to expose ONLY geometry methods, nothing reaching signer/wallet/store. |
| V5 Input Validation | yes | LLM-supplied tool args MUST be validated at dispatch. Reuse `parseToolCallArguments` + numeric clamps (`helpers.ts`). circle/buffer radii must be bounded (no NaN/Infinity/negative). |
| V6 Cryptography | no | No new crypto; never hand-roll. |

### Known Threat Patterns for {AI tool dispatch + geometry facade}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM emits unknown/garbage tool name → silent no-op masks failure | Tampering / Repudiation | D-16 hard error fed back to model AND surfaced in UI (this is a security requirement, not just UX). |
| Malformed/oversized GeoJSON arg (DoS via huge coordinate arrays) | Denial of Service | Existing `MAX_GEOJSON_TEXT_CHARS` cap (`helpers.ts`); keep enforcing at the API boundary; bound buffer/circle radius. |
| Authoring API leaks editor internals (store/signer reachable) → future sandbox escape | Elevation of Privilege | D-07 strict layering + boundary test asserting the API surface exposes only geometry ops; no `useEditorStore`/signer/wallet re-export from `api/`. |
| Unbounded turf computation (giant buffer steps) freezes main thread | Denial of Service | Bound `steps`/radius; (off-thread execution is Phase 7's concern, note for forward-coupling). |

## Sources

### Primary (HIGH confidence)
- Live code inspection (2026-06-16): `execute.ts`, `helpers.ts`, `commands.ts`, `definitions.ts`, `GeoEditor.ts`, `editorCoreSlice.ts`, `Editor.tsx`, `EarthlyGeoServerClient.ts`, `store.ts`, `utils.ts`, `DrawButtonGroup.tsx`, `GeoEditorView.tsx` (grep'd call sites).
- `@turf/turf` 7.3.5 — `circle`/`buffer` signatures verified by local Node execution.
- `@modelcontextprotocol/sdk` 1.29.0 — `listTools` + `setNotificationHandler` confirmed in `node_modules/.../client/index.js`.
- `@contextvm/sdk` 0.9.1 — `isStateless` emulation + incoming-event routing verified in `nostr-client-transport.js`.
- `.planning/codebase/TESTING.md` — Bun test conventions, zero-tests baseline.
- `.planning/REQUIREMENTS.md` (SAFE-01…SAFE-06 forward-coupling), `.planning/PROJECT.md` (Pillar-3 standalone-API motivation), `.planning/config.json`.

### Secondary (MEDIUM confidence)
- MEMORY notes: tsc baseline (~305 pre-existing errors, not a gate); applesauce migration done.

### Tertiary (LOW confidence)
- A1/A2 assumptions (live server `tools/list` support; push-notification reliability) — not network-tested this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages installed; turf signatures executed; SDK capabilities grep-confirmed.
- Architecture (registry + Authoring API + read-mirror): HIGH — every claim maps to a cited file/line; the event-mirror and co-located-registry patterns already exist in-tree.
- D-05 tool-discovery: MEDIUM — client capability HIGH (verified), live-server support LOW (A1, needs spike).
- Pitfalls: HIGH — derived directly from inspecting `setFeatures` (no emit), `Editor.tsx` dual sync, and stateless transport code.
- Validation: HIGH on strategy; gap is that no test infra exists yet (Wave 0 builds it).

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable internal codebase; re-verify only if `EarthlyGeoServerClient`, `GeoEditor` event API, or turf major version changes)
