# Phase 7: Geometry Optimization - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 7-geometry-optimization
**Areas discussed:** Budget-loop orchestration (deep-dived). Merge property preservation, Quality guardrail, Publish hand-off — captured as recommended defaults (user deferred to defaults).

---

## Gray-area selection

Presented four gray areas (budget convergence, merge-to-multi & properties, microgap stitching, quality guardrail). The user's first response was a steering constraint rather than a selection: **"Keep in mind that we have most of these functions already exposed in the toolbar."**

This was investigated and confirmed: `simplify_selected_features`, `merge_selected_features`, `connect_selected_lines`/`dissolve_selected_lines` already exist as editor commands AND are already registered as AI tools (`kind:'editor'`). The steer was locked as the central framing — Phase 7 reuses existing primitives and adds only the orchestration layer. Gray areas were re-presented, reframed around what's genuinely new. The user then selected **"Who drives the budget loop"** to deep-dive.

---

## Budget-loop orchestration

### Q1 — Which stages run on a given dataset?

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed full pipeline | Always run all three in fixed order (stitch → merge → simplify), each a no-op when N/A. Deterministic. | ✓ |
| AI selects stages | Model inspects dataset/validation report and picks stages. Tailored but non-deterministic. | |
| Host auto-selects | Optimizer decides per-stage applicability from geometry types/metrics. Deterministic but adaptive. | |

**User's choice:** Fixed full pipeline.

### Q2 — How to search for the budget-hitting tolerance?

| Option | Description | Selected |
|--------|-------------|----------|
| Binary search to budget | Binary-search simplify tolerance to land just under budget; early-stop on quality guardrail. Best quality-for-budget. | ✓ |
| Escalating fixed steps | Try a fixed tolerance ladder, stop at first that clears budget. Simpler but can overshoot. | |
| Single pass, AI-chosen | Model picks one tolerance up front, one pass. Fast but rarely lands on budget. | |

**User's choice:** Binary search to budget.

### Q3 — Tool input surface + default budget?

| Option | Description | Selected |
|--------|-------------|----------|
| Just an optional target | Tool takes only an optional target byte budget; default = 1MB BLOSSOM_UPLOAD_THRESHOLD_BYTES. Minimal surface. | ✓ |
| Target + coarse knobs | Target + aggressiveness level + optional scope predicate. More expressive. | |
| Target + full params | Expose tolerance bounds, microgap threshold, per-stage toggles. Max control, max misuse risk. | |

**User's choice:** Just an optional target.

### Q4 — How does it present through the Phase 5 gate?

| Option | Description | Selected |
|--------|-------------|----------|
| One before/after preview | Whole optimization shows as a single before/after gate block; one undoable snapshot. Model never sees intermediates. | ✓ |
| Metrics-only, then gate | Return metrics first (no map change), require a second explicit apply call that goes through the gate. | |
| You decide | Pick whichever integrates most cleanly with gateBulkApply. | |

**User's choice:** One before/after preview.

---

## Claude's Discretion (defaults captured for planner to confirm)

- **Merge property preservation (D-05):** existing `combineSelectedFeatures` is property-lossy (keeps only feature[0]'s props, `CombineManager.ts:43`); GEO-02 forbids that. Recommended default: merge only features with identical properties (lossless). Alternatives (per-part property array, merge-by-attribute-group) held in reserve.
- **Quality guardrail (D-06):** topology validation (Phase 6 `validateGeometryFeatures`) as a hard gate on the converge loop + a simplify-aggressiveness ceiling; Phase-5 before/after diff as human eyeball.
- **Publish hand-off (D-07):** optimize → review → user publishes via normal flow (no auto-publish); fall back to the existing Blossom external-upload path when budget is unreachable, with honest best-effort reporting.
- Off-thread worker seam, microgap default tolerance, binary-search iteration cap, and registrar location (bulk-tools vs new geometry-tools) — planner's discretion within the decisions above.

## Deferred Ideas

- AI-selected / host-auto-selected pipeline stages (declined in favor of fixed full pipeline).
- Coarse/full param exposure to the model (declined in favor of target-only).
- Optional `where` predicate to scope optimization to a feature subset (Phase-6 D-06 hook if needed).
- Per-part property array on merged multis / merge-by-attribute-group (D-05 alternatives in reserve).
