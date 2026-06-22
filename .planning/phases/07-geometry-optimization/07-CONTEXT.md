# Phase 7: Geometry Optimization - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring an oversized, messy GeoJSON under the publish/city-dialog size limit (1MB,
`BLOSSOM_UPLOAD_THRESHOLD_BYTES`) **without visibly degrading it**, then let the user
publish it. The AI gets one new orchestration capability — `optimize_geometry` — that
drives the **already-existing** toolbar/editor geometry primitives toward a target byte
budget over the **whole bound dataset**, off the main thread, reporting before/after
metrics and validating topology. Delivers GEO-01, GEO-02, GEO-03.

**Critical framing (locked by the user):** the geometry math already exists and is already
exposed in the toolbar — *and already registered as AI tools* (`kind:'editor'`, via
`registerEditorCommands()`):
- `simplify_selected_features` → `editor.simplifySelectedFeatures(tolerance)` (turf simplify)
- `merge_selected_features` → `editor.combineSelectedFeatures()` (merge-to-multi)
- `connect_selected_lines` / `dissolve_selected_lines` → `editor.dissolveSelectedLines(tolerance)`
  (tolerance-based line join = the **microgap stitch** primitive)

Phase 7 does **NOT** reimplement simplify / merge / stitch. It adds the *orchestration layer*
that (a) runs these over ALL bound features by id (not just the selection), (b) off-thread,
(c) converges on a byte budget, (d) preserves per-feature properties through merge (the one
gap the existing primitives do NOT cover — see D-05), and (e) emits a unified before/after +
topology report that flows through the Phase 5 gate. This clarifies HOW to implement
GEO-01/02/03 — it adds no capability beyond them.

**Discussion scope note:** The user deep-dived **Budget-loop orchestration** (D-01…D-04).
The other three areas — **merge property preservation (D-05)**, **quality guardrail (D-06)**,
and **publish hand-off / unreachable-budget fallback (D-07)** — were captured as recommended
defaults for the planner to confirm. They remain in phase scope; surface real options to the
user during planning only if genuine ambiguity blocks planning.

</domain>

<decisions>
## Implementation Decisions

### Budget-loop orchestration (GEO-01) — deep-dived with the user
- **D-01: One deterministic host-side `optimize_geometry` tool drives the loop** (user choice).
  Not the model agentically calling per-op tools in a loop. The host owns the pipeline,
  operating over ALL bound features by id (SAFE-05 carry-forward) — never the model's compacted
  context view. Mirrors the "host-side deterministic rule over the full bound dataset" pattern
  from Phases 5 and 6 (`runFixAllRule` / `gateBulkApply`). Off-thread execution (GEO-01 mandates
  "off the main thread") is a hard constraint — the precedent is `src/features/chat/ingest/ingest.worker.ts`;
  researcher resolves the exact worker seam (the geometry transforms are pure turf, so they port
  to a worker cleanly; results apply back on the main thread through the gate).
- **D-02: Fixed full pipeline in fixed order** (user choice) — **stitch microgaps → merge-to-multi →
  simplify**, each stage a no-op when it does not apply (e.g. no lines → stitch is a no-op; <2
  compatible features → merge is a no-op). Deterministic, predictable, one consistent report.
  NOT "AI selects stages" and NOT "host auto-selects per geometry type" — both were offered and
  declined in favor of the simplest deterministic path. (A stage may still internally skip
  inapplicable features, but the *pipeline* always runs all three.)
- **D-03: Binary-search the simplify tolerance to the budget** (user choice). Search tolerance
  between min/max bounds to land *just under* the byte budget (fewest vertices removed to clear the
  limit — best quality-for-budget), bounded iterations. **Stops early** if the quality guardrail
  (max tolerance / a topology break, see D-06) is hit before the budget is reached → best-effort +
  honest report rather than shredding the shape. NOT an escalating fixed-step ladder (can overshoot)
  and NOT a single AI-chosen pass (rarely lands on budget). Note: only the *simplify* stage is
  tolerance-searched; stitch + merge run once up front (they shrink bytes structurally before the
  simplify search begins).
- **D-04: The tool takes only an optional target byte budget** (user choice). Everything else —
  which stages, tolerance bounds, microgap threshold — is host-internal and NOT exposed to the model.
  **Default budget = `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (1MB)**, the existing publish/city-dialog limit.
  Minimal model surface, hardest to misuse. NOT "target + coarse knobs" and NOT "target + full params".
  (Planner: if the user later wants to scope optimization to a subset of features, the Phase-6 D-06
  predicate engine is the clean place to add an optional `where` — but ship the no-arg/target-only
  surface first.)

### Gate integration (GEO-02 before/after) — deep-dived with the user
- **D-04b: One before/after preview as a SINGLE gate block** (user choice). The whole optimization
  (all three stages + the converged result) surfaces as one Phase-5 diff/preview block —
  headline metrics (byte size, vertex count, feature count, microgap join count) + confirm/cancel —
  applied as ONE undoable snapshot (Phase 5 D-11: "one confirmed apply = one undo step"). The model
  never sees intermediate per-stage states; the user sees the net result and accepts/rejects it whole.
  Reuse `gateBulkApply` (Phase 6 06-05) — optimization is classified `modify` and flows through the
  existing gate; the diff headline must be **metrics-aware** (mirrors Phase 6 D-02's style-aware
  `~N restyled` headline) so it reads as an optimization summary, not a wall of geometry edits.

### Merge property preservation (GEO-05) — RECOMMENDED DEFAULT, planner to confirm
- **D-05: Properties must survive merge — the existing primitive is LOSSY and must NOT be reused as-is
  for the optimizer's merge step.** `CombineManager.combineSelectedFeatures()` builds the multi from
  `template = cloneFeature(selected[0])` (`CombineManager.ts:43`) — it keeps ONLY the first feature's
  properties and discards the rest. GEO-02 explicitly requires "per-feature properties preserved
  through merge," so the optimizer cannot call the toolbar merge verbatim.
  **Recommended default:** the optimizer's merge step only merges features whose **properties are
  identical** (lossless, safe, deterministic) — features with differing properties are left as
  separate geometries (they still get simplified/stitched). This satisfies "properties preserved"
  with zero ambiguity and no schema change. Alternatives the planner may weigh if identical-only
  merges too little: (b) carry a per-part property array on the multi-feature; (c) merge by
  attribute-group (Phase-6 D-06 predicate) keeping the group's shared props. Option (a) is the
  recommendation — start lossless. **Planner: re-engage the user only if (a) demonstrably fails the
  GEO-03 acceptance dataset.**

### Quality guardrail (GEO-02 "no visible degradation") — RECOMMENDED DEFAULT, planner to confirm
- **D-06: Topology validation is a HARD gate on the converge loop, plus an aggressiveness ceiling.**
  Reuse Phase 6's read-only `validateGeometryFeatures` (`geometryValidation.ts` — turf `kinks`
  self-intersection, near-zero-area sliver, invalid-ring). The binary search REJECTS any tolerance
  step that introduces NEW self-intersections or zero-area collapse relative to the input (GEO-02:
  "no new self-intersections or zero-area collapse"), backing off to the last good tolerance. Plus a
  hard ceiling on simplify tolerance (`SIMPLIFY_TOLERANCE_MAX` already exists in `SimplifyDialog.tsx`)
  so budget-chasing can't shred the shape even if topology stays technically valid. The Phase-5
  before/after diff (D-04b) is the human eyeball backstop. Net: the loop optimizes as far as it can
  WITHOUT degrading topology or exceeding the ceiling, then reports — it never sacrifices quality to
  force the budget.

### Publish hand-off & unreachable-budget fallback (GEO-03) — RECOMMENDED DEFAULT, planner to confirm
- **D-07: Optimize → user reviews the before/after → user publishes via the normal flow; fall back to
  the existing Blossom escape hatch when the budget is unreachable.** Do NOT auto-publish — the gate's
  confirm + the existing `usePublishing` flow stay the explicit publish action (consistent with the
  "explicit verbs / nothing auto-promotes" PROJECT.md discipline). If the budget is UNREACHABLE
  without breaking the D-06 guardrail, the optimizer stops at best-effort, reports honestly (mirrors
  Phase 3/6 no-silent-truncation: "reduced 12MB → 1.4MB; still over the 1MB limit"), and the dataset
  can still be published via the **already-existing Blossom external-upload path** (`BlossomUploadDialog`
  / `usePublishing` `isOverSizeLimit`) — optimization makes the blob smaller even when it can't
  eliminate it. The GEO-03 acceptance bar (12MB "West Pacific Trail" → under 1MB → published) is the
  headline target the loop must clear at preserved visual quality.

### Claude's Discretion / planner's discretion
- The exact off-thread worker seam (new `optimize.worker.ts` mirroring `ingest.worker.ts`, vs. another
  transport) — researcher/planner decides; the geometry transforms are pure turf so any worker works.
  Watch the known dev-mode worker `file://` URL landmine (see `.planning/debug/sandbox-worker-file-url-dev.md`).
- Microgap threshold default — reuse `dissolveSelectedLines`' existing default tolerance (`0.00001`)
  unless the GEO-03 dataset needs tuning; expose it host-internal only (D-04).
- Binary-search iteration cap and convergence epsilon — planner's discretion; pick a small bounded
  count (the budget is monotonic in tolerance, so ~8–12 iterations suffice).
- Whether `optimize_geometry` registers in `bulk-tools.ts` (Phase 6 registrar) or a new
  `geometry-tools.ts` registrar — planner's discretion; follow the injected-`register` idiom either way.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — GEO-01, GEO-02, GEO-03 (all `[E]` effort-flagged); plus the
  anti-patterns table.
- `.planning/ROADMAP.md` §"Phase 7: Geometry Optimization" — goal + 3 success criteria (verbatim
  acceptance conditions); dependency on Phase 5 (gate), Phase 3 (off-thread ingest), Phase 2 (Authoring API).
- `.planning/PROJECT.md` — milestone goal; **user story #5** (12MB messy "West Pacific Trail" → ~900KB
  at same visual quality, clearing the city-dialog size complaints) is the headline acceptance bar.

### Existing geometry primitives to REUSE (do NOT reimplement) — READ FIRST
- `src/features/geo-editor/commands.ts` — `simplify_selected_features`, `merge_selected_features`,
  `split_selected_features`, `connect_selected_lines` / `dissolve_selected_lines` editor commands,
  each with an `ai.toolName`; these are the primitives the optimizer orchestrates.
- `src/features/geo-editor/core/managers/SimplifyManager.ts` — `simplifySelectedFeatures(tolerance)`
  (turf simplify + skip-if-unchanged + history). The simplify stage's engine.
- `src/features/geo-editor/core/managers/CombineManager.ts` — `combineSelectedFeatures()` (merge-to-multi)
  — **NOTE the property-loss bug at line 43** (`template = cloneFeature(selected[0])`); D-05 must work
  around it.
- `src/features/geo-editor/core/managers/TransformManager.ts` — `simplify(feature, tolerance)` low-level.
- line-ops manager behind `editor.dissolveSelectedLines(tolerance)` (microgap stitch); default tolerance `0.00001`.
- `src/lib/geo/geometry.ts` — `countGeometryVertices`, `isSimplifiableGeometryType` (metric helpers).
- `src/features/geo-editor/components/toolbar/SimplifyDialog.tsx` — existing manual simplify UI with
  byte/vertex before/after metrics + the 1MB limit display + `SIMPLIFY_TOLERANCE_MIN/MAX` bounds; the
  metrics-assembly + tolerance-bound precedent for the optimizer's report and D-06 ceiling.

### The gate this phase plugs into (Phase 5 + Phase 6)
- `.planning/phases/05-dataset-aware-safe-editing/05-CONTEXT.md` — binding chip, add/modify/delete
  classification, diff = counts-headline + expandable list (D-05), per-apply snapshot/undo (D-11),
  SAFE-05 host-side over-ALL-ids.
- `.planning/phases/06-ai-bulk-transform-data-driven-styling/06-CONTEXT.md` — `gateBulkApply`
  (snapshot → real apply → classify → confirm/cancel), host-side-over-all-ids `runFixAllRule`,
  the bulk-tools registrar idiom, style-aware diff headline precedent (D-02).
- `src/features/geo-editor/api/interceptor.ts` — `runInterceptors({intent, featureIds})`, THE gate point.
- `src/features/geo-editor/api/authoring.ts` — single mutation seam (`modifyFeature` / `deleteFeatures` /
  `writeGeoJSON`); the optimizer applies its converged result through here, never bypassing it.
- `src/features/chat/tools/bulk-tools.ts` — `registerBulkTools` + `gateBulkApply` usage; the closest
  analog for where/how `optimize_geometry` registers and gates.

### Topology validation (GEO-02 guardrail)
- `src/features/geo-editor/api/geometryValidation.ts` — read-only `validateGeometryFeatures`
  (turf `kinks` / zero-area / invalid-ring); `ZERO_AREA_THRESHOLD_M2`. The D-06 hard-gate check.

### Off-thread precedent + size limit + publish/Blossom
- `src/features/chat/ingest/ingest.worker.ts` — the in-repo off-thread worker pattern for GEO-01.
- `.planning/debug/sandbox-worker-file-url-dev.md` — known dev-mode worker `file://` URL landmine to avoid.
- `src/features/geo-editor/constants.ts:26` — `BLOSSOM_UPLOAD_THRESHOLD_BYTES = 1024 * 1024` (the budget default).
- `src/features/geo-editor/hooks/usePublishing.ts` — `isOverSizeLimit` / `getCollectionSize` /
  `currentCollectionSize` / `sizeThreshold`; the publish flow + size gate the optimizer feeds (GEO-03).
- `src/components/BlossomUploadDialog.tsx`, `src/components/info-panel/DatasetSizeIndicator.tsx` — the
  existing external-upload escape hatch (D-07 fallback when budget unreachable).

### Tool registry
- `src/features/chat/tools/registry.ts` — central typed registry; `registerEditorCommands()` (proves the
  editor primitives are already AI tools); injected-`register` idiom for new tool registrars.

No external ADRs/specs beyond the above — requirements fully captured in REQUIREMENTS.md + these decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **simplify / merge / stitch engines already exist** (`SimplifyManager`, `CombineManager`, line-ops,
  `TransformManager.simplify`, turf) AND are already AI tools — the optimizer composes them; no new geo math.
- `SimplifyDialog.tsx` — before/after byte+vertex metrics assembly + tolerance bounds (`SIMPLIFY_TOLERANCE_MIN/MAX`)
  + 1MB-limit display: directly informs the optimizer's report (GEO-02) and the D-06 aggressiveness ceiling.
- `geometryValidation.ts` (Phase 6) — read-only topology report; the D-06 hard guardrail with zero new code.
- `gateBulkApply` + `runFixAllRule` (Phase 6) — host-side-over-all-ids apply through the Phase-5 gate;
  the optimizer's apply path (one snapshot, one undo, one before/after diff — D-04b).
- `ingest.worker.ts` (Phase 3) — the off-thread worker pattern for GEO-01.
- `BLOSSOM_UPLOAD_THRESHOLD_BYTES` + `usePublishing` + `BlossomUploadDialog` — budget default, publish
  flow, and the D-07 unreachable-budget fallback, all already built.

### Established Patterns
- All AI map mutation funnels through `createAuthoring(editor)` → `runInterceptors` → the Phase-5 gate;
  the optimizer's converged result applies through this chokepoint, never a bypass.
- Host-side rule over ALL bound features by id (SAFE-05 / Phase 6 `runFixAllRule`) — the optimizer
  reads the full id-keyed set via `editor.getAllFeatures()`; schema exposes NO feature array.
- Tools self-register with a mandatory `kind` (Phase 2 D-03); errors use the D-16 contract.
- No-silent-truncation reporting (Phase 3/6) — the optimizer reports honestly when it can't hit budget (D-07).

### Integration Points
- New `optimize_geometry` tool lives in `src/features/chat/tools/` (bulk-tools.ts or a new geometry-tools.ts),
  reads the full bound dataset, runs the off-thread converge loop, and applies the result through `gateBulkApply`.
- The before/after metrics + topology + microgap-join-count report renders in the Phase-5 inline diff block.
- Result size feeds `usePublishing.isOverSizeLimit`; under-limit → normal publish; over-limit → Blossom path.

</code_context>

<specifics>
## Specific Ideas

- PROJECT.md user story #5 is the acceptance bar and the GEO-03 test fixture: a 12MB messy
  "West Pacific Trail" GeoJSON (hundreds of polylines, microgaps, superfluous vertices) → ~900KB at the
  same visual quality → clears the city-dialog size limit → publishes.
- The user's framing — "most of these functions are already exposed in the toolbar" — is the central
  constraint: Phase 7 is an *orchestration + budget-convergence + off-thread + property-preserving-merge +
  report* layer, NOT a reimplementation of simplify/merge/stitch. Reuse the existing engines.

</specifics>

<deferred>
## Deferred Ideas

- **AI-selected / host-auto-selected pipeline stages** — letting the model or the host pick which of the
  three stages to run per dataset. Declined in favor of the fixed full pipeline (D-02); revisit only if
  the fixed pipeline proves wasteful on certain dataset shapes.
- **Coarse/full param exposure to the model** (aggressiveness level, per-stage toggles, tolerance bounds) —
  declined in favor of target-only (D-04). A clean later add if users want more control.
- **Optional `where` predicate to scope optimization to a feature subset** — not needed for the GEO-03
  story; the Phase-6 D-06 predicate engine is the clean hook if it becomes a real need.
- **Per-part property array on merged multi-features / merge-by-attribute-group** — D-05 alternatives held
  in reserve behind the lossless identical-only default.

None of the above expand Phase 7 scope; they are future considerations.

</deferred>

---

*Phase: 7-geometry-optimization*
*Context gathered: 2026-06-22*
