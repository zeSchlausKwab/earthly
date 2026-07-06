---
phase: 10-story-article-37520
plan: 01
subsystem: nostr-data-layer
tags: [story, article, kind-37520, lifecycle, drafts, hooks]
requires:
  - "src/lib/nostr/article (ArticleFactory/Article/isArticle/ArticleContent — Phase 8)"
  - "src/lib/nostr/references.ts (extractReferencedCoordinates + setAddressReferenceTags)"
  - "src/lib/nostr/entityFactory.ts (SignerLike bare-sign contract)"
  - "src/features/geo-editor/store/persistence.ts (readScopedStorage/writeScopedStorage)"
  - "src/lib/nostr/hooks (useTimelineWithEose)"
provides:
  - "publishStory()/editStory() — single source-of-truth Story publish path (STORY-03/04)"
  - "readStoryDraft/writeStoryDraft/clearStoryDraft — local-first Story drafts (STORY-04)"
  - "useStories() — reactive isArticle-filtered kind-37520 Article timeline"
  - "src/lib/nostr/story barrel for Plans 02–04"
affects:
  - "Plan 02 (Story authoring panel) imports publishStory/editStory + drafts"
  - "Plan 03 (Story browse/read) imports useStories()"
  - "Plan 04 (proposal-accept republish) reuses editStory's tested code path"
tech-stack:
  added: []
  patterns:
    - "Thin lifecycle service wrapping a Phase-8 EntityFactory (mirrors GroupEditorPanel.handleSave, extracted to a standalone tested module)"
    - "Destructive naddr→a re-derivation on every publish (body is the single source of truth)"
    - "isArticle filter BEFORE castEvent in the timeline useMemo (SPEC-03 defensive skip)"
    - "Defensive keyed-map draft read over scoped localStorage primitives (mirrors draftSlice.ts)"
key-files:
  created:
    - "src/lib/nostr/story/lifecycle.ts"
    - "src/lib/nostr/story/lifecycle.test.ts"
    - "src/lib/nostr/story/draft.ts"
    - "src/lib/nostr/story/index.ts"
    - "src/lib/hooks/useStories.ts"
  modified: []
decisions:
  - "Mocked @/lib/nostr's publish via mock.module in lifecycle.test.ts (no live publish); asserted on the returned signed event"
  - "publishStory also runs modifyPublicTags(setAddressReferenceTags(...)) even though a fresh create has no prior a tags — keeps create/edit on one path"
  - "Built story/index barrel incrementally: lifecycle-only in Task 1 (draft.ts not yet present), added draft in Task 2 — each commit compiles"
metrics:
  duration: ~14m
  completed: 2026-06-27
---

# Phase 10 Plan 01: Story Data-Layer Service Summary

Shipped the Story (kind 37520) data-layer seam: a thin, tested wrapper over the
Phase-8 `ArticleFactory` that publishes/edits a Story while destructively
re-deriving the queryable `a` tags from the Markdown body's inline `nostr:naddr…`
refs on every publish (STORY-03), preserves the `d`-tag lineage on edit (STORY-04),
persists a local-first draft keyed by `d`-tag, and exposes a reactive
`isArticle`-filtered `useStories()` timeline — the seam the authoring/reading panels
in Plans 02–04 import. No UI in this plan.

## What Was Built

**Task 1 — `lifecycle.ts` + `lifecycle.test.ts` (TDD, STORY-03/04)**
- `publishStory(content, signer)` → `ArticleFactory.create` (new `d`) and
  `editStory(existing, content, signer)` → `ArticleFactory.modify` (preserves `d`).
- Both call `extractReferencedCoordinates(content.content ?? '')` then
  `.modifyPublicTags(setAddressReferenceTags(coords))` so `a` tags are destructively
  re-derived from the body on every publish, then `.sign(signer)` and
  `await publish(signed, { routing: 'outbox' })`. Service does not cast — the caller does.
- Malformed naddr handling is inherited from `naddrToCoordinate` returning null; no extra code.
- 5 behaviors GREEN: one valid ref → one `a`; malformed ref → zero `a`, no throw; two
  identical refs → deduped; edit preserves `d`; refs removed → stale `a` dropped.

**Task 2 — `draft.ts` + `useStories.ts` (STORY-04 draft, browse seam)**
- `StoryDraft = Pick<ArticleContent,'title'|'summary'|'image'|'content'> & { updatedAt }`;
  `readStoryDraft`/`writeStoryDraft`/`clearStoryDraft` over a single keyed map at base key
  `'earthly:story:drafts:v1'` via the existing `readScopedStorage`/`writeScopedStorage`
  primitives. `NEW_STORY_DRAFT_KEY = 'new-story'` sentinel for an unsaved draft. Malformed
  stored value → empty map, never throws.
- `useStories(additionalFilters = [{}])` copies `useGroups` exactly:
  `useTimelineWithEose([{...filter, kinds:[ARTICLE_KIND]}])` → `events.filter(isArticle).map(castEvent(…Article…))`
  in a `useMemo`, returns `{ events, eose }`. Filter precedes cast (the cast ctor throws on
  non-conforming events).

## Verification

- `bun test src/lib/nostr/story/lifecycle.test.ts` → 5 pass / 0 fail.
- `bun run build` → exits 0 (workers + bundle emitted).
- Full suite `bun test` → 687 pass / 0 fail (no regressions vs Phase-9 663/0 baseline).
- `bunx biome check` scoped to the 5 new files → clean (one import-format auto-fix applied).
- Acceptance greps all satisfied: `extractReferencedCoordinates` (5), `setAddressReferenceTags`
  (4), `ArticleFactory.modify` (1), zero `dangerouslySetInnerHTML`, `readScopedStorage|writeScopedStorage`
  (7), `isArticle` (3, applied before cast), `ARTICLE_KIND` (2), all four named exports present.

Note: the project-wide `bun run lint` script (biome over all 453 files) reports ~107
pre-existing errors in unrelated files — out of scope per the deviation scope boundary;
the new files are biome-clean when checked directly.

## Deviations from Plan

None — plan executed as written. Two planned-ambiguities resolved per the plan's own
guidance: (1) `publish` was mocked via `mock.module('@/lib/nostr', …)` rather than stubbed
inline (plan allowed either); (2) the `story/index.ts` barrel was built incrementally
(lifecycle-only at Task 1, draft added at Task 2) so each commit compiles — the plan's Task-1
action listed both exports, but `draft.ts` lands in Task 2.

## Threat Model Outcomes

- **T-10-01 (Tampering, naddr→`a`)** — mitigated. Malformed naddr excluded via
  `naddrToCoordinate`→null; asserted by lifecycle behavior 2 (zero `a`, no throw).
- **T-10-02 (DoS, useStories cast)** — mitigated. `isArticle` guard applied BEFORE `castEvent`
  in the useMemo; a malformed/legacy/forged kind-37520 event is dropped, cannot crash the map.
- **T-10-03 (Tampering, local draft)** — accepted as planned. Drafts local-only, pubkey-scoped;
  corrupted localStorage → empty map (defensive parse), no trust crossing.

## Known Stubs

None. All exports are wired to real factory/storage/timeline code paths; no placeholder data.

## Commits

- `b1ebc7f` feat(10-01): Story lifecycle service — publishStory/editStory with naddr→a re-derivation
- `0326375` feat(10-01): local-first Story draft helper + useStories() subscription

## Self-Check: PASSED

- FOUND: src/lib/nostr/story/lifecycle.ts, lifecycle.test.ts, draft.ts, index.ts
- FOUND: src/lib/hooks/useStories.ts
- FOUND commit b1ebc7f, FOUND commit 0326375
