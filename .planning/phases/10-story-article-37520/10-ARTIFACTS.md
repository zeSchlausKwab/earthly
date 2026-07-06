# Phase 10 — Artifacts & Source Coverage

**Created:** 2026-06-26 (planner)
**Plans:** 4 (10-01 … 10-04), 4 waves

This file is the phase-level manifest the `/gsd-execute-phase` consumer and the
plan-review-convergence source-grounding pass read. **Every symbol listed under
"Artifacts this phase produces" is NEWLY CREATED by Phase 10** — exclude these from
drift/source-grounding verification (they do not exist in the codebase before this phase).

---

## Artifacts this phase produces

### New components / panels
- `StoryEditorPanel` — `src/components/info-panel/StoryEditorPanel.tsx` (Plan 02) — create/edit Story authoring panel (Write/Preview tabs, metadata, draft, in-place edit)
- `StoriesPanelContent` — `src/components/StoriesPanel.tsx` (Plan 02) — Stories rail browse panel + New Story entry
- `StoryViewPanel` — `src/components/info-panel/StoryViewPanel.tsx` (Plan 03) — Story reading panel (sanitized narrative + inline eye-toggle/fly-to + comment/react mount)
- `StoryProposalsPanel` — `src/features/social/proposals/StoryProposalsPanel.tsx` (Plan 04) — author-side Proposed-edits list + diff preview + Accept/Reject
- `StoryProposeEditDialog` — `src/features/social/proposals/StoryProposeEditDialog.tsx` (Plan 04) — reader-side Propose-an-edit affordance

### New rail destination key / route path
- Rail destination key: `'stories'` — added to `WorkViewMode` union + `workNavItems` + `renderWorkContent` switch in `src/components/AppSidebar.tsx` (Plan 03), icon `BookOpen` (lucide)
- Route focus-type: `'story'` — added to `RouteState.focusType` / `isFocusType` in `useRouting.ts` and `RouteSnapshot.focusType` in `store/types.ts` (Plan 03)
- Deep-link route path: `/story/:naddr` (and `/story/:naddr/comment/:commentId`) — `useRouting` parse branch + `src/index.ts` OG crawler routes (Plan 03)
- In-app hash route: `/#/stories/story/:naddr` (the user-redirect target of handleStoryRoute)

### New hooks
- `useStories` — `src/lib/hooks/useStories.ts` (Plan 01) — reactive kind-37520 Article timeline (isArticle-filtered)
- `useStoryProposals` — `src/features/social/hooks/useStoryProposals.ts` (Plan 04) — kind-37519 proposals targeting a Story coordinate; accept (via editStory) / reject

### New helper / service functions
- `publishStory`, `editStory` — `src/lib/nostr/story/lifecycle.ts` (Plan 01)
- `readStoryDraft`, `writeStoryDraft`, `clearStoryDraft` — `src/lib/nostr/story/draft.ts` (Plan 01)
- `GeoProposalFactory.createForStory` (new static method) — `src/lib/nostr/geo-proposal/factory.ts` (Plan 04)
- `getProposalMarkdownContent`, `getProposalTargetKind` — `src/lib/nostr/geo-proposal/helpers.ts` (Plan 04)
- Store: `viewStory` slot + `setViewStory` — `src/features/geo-editor/store/viewModeSlice.ts` (Plan 03)
- OG: `fetchStoryOGData` / `fetchCachedStoryEventOGData` (`src/lib/og/fetchEvent.ts` + `cache.ts`), `generateStoryOGHtml` (`src/lib/og/template.ts`), `handleStoryRoute` (`src/index.ts`), `'story'` added to `OGCacheType` (Plan 03)

### Widened existing symbols (NOT new — these pre-exist; only the union/case is extended)
- `CommentsPanelProps.target`, `UseGeoCommentsOptions.target`, `useGeoComments.react()` param — union widened to include `Article` (Plan 03, XCUT-01 minimal slice)
- `getEntitySharePath` — `ARTICLE_KIND → 'story'` case added (Plan 03)
- `WorkViewMode` / `RouteState.focusType` / `RouteSnapshot.focusType` — `'stories'` / `'story'` added (Plan 03)

### New files (full list)
- `src/lib/nostr/story/lifecycle.ts`, `src/lib/nostr/story/draft.ts`, `src/lib/nostr/story/index.ts`, `src/lib/nostr/story/lifecycle.test.ts`
- `src/lib/hooks/useStories.ts`
- `src/components/info-panel/StoryEditorPanel.tsx`, `src/components/info-panel/StoryViewPanel.tsx`
- `src/components/StoriesPanel.tsx`
- `src/features/social/hooks/useStoryProposals.ts`
- `src/features/social/proposals/StoryProposalsPanel.tsx`, `src/features/social/proposals/StoryProposeEditDialog.tsx`
- `src/lib/nostr/geo-proposal/storyProposal.test.ts`

### Reused-unchanged (data layer already shipped Phase 8 — NOT produced this phase)
- `ArticleFactory` / `Article` cast / `isArticle` / `getArticleContent` / `ArticleContent` (`src/lib/nostr/article/*`) — Phase 8
- `extractReferencedCoordinates` / `setAddressReferenceTags` / `naddrToCoordinate` (`src/lib/nostr/references.ts`) — pre-existing
- `RichContentRenderer` / `GeoRichTextEditor` / `GeoMentionExtension` / `MediaExtensions` — pre-existing
- `CommentsPanel` / `GeoSocialActions` / `ProposalCard` / `ProposalsPanel` (dataset) — pre-existing

---

## Multi-Source Coverage Audit

Every source item is COVERED by a plan. No unplanned items.

### GOAL (ROADMAP Phase 10 goal + 4 success criteria)
| Goal item | Covered by |
|-----------|-----------|
| Author a curate-pull Story (Markdown narrative + NIP-23 metadata) | 10-02 (T1) |
| Inline geo refs render in place (eye-toggle/fly-to) + map lane from body | 10-02 (insert) + 10-03 (render) |
| naddr→`a` mirroring (single source of truth = body, re-derived every publish) | 10-01 (T1) |
| Draft + in-place edit (parameterized-replaceable, same d-tag) | 10-01 (T1/T2) + 10-02 (T1) |
| Comment/react + propose-edit | 10-03 (STORY-05) + 10-04 (STORY-06) |

### REQ (phase_req_ids: STORY-01..06)
| Req | Plan(s) |
|-----|---------|
| STORY-01 (title/summary/cover/Markdown body) | 10-02 |
| STORY-02 (inline refs eye-toggle/fly-to) | 10-02 (insert) + 10-03 (render) |
| STORY-03 (naddr→`a` mirror) | 10-01 (service) + 10-02 (UI) |
| STORY-04 (draft + in-place edit) | 10-01 (service) + 10-02 (UI) |
| STORY-05 (comment + react) | 10-03 |
| STORY-06 (propose narrative edit) | 10-04 |

### RESEARCH (RESEARCH.md)
Phase 10 research flag = SKIP (NIP-23 well-documented; `getContentPointers`/naddr mirror is a library call). No RESEARCH.md for this phase — coverage N/A. The flagged 37519 content-type question is resolved in 10-04 (pure content-type extension, no discriminator; cited to SPEC.md §11.1/§11.2/§17).

### CONTEXT (D-XX locked decisions)
| Decision | Plan |
|----------|------|
| D-01 (dedicated Stories rail destination) | 10-03 (T2) |
| D-02 (New Story button at top of Stories panel) | 10-02 (T2) + 10-03 (T2 create path) |
| D-03 (open in right info panel; main map = canvas; map lane from body) | 10-03 (T1 render + T2 mount) |
| D-04 (deep-link /story/:naddr + OG social card) | 10-03 (T2) |
| Claude's Discretion — body editor type | Resolved: reuse TipTap GeoRichTextEditor + Write/Preview tabs (10-02 T1) |
| Claude's Discretion — geo-ref insertion | Resolved: reuse @-mention picker (10-02 T1) |
| Claude's Discretion — draft storage | Resolved: local-first via scoped storage (10-01 T2 + 10-02 T1) |
| Claude's Discretion — inline refs default shown/hidden | Resolved: default HIDDEN on load (10-03 T1) |
| Claude's Discretion — STORY-06 shape + discriminator | Resolved: pure content-type extension, no discriminator (10-04 objective + T1) |

### Exclusions (not gaps)
- Deferred Ideas (CONTEXT.md): Wide/takeover reading view; Groups-tab cleanup — out of Phase 10 scope.
- Phase 13 (XCUT full K/k widening + cross-kind routing): Phase 10 ships only the minimal XCUT-01 slice (Article target union + ARTICLE_KIND share path) needed for STORY-05; full widening stays Phase 13.

**Result: No unplanned items. All GOAL / REQ / CONTEXT items COVERED.**
