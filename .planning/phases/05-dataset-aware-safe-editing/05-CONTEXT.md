# Phase 5: Dataset-Aware Safe Editing - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The safety gate between the AI and the user's dataset: a visible binding chip (what the AI is editing), add/modify/delete classification with a preview/diff before applying, a configurable safety level, and a dataset-level snapshot/undo. This gate MUST land before any destructive bulk tool (Phases 6–7). Delivers SAFE-01…06.

Implementation hooks into the existing **interceptor seam** (`runInterceptors`, Phase 4 D-03/D-08/D-12) — Phase 4 wired `add` through it with NO gate, leaving the gate for this phase. We are clarifying HOW to implement SAFE-01…06, not adding new capabilities.

</domain>

<decisions>
## Implementation Decisions

### Binding model (SAFE-01)
- **D-01:** **Auto-bind to the open draft/dataset.** The chat is bound to whatever dataset/draft is currently open in the editor; opening a different dataset re-binds; the binding chip just reflects the current target (no separate picker required). Matches the single-workspace model and how `run_code` already draws into the open draft.
- **D-02:** **Auto-create-and-bind when nothing is bound.** If the AI is asked to mutate and nothing is bound, create a new untitled draft, bind to it, show the chip, and proceed. The success-criterion "no mutating tool fires unless a target is bound and shown" is satisfied because binding is *created and shown* before the mutation — not by refusing.
- **D-03:** The binding chip shows the bound dataset's identity (name / unsaved-draft state / feature count). It is the user-visible anchor for "what the AI is working on."

### Diff / preview (SAFE-02 / SAFE-03)
- **D-04:** **Inline chat block only** for the preview — a collapsible diff block in the transcript, reusing the `CodeRunDisclosure` collapse language. No map ghost/overlay in this phase (map-overlay diff is a possible later enhancement, not now).
- **D-05:** **Granularity = counts headline + expandable per-feature list.** Headline like `+3 added · ~2 changed · −1 deleted`, expandable to the per-feature detail. Scales from tiny to large edits.
- **D-06:** Classification (SAFE-02): `add` = new feature id, `modify` = existing id whose geometry/properties/style change, `delete` = existing id removed — determined by diffing the proposed change against the **bound dataset's current features by id**.

### Safety levels (SAFE-04)
- **D-07:** **"Destructive" = modify + delete of existing features.** Pure adds proceed freely; anything that CHANGES or REMOVES existing features (in-place edits, deletes, overwrites/replaces) is gated. Level 2 (default) confirms those; Level 1 confirms everything (incl. adds); Level 3 = trust + undo (no confirm, snapshot taken for undo).
- **D-08:** **Confirm UX = inline Apply / Cancel buttons in the chat diff block** (D-04). Keeps the whole flow in the transcript; no modal.
- **D-09:** Safety level **persists via the Phase 1 encrypted settings** store (carry-forward). Shipped default = Level 2.
- **D-12:** **"Just accept" auto-accept toggle** — a prominent, one-click toggle (near the binding chip / in the chat, not buried in settings) that puts the user in **Level 3 (trust + undo)**: AI edits apply WITHOUT confirmation and the user relies on the dataset snapshot/undo (SAFE-06) as the backstop. It is the same persisted safety-level state (D-09) — the toggle is just the fast path between "confirm" and "auto-accept", not a separate parallel concept. Opt-in; shipped default stays Level 2. **Rationale:** recent Phase-4 hardening (dataset snapshot/undo, sandbox confinement, the safe Authoring API that throws-not-silently) materially lowers the severity of an unwanted edit, so an easy auto-accept-with-undo mode is acceptable and worth surfacing for trusting users. When auto-accept is on, the diff still renders (so the user can see what happened) — it just applies without gating, and remains undoable per D-10/D-11.

### Undo / snapshot (SAFE-06)
- **D-10:** **Dataset snapshot before each apply, as a SEPARATE stack** from the geometry-only `HistoryManager`. Snapshot covers the bound dataset's full state — geometry **and** property / style / translation / metadata edits — which `HistoryManager` does not cover today. Hook the existing undo trigger (Cmd+Z / editor undo) so it feels native.
- **D-11:** **Undo granularity = per confirmed apply.** Each approved diff (the unit the user confirmed) = one snapshot / one undo step. Undo reverts the last applied AI change as a whole.

### Claude's Discretion
- Undo trigger surface: integrate with the existing editor undo (Cmd+Z) AND expose a chat-accessible undo (e.g. an "Undo last AI edit" affordance near the applied diff block). Exact placement is Claude's discretion.
- Snapshot storage strategy for large bound datasets (full copy vs structural sharing vs bounded depth) — implementation detail for research/planning; must not reintroduce the OOM-class memory pressure seen in Phase 4.
- The binding-chip visual treatment (reuse existing chip/badge primitives) — Claude's discretion within brand.

### Open questions for research (gsd-phase-researcher)
- **Complete the Phase-2-deferred modify/delete authoring surface.** `authoring.ts` only exposes `add`/`writeGeoJSON`/`circle`/`buffer` today (all `intent:'add'` through `runInterceptors`); the A3 boundary test is `addFeature`-only. SAFE-02 classification + SAFE-06 undo need `modifyFeature`/`deleteFeatures` on the facade, all routed through the interceptor, with A3 tightened to all verbs. (Tracked as a deferred Phase-2 facade-expansion item.)
- **Where classification + gating live in the interceptor pipeline** vs. the chat apply path (the interceptor currently fires synchronously inside the mutation; the gate needs an async confirm before apply — research the right seam: buffer-then-apply at the chat layer, or an interceptor that can defer).
- **SAFE-05 host-side "fix all" by feature id**: the bound dataset (D-01) defines "the full dataset"; research how bulk transforms apply host-side over ALL bound features by id (never the model's compacted context view) so out-of-context features aren't silently skipped.
- **WR-04 (from 04-REVIEW.md):** the recorded-authoring write channel is uncapped at the interceptor seam — this phase owns that seam; cap/bound it as part of gating.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — SAFE-01…06 (SAFE-01/03/05 are `[D]` decision-flagged)
- `.planning/ROADMAP.md` §"Phase 5: Dataset-Aware Safe Editing" — goal + 4 success criteria

### The gate seam (where this phase plugs in)
- `src/features/geo-editor/api/interceptor.ts` — D-12 interceptor scaffold (`runInterceptors({intent, featureIds})`, default chain empty). THE gate point.
- `src/features/geo-editor/api/authoring.ts` — the single mutation seam; add/circle/buffer route through `runInterceptors` (intent:'add'); `setDatasetMetadata` is a benign non-gated metadata op; **modify/delete surface + A3 boundary still deferred** (complete here).
- `.planning/phases/02-tool-registry-authoring-api/02-CONTEXT.md` — Authoring API + interceptor decisions; the deferred modify/delete + A3 boundary item.
- `.planning/phases/04-code-interpreter-sandbox/04-CONTEXT.md` — D-03/D-08 (sandbox writes replay through `createAuthoring`→`runInterceptors`, no Phase-4 gate) and D-12.
- `.planning/phases/04-code-interpreter-sandbox/04-REVIEW.md` — WR-04 (uncapped authoring write channel at the interceptor seam).

### Undo, dataset identity, settings, UI
- `src/features/geo-editor/core/managers/HistoryManager.ts` — geometry-only undo/redo today (SAFE-06 needs broader coverage → separate snapshot stack).
- `src/features/geo-editor/store/metadataSlice.ts` — `collectionMeta` (dataset name/description/customProperties), the dataset-identity source for the binding chip.
- `.planning/phases/01-encrypted-settings-persistence/01-CONTEXT.md` — encrypted settings persistence (safety-level storage, SAFE-04).
- `src/features/chat/CodeRunDisclosure.tsx` — collapse/disclosure language to reuse for the inline diff block (D-04).

No external ADRs/specs beyond the above — requirements fully captured in REQUIREMENTS.md + these decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runInterceptors` / `interceptor.ts`: populate the (currently empty) chain with the classify→gate→preview/confirm logic — this is the designed extension point.
- `authoring.ts`: extend with `modifyFeature`/`deleteFeatures` (Phase-2-deferred) so all three intents flow through the gate.
- `CodeRunDisclosure.tsx`: the collapsed-block pattern for the inline diff (D-04/D-05) — consistent transcript language.
- `collectionMeta` (metadataSlice): dataset identity for the binding chip (D-03).
- Phase 1 encrypted settings: persist the safety level (D-09).
- `HistoryManager`: existing undo trigger to hook the new dataset-snapshot stack into (D-10).

### Established Patterns
- All AI map mutation already funnels through `createAuthoring(editor)` → `runInterceptors` (Phase 2/4) — single chokepoint, so the gate has one place to live.
- Chat tool results render as collapsible transcript blocks (CodeRunDisclosure) — the diff block follows suit.
- Per-feature style/metadata via canonical property keys (`fillColor`/`strokeColor`/`color`/…) from the Phase-4 styling work — the diff must account for style/property changes, not just geometry.

### Integration Points
- Chat ↔ editor: the binding chip + diff block live in the chat panel (`src/features/chat/`); the bound target reflects the editor's open dataset/draft.
- The interceptor seam is the boundary between "AI proposes" and "editor applies" — gating + snapshot + confirm wrap this transition.

</code_context>

<specifics>
## Specific Ideas

- Reuse the `CodeRunDisclosure` collapse idiom for the diff block so the safe-editing preview reads like the rest of the AI transcript.
- The binding chip + diff + confirm should keep the entire safe-edit flow in the chat transcript (no modals), matching the inline-everything direction established during Phase 4 UAT.

</specifics>

<deferred>
## Deferred Ideas

- **Map-overlay (ghost/highlight) diff** — visualizing the add/modify/delete on the map itself. Considered for the preview surface but scoped out (inline-chat-only chosen, D-04). A natural later enhancement.

None other — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-dataset-aware-safe-editing*
*Context gathered: 2026-06-20*
