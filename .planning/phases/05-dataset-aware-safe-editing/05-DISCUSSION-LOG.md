# Phase 5: Dataset-Aware Safe Editing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-20
**Phase:** 5-dataset-aware-safe-editing
**Areas discussed:** Binding model, Diff/preview surface, Safety-level semantics, Undo/snapshot mechanism

---

## Binding model (SAFE-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-bind to the open draft/dataset | Chat binds to the currently-open dataset/draft; chip reflects it; switching re-binds | ✓ |
| Explicit pick + switch | User must select the bound target before the AI can mutate | |
| Hybrid: auto-bind, lockable | Auto-bind but allow explicit switch/lock | |

**User's choice:** Auto-bind to the open draft/dataset.

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create a draft + bind, then proceed | Create untitled draft, bind, show chip, proceed when nothing bound | ✓ |
| Refuse until bound | AI declines mutation, prompts user to bind/create first | |

**User's choice:** Auto-create a draft + bind, then proceed.

---

## Diff / preview surface (SAFE-02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline chat block + map highlight | Diff in transcript + ghost/highlight on map | |
| Inline chat block only | Diff summary in transcript; no map overlay | ✓ |
| Map overlay only | Ghost/highlight on map with confirm controls there | |
| Dedicated side panel | Separate diff/review panel | |

**User's choice:** Inline chat block only. (Map overlay noted as a deferred enhancement.)

| Option | Description | Selected |
|--------|-------------|----------|
| Counts + expandable per-feature list | `+3 · ~2 · −1` headline, expand to detail | ✓ |
| Aggregate counts only | Just the counts | |
| Full per-feature list always | Every change listed, no collapse | |

**User's choice:** Counts + expandable per-feature list.

---

## Safety-level semantics (SAFE-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Modify + delete of existing features | Adds free; any change/removal of existing features gated | ✓ |
| Delete / overwrite only | Only deletes + full replaces gated | |
| Delete only | Only deletions gated | |

**User's choice:** Modify + delete of existing features.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline Apply/Cancel in the chat diff block | Confirm buttons in the transcript diff block | ✓ |
| Blocking modal dialog | Separate modal to confirm | |

**User's choice:** Inline Apply/Cancel in the chat diff block.

---

## Undo / snapshot mechanism (SAFE-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Dataset snapshot before each apply (separate stack) | Snapshot full dataset state before apply; separate from geometry-only HistoryManager | ✓ |
| Extend HistoryManager to cover all edit types | Unified history incl. property/style/translation | |

**User's choice:** Dataset snapshot before each apply (separate stack).

| Option | Description | Selected |
|--------|-------------|----------|
| Per confirmed apply (the diff you approved) | Each approved diff = one undo step | ✓ |
| Per chat turn | Whole AI turn = one undo step | |
| Per individual operation | Every mutation its own undo step | |

**User's choice:** Per confirmed apply.

---

## Claude's Discretion

- Undo trigger surface (Cmd+Z integration + a chat-accessible "undo last AI edit").
- Snapshot storage strategy for large datasets (must avoid OOM-class memory pressure).
- Binding-chip visual treatment (reuse existing chip/badge primitives within brand).

## Deferred Ideas

- Map-overlay (ghost/highlight) diff visualization — considered for the preview surface, scoped out in favor of inline-chat-only; natural later enhancement.
