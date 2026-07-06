# Phase 7: Geometry Optimization - Research

**Researched:** 2026-06-22
**Domain:** Off-thread GeoJSON byte-budget convergence (orchestration over existing turf primitives) in a Bun + React 19 client
**Confidence:** HIGH (all claims grounded in current source read this session; no new external packages)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** ONE deterministic host-side `optimize_geometry` tool drives the loop — NOT the model calling per-op tools in a loop. Host owns the pipeline, operates over ALL bound features by id (`editor.getAllFeatures()`), never the model's compacted view. Off-thread execution is a hard constraint; precedent is `ingest.worker.ts`.
- **D-02:** Fixed full pipeline in fixed order — **stitch microgaps → merge-to-multi → simplify**. Each stage is a no-op when inapplicable. NOT "AI selects stages", NOT "host auto-selects per geometry type".
- **D-03:** Binary-search the simplify tolerance to land *just under* the byte budget (fewest vertices removed). Bounded iterations. Stops early if the quality guardrail (max tolerance / topology break, D-06) is hit. Only simplify is tolerance-searched; **stitch + merge run ONCE up front** before the search.
- **D-04:** The tool's ONLY model-facing arg is an optional target byte budget. Everything else (stages, tolerance bounds, microgap threshold) is host-internal. **Default budget = `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (1MB)**.
- **D-04b:** ONE before/after preview as a SINGLE Phase-5 gate block — metrics-aware headline + confirm/cancel — applied as ONE undoable snapshot. Model never sees intermediate per-stage states. Reuse `gateBulkApply`; optimization classified `modify`.

### Claude's Discretion (researcher/planner to confirm)
- **D-05 (RECOMMENDED DEFAULT):** Properties must survive merge. `CombineManager.combineSelectedFeatures()` is LOSSY (keeps only first feature's props, `CombineManager.ts:43`) — do NOT reuse it. Recommended: merge ONLY features whose properties are **identical** (lossless). Re-engage user only if identical-only merges too little for the GEO-03 dataset.
- **D-06 (RECOMMENDED DEFAULT):** Topology validation is a HARD gate on the converge loop, plus an aggressiveness ceiling. Reuse `validateGeometryFeatures`. Binary search REJECTS any tolerance step that introduces NEW self-intersections or zero-area collapse relative to input. Hard ceiling on tolerance (`SIMPLIFY_TOLERANCE_MAX`).
- **D-07 (RECOMMENDED DEFAULT):** Optimize → user reviews → user publishes via normal flow. NO auto-publish. Budget unreachable → best-effort + honest report; dataset can still be published via the existing Blossom external-upload path (`BlossomUploadDialog` / `usePublishing.isOverSizeLimit`).
- Worker seam: new `optimize.worker.ts` mirroring `ingest.worker.ts`, vs. another transport — planner decides. Watch the dev-mode worker `file://` landmine.
- Microgap threshold default: reuse `dissolveSelectedLines`' default `0.00001`.
- Binary-search iteration cap + convergence epsilon: small bounded count (~8–12 iterations).
- `optimize_geometry` registrar: `bulk-tools.ts` vs. a new `geometry-tools.ts` — planner's discretion; follow the injected-`register` idiom either way.

### Deferred Ideas (OUT OF SCOPE)
- AI-selected / host-auto-selected pipeline stages.
- Coarse/full param exposure to the model (aggressiveness level, per-stage toggles, tolerance bounds).
- Optional `where` predicate to scope optimization to a feature subset (Phase-6 D-06 predicate engine is the hook if needed later).
- Per-part property array on merged multi-features / merge-by-attribute-group (D-05 alternatives held in reserve).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEO-01 | AI reduces oversized GeoJSON toward a byte budget via simplify + merge-to-multi (+ microgap stitch), off the main thread. | Pure `optimize(fc, budget) → {result, report}` over plain GeoJSON in a new `optimize.worker.ts` (built/served via the existing `WORKER_ASSETS` seam); host drives the deterministic pipeline; result applies back through `gateBulkApply` on the main thread. (Architecture Patterns §1, §2) |
| GEO-02 | Before/after metrics (byte, vertex, feature) + topology validation; properties preserved through merge; microgap join count shown. | Worker computes the `OptimizeReport` (counts via `countGeometryVertices`, byte via `TextEncoder`); `validateGeometryFeatures` (worker-safe) is the topology gate; lossless identical-props merge (D-05); metrics-aware diff headline extends `gateBulkApply`/`DatasetDiffDisclosure`. (Pitfalls §2, §3; Code Examples) |
| GEO-03 | Previously-oversized dataset brought under the limit and published. | Result size feeds `usePublishing.isOverSizeLimit` (`> BLOSSOM_UPLOAD_THRESHOLD_BYTES`); under-limit → normal publish; over-limit → existing `BlossomUploadDialog` escape hatch (D-07). 12MB "West Pacific Trail" is the acceptance fixture. (Validation Architecture) |
</phase_requirements>

## Summary

Phase 7 is an **orchestration layer**, not new geometry. Every geometry primitive the loop needs already exists as a **pure function** that operates on plain coordinate arrays — they are simply currently *wrapped* by manager classes bound to the live MapLibre editor (`SimplifyManager`, `CombineManager`, `LineOperationsManager`). The seam is to extract a pure `optimize(featureCollection, budget) → { result, report }` that calls those same pure leaf helpers over plain GeoJSON inside a Web Worker, then apply the converged result back on the main thread through the existing Phase-6 `gateBulkApply` path. No new npm package is required — `@turf/turf@^7.3.5` is already installed and worker-safe.

The single hard infrastructure constraint is the **worker serving landmine**: the idiomatic `new Worker(new URL('./x.worker.ts', import.meta.url))` form is broken in BOTH this app's Bun dev server and its production build (documented exhaustively in `.planning/debug/sandbox-worker-file-url-dev.md`). The app already solved this with the `WORKER_ASSETS` registry + `/workers/:name` dev route + `dist/workers/` prod emission. Phase 7 MUST reuse that seam verbatim: add one entry to `WORKER_ASSETS`, spawn via `new Worker(workerUrl('optimize'), { type: 'module' })`. A secondary, equally-documented landmine is the **`@/features/geo-editor/api` barrel import** which transitively drags `createAuthoring` → GeoEditor → Nostr → a Node `pino` logger that throws on load inside a browser Worker (~2MB). The worker MUST import only leaf modules (`@turf/turf`, `core/utils/featureHelpers`, `lib/geo/geometry`, `api/geometryValidation`) — never the barrel.

The three "recommended default" decisions all resolve cleanly against current code: (D-05) `CombineManager` IS lossy at line 43 as described — the optimizer must implement its own identical-props merge using the same pure helpers; (D-06) `validateGeometryFeatures` is already pure, holds no editor reference, and is worker-safe; (D-07) `usePublishing.isOverSizeLimit` already gates exactly on the budget constant the tool defaults to.

**Primary recommendation:** Build a pure `optimize()` in a leaf-import-only `optimize.worker.ts` registered through `WORKER_ASSETS`; drive a once-up-front stitch+merge then a weakly-monotonic binary search over simplify tolerance with a `validateGeometryFeatures` reject-step + `SIMPLIFY_TOLERANCE_MAX` ceiling; apply the converged plain-GeoJSON result back through `gateBulkApply(editor, …, 'modify', …)` with a metrics-aware headline; register one `optimize_geometry` tool (target-byte-budget-only arg) in a new `geometry-tools.ts` via the injected-`register` idiom.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Geometry math (simplify/merge/stitch) | Worker thread (pure turf + leaf helpers) | — | GEO-01 mandates off-thread; the math is pure coordinate transforms, no editor/DOM dependency. |
| Byte-budget convergence loop | Worker thread | — | CPU-bound iteration must not block the main thread; reads only plain GeoJSON + the budget number. |
| Topology guardrail | Worker thread (`validateGeometryFeatures`) | — | Already pure/editor-free; runs per-iteration inside the worker to reject bad tolerance steps. |
| Tool registration + dispatch | Main thread (chat registry) | — | `optimize_geometry` is a registry entry like every other tool; spawns the worker, awaits the report. |
| Reading the full bound dataset | Main thread (`editor.getAllFeatures()`) | — | SAFE-05: host owns the id-keyed list; serialized into the worker, never the model's compacted view. |
| Apply + gate + diff/report | Main thread (`gateBulkApply` → facade) | — | All mutation funnels through the Phase-5 interceptor seam; one snapshot, one undo, one diff block. |
| Publish hand-off + size gate | Main thread (`usePublishing`) | UI (`BlossomUploadDialog`) | Publishing stays an explicit user action (D-07); existing size gate + Blossom fallback already built. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@turf/turf` | `^7.3.5` (installed) | `simplify` (Douglas-Peucker), `kinks` (self-intersection), `area` (zero-area) | Already the geometry engine across the codebase (`TransformManager`, `geometryValidation`); worker-safe (pure, no Node deps); confirmed bundles into the existing sandbox worker. `[VERIFIED: package.json + curatedTurf.ts worker precedent]` |
| Bun Web Worker | runtime built-in | Off-thread execution (GEO-01) | The app already runs 3 workers through one serving seam; no new dependency. `[VERIFIED: workerAssets.ts]` |

### Supporting (in-repo modules, reused — NOT new packages)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/workers/workerAssets.ts` | Worker registry + `workerUrl(id)` | Add `optimize` entry; spawn from the stable `/workers/optimize.worker.js` URL. |
| `src/lib/workers/buildWorker.ts` | Shared `Bun.build` worker bundler | Dev route + prod build both read `WORKER_ASSETS`; nothing to change here. |
| `src/features/geo-editor/core/utils/featureHelpers.ts` | `extractGeometryParts`, `toMultiGeometryType`, `getBaseGeometryType`, `normalizeLineCoordinates`, `mergeLinePartsBySharedEndpoints`, `extractLinePartsFromGeometry` | The PURE merge-to-multi + microgap-stitch helpers. Worker imports these directly (leaf, editor-free). |
| `src/lib/geo/geometry.ts` | `countGeometryVertices`, `isSimplifiableGeometryType` | Metric counts for the report; gate which features simplify. Leaf, editor-free. |
| `src/features/geo-editor/api/geometryValidation.ts` | `validateGeometryFeatures` (D-06 guardrail) | Per-iteration topology reject. Pure, editor-free, worker-safe. |
| `src/features/chat/safeEditing/gateBulkEdit.ts` | `gateBulkApply` (Phase 6) | Apply the converged result as ONE gated `modify` snapshot. |
| `src/features/chat/safeEditing/fixAll.ts` | `runFixAllRule` | Optional apply mechanism (rule over all ids) — but see Architecture §3 for why a direct `writeGeoJSON`-style apply may be cleaner for a whole-collection replace. |
| `src/features/geo-editor/constants.ts` | `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (`constants.ts:26`) | Default budget (D-04). |
| `src/features/geo-editor/hooks/usePublishing.ts` | `isOverSizeLimit` / `getCollectionSize` (`usePublishing.ts:230,238`) | Post-optimize publish gate (GEO-03 / D-07). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing the pure leaf helpers in a worker | Reusing the manager classes directly | REJECTED — the managers are bound to `EditorOperationContext` (live `ctx.features` Map, `ctx.render()`, `ctx.history`, `ctx.emit`). They cannot run in a worker; only their inner pure math can. (CONTEXT.md framing, confirmed by reading all three managers.) |
| `@turf/turf` umbrella import | `@turf/simplify` + `@turf/kinks` + `@turf/area` leaf packages | Marginally smaller worker bundle, but the umbrella already bundles cleanly into the sandbox worker (~0.5MB after the pino fix); not worth the churn. Use the umbrella for consistency. `[ASSUMED — bundle size of leaf split not measured]` |
| A topology-aware simplifier (topojson) | — | Explicitly OUT OF SCOPE per REQUIREMENTS.md anti-pattern table ("Heavy new topology-aware simplifier dependency"). Compose existing turf + post-validation instead. `[CITED: REQUIREMENTS.md L93]` |

**Installation:** None. No new package. All modules above already exist in the repo.

**Version verification:** `@turf/turf@^7.3.5` confirmed present in `package.json`. No install step in this phase. `[VERIFIED: package.json]`

## Package Legitimacy Audit

> Not applicable — Phase 7 installs NO external packages. It composes existing in-repo modules and the already-installed `@turf/turf@^7.3.5`.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                          MAIN THREAD                                    WORKER THREAD
                                                                  (optimize.worker.ts — leaf imports only)
  Chat model
     │  optimize_geometry({ targetBytes? })
     ▼
  registry.dispatch ──► optimize_geometry handler (geometry-tools.ts)
     │                       │
     │   requireEditor()     │  editor.getAllFeatures()  ──► EditorFeature[] (FULL id-keyed set, SAFE-05)
     │                       │  budget = targetBytes ?? BLOSSOM_UPLOAD_THRESHOLD_BYTES
     │                       ▼
     │                  optimizeClient.run(featureCollection, budget) ──postMessage(structured-clone)──►  optimize(fc, budget)
     │                                                                                                        │
     │                                                                                                        │  STAGE 1: stitch microgaps (lines)
     │                                                                                                        │    normalizeLineCoordinates + mergeLinePartsBySharedEndpoints (tol 0.00001)
     │                                                                                                        │  STAGE 2: merge-to-multi (LOSSLESS — identical props only, D-05)
     │                                                                                                        │    group by base type + canonical props key; extractGeometryParts + toMultiGeometryType
     │                                                                                                        │  STAGE 3: binary-search simplify tolerance → budget (D-03)
     │                                                                                                        │    lo=MIN, hi=MAX; each step: turf.simplify(highQuality)
     │                                                                                                        │      → validateGeometryFeatures (reject NEW kinks / zero-area, D-06)
     │                                                                                                        │      → measure bytes (TextEncoder over serialized FC)
     │                                                                                                        │      weakly-monotonic: bytes ↓ as tolerance ↑
     │                                                                                                        ▼
     │                  { result: FeatureCollection, report } ◄──────postMessage──────────────────────  { result, report }
     │                       │
     │                       ▼
     │                  gateBulkApply(editor, deps, 'modify', apply=() => writeOptimizedResult(editor, result))
     │                       │   ├─ pushDatasetSnapshot (ONE undo, D-11)
     │                       │   ├─ apply() routes through createAuthoring facade → runInterceptors (A3 clean)
     │                       │   ├─ classifyMutation(before, after, 'modify') → DatasetDiff
     │                       │   └─ emitDiffBlock(diff, { metrics })  ── metrics-aware headline (D-04b / GEO-02)
     │                       ▼
     │                  DatasetDiffDisclosure  ── "12MB → 0.9MB · 41k→3.2k pts · 312→18 features · 47 joins"  [Apply/Cancel]
     ▼
  tool result → model + transcript;  result feeds usePublishing.isOverSizeLimit
     │
     ├─ under limit → normal publish flow
     └─ over limit  → BlossomUploadDialog external-upload escape hatch (D-07)
```

### Recommended Project Structure
```
src/features/chat/
├── geometry/                       # NEW — the optimization orchestration layer (mirrors chat/ingest/)
│   ├── optimize.ts                 # PURE optimize(fc, budget) → {result, report}; the worker shell calls this
│   ├── optimize.worker.ts          # self.onmessage shell (mirrors ingest.worker.ts) — imports ONLY ./optimize
│   ├── optimizeClient.ts           # host RPC client (mirrors ingestClient.ts): spawn, id-keyed pending, timeout + sync fallback
│   └── types.ts                    # OptimizeRequest / OptimizeResponse / OptimizeReport discriminated shapes
└── tools/
    └── geometry-tools.ts           # NEW — registerGeometryTools(register): optimize_geometry (injected-register idiom)

src/lib/workers/workerAssets.ts     # EDIT — add `optimize` entry to WORKER_ASSETS
src/features/chat/tools/registry.ts # EDIT — call registerGeometryTools(register) in bootstrapRegistry()
src/features/chat/safeEditing/
├── gateBulkEdit.ts                 # EDIT — thread optional metrics through to emitDiffBlock (D-04b headline)
├── pendingDiffStore.ts             # EDIT — PendingDiffEntry/EmitDiffBlockOptions gain optional metrics
└── DatasetDiffDisclosure.tsx       # EDIT — render metrics-aware headline when present
```

### Pattern 1: Pure-function-in-worker (mirror `ingest.worker.ts`)
**What:** The worker is a thin `self.onmessage` shell over a pure module (`optimize.ts`), so the heavy logic is unit-testable WITHOUT instantiating a Worker (exactly how `ingest.worker.ts` defers to `./parse.ts`).
**When to use:** Always for off-thread GEO-01 work.
**Example:**
```typescript
// Source: src/features/chat/ingest/ingest.worker.ts (in-repo precedent, read this session)
// optimize.worker.ts — leaf imports ONLY (NEVER @/features/geo-editor/api barrel — pino landmine)
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

### Pattern 2: Worker spawn via the stable served URL (MANDATORY — avoids the file:// landmine)
**What:** Spawn from the origin-rooted string `workerUrl('optimize')` (`/workers/optimize.worker.js`), NOT `new URL('./x.worker.ts', import.meta.url)`.
**When to use:** Every worker spawn in this codebase.
**Example:**
```typescript
// Source: src/features/chat/ingest/ingestClient.ts:146 (in-repo precedent)
import { workerUrl } from '@/lib/workers/workerAssets'
// new URL('./optimize.worker.ts', import.meta.url) resolves to file:// in dev (Bun #17705)
// and a non-existent .ts in prod (Bun #7534) — see sandbox-worker-file-url-dev.md.
worker = new Worker(workerUrl('optimize'), { type: 'module' })
```
And register the asset (one entry — build.ts + dev route both iterate `WORKER_ASSETS`, confirmed `build.ts:270`):
```typescript
// Source: src/lib/workers/workerAssets.ts:45 (EDIT)
export const WORKER_ASSETS = {
  sandbox: { /* … */ },
  ingest: { /* … */ },
  geoJsonParse: { /* … */ },
  optimize: {
    servedName: 'optimize.worker.js',
    sourcePath: 'src/features/chat/geometry/optimize.worker.ts',
  },
} as const satisfies Record<string, WorkerAsset>
```

### Pattern 3: Apply the converged whole-collection result through the gate
**What:** The optimizer produces a NEW `FeatureCollection` (different feature ids after merge — `CombineManager`/`LineOperationsManager` mint `generateId()` for merged features). This is a whole-dataset replace, classified `modify`. Apply it through `gateBulkApply` so it is one snapshot, one undo, one diff.
**When to use:** The single apply point after the worker returns.
**Nuance — id stability and `classifyMutation`:** `classifyMutation` buckets BY FEATURE ID (`diff.ts:157`). Because merge/stitch create new ids, a naive before/after over raw ids would classify the whole set as adds+deletes, not modifies. **The planner must decide the apply representation.** Two viable approaches:
  - (a) **Replace-in-place semantics:** apply via the facade's `writeGeoJSON(..., replaceExisting=true)` equivalent, and let the gate's `intent:'modify'` + a metrics-aware headline carry the user-facing meaning (the per-row add/modify/delete list is secondary to the headline for an optimization). Simplest; the headline is the truth.
  - (b) **Preserve ids where possible:** keep original ids on features that pass through unmerged (simplify-only), only minting new ids for genuinely-merged multi-features. Produces a more honest per-row diff but more complex.
  Recommendation: **(a)** — the optimization's value is the *aggregate* metrics headline (D-04b explicitly says "the diff headline must be metrics-aware … so it reads as an optimization summary, not a wall of geometry edits"), so do not over-invest in per-row id continuity. Confirm with the user during planning only if the per-row diff list matters.
**Example:**
```typescript
// Source: src/features/chat/tools/bulk-tools.ts:376 (gateBulkApply usage precedent)
const outcome = await gateBulkApply(
  editor,
  { getSafetyLevel, label: 'Optimize geometry' },
  'modify',
  () => { applyOptimizedCollection(editor, result) }, // routes through createAuthoring → runInterceptors
)
```

### Pattern 4: Metrics-aware diff headline (D-04b / GEO-02)
**What:** The Phase-5/6 headline is computed purely from `DatasetDiff` counts (`+N added · ~N changed · −N deleted` or the Phase-6 `~N restyled` special-case, `DatasetDiffDisclosure.tsx:40`). An optimization needs a DIFFERENT headline carrying byte/vertex/feature/join counts. The clean extension: thread an optional `metrics`/`headline` object from `gateBulkApply` → `emitDiffBlock` → `PendingDiffEntry` → `DatasetDiffDisclosure`, and render it in place of the count string when present.
**When to use:** This is the one piece of new plumbing in the safe-editing layer. Keep it additive and backward-compatible (Phase 5/6 tests must stay green — they pass no metrics).
**Extension points (exact, read this session):**
  - `EmitDiffBlockOptions` (`pendingDiffStore.ts:45`) — add optional `headline?: string` (or a structured `metrics`).
  - `PendingDiffEntry` (`pendingDiffStore.ts:32`) — carry it.
  - `gateBulkApply` (`gateBulkEdit.ts:70`) — accept an optional `headline` in `deps` and pass to every `emitDiffBlock` call.
  - `buildDatasetDiffSummary` (`DatasetDiffDisclosure.tsx:40`) — if an entry has a `headline`, render it; else fall through to the existing count/`restyled` logic.

### Anti-Patterns to Avoid
- **Importing the `@/features/geo-editor/api` barrel into the worker:** drags `createAuthoring` → GeoEditor → Nostr → Node `pino` (throws on load in a browser Worker, ~2MB). Import leaf modules only. `[VERIFIED: sandbox-worker-file-url-dev.md "SECONDARY ROOT CAUSE"]`
- **`new Worker(new URL('./x.worker.ts', import.meta.url))`:** broken in dev AND prod here. Always `workerUrl(id)`. `[VERIFIED: sandbox-worker-file-url-dev.md]`
- **Reusing `CombineManager.combineSelectedFeatures()` for the optimizer's merge:** LOSSY — `template = cloneFeature(selected[0])` discards all but the first feature's properties (`CombineManager.ts:43`). Violates GEO-02. Implement identical-props merge instead (D-05). `[VERIFIED: CombineManager.ts:43]`
- **Re-serializing the entire collection per binary-search iteration with no thought to cost:** acceptable for correctness but measure bytes via a single `TextEncoder().encode(JSON.stringify(fc)).length` per step (same method as `usePublishing.getCollectionSize` and `SimplifyDialog`) — see Pitfall 2 for the cheaper incremental option if the GEO-03 fixture is slow.
- **Calling `editor.*` from inside `features/chat/**`:** the A3 boundary scan forbids the literal `editor.deleteFeatures(` / direct-mutation tokens in chat code. Route through `createAuthoring`/`gateBulkApply`/`deleteFeaturesById` like every Phase-6 tool. `[VERIFIED: authoring.ts:516-524 boundary note]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line simplification | A Douglas-Peucker impl | `turf.simplify(feature, { tolerance, highQuality: true })` | Already used in `TransformManager.simplify` (`TransformManager.ts:161`); high-quality mode preserves topology better. |
| Microgap stitch | Endpoint-snapping graph walk | `normalizeLineCoordinates` + `mergeLinePartsBySharedEndpoints` (`featureHelpers.ts:105,110`) | Already implemented, tolerance-parameterized, the exact primitive behind `dissolveSelectedLines`. |
| Merge-to-multi | Geometry-type multiplexing | `getBaseGeometryType` + `extractGeometryParts` + `toMultiGeometryType` (`featureHelpers.ts:17,38,25`) | The pure core of `CombineManager` minus the lossy property step. |
| Self-intersection / zero-area detection | turf.kinks/area wiring | `validateGeometryFeatures` (`geometryValidation.ts:115`) | Pure, editor-free, worker-safe; already the Phase-6 topology reporter; gives per-feature + aggregate counts for the report AND the D-06 reject. |
| Vertex counting | A geometry walker | `countGeometryVertices` (`geometry.ts:19`) | Handles all geometry types incl. Multi*/GeometryCollection. |
| Byte measurement | A custom estimator | `new TextEncoder().encode(JSON.stringify(fc)).length` | The EXACT method `usePublishing.getCollectionSize` (`usePublishing.ts:230`) and `SimplifyDialog` use — must match so the budget compares apples-to-apples with the publish gate. |
| Off-thread plumbing | Raw `postMessage` glue | Mirror `ingestClient.ts` (id-keyed pending map, 30s timeout, sync fallback, broken-worker latch) | Proven no-freeze machinery; guarantees the promise always settles. |
| The gate / diff / undo | New preview UI | `gateBulkApply` + `DatasetDiffDisclosure` | Phase 5/6 already deliver snapshot→apply→classify→confirm→undo as one block. |

**Key insight:** Phase 7 writes almost no geometry code. It writes (1) a deterministic pipeline + binary search that *calls* existing pure helpers, (2) a worker shell + RPC client cloned from the ingest precedent, (3) one tool registration, and (4) one additive metrics-headline extension to the diff disclosure. The geometry math is entirely reuse.

## Runtime State Inventory

> Phase 7 is greenfield orchestration over existing primitives — it does NOT rename, migrate, or refactor stored/registered state. This section is included for completeness because the phase adds a worker asset.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — operates on in-memory editor features; produces a new FeatureCollection applied via the facade. No datastore keys touched. | none |
| Live service config | None. | none |
| OS-registered state | None. | none |
| Secrets/env vars | None — the worker receives only plain GeoJSON + a number; the `buildWorker` define map injects only frontend env (no secrets reach the worker). | none |
| Build artifacts | NEW worker artifact `dist/workers/optimize.worker.js` is emitted by `build.ts` once the `WORKER_ASSETS` entry is added (`build.ts:270` iterates the map). | Verify `bun run build` emits it; verify dev `/workers/optimize.worker.js` returns 200 text/javascript. |

**Nothing found in categories Stored data / Live service config / OS-registered state / Secrets — verified by reading the data flow: the worker is a pure compute step with no persistence and no Nostr/signer access.**

## Common Pitfalls

### Pitfall 1: The worker `file://` URL landmine (dev) and missing-chunk landmine (prod)
**What goes wrong:** Using `new Worker(new URL('./optimize.worker.ts', import.meta.url))` — the dev bundler substitutes `import.meta.url` with the source `file://` path → `Failed to construct 'Worker': Script at 'file://…' cannot be accessed from origin 'http://localhost'`; prod resolves to a non-existent `.ts` served as `index.html`.
**Why it happens:** Bun's HTML-import dev server does not support workers (Bun #17705); the prod bundler does not auto-emit the worker chunk from this form (Bun #7534/#7901/#16869).
**How to avoid:** Add the worker to `WORKER_ASSETS` and spawn via `new Worker(workerUrl('optimize'), { type: 'module' })`. The dev `/workers/:name` route + `build.ts` prod emission already handle serving.
**Warning signs:** `Failed to construct 'Worker'` in dev console; `/workers/optimize.worker.js` returning `text/html`; the worker silently never running (note: the ingest worker SILENTLY sync-fell-back when broken — build the RPC client with the same explicit fallback so a broken worker degrades to a main-thread compute, not a hang). `[VERIFIED: sandbox-worker-file-url-dev.md]`

### Pitfall 2: Byte measurement cost in the binary-search loop
**What goes wrong:** Re-serializing the full collection (`JSON.stringify` of 12MB) once per iteration is ~8–12× the cost of a single serialization. For the 12MB GEO-03 fixture this could be a few hundred ms of CPU — acceptable in a worker (it does not freeze the UI), but worth bounding.
**Why it happens:** Each tolerance step produces a new geometry set whose serialized size must be measured to compare against the budget.
**How to avoid:** (a) Acceptable default: full `TextEncoder().encode(JSON.stringify(fc)).length` per step — it runs off-thread, and 8–12 iterations is bounded (D-03). (b) Optimization if the fixture is slow: only the simplified geometries change between steps; measure incremental byte delta over the simplifiable features and add the constant byte cost of the untouched (point) features once. Start with (a); profile against the West Pacific Trail fixture before adding (b).
**Warning signs:** Worker round-trip > a couple seconds on the 12MB fixture.

### Pitfall 3: Topology reject must be RELATIVE to input, not absolute (D-06)
**What goes wrong:** Rejecting any tolerance step where `validateGeometryFeatures` reports ANY self-intersection/zero-area would mis-fire on inputs that were ALREADY self-intersecting (a messy 12MB import likely has pre-existing kinks). The guardrail is "no NEW self-intersections / zero-area collapse relative to input" (GEO-02 verbatim).
**Why it happens:** The validator reports absolute counts; the requirement is a delta.
**How to avoid:** Validate the INPUT once up front (after stitch+merge, before the search) to get a baseline (`withSelfIntersections`, `withZeroArea`, and ideally the per-feature `issues` set). At each tolerance step, reject only if the step introduces NEW problems beyond the baseline (a per-feature-id comparison of the `issues` list, OR — simpler and conservative — aggregate counts must not *increase*). Back off to the last good tolerance on reject. Combine with the hard `SIMPLIFY_TOLERANCE_MAX` ceiling (`SimplifyDialog.tsx:23` = `1e-3`) so budget-chasing can't shred the shape even when topology stays technically valid.
**Warning signs:** A clean input getting rejected at low tolerance; a dataset that "can't optimize at all" because its baseline already has kinks. `[VERIFIED: geometryValidation.ts report shape; SimplifyDialog.tsx:22-23 bounds]`

### Pitfall 4: Lossy merge silently dropping properties (D-05)
**What goes wrong:** Reusing `CombineManager`'s merge keeps only the first part's properties (`CombineManager.ts:43`), violating GEO-02 "per-feature properties preserved through merge."
**Why it happens:** The toolbar merge was designed for a hand-selected homogeneous group, not arbitrary bulk merge.
**How to avoid:** The optimizer's merge groups features by `(baseGeometryType, canonicalPropsKey)` where `canonicalPropsKey = stableStringify(properties minus editor-internal keys)`, and only merges within a group whose properties are IDENTICAL. Features with differing properties stay separate (they still get stitched/simplified). Strip the editor-internal property keys (`NON_CUSTOM_EDITOR_PROPERTY_KEYS`, `constants.ts:40`; note `featureId`/`meta` are re-stamped by `normalizeFeature`) before comparing, so two features that differ only in their internal `featureId` still merge. Use `extractGeometryParts` + `toMultiGeometryType` for the actual multi build.
**Warning signs:** Merged multi-features losing `name`/`description`; the GEO-03 acceptance dataset coming out under budget but with mangled attributes. `[VERIFIED: CombineManager.ts:43; constants.ts:40; featureHelpers.normalizeFeature:8]`

### Pitfall 5: structuredClone / serialization of `EditorFeature` into the worker
**What goes wrong:** `editor.getAllFeatures()` returns `EditorFeature[]` (`GeoEditor.ts:1181` → `Array.from(this.features.values())`). These must postMessage cleanly into the worker (structured-clone). They are plain GeoJSON Features with a `properties` bag — serializable. But the worker must return PLAIN features the facade can re-ingest.
**Why it happens:** Any non-cloneable field (function, class instance) on a feature would throw `DataCloneError`.
**How to avoid:** Pass `{ type: 'FeatureCollection', features }` of plain objects; the worker returns the same plain shape. `normalizeFeature` (run on apply via the facade) re-stamps `meta`/`featureId`. Confirmed `EditorFeature` is a plain GeoJSON-shaped object (no class instances) by reading the managers' usage. `[VERIFIED: GeoEditor.ts:1181; featureHelpers cloneFeature uses JSON round-trip]`

### Pitfall 6: Registry circular-init crash (the injected-`register` idiom)
**What goes wrong:** A new tools module that imports the VALUE `register` from `./registry` forms the Phase-2 circular-init cycle that crashes the dev bundler at bootstrap (null `./registry` during HMR).
**Why it happens:** `registry.ts` imports the tool registrars; if a registrar imports `register` back, the cycle has a value edge.
**How to avoid:** `geometry-tools.ts` imports ONLY `type ToolEntry` from `./registry` and receives `register` as an injected parameter (`registerGeometryTools(register)`), exactly like `registerBulkTools` / `registerIngestTools` / `registerSandboxTools`. `[VERIFIED: bulk-tools.ts:54-55; registry.ts:1073-1089]`

## Code Examples

### Identical-props merge-to-multi (D-05, pure, worker-safe)
```typescript
// Composes existing pure helpers — NO new geometry math.
// Source helpers: src/features/geo-editor/core/utils/featureHelpers.ts (read this session)
import {
  getBaseGeometryType, extractGeometryParts, toMultiGeometryType,
} from '@/features/geo-editor/core/utils/featureHelpers'
import { NON_CUSTOM_EDITOR_PROPERTY_KEYS } from '@/features/geo-editor/constants'

function userPropsKey(props: Record<string, unknown> | null | undefined): string {
  const entries = Object.entries(props ?? {})
    .filter(([k]) => !['featureId', 'meta'].includes(k)) // editor-internal, re-stamped on apply
    .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(entries)
}

// Group identical-props features of the same base type, build one Multi* per group.
// Singleton groups and differing-props features pass through unchanged.
```

### Binary search over simplify tolerance to the budget (D-03)
```typescript
// turf.simplify is weakly monotonic in tolerance: larger tolerance ⇒ fewer-or-equal
// vertices ⇒ fewer-or-equal bytes. So a lower tolerance bound (lo) is "more bytes",
// a higher bound (hi) is "fewer bytes". Search for the SMALLEST tolerance that lands
// under budget (best quality-for-budget), respecting the SIMPLIFY_TOLERANCE_MAX ceiling
// and the topology-reject guardrail.
// Source bounds: SimplifyDialog.tsx:22-23 (MIN=1e-8, MAX=1e-3)
const MIN = 1e-8, MAX = 1e-3, MAX_ITERS = 12
const bytesAt = (fc) => new TextEncoder().encode(JSON.stringify(fc)).length // matches usePublishing

let lo = MIN, hi = MAX, best = null
for (let i = 0; i < MAX_ITERS; i++) {
  const mid = Math.sqrt(lo * hi) // geometric mid — tolerance is log-scaled (SimplifyDialog slider)
  const candidate = simplifyAll(stitchedMerged, mid)        // turf.simplify(highQuality)
  if (introducesNewTopologyProblems(candidate, baseline)) { // D-06 reject relative to input
    hi = mid; continue                                      // too aggressive → back off
  }
  const bytes = bytesAt(candidate)
  if (bytes <= budget) { best = { mid, candidate, bytes }; hi = mid } // under budget → try gentler
  else { lo = mid }                                                   // over budget → push harder
}
// best === null ⇒ budget unreachable without breaking the guardrail (D-07 best-effort path):
// return the gentlest VALID candidate + honest report ("reduced X→Y; still over the Z limit").
```

### Off-thread RPC client (mirror `ingestClient.ts`)
```typescript
// Source pattern: src/features/chat/ingest/ingestClient.ts (read this session)
// - workerUrl('optimize') spawn  - id-keyed pending map  - timeout + main-thread sync fallback
// - broken-worker latch so a failed worker degrades to sync optimize(), never hangs.
import { workerUrl } from '@/lib/workers/workerAssets'
import { optimize } from './optimize' // SAME pure fn the worker uses → paths can't diverge
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual per-selection simplify via `SimplifyDialog` (toolbar, one selection) | Host-driven whole-dataset byte-budget convergence over all bound ids, off-thread | Phase 7 | The dialog stays for manual use; the AI tool is the bulk/automatic path. |
| Toolbar `combineSelectedFeatures` (lossy, first-props-wins) | Lossless identical-props merge in the optimizer | Phase 7 (D-05) | Properties preserved through merge (GEO-02). The toolbar primitive is unchanged; the optimizer has its own merge. |
| `new Worker(new URL('./x.worker.ts', import.meta.url))` | `WORKER_ASSETS` registry + `workerUrl(id)` + dev route + `dist/workers/` | Phase 4 fix (a417ca5 era) | Workers actually work in dev AND prod; Phase 7 reuses verbatim. |

**Deprecated/outdated:**
- Comments in older code claiming `new Worker(new URL(...))` "emits a worker chunk under the production build" are FALSE — corrected by the Phase-4 worker-serving fix. Do not trust that form. `[VERIFIED: sandbox-worker-file-url-dev.md Evidence L46]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@turf/turf` umbrella import bundles into the new worker at acceptable size (~0.5MB, like the sandbox worker post-pino-fix) without a leaf-package split. | Standard Stack / Alternatives | LOW — if bundle is too large, swap to `@turf/simplify`+`@turf/kinks`+`@turf/area` leaf imports; mechanical change. |
| A2 | Apply representation (a) "replace-in-place, headline is the truth" is acceptable to the user; per-row add/modify/delete continuity is not required for an optimization. | Architecture Pattern 3 | MEDIUM — if the user wants a precise per-feature diff, approach (b) (id preservation for unmerged features) is needed; flagged for planning. |
| A3 | Aggregate-count topology comparison (counts must not increase) is a sufficient proxy for "no NEW self-intersections" for the GEO-03 acceptance bar; a full per-feature-id `issues` delta is nicer but may not be needed. | Pitfalls §3 | MEDIUM — a feature could lose one kink and gain another (net-zero count) and slip through; if the fixture exposes this, use the per-feature `issues` delta. |
| A4 | The geometric mid-point (`sqrt(lo*hi)`) bisection over the log-scaled tolerance converges in ≤12 iterations for the 12MB fixture. | Code Examples | LOW — iteration cap is a tuning constant; raise if needed. The budget is weakly monotonic so convergence is guaranteed. |
| A5 | Stitch-before-merge ordering (D-02) is correct for the fixture: stitching microgaps first produces longer continuous lines that then merge-to-multi and simplify well. | Architecture | LOW — D-02 locks this order; if a dataset shape suffers, that's a deferred "AI/host-selected stages" concern, explicitly out of scope. |

## Open Questions (RESOLVED)

1. **Per-row diff fidelity vs. metrics headline (Apply representation).**
   - What we know: `classifyMutation` is id-keyed; merge/stitch mint new ids; D-04b says the headline is the user-facing truth.
   - What's unclear: whether the user wants the expandable per-row add/modify/delete list to be meaningful for an optimization, or whether the metrics headline alone suffices.
   - Recommendation: ship approach (a) (replace-in-place, metrics headline); the per-row list will show the net id churn. Confirm during `/gsd-discuss` only if it blocks planning.

2. **Topology baseline granularity (aggregate counts vs. per-feature `issues` delta).**
   - What we know: `validateGeometryFeatures` returns both aggregate counters and a per-feature `issues` array.
   - What's unclear: whether aggregate-counts-must-not-increase is strict enough for "no NEW self-intersections" on the real fixture.
   - Recommendation: start with aggregate counts; escalate to the per-feature `issues` delta if the GEO-03 fixture demonstrates a net-zero-but-different failure (A3).

3. **Microgap threshold tuning.**
   - What we know: `dissolveSelectedLines` default tolerance is `0.00001` (~1m); CONTEXT.md says reuse it unless the fixture needs tuning.
   - What's unclear: whether the West Pacific Trail's microgaps are within that tolerance.
   - Recommendation: start at `0.00001`; host-internal only (D-04). Tune against the fixture in Wave-0 if joins come out at 0.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@turf/turf` | simplify/kinks/area | ✓ | ^7.3.5 | — |
| Bun Web Worker + `WORKER_ASSETS` serving | GEO-01 off-thread | ✓ | runtime | Main-thread sync `optimize()` (RPC client latches broken-worker → sync, mirrors ingest) |
| `bun test` | Wave-0 fixtures + assertions | ✓ | — | — |
| `bun run build` / `build:production` | prod worker emission | ✓ | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the worker itself — if it fails to construct/load, the RPC client must sync-fallback to the same pure `optimize()` on the main thread (briefly blocking, but never hanging). This is the proven `ingestClient` pattern; replicate it.

## Validation Architecture

> `workflow.nyquist_validation` not set to false in config → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner (`bun test`) |
| Config file | none — Bun built-in; tests colocated as `*.test.ts` |
| Quick run command | `bun test src/features/chat/geometry/` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEO-01 | `optimize(fc, budget)` reduces bytes via stitch→merge→simplify; pure, no editor ref | unit | `bun test src/features/chat/geometry/optimize.test.ts` | ❌ Wave 0 |
| GEO-01 | Worker RPC client settles (worker path + sync fallback + timeout), no hang | unit | `bun test src/features/chat/geometry/optimizeClient.test.ts` | ❌ Wave 0 |
| GEO-02 | Report carries before/after byte+vertex+feature counts + microgap join count | unit | `bun test src/features/chat/geometry/optimize.test.ts -t report` | ❌ Wave 0 |
| GEO-02 | Topology guardrail: a tolerance step introducing NEW kinks/zero-area is rejected (relative to baseline) | unit | `bun test src/features/chat/geometry/optimize.test.ts -t topology` | ❌ Wave 0 |
| GEO-02 | Lossless merge: identical-props features merge to Multi*; differing-props stay separate; props preserved | unit | `bun test src/features/chat/geometry/optimize.test.ts -t merge` | ❌ Wave 0 |
| GEO-02 | Metrics-aware headline renders byte/vertex/feature/join summary in the diff disclosure | render | `bun test src/features/chat/safeEditing/DatasetDiffDisclosure.test.tsx -t metrics` | ⚠️ extend existing |
| GEO-03 | An oversized synthetic FixtureCollection is brought under `BLOSSOM_UPLOAD_THRESHOLD_BYTES`; result passes `isOverSizeLimit === false` | integration | `bun test src/features/chat/geometry/optimize.acceptance.test.ts` | ❌ Wave 0 |
| GEO-03 | Budget-unreachable path: returns best-effort + honest "still over limit" report (no throw, no silent truncation) | unit | `bun test src/features/chat/geometry/optimize.test.ts -t unreachable` | ❌ Wave 0 |
| GEO-01/02/03 | `optimize_geometry` tool dispatches, gates as `modify`, one snapshot/undo | integration | `bun test src/features/chat/tools/geometry-tools.test.ts` | ❌ Wave 0 |

### Synthetic acceptance fixture (the West Pacific Trail surrogate)
Build a deterministic generator (NOT a checked-in 12MB blob): produce a FeatureCollection of N (~300) `LineString` features with (a) superfluous near-collinear vertices, (b) deliberate microgaps between consecutive lines within the dissolve tolerance, (c) a subset sharing identical properties (to exercise lossless merge), (d) total serialized size > 1MB. Assertions: `bytesAfter < BLOSSOM_UPLOAD_THRESHOLD_BYTES`; `verticesAfter < verticesBefore`; `featuresAfter <= featuresBefore`; no NEW topology problems vs. baseline; every input property value still present on some output feature; `report.microgapJoins > 0`.

### Sampling Rate
- **Per task commit:** `bun test src/features/chat/geometry/`
- **Per wave merge:** `bun test` (full suite — must stay green; Phase 5/6 diff tests must not regress from the additive headline change)
- **Phase gate:** Full suite green + `bun run build` (emits `dist/workers/optimize.worker.js`) before `/gsd-verify-work`; live UAT runs the real 12MB import → optimize → publish.

### Wave 0 Gaps
- [ ] `src/features/chat/geometry/optimize.test.ts` — covers GEO-01, GEO-02 (report, topology, merge, unreachable)
- [ ] `src/features/chat/geometry/optimizeClient.test.ts` — covers GEO-01 no-hang RPC contract
- [ ] `src/features/chat/geometry/optimize.acceptance.test.ts` + a synthetic-fixture generator — covers GEO-03
- [ ] `src/features/chat/tools/geometry-tools.test.ts` — covers tool dispatch + gate integration
- [ ] Extend `DatasetDiffDisclosure.test.tsx` — metrics-aware headline render
- [ ] No framework install needed (Bun built-in)

## Security Domain

> `security_enforcement` absent in config → treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 7 touches no auth/signer. |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | The single model-facing arg (`targetBytes`) must be validated: a finite positive number, clamped to a sane range (reject NaN/negative/absurd; default to `BLOSSOM_UPLOAD_THRESHOLD_BYTES`). Worker input is the host-supplied collection (trusted), not model-supplied — the model never passes geometry to this tool (D-04). |
| V6 Cryptography | no | The worker receives NO secrets; `buildWorker`'s define injects only frontend env vars. |

### Known Threat Patterns for {Bun worker + chat tool}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DoS via absurd `targetBytes` or a pathological collection causing an unbounded loop | Denial of Service | Bounded binary-search iterations (`MAX_ITERS`, D-03); off-thread so the UI never freezes; RPC client 30s timeout + sync fallback (mirror ingest). |
| Secret leakage into the worker bundle | Information Disclosure | Leaf-imports-only rule keeps `createAuthoring`/Nostr/signer out of the worker (the pino landmine fix already enforces this boundary; the A3 boundary scan + worker bundle stay secret-free). |
| Mutation bypassing the safe-editing gate | Tampering | Apply ONLY through `gateBulkApply` → `createAuthoring` → `runInterceptors`; no direct `editor.*` from `chat/**` (A3 boundary scan enforces). |
| Auto-publish of AI-optimized data | Tampering / Repudiation | NO auto-publish (D-07); publishing stays the explicit `usePublishing` user action. `[CITED: REQUIREMENTS.md Out-of-Scope "Auto-publish of AI edits"]` |

## Sources

### Primary (HIGH confidence — read this session)
- `src/features/chat/ingest/ingest.worker.ts`, `ingestClient.ts` — off-thread worker + RPC precedent (GEO-01)
- `src/lib/workers/workerAssets.ts`, `buildWorker.ts`, `build.ts:265-274` — worker serving seam (file:// landmine fix)
- `.planning/debug/sandbox-worker-file-url-dev.md` — the worker URL + pino-barrel landmines (root cause + fix)
- `src/features/geo-editor/core/managers/{Simplify,Combine,LineOperations,Transform}Manager.ts` — the primitives (and the lossy-merge bug at `CombineManager.ts:43`)
- `src/features/geo-editor/core/utils/featureHelpers.ts` — pure merge/stitch helpers
- `src/lib/geo/geometry.ts` — `countGeometryVertices`, `isSimplifiableGeometryType`
- `src/features/geo-editor/api/geometryValidation.ts` — D-06 guardrail (pure, worker-safe)
- `src/features/chat/safeEditing/gateBulkEdit.ts`, `fixAll.ts`, `pendingDiffStore.ts`, `DatasetDiffDisclosure.tsx` — the gate/diff/headline integration points
- `src/features/geo-editor/api/diff.ts` — `classifyMutation` (id-keyed; informs Apply representation)
- `src/features/chat/tools/{registry,bulk-tools}.ts` — injected-`register` idiom + `gateBulkApply` usage
- `src/features/geo-editor/constants.ts:26,40` — `BLOSSOM_UPLOAD_THRESHOLD_BYTES`, `NON_CUSTOM_EDITOR_PROPERTY_KEYS`
- `src/features/geo-editor/hooks/usePublishing.ts:230-251,758-761` — size gate (GEO-03/D-07)
- `src/features/geo-editor/components/toolbar/SimplifyDialog.tsx:22-24` — `SIMPLIFY_TOLERANCE_MIN/MAX`, byte-measurement precedent
- `package.json` — `@turf/turf@^7.3.5`

### Secondary (MEDIUM confidence)
- Douglas-Peucker tolerance↔vertex-count monotonicity (weakly monotonic: larger tolerance ⇒ fewer-or-equal points) — confirms the binary search is well-posed.

### Tertiary (LOW confidence)
- Worker bundle-size estimate for `@turf/turf` umbrella (A1) — inferred from the sandbox worker's post-fix size, not measured for this worker.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules read this session; no new packages; turf version verified in package.json.
- Architecture: HIGH — worker seam, gate, and primitives all have exact in-repo precedents read this session; the one new plumbing piece (metrics headline) has precise extension points identified.
- Pitfalls: HIGH — the two landmines are documented verbatim in the debug file; the lossy-merge bug confirmed at the cited line.
- Apply representation (Pattern 3) / topology-delta granularity: MEDIUM — two viable approaches each, flagged as Open Questions A2/A3 for planning.

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable — internal codebase, no fast-moving external deps; the only external dep `@turf/turf` is pinned).

Sources:
- [Ramer–Douglas–Peucker algorithm (tolerance ↔ vertex count)](https://grokipedia.com/page/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm)
- [A Vector Line Simplification Algorithm Based on Douglas–Peucker, Monotonic Chains and Dichotomy](https://www.mdpi.com/2220-9964/9/4/251)
</content>
</invoke>
