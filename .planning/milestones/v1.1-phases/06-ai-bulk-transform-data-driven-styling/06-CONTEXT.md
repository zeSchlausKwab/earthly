# Phase 6: AI Bulk Transform & Data-Driven Styling - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Rule-based, gated cleanup of a whole **bound** dataset. The AI gets four new capabilities, all built on the Phase 2 Authoring API facade and all destructive ops flowing through the Phase 5 safe-editing gate:

- **TOOLS-02** — batch attribute-edit: set/modify properties across many features by rule (fill missing descriptions, rewrite/translate names).
- **TOOLS-03** — select-by-attribute + dedup.
- **TOOLS-04** — geometry-validation tool that *reports* topology problems (self-intersections, gaps, slivers).
- **STYLE-01 / STYLE-02** — data-driven attribute-rule styling (color/stroke/width by attribute) that persists and round-trips through the kind 37515 event.

This phase clarifies HOW to implement these requirements — it adds no capability beyond TOOLS-02/03/04 + STYLE-01/02. Every modify/delete passes through the existing interceptor seam (`runInterceptors`) and the Phase 5 diff/preview gate. Bulk transforms apply **host-side over ALL bound features by id**, never the model's compacted context view (Phase 5 SAFE-05 carry-forward).

**Discussion scope note:** The user chose to deep-dive **Styling model** and **Batch transform labor**. **Dedup semantics (TOOLS-03 dedup half)** and **Geometry validation (TOOLS-04)** were NOT discussed — they remain in phase scope but are unlocked. See `<decisions>` → "Undiscussed — open for research/planning" and surface real options to the user during planning if genuine ambiguity remains.

</domain>

<decisions>
## Implementation Decisions

### Data-driven styling (STYLE-01 / STYLE-02)
- **D-01:** **Materialize the rule per-feature.** The style tool resolves an attribute rule host-side and writes canonical style properties (`fillColor`/`strokeColor`/`strokeWidth`/`fillOpacity`/`strokeOpacity`/`radius`/`color`/`lineDash`, per `styleProperties.ts`) onto each matching feature's GeoJSON properties. STYLE-02 (round-trip through kind 37515) is satisfied **for free** because the event `content` IS the FeatureCollection and `LayerManager` already paints from `['get', <styleKey>]` — no LayerManager change, no new event schema. "Attribute rule rather than per-feature edits" (STYLE-01) is satisfied at the **tool-ergonomics** level: one rule call, not O(N) recolor calls (the anti-pattern the requirements explicitly forbid). The rule itself is NOT persisted as a live spec (see Deferred — stored data-driven rule).
- **D-02:** **Restyle is classified `modify` and stays in the Phase 5 gate** (Claude's discretion call — user said "you decide"). Rationale: avoids threading a new intent class through the interceptor / classification / undo; bulk restyle IS a sweeping visible change worth previewing. Mitigations: (a) the diff must be **style-aware** so the headline reads e.g. `~500 restyled` instead of a wall of geometry; (b) Phase 5's existing **auto-accept Level-3 toggle** is the friction escape hatch for trusting users (apply-without-confirm + undo). Research may revisit "restyle as a non-destructive class" only if the gated demo feels heavy (see Deferred).
- **D-03:** **Unmatched features are left untouched** (Claude's discretion — "you decide"). The rule only writes the buckets the user named; everything else keeps its current style (smallest diff, least destructive). The style tool accepts an **optional explicit fallback bucket** so the model can do "everything else → gray" only when the user actually asks.

### Batch attribute transform (TOOLS-02)
- **D-04:** **Two modes in one tool** (Claude's discretion — "you decide"). The batch-edit tool exposes both:
  - **(a) Declarative rule** for mechanical edits — predicate → set / copy / template / fill-if-missing over a property. Applied **host-side over ALL bound features by id** (SAFE-05), deterministic, no model round-trip, unbounded in size.
  - **(b) Explicit `id→value` map** for intelligence edits — the model reads feature properties (translate Arabic names, summarize descriptions), computes new values, and submits the map; the host applies it through the gate.
  This covers all of PROJECT.md user-story #4 (fill missing descriptions = declarative fill-if-missing OR model-generated; translate names = id→value; recolor = the STYLE tool, D-01) without an O(N) per-feature tool-call loop.
- **D-05:** **Intelligence edits are bounded best-effort with an explicit skipped-remainder report** (Claude's discretion — "you decide"). The model covers what it processes this turn and reports honestly (`translated 40 of 312; rerun to continue`), mirroring Phase 3's `batch_geocode` no-silent-truncation discipline. Mechanical declarative rules (D-04a) remain the **unbounded** host-side path for the common case. Host-chunked multi-turn pagination is deferred (see Deferred) — too much paid orchestration for a modest-sized demo. **Research note:** pick a sensible per-call feature cap for the intelligence path (à la `BATCH_GEOCODE_MAX_ROWS = 50`).

### Shared targeting (spans TOOLS-02 / TOOLS-03 / STYLE-01)
- **D-06:** **One shared select-by-attribute predicate engine** (Claude's discretion — "you decide"). A small, host-side, AI-free predicate language (eq / neq / exists / missing / contains / value-in-set / simple comparisons over `properties.*`) consumed by batch-edit (D-04), the style buckets (D-01/D-03), and dedup/select (TOOLS-03). One consistent targeting vocabulary for the model, one deterministic thing to unit-test, and it satisfies the **select** half of TOOLS-03 directly. Belongs in the AI-free Authoring API layer (Phase 2 D-07) since it's pure feature filtering. **Research note:** keep it minimal — enough for the user stories, NOT a full query DSL.

### Undiscussed — open for research/planning (still in phase scope)
- **TOOLS-03 dedup half:** what constitutes a duplicate (identical geometry / identical attributes / both) and which survivor is kept (keep-first / keep-last / merge-properties). Dedup is `modify`+`delete` → flows through the gate. The **select** half is covered by D-06.
- **TOOLS-04 geometry validation:** which checks (self-intersection via turf `kinks` is cheap; cross-feature gaps/slivers are materially harder), **report-only vs. report+suggest-fix** (roadmap says *reports* — fixing is Phase 7's domain), and how problems surface (chat report only vs. map highlight). Validation is read-only → does NOT pass through the destructive gate.
- Both were left unlocked because the user prioritized Styling and Batch transform. Planner/researcher should propose options and only re-engage the user if real ambiguity blocks planning.

### Claude's Discretion (summary)
- D-02, D-03, D-04, D-05, D-06 were all "you decide" — recommendations recorded above with rationale; the user may override any during plan review.
- Exact predicate-language surface (D-06), template syntax for declarative set/copy (D-04a), the style-aware diff rendering (D-02), and the dedup/validation shapes (above) are planner's discretion within these decisions.
- "Missing" semantics for fill-if-missing (absent key vs. null vs. empty string vs. whitespace) — planner's discretion; pick the obvious inclusive default and document it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — TOOLS-02 (`[D]`), TOOLS-03, TOOLS-04, STYLE-01 (`[D]`), STYLE-02; plus the anti-patterns table ("Per-feature manual recolor loop → styling by attribute rule instead").
- `.planning/ROADMAP.md` §"Phase 6: AI Bulk Transform & Data-Driven Styling" — goal + 4 success criteria (verbatim acceptance conditions); note dependency on Phase 5 (gate) and Phase 2 (Authoring API).
- `.planning/PROJECT.md` — milestone goal; **user story #4** (clean a convoluted context: fill missing descriptions, translate Arabic names, recolor ports/airports/waterways distinctly) is the headline acceptance bar for this phase.

### The safe-editing gate this phase plugs into (READ FIRST)
- `.planning/phases/05-dataset-aware-safe-editing/05-CONTEXT.md` — binding model, add/modify/delete classification, diff = counts-headline + expandable list (D-05), safety levels + Level-3 auto-accept toggle, per-apply snapshot/undo, and **SAFE-05 "host-side fix-all over ALL bound features by id"** which Phase 6 bulk ops MUST honor.
- `src/features/geo-editor/api/interceptor.ts` — `runInterceptors({intent, featureIds})`; THE gate point. New bulk modify/delete route through here.
- `src/features/geo-editor/api/authoring.ts` — the single mutation seam; already exposes `addFeature` / `writeGeoJSON` / `circle` / `buffer` / `modifyFeature` / `deleteFeatures` / `setDatasetMetadata`. Bulk tools compose these (or add bulk-aware methods) — no new bypass path.

### Authoring API layering & registry
- `.planning/phases/02-tool-registry-authoring-api/02-CONTEXT.md` — D-07 strict one-way layering (Authoring API is AI-free; the predicate engine D-06 belongs here), D-11 structured `MutationResult` returns, D-16 error contract; the typed tool registry every new tool registers into with a mandatory `kind`.
- `src/features/geo-editor/api/results.ts` — `MutationResult` / `MutationCounts` shape (feeds the gate diff headline).
- `src/features/chat/tools/registry.ts`, `definitions.ts`, `schemas.ts`, `execute.ts` — where the new batch-edit / select / dedup / validate / style tools register; `batch_geocode` in `src/features/chat/tools/ingest-tools.ts` is the precedent for bounded/throttled/no-silent-truncation batch tools (D-05).

### Styling (materialize-per-feature)
- `src/features/geo-editor/types/styleProperties.ts` — canonical style keys + defaults per geometry type; the materialize target for D-01.
- `src/features/geo-editor/core/managers/LayerManager.ts` — paints via `['coalesce', ['get','fillColor'], ['get','color'], …]` expressions; confirms per-feature style props render with NO LayerManager change.
- `src/features/geo-editor/api/styleOptions.ts` — existing per-feature style-option validation (`InvalidStyleOptionError`) reused by `circle`/`buffer`; the bulk style tool should reuse this validation surface.
- `src/lib/nostr/geo-event/cast.ts` + `factory.ts` — kind 37515 `content` is the raw FeatureCollection (no dataset-level style tag exists); confirms STYLE-02 round-trips via feature properties.

No external ADRs/specs beyond the above — requirements fully captured in REQUIREMENTS.md + these decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `authoring.ts` facade — `modifyFeature` / `deleteFeatures` already exist (added in Phase 5) and route through `runInterceptors`; bulk transforms build on this, no new mutation path.
- `styleOptions.ts` style validation + `styleProperties.ts` canonical keys — the bulk style tool materializes into these (D-01) and reuses `InvalidStyleOptionError` for self-correcting callers.
- `LayerManager` data-driven paint expressions — already read per-feature style props, so materialized styles render and round-trip with zero rendering change.
- `ingest-tools.ts` `batch_geocode` — the template for a bounded, throttled, de-duped, skip-and-report batch tool (D-05's intelligence path mirrors its no-silent-truncation reporting).
- Phase 5 gate (interceptor + diff/preview + snapshot/undo) — every destructive bulk op (batch modify, dedup delete, restyle) flows through it; nothing new to build for safety.
- `@turf/turf@^7.3.5` (installed) — `kinks` (self-intersection) for the easy TOOLS-04 check; geometry helpers for dedup geometry-equality.

### Established Patterns
- All AI map mutation funnels through `createAuthoring(editor)` → `runInterceptors` — single chokepoint; bulk tools must not bypass it.
- Tools register in the typed registry with a mandatory `kind` (Phase 2 D-03); errors use the D-16 contract (model loop + chat UI).
- No-silent-truncation reporting (Phase 3) — any bounded batch op reports what it skipped.
- AI-free Authoring API layer (Phase 2 D-07) — the predicate engine (D-06) and dedup/validation primitives belong here as pure geometry/feature logic, callable without the AI layer.

### Integration Points
- New bulk tools live in `src/features/chat/tools/` and call the Authoring API; bulk modify/delete classification + diff render in the Phase 5 chat gate.
- The shared predicate engine (D-06) is consumed by batch-edit, the style tool, and dedup/select — one primitive, three consumers.
- The style tool writes feature properties → the existing LayerManager render path → the kind 37515 publish/reload round-trip (STYLE-02).

</code_context>

<specifics>
## Specific Ideas

- PROJECT.md user story #4 is the acceptance bar: a single chat interaction cleans a convoluted context — fill missing descriptions, translate Arabic names, recolor ports/airports/waterways distinctly — "with the AI precisely aware of which dataset it edits and what already exists." The Phase 5 binding chip provides that awareness; this phase provides the transforms.
- The user consistently leaned toward "you decide" on implementation shape while keeping the **gate discipline** and **no O(N) recolor loop** as the fixed constraints — capture the recommendations but stay open to override at plan review.

</specifics>

<deferred>
## Deferred Ideas

- **Stored data-driven style rule** — persisting the attribute→style rule as a live spec on the dataset and generating a MapLibre `match`/`case` expression in LayerManager (so editing a feature's attribute auto-updates its color). Rejected in favor of materialize-per-feature (D-01); revisit only if live re-styling-on-attribute-edit becomes a real need. Would require a new kind-37515 persistence slot + LayerManager expression generation + precedence rules vs. per-feature overrides.
- **Restyle as a dedicated non-destructive intent class** — bypass the gate for pure style changes. Set aside in favor of classifying restyle as `modify` (D-02); an optional refinement if the gated demo feels heavy.
- **Host-chunked multi-turn pagination for intelligence edits** — host feeds the bound dataset to the model in bounded batches to fully cover datasets larger than the model's view. Deferred in favor of bounded best-effort (D-05); a clean later add if a large-dataset translation need emerges.

None of the above expand Phase 6 scope; they are future considerations.

</deferred>

---

*Phase: 6-ai-bulk-transform-data-driven-styling*
*Context gathered: 2026-06-21*
