# Phase 6: AI Bulk Transform & Data-Driven Styling - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 6-ai-bulk-transform-data-driven-styling
**Areas discussed:** Styling model, Batch transform labor

**Area selection:** From four offered gray areas (Styling model, Batch transform labor, Dedup & select, Geometry validation), the user selected **Styling model** and **Batch transform labor**. Dedup & Geometry validation were left unlocked and captured as open research/planning items in CONTEXT.md.

---

## Styling model

### Q1 — Storage & rendering of an attribute-rule style

| Option | Description | Selected |
|--------|-------------|----------|
| Materialize per-feature | Resolve rule host-side, write canonical style props onto each matching feature. Free round-trip via kind 37515 FeatureCollection; no LayerManager/event change. | ✓ |
| Stored rule (data-driven) | Persist rule as a dataset-level spec; LayerManager generates MapLibre match/case expression. True live styling; needs new event slot + LayerManager work. | |
| You decide | — | |

**User's choice:** Materialize per-feature.
**Notes:** STYLE-02 is satisfied for free (styles are feature properties; LayerManager already paints from `['get', key]`). "Attribute rule" interpreted as tool ergonomics (one call, no O(N) loop), not live storage.

### Q2 — How style-only changes flow through the Phase 5 gate

| Option | Description | Selected |
|--------|-------------|----------|
| Style = non-destructive | New "restyle" class, apply freely + snapshot for undo. | |
| Style stays gated | Restyle is a modify; confirm at Level 2 with style-aware diff. | |
| You decide | — | ✓ |

**User's choice:** You decide.
**Notes:** Claude recommendation recorded as D-02 — keep restyle as `modify` (no new intent class), make the diff style-aware (`~N restyled`), lean on Phase 5's auto-accept Level-3 toggle as the friction escape hatch. "Restyle as non-destructive class" flagged as optional research refinement.

### Q3 — Features matching no style bucket

| Option | Description | Selected |
|--------|-------------|----------|
| Leave untouched | Rule only writes named buckets; everything else unchanged. | |
| Default/fallback style | Apply a fallback (e.g. neutral gray) to all non-matching features. | |
| You decide | — | ✓ |

**User's choice:** You decide.
**Notes:** Claude recommendation recorded as D-03 — leave unmatched untouched by default (smallest diff), with an optional explicit fallback bucket so the model can do "everything else gray" only when asked.

---

## Batch transform labor

### Q1 — Division of work between model and host

| Option | Description | Selected |
|--------|-------------|----------|
| Two modes, one tool | Declarative rule (mechanical, host-side over all features) + explicit id→value map (model-computed for translate/summarize). | |
| Declarative rule only | Only mechanical rules; intelligence edits pushed onto other surfaces (risks O(N) loop). | |
| You decide | — | ✓ |

**User's choice:** You decide.
**Notes:** Claude recommendation recorded as D-04 — two modes in one tool. Covers user-story-4 (fill missing / translate / rewrite) without an O(N) tool-call loop.

### Q2 — Scaling intelligence edits beyond the model's view

| Option | Description | Selected |
|--------|-------------|----------|
| Host-chunked pagination | Host feeds dataset to model in batches for full coverage; more orchestration. | |
| Bounded best-effort | Cover what's processed this turn + explicit skipped-remainder report; declarative rules stay unbounded. | |
| You decide | — | ✓ |

**User's choice:** You decide.
**Notes:** Claude recommendation recorded as D-05 — bounded best-effort with no-silent-truncation report (mirrors `batch_geocode`); mechanical declarative rules remain the unbounded host-side path. Host-chunked pagination deferred. Research note: pick a per-call feature cap (~50).

### Q3 — Shared select-by-attribute predicate engine

| Option | Description | Selected |
|--------|-------------|----------|
| Shared predicate engine | One select-by-attribute primitive reused by batch-edit, styling, dedup (also satisfies TOOLS-03 select half). | |
| Per-tool selectors | Each tool defines its own targeting; risks divergent dialects. | |
| You decide | — | ✓ |

**User's choice:** You decide.
**Notes:** Claude recommendation recorded as D-06 — one shared, minimal, host-side predicate engine in the AI-free Authoring API layer. Satisfies the select half of TOOLS-03 in passing.

---

## Claude's Discretion

- Gate treatment of restyle (D-02), unmatched-feature fallback (D-03), batch labor split (D-04), intelligence-edit scaling (D-05), shared predicate engine (D-06) — all "you decide"; recommendations recorded in CONTEXT.md with rationale, open to override at plan review.
- TOOLS-03 dedup semantics and TOOLS-04 geometry-validation scope — undiscussed by user choice; captured as open research/planning items.
- "Missing" semantics for fill-if-missing, template syntax, style-aware diff rendering, exact predicate surface — planner discretion within the recorded decisions.

## Deferred Ideas

- Stored data-driven style rule (live MapLibre expression persisted on dataset) — rejected in favor of materialize-per-feature.
- Restyle as a dedicated non-destructive intent class — optional refinement if gated demo feels heavy.
- Host-chunked multi-turn pagination for intelligence edits — clean later add if large-dataset translation need emerges.
