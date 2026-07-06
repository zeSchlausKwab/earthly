# Phase 2: Tool Registry & Authoring API - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 14 (5 new groups + 9 modified)
**Analogs found:** 11 / 14 (2 first-of-its-kind: test harness, mcp-sync)

> **Two strongest reuse anchors (build on these, do NOT reinvent):**
> 1. **`src/features/geo-editor/commands.ts`** — already a co-located `{schema + handler + metadata}` mini-registry (`EditorCommandDefinition`, `getEditorAiToolDefinitions()`, `executeEditorAiTool()`). This IS the template for the unified registry (D-01). Generalize it with a `kind` discriminator (D-03) and `register`/`unregister` (D-04).
> 2. **`src/features/geo-editor/components/Editor.tsx:65-67`** — already subscribes to GeoEditor `create`/`update`/`delete` and mirrors into the store. This IS the D-09 one-way read-mirror chokepoint. Extend it; do not invent a new sync.

---

## Line-Drift Corrections (verified against live code 2026-06-16)

| Cited (CONTEXT/RESEARCH) | Live reality | Correction |
|--------------------------|--------------|------------|
| `GeoEditor.addFeature` "needs event emission added" (~1111-1117) | `addFeature` at **1111**; **already emits `create` at line 1116** | ✅ No change needed to `addFeature`. Emission gap is **only** in `setFeatures`. |
| `setFeatures` emits no event (~1493) | Confirmed: **`setFeatures` 1493-1501** calls `render()`/`renderVertices()`, **no `emit`** | ✅ Accurate. This is the real gap. |
| `execute.ts:786` unknown-tool throw; `default` at 780-787 | Confirmed: `default:` **780**, `throw` **786**, `executeEditorAiTool` dispatch **781** | ✅ Accurate. Entry fn is `executeToolCall` at **162**, switch at **173**. |
| `helpers.ts:735-776` dual-write; store write 747-748 | Confirmed: `importFeaturesToEditor` **735**; `editor.setFeatures` **747** + store `setFeatures` **748**; `editor.addFeature` **766** | ✅ Accurate. |
| `GeoEditorView.tsx` addFeature ~1249, 1413, 2120 | Confirmed exactly: **1249**, **1413**, **2120** | ✅ Accurate (note 2120 wraps with `toEditorFeature`). |
| model-loop error feedback `store.ts:1469-1479` | `executeToolCall` call at **1469**; tool message appended **1474-1487** | ✅ Effectively accurate (loop body 1467-1520). |
| `executeEditorAiTool` lives in `commands.ts` | Defined in `commands.ts:577`; **re-exported via `definitions.ts:19`**; `execute.ts:49` imports it from `./definitions` | ⚠️ Import path indirection — registry must replace BOTH the re-export and the `definitions.ts:7` import. |
| `editorCoreSlice setFeatures` ~21-43 (plain mirror) | Confirmed **21-43**, but it does **draft persistence + `isDirty` + `updateStats()`** | ⚠️ Read-mirror must PRESERVE these side-effects (D-09), not just `set({features})`. |
| `Editor.tsx:148-154` reverse store→editor sync | Confirmed: stringify-diff push at **150-152**; also a manual re-render via `setFeatures` at **196** | ✅ Accurate — loop risk is real (Pitfall 2). |
| `DrawButtonGroup.tsx` direct `editor.addFeature` write path | **No `addFeature` calls** — it only sets modes; geometry is created inside GeoEditor click handlers (which already emit `create`) | ⚠️ D-08 toolbar concern is the GeoEditor internal draw path, NOT DrawButtonGroup. The 3 `GeoEditorView` sites are the only direct UI `addFeature` calls. |

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `geo-editor/api/authoring.ts` (NEW) | service/facade | transform + CRUD | `commands.ts` + GeoEditor mutators | role-match |
| `geo-editor/api/primitives.ts` (NEW) | utility | transform | `helpers.ts` turf usage (16-25) | partial (same turf idiom) |
| `geo-editor/api/interceptor.ts` (NEW) | middleware | event-driven | none (D-12 scaffold) | no analog |
| `geo-editor/api/results.ts` (NEW) | model/types | — | `EditorCommandExecutionResult` (commands.ts:24) | role-match |
| `chat/tools/registry.ts` (NEW) | service/registry | request-response | `commands.ts` mini-registry | exact |
| `chat/tools/errors.ts` (NEW) | model/types | — | `execute.ts:806-820` error JSON | role-match |
| `chat/tools/mcp-sync.ts` (NEW, last wave) | service | request-response / poll | `EarthlyGeoServerClient` | partial |
| `geo-editor/api/*.test.ts` (NEW) | test | — | **none — zero-test baseline** | no analog |
| `chat/tools/execute.ts` (MOD) | controller/dispatch | request-response | self (switch → dispatch) | — |
| `chat/tools/definitions.ts` (MOD) | config | — | self (static → derived) | — |
| `chat/tools/helpers.ts` (MOD) | utility | CRUD | self (remove dual-write) | — |
| `geo-editor/commands.ts` (MOD) | registry | request-response | self (self-register) | — |
| `geo-editor/core/GeoEditor.ts` (MOD) | model/engine | event-driven | self (`setFeatures` emit) | — |
| `geo-editor/store/editorCoreSlice.ts` (MOD) | store | event-driven | self (write → read-mirror) | — |
| `geo-editor/GeoEditorView.tsx` (MOD) | component | CRUD | self (reroute 3 sites) | — |

---

## Pattern Assignments

### `chat/tools/registry.ts` (NEW — registry, request-response)  ⭐ PRIMARY ANCHOR

**Analog:** `src/features/geo-editor/commands.ts` (co-located schema+handler, EXACT match)

**Co-location entry shape** (commands.ts:49-60) — generalize by adding mandatory `kind` (D-03):
```typescript
export interface EditorCommandDefinition {
  id: EditorCommandId
  label: string
  description: string
  canExecute?: (state: EditorStoreSnapshot) => boolean
  execute: (state: EditorStoreSnapshot, args: EditorCommandArgs) => EditorCommandExecutionResult // handler
  ai?: { toolName: string; description: string; parameters?: EditorCommandToolParameters }       // schema
}
```
New registry entry generalizes to: `{ name, schema (OpenAI Tool), handler, kind: 'editor'|'host-builtin'|'remote-mcp'|'authoring-primitive'|'nostr-scroll', origin? }`. Make `kind` a **required** field (compile error if omitted — Pitfall 5).

**Advertise layer** (commands.ts:567) — `getEditorAiToolDefinitions()` derives advertised defs; generalize into `registry.advertise()` (D-06, decoupled from dispatch).

**Dispatch** (commands.ts:577) — `executeEditorAiTool(toolName, args)` looks up by name → returns result | null. Generalize into `registry.dispatch(name, args)`; **unknown name → `ToolError(unknown_tool)` instead of null** (D-16, INFRA-01 hard error).

---

### `chat/tools/execute.ts` (MODIFY — dispatch controller)

**Current:** `executeToolCall` (line 162) → `switch (toolCall.function.name)` (173) → 24 named cases → `default:` (780) calls `executeEditorAiTool` (781) → `throw new Error(\`Unknown tool: …\`)` (786).

**Change:** Replace the entire switch with `registry.dispatch(name, args)`. The `default`→`executeEditorAiTool` fallthrough disappears (editor commands self-register, D-01). Unknown tool now yields a structured `ToolError`, not a bare throw.

**Error return pattern to preserve+upgrade** (execute.ts:806-820):
```typescript
} catch (error) {
  const argumentPreview = rawArguments.length > 240 ? `${rawArguments.slice(0,240)}...` : rawArguments
  return {
    tool_call_id: toolCall.id,
    role: 'tool',
    content: JSON.stringify({ tool: toolCall.function.name, error: ..., argumentsPreview: argumentPreview }),
  }
}
```
Keep this `role:'tool'` shape (the model loop at `store.ts:1469-1487` consumes `.content` + `.tool_call_id`), but serialize a typed `ToolError` (errors.ts) so chat UI can render it distinctly (D-16).

---

### `chat/tools/errors.ts` (NEW — error contract types)

**Analog:** inline error JSON at `execute.ts:806-820` (formalize it).
```typescript
interface ToolError {
  kind: 'unknown_tool' | 'handler_error'
  toolName: string
  message: string
  origin?: string            // remote-mcp failures: SERVER_PUBKEY
  argumentsPreview?: string
}
```
Fed back to model loop (`store.ts:1469`) AND surfaced in chat UI (D-16).

---

### `geo-editor/api/authoring.ts` (NEW — facade, D-07/D-10)  ⭐ SECONDARY ANCHOR

**Analog:** GeoEditor mutators (`addFeature` 1111, `setFeatures` 1493) + `importFeaturesToEditor` (helpers.ts:735).

**MUST reuse, never reimplement** (Pitfall 4 — criterion #2 binding):
- `toEditorFeature()` from `@/features/geo-editor/utils` (helpers.ts:14) for normalization/source-tagging.
- dedup-by-id logic verbatim from `importFeaturesToEditor`.

**Replace-path pattern** (the dual-write being removed — helpers.ts:735-766):
```typescript
export function importFeaturesToEditor(features, replaceExisting) {
  const { editor, setFeatures } = useEditorStore.getState()  // ← store handle to DELETE
  if (replaceExisting) {
    editor.setFeatures(normalized)   // line 747 — keep (via authoring)
    setFeatures(normalized)          // line 748 — REMOVE (D-09; mirror catches it)
  } else {
    for (...) editor.addFeature(feature)  // line 766 — keep (via authoring)
  }
}
```
After refactor, `authoring.*` is the ONLY caller of `editor.addFeature/setFeatures`. `authoring/` imports **nothing** from chat/registry/Nostr (D-07 — boundary test enforces).

**Result-object shape** (D-11) — analog `EditorCommandExecutionResult` (commands.ts:24-32). Every mutating method returns:
```typescript
interface MutationResult {
  ok: boolean
  intent: 'add' | 'modify' | 'delete'   // D-12
  featureIds: string[]
  counts: { created: number; updated: number; deleted: number; skippedDuplicates: number }
}
```

---

### `geo-editor/api/primitives.ts` (NEW — circle/buffer, TOOLS-01)

**Analog:** existing turf import idiom in `helpers.ts:16-25` (named aliased imports from `@turf/turf`). `circle`/`buffer` present but unused.
```typescript
import { circle, buffer } from '@turf/turf'
// circle([lon,lat], radius, { units }) → Feature<Polygon>   (no default radius — D-14)
// buffer(geojsonOrGeom, distance, { units }) → Feature | undefined  ← MUST null-check (D-16 ToolError)
```
Buffer-by-id (D-15): resolve via `editor.getFeature(id)`, pass geometry to `buffer`, `authoring.addFeature` result, return source+new ids. Both draw immediately AND return `MutationResult`.

---

### `geo-editor/api/interceptor.ts` (NEW — D-12 scaffold, NO analog)

Middleware pipeline + intent enum `add | modify | delete`. Build the SHAPE only; no Phase 5 diff/preview/persistence UI. Forward-coupled to SAFE-01…SAFE-06.

---

### `geo-editor/core/GeoEditor.ts` (MODIFY — emit on bulk replace)

**Current `setFeatures` (1493-1501) — emits nothing:**
```typescript
setFeatures(features: EditorFeature[]): void {
  this.features.clear()
  features.forEach((feature) => { const n = this.normalizeFeature(feature); this.features.set(n.id, n) })
  this.render()
  if (this.mode === 'edit') this.renderVertices()
}   // ← no emit — the read-mirror miss (Pitfall 1)
```
**Pattern to copy** — `addFeature` already does it right (1116): `this.emit('create', { type:'create', features:[normalized] })`. Add an analogous emit to `setFeatures` (e.g. `this.emit('update', { type:'update', features:[...] })` or a new `features.replace` type) so `Editor.tsx` mirror catches bulk replace. `emit`/`on`/`off` defined at 1610/1542/1549.

---

### `geo-editor/store/editorCoreSlice.ts` (MODIFY — write → read-mirror, D-09)

**Current `setFeatures` (21-44)** does more than mirror — **preserve these side-effects** when it becomes the event-driven mirror sink:
- draft persistence (`writePersistedGeoCollectionDraftState`, line 36)
- `isDirty: true` (line 39)
- `get().updateStats()` (line 43)

Callers stop invoking it directly; the `Editor.tsx` event subscription feeds it from `editor.getAllFeatures()`.

---

### `geo-editor/components/Editor.tsx` (the D-09 mirror — EXTEND, don't reinvent)  ⭐ ANCHOR

**Existing mirror (43-67):**
```typescript
const setFeatures = useEditorStore((state) => state.setFeatures)   // line 16
const updateFeatures = () => setFeatures(editor.getAllFeatures())  // line 44
editor.on('create', updateFeatures)  // 65
editor.on('update', updateFeatures)  // 66
editor.on('delete', updateFeatures)  // 67
```
This is the single chokepoint Phase 5's gate hooks. Once `setFeatures` (GeoEditor) emits, this catches bulk replace too — then delete the store write in `importFeaturesToEditor:748`.

**⚠️ Reverse-sync loop hazard (150-152, Pitfall 2):**
```typescript
const current = editorRef.current.getAllFeatures()
if (JSON.stringify(current) !== JSON.stringify(storeFeatures)) {
  editorRef.current.setFeatures(storeFeatures)   // store → editor reverse push
}
```
With the new one-way mirror this can round-trip. Guard with a ref flag so Authoring-API-originated updates skip the reverse push, OR narrow it to external dataset loads only (Open Question 2).

---

### `geo-editor/GeoEditorView.tsx` (MODIFY — reroute 3 UI write sites, D-08)

Direct `editor.addFeature` at **1249**, **1413**, **2120** (2120 wraps `toEditorFeature(feature)`). Reroute each through `authoring.addFeature`. After: grep for `editor.addFeature|setFeatures` outside `api/` + GeoEditor core must return zero hits (boundary test, A3 mitigation).

---

### `chat/tools/definitions.ts` (MODIFY — static → derived, D-04)

`geoTools` static array at **21**; `editorCommandTools` derived at **10** (already maps `getEditorAiToolDefinitions()`); MCP tools `search_location` (139), `reverse_lookup` (161) **hardcoded** (D-05 target). Make the whole advertised list derived from `registry.advertise()`. Note the `executeEditorAiTool` re-export at **19** and import at **7** both go away under unification.

---

### `chat/tools/mcp-sync.ts` (NEW — last/isolable wave, D-05, NO direct analog)

Poll-based `client.listTools()` refresh → `registry.register(kind:'remote-mcp', origin: SERVER_PUBKEY)`. ⚠️ Start wave with a `checkpoint:human-verify` spike (A1: live server `tools/list` support unverified). Do NOT use push notifications (Pitfall 3, stateless transport). Deferrable without sinking INFRA-01/02/03 + TOOLS-01.

---

## Shared Patterns

### Co-located schema+handler registry
**Source:** `commands.ts:49-60` (`EditorCommandDefinition`) + `:567`/`:577` derive/dispatch.
**Apply to:** `registry.ts` and every migrated tool entry.

### Event-driven one-way read-mirror
**Source:** `Editor.tsx:43-67` (`editor.on('create'|'update'|'delete')` → store).
**Apply to:** all geometry mutations (D-09). The single store-write chokepoint.

### turf import idiom
**Source:** `helpers.ts:16-25` (named aliased imports from `@turf/turf`).
**Apply to:** `primitives.ts` (`circle`, `buffer`).

### Structured tool result / error
**Source:** `EditorCommandExecutionResult` (commands.ts:24) for results; `execute.ts:806-820` for the `role:'tool'` JSON envelope.
**Apply to:** `MutationResult` (D-11), `ToolError` (D-16).

### Battle-tested arg parsing (reuse, don't rebuild)
**Source:** `parseToolCallArguments` (helpers.ts:700) + truncation repair + `MAX_GEOJSON_TEXT_CHARS` cap (helpers.ts:31/553).
**Apply to:** registry dispatch input validation (V5 security control). Do NOT introduce zod into the dispatch hot path.

### Feature normalization (reuse verbatim — criterion #2)
**Source:** `toEditorFeature()` (`@/features/geo-editor/utils`, imported helpers.ts:14).
**Apply to:** Authoring API write paths. Reimplementing it breaks behavior preservation (Pitfall 4).

### Conventions (CONVENTIONS.md)
Tabs, single quotes, no-semicolons (Biome); `import type` for types (`verbatimModuleSyntax`); `@/` for cross-feature, relative within feature; named exports; SCREAMING_SNAKE constants; error narrowing `error instanceof Error ? error.message : 'fallback'`.

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `geo-editor/api/*.test.ts` (golden/primitives/mirror/boundary) | test | **Zero-test baseline** (TESTING.md). First-of-its-kind. Needs headless GeoEditor harness (mock MapLibre `map`) — allow spike time. |
| `chat/tools/registry.test.ts`, `errors.test.ts`, `commands.test.ts` | test | Same — no existing test to copy from. Use Bun `bun:test`. |
| `geo-editor/api/interceptor.ts` | middleware | No middleware/interceptor pattern exists in-tree; D-12 net-new scaffold. |
| `chat/tools/mcp-sync.ts` | service | No tool-discovery code exists; MCP tools currently hardcoded. |

---

## Metadata

**Analog search scope:** `src/features/chat/tools/`, `src/features/geo-editor/{core,components,store}/`, `commands.ts`, `helpers.ts`, `definitions.ts`, `GeoEditorView.tsx`, `editorCoreSlice.ts`.
**Files scanned:** ~12 (all line numbers re-verified live).
**Pattern extraction date:** 2026-06-16
