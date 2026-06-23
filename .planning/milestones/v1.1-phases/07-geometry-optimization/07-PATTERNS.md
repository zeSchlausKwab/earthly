# Phase 7: Geometry Optimization - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 9 (4 new in `chat/geometry/`, 1 new tool registrar, 4 additive edits)
**Analogs found:** 9 / 9 (every new/modified file has an exact in-repo precedent)

Phase 7 is an ORCHESTRATION layer over existing geometry primitives — almost no new
geometry code. Every analog below was read this session; line numbers are current.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/features/chat/geometry/optimize.ts` (NEW) | service (pure compute) | transform / batch | `src/features/chat/ingest/parse.ts` (pure helpers) + `featureHelpers.ts` + `geometryValidation.ts` | role + flow exact (composes existing pure helpers) |
| `src/features/chat/geometry/optimize.worker.ts` (NEW) | worker shell | request-response (off-thread) | `src/features/chat/ingest/ingest.worker.ts` | EXACT |
| `src/features/chat/geometry/optimizeClient.ts` (NEW) | service (RPC client) | request-response (off-thread) | `src/features/chat/ingest/ingestClient.ts` | EXACT |
| `src/features/chat/geometry/types.ts` (NEW) | types | — | `src/features/chat/ingest/types.ts` | EXACT |
| `src/features/chat/tools/geometry-tools.ts` (NEW) | tool registrar | request-response (gated) | `src/features/chat/tools/bulk-tools.ts` (`registerBulkTools` + `gateBulkApply`) | EXACT |
| `src/lib/workers/workerAssets.ts` (EDIT) | config | — | the `WORKER_ASSETS` map itself (`workerAssets.ts:45`) | EXACT (additive entry) |
| `src/features/chat/tools/registry.ts` (EDIT) | config (bootstrap) | — | `bootstrapRegistry()` (`registry.ts:1068`) | EXACT (additive call) |
| `src/features/chat/safeEditing/gateBulkEdit.ts` (EDIT) | service (gate) | request-response | itself (`gateBulkApply`, `gateBulkEdit.ts:70`) | EXACT (additive `headline` param) |
| `src/features/chat/safeEditing/pendingDiffStore.ts` (EDIT) | store | event-driven | itself (`EmitDiffBlockOptions`/`PendingDiffEntry`) | EXACT (additive field) |
| `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (EDIT) | component | — | itself (`buildDatasetDiffSummary`, line 40) | EXACT (additive headline branch) |

---

## Shared Patterns (cross-cutting — apply to ALL new files)

### Worker serving seam — MANDATORY (avoids the file:// + missing-chunk landmines)
**Source:** `src/lib/workers/workerAssets.ts:45-73`, `build.ts:270-274`
**Apply to:** `optimize.worker.ts`, `optimizeClient.ts`, `workerAssets.ts` edit

NEVER use `new Worker(new URL('./optimize.worker.ts', import.meta.url))` — broken in
dev (Bun #17705, resolves to `file://`) AND prod (Bun #7534, non-existent `.ts`). Register
one entry and spawn from the stable origin-rooted string. The map is iterated by both the
dev `/workers/:name` route and the prod build, so one entry suffices:

```typescript
// EDIT workerAssets.ts:45 — add ONE entry (mirrors ingest entry at :50)
export const WORKER_ASSETS = {
  sandbox: { /* … */ },
  ingest: { servedName: 'ingest.worker.js', sourcePath: 'src/features/chat/ingest/ingest.worker.ts' },
  geoJsonParse: { /* … */ },
  optimize: {
    servedName: 'optimize.worker.js',
    sourcePath: 'src/features/chat/geometry/optimize.worker.ts',
  },
} as const satisfies Record<string, WorkerAsset>
```
Verify: `bun run build` emits `dist/workers/optimize.worker.js` (`build.ts:270` loops the map).

### Leaf-imports-ONLY in the worker — secret/pino boundary
**Source:** `.planning/debug/sandbox-worker-file-url-dev.md` (SECONDARY ROOT CAUSE), confirmed by
`geometryValidation.ts:24-28` boundary docstring (imports ONLY `EditorFeature` type + `predicate` + `@turf/turf`).
**Apply to:** `optimize.ts`, `optimize.worker.ts`

The worker MUST import only leaf modules. NEVER `@/features/geo-editor/api` (the barrel) — it
transitively drags `createAuthoring → GeoEditor → Nostr → Node pino` (~2MB, throws on load in a
browser Worker). Safe leaf imports for `optimize.ts`:
- `@turf/turf` (worker-safe, already used by `geometryValidation.ts:30` and `TransformManager`)
- `@/features/geo-editor/core/utils/featureHelpers` (pure: `extractGeometryParts`, `toMultiGeometryType`, `getBaseGeometryType`, `normalizeLineCoordinates`, `mergeLinePartsBySharedEndpoints`)
- `@/lib/geo/geometry` (`countGeometryVertices`, `isSimplifiableGeometryType`)
- `@/features/geo-editor/api/geometryValidation` (`validateGeometryFeatures` — verified pure/editor-free, `geometryValidation.ts:115`)
- `@/features/geo-editor/constants` (`BLOSSOM_UPLOAD_THRESHOLD_BYTES:26`, `NON_CUSTOM_EDITOR_PROPERTY_KEYS:40`)

### Byte measurement — must match the publish gate exactly
**Source:** `SimplifyDialog.tsx:25,52-59` (`new TextEncoder().encode(JSON.stringify({type:'FeatureCollection',features})).length`); same method as `usePublishing.getCollectionSize`.
**Apply to:** `optimize.ts` budget comparison and the before/after report. Use this EXACT serialization so the optimizer's bytes compare apples-to-apples with `usePublishing.isOverSizeLimit`.

### No `editor.*` from `chat/**` — route every mutation through the gate
**Source:** `bulk-tools.ts:504-507` (uses `deleteFeaturesById(editor, …)` facade helper, never a raw verb), `gateBulkEdit.ts:27-31` docstring.
**Apply to:** `geometry-tools.ts`. The converged result applies ONLY via `gateBulkApply` → `createAuthoring`/facade → `runInterceptors`. The A3 boundary scan forbids literal `editor.deleteFeatures(`-style tokens in chat code.

---

## Pattern Assignments

### `src/features/chat/geometry/types.ts` (NEW — types)
**Analog:** `src/features/chat/ingest/types.ts` (read in full)

Mirror the discriminated `{ id, success, ... }` request/response contract verbatim. Each
response carries the originating `id` + a `success` flag so the client keys pending requests
and no error throws out of `onmessage`. Add an `OptimizeReport` for the before/after metrics.

```typescript
// Mirror ingest/types.ts:20-48 shape
export interface OptimizeRequest {
  id: string
  featureCollection: { type: 'FeatureCollection'; features: EditorFeature[] }
  targetBytes?: number
}
export interface OptimizeReport {
  bytesBefore: number; bytesAfter: number
  verticesBefore: number; verticesAfter: number
  featuresBefore: number; featuresAfter: number
  microgapJoins: number
  reachedBudget: boolean            // false → D-07 best-effort honest report
  // baseline topology counters for the D-06 relative-reject report
}
export interface OptimizeResponse {
  id: string
  success: boolean
  result?: { type: 'FeatureCollection'; features: EditorFeature[] }
  report?: OptimizeReport
  error?: string                    // present iff success === false
}
```

---

### `src/features/chat/geometry/optimize.worker.ts` (NEW — worker shell)
**Analog:** `src/features/chat/ingest/ingest.worker.ts` (read in full, 62 lines)

A thin `self.onmessage` shell over the pure `./optimize` module so the heavy logic is unit-testable
WITHOUT a real Worker (exactly how `ingest.worker.ts` defers to `./parse`). Wrap in try/catch;
NEVER throw out of the handler — always post `{ id, success:false, error }`.

```typescript
// Mirror ingest.worker.ts:14-62 — LEAF IMPORTS ONLY (never the api barrel — pino landmine)
import { optimize } from './optimize'
import type { OptimizeRequest, OptimizeResponse } from './types'

self.onmessage = (event: MessageEvent<OptimizeRequest>) => {
  const { id, featureCollection, targetBytes } = event.data
  try {
    const { result, report } = optimize(featureCollection, targetBytes)
    self.postMessage({ id, success: true, result, report } satisfies OptimizeResponse)
  } catch (error) {
    self.postMessage({
      id, success: false,
      error: error instanceof Error ? error.message : 'Optimize failed',
    } satisfies OptimizeResponse)
  }
}
```

---

### `src/features/chat/geometry/optimizeClient.ts` (NEW — host RPC client)
**Analog:** `src/features/chat/ingest/ingestClient.ts` (read in full, 245 lines)

Clone the no-freeze machinery so the promise ALWAYS settles. Note the analog's DOCSTRING (lines
6-9) still describes the old `new URL(..., import.meta.url)` form, but the ACTUAL code at
`ingestClient.ts:146` uses `workerUrl('ingest')` — mirror the CODE, not the stale docstring.

**Spawn pattern** (`ingestClient.ts:133-146`):
```typescript
import { workerUrl } from '@/lib/workers/workerAssets'
import { optimize } from './optimize' // SAME pure fn the worker uses → paths can't diverge
function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  worker = new Worker(workerUrl('optimize'), { type: 'module' }) // origin-rooted string, NOT new URL(...)
  // ...
}
```

**Pending-map + sync-fallback machinery to copy** (`ingestClient.ts:69-73,148-173,183-234`):
- id-keyed `pendingRequests` Map (`ingestClient.ts:72`) — concurrent calls never cross-talk.
- `worker.onerror` (`:156-166`) sync-falls-back every pending request, latches `workerBroken = true`, terminates.
- 30s per-request `setTimeout` (`:220-232`) → sync fallback so a hung worker still settles.
- Shared `parseSync`/`optimizeSync` calling the SAME pure `optimize()` so worker + fallback can't diverge (`:82-119`).
- NO transferable-buffer complexity needed (that's xlsx-only in the analog; the FeatureCollection is structured-cloned plainly — see Pitfall 5 in RESEARCH).

---

### `src/features/chat/geometry/optimize.ts` (NEW — pure pipeline + binary search)
**Analogs (composes, does not reimplement):**
- merge-to-multi: `featureHelpers.ts` — `getBaseGeometryType:17`, `extractGeometryParts:38`, `toMultiGeometryType:25`
- microgap stitch: `featureHelpers.ts` — `normalizeLineCoordinates:105`, `mergeLinePartsBySharedEndpoints:110`
- topology guardrail: `geometryValidation.ts:115` `validateGeometryFeatures` (+ `withSelfIntersections`/`withZeroArea` counters, lines 53-59)
- simplify: `turf.simplify(feature, { tolerance, highQuality: true })` (precedent `TransformManager.simplify`)
- vertex count: `geometry.ts:19` `countGeometryVertices`
- bounds: `SimplifyDialog.tsx:22-24` `SIMPLIFY_TOLERANCE_MIN=1e-8`, `SIMPLIFY_TOLERANCE_MAX=1e-3`, default `0.0001`
- byte measure: `SimplifyDialog.tsx:52-59`

**The lossy-merge bug to NOT reuse (D-05):** `CombineManager.combineSelectedFeatures()` at
`CombineManager.ts:43` does `const template = cloneFeature(selected[0])` then spreads it onto the
multi — keeping ONLY the first feature's properties and discarding the rest. The optimizer must
NOT call this; it needs its own LOSSLESS identical-props merge. Compose the SAME pure helpers
`CombineManager` uses (`extractGeometryParts`/`toMultiGeometryType`, imported `CombineManager.ts:4-11`)
but group by `(baseGeometryType, canonicalPropsKey)` and only merge within identical-props groups.
Strip editor-internal keys (`NON_CUSTOM_EDITOR_PROPERTY_KEYS`, `constants.ts:40`; plus `featureId`/`meta`
which `normalizeFeature` re-stamps on apply, `featureHelpers.ts:8-15`) before comparing props.

**Pipeline order (D-02):** stitch microgaps (tol `0.00001`) → identical-props merge → binary-search
simplify tolerance to budget. Stitch+merge run ONCE up front; only simplify is tolerance-searched.

**Binary search (D-03 / D-06):** geometric mid `sqrt(lo*hi)` over the log-scaled tolerance; reject any
step that INCREASES topology problems RELATIVE to the post-stitch/merge baseline (validate baseline
ONCE up front — Pitfall 3: a messy import may already have kinks; reject only NEW ones). Honor the
`SIMPLIFY_TOLERANCE_MAX` ceiling. `best === null` → budget unreachable → return gentlest VALID
candidate + `reachedBudget:false` honest report (D-07, no throw, no silent truncation).

---

### `src/features/chat/tools/geometry-tools.ts` (NEW — tool registrar)
**Analog:** `src/features/chat/tools/bulk-tools.ts` (read in full)

Use the INJECTED-`register` idiom: import ONLY `type ToolEntry` from `./registry`, receive `register`
as a parameter (`bulk-tools.ts:54-55,310`). A value import of `register` forms the Phase-2 circular-init
cycle that crashes the dev bundler (Pitfall 6).

**`requireEditor()` idiom** (`bulk-tools.ts:89-95`): resolve `useEditorStore.getState().editor` or throw a
self-correctable error.

**Read the FULL bound set** (SAFE-05): `editor.getAllFeatures()` — never the model's compacted view
(`bulk-tools.ts:319-321`).

**Gate-apply path** (`bulk-tools.ts:376-383` for the `gateBulkApply` call shape):
```typescript
const editor = requireEditor()
const all = editor.getAllFeatures()
const budget = typeof args.targetBytes === 'number' && args.targetBytes > 0
  ? args.targetBytes : BLOSSOM_UPLOAD_THRESHOLD_BYTES   // V5: validate finite/positive, clamp, default
const { result, report } = await runOptimize({ type: 'FeatureCollection', features: all }, budget)

const outcome = await gateBulkApply(
  editor,
  { getSafetyLevel, label: 'Optimize geometry', headline: buildOptimizeHeadline(report) }, // NEW headline dep
  'modify',
  () => { applyOptimizedCollection(editor, result) }, // routes through createAuthoring facade — NOT raw editor.*
)
return { cancelled: outcome.status === 'cancelled', ...report }
```
Apply representation: approach (a) replace-in-place, headline is the truth (RESEARCH Pattern 3 / Open
Question 1) — `classifyMutation` is id-keyed and merge mints new ids, so the per-row list is secondary.
**Schema:** only model-facing arg is optional `targetBytes` (D-04); add via `schemaFor('optimize_geometry')`
mirroring `bulk-tools.ts:315`. Tool `kind: 'authoring-primitive'` (matches the destructive bulk tools).

**Register it** — EDIT `registry.ts`: add `import { registerGeometryTools } from './geometry-tools'`
(mirror line 29) and call `registerGeometryTools(register)` in `bootstrapRegistry()` after line 1089
(mirror the `registerBulkTools(register)` call).

---

## Additive edits to the safe-editing layer (the ONE new plumbing piece — metrics headline, D-04b)

Keep ALL three edits backward-compatible: Phase 5/6 callers pass no `headline`, so the existing
count/`restyled` logic must stay the fall-through. Phase 5/6 diff tests must remain green.

### `src/features/chat/safeEditing/pendingDiffStore.ts` (EDIT)
**Self-analog:** `EmitDiffBlockOptions` (`pendingDiffStore.ts:45-51`), `PendingDiffEntry` (`:32-39`), `emitDiffBlock` (`:83-88`).
Add optional `headline?: string` to `EmitDiffBlockOptions` and `PendingDiffEntry`; carry it through
`emitDiffBlock` into the stored entry (`:85`).

### `src/features/chat/safeEditing/gateBulkEdit.ts` (EDIT)
**Self-analog:** `GateBulkDeps` (`gateBulkEdit.ts:39-44`), every `emitDiffBlock(diff, …)` call (`:108,119,124`).
Add optional `headline?: string` to `GateBulkDeps`; thread it into every `emitDiffBlock` call so the
optimization's metrics headline reaches the disclosure. Signature stays additive (callers without it unaffected).

### `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (EDIT)
**Self-analog:** `buildDatasetDiffSummary` (`DatasetDiffDisclosure.tsx:40-55`) — note it already special-cases
`~N restyled` (Phase 6 D-02), the exact precedent for a per-kind headline branch. Thread an optional
`headline` prop (from the `PendingDiffEntry`) and, when present, render it in place of the count string;
else fall through to the existing `restyled`/counts logic (lines 45-54). The summary is consumed at line 119
(`useMemo`) and rendered at line 140.

---

## No Analog Found

None. Every Phase-7 file has an exact in-repo precedent.

## Metadata

**Analog search scope:** `src/features/chat/{ingest,tools,safeEditing,geometry}/`,
`src/features/geo-editor/{core/managers,core/utils,api,components/toolbar,hooks,constants.ts}/`,
`src/lib/{workers,geo}/`, `build.ts`
**Files scanned/read:** 14
**Pattern extraction date:** 2026-06-22
