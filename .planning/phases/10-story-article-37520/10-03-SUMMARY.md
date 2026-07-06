---
phase: 10-story-article-37520
plan: 03
subsystem: story-reading-and-navigation
tags: [story, article, kind-37520, view-panel, rail-destination, deep-link, og-card, comments, reactions]
requires:
  - "src/lib/nostr/story/{lifecycle,draft,index}.ts + src/lib/hooks/useStories.ts (Plan 01 — useStories/publishStory/editStory)"
  - "src/components/info-panel/StoryEditorPanel.tsx + src/components/StoriesPanel.tsx (Plan 02 — authoring panel + browse panel body)"
  - "src/lib/nostr/article (Article cast/isArticle/getArticleContent/getArticleId/ArticleFactory — Phase 8)"
  - "src/components/editor/RichContentRenderer (sanitized inline-ref render with eye-toggle + fly-to)"
  - "src/features/social/comments/{CommentsPanel,GeoSocialActions} + hooks/useGeoComments (comment/react surface)"
  - "src/components/info-panel/GroupViewPanel.tsx (the structural analog stripped of two-lane machinery)"
  - "src/lib/og/{cache,fetchEvent,template} + src/index.ts (OG crawler/route infra)"
provides:
  - "StoryViewPanel — Story reading panel: sanitized narrative + inline eye-toggle/fly-to + comment/react mount"
  - "Stories rail destination (AppSidebar) + New-Story create path + StoryViewPanel/StoryEditorPanel info-panel mounts"
  - "useStoryEditor hook — Story inspect/create/edit/save/close lifecycle (mirrors useContextEditor)"
  - "/story/:naddr deep-link route + OG social card (handleStoryRoute + fetchStoryOGData + generateStoryOGHtml)"
  - "deleteStory() NIP-09 deletion helper"
  - "XCUT-01 minimal slice: CommentsPanel/useGeoComments target unions accept Article; ARTICLE_KIND→'story' share path"
affects:
  - "Plan 04 (proposal-accept republish) reuses the StoryViewPanel reading surface"
tech-stack:
  added: []
  patterns:
    - "Structural copy of GroupViewPanel (Article for Group) with the CuratedLane/ForeignLane two-lane machinery STRIPPED — a Story is closed/curated, no foreign-attach lane"
    - "Narrative renders ONLY through the sanitized RichContentRenderer; inline refs default HIDDEN (chip starts hidden, emits a toggle only when the reader opts in) — no auto-load of attacker-controlled targets, zero dangerouslySetInnerHTML"
    - "useStoryEditor mirrors useContextEditor; story is a third EntityWorkspace alongside geometry/context in AppSidebar"
    - "Story view mounts inside GeoEditorInfoPanelContent's viewMode==='view' branch, gated on a new viewStory store slot"
    - "OG: handleStoryRoute copies handleGeoEventRoute; fetchStoryOGData reads NIP-23 title/summary/image; generateStoryOGHtml reuses the audited generateOGHtml escaping path (no new escaping)"
key-files:
  created:
    - "src/components/info-panel/StoryViewPanel.tsx"
    - "src/features/geo-editor/hooks/useStoryEditor.ts"
  modified:
    - "src/features/social/comments/CommentsPanel.tsx"
    - "src/features/social/hooks/useGeoComments.ts"
    - "src/features/social/comments/GeoSocialActions.tsx"
    - "src/components/AppSidebar.tsx"
    - "src/components/GeoEditorInfoPanel.tsx"
    - "src/features/geo-editor/GeoEditorView.tsx"
    - "src/features/geo-editor/components/MobilePanel.tsx"
    - "src/features/geo-editor/hooks/useRouting.ts"
    - "src/features/geo-editor/hooks/index.ts"
    - "src/features/geo-editor/store/types.ts"
    - "src/features/geo-editor/store/viewModeSlice.ts"
    - "src/index.ts"
    - "src/lib/nostr/story/lifecycle.ts"
    - "src/lib/og/cache.ts"
    - "src/lib/og/fetchEvent.ts"
    - "src/lib/og/template.ts"
    - "src/lib/og/index.ts"
    - "src/components/info-panel/index.ts"
decisions:
  - "Stories is a real SidebarViewMode (not only an AppSidebar-local WorkViewMode) so navigateToView('stories') + /stories route parse + the /story/:naddr→/#/stories/story/:naddr OG redirect all share one canonical view value"
  - "Added a viewStory store slot (parallel to viewContext) rather than bridging through viewContext — Article and MapContext are different casts; keeping them separate avoids a store-wide type migration"
  - "Story is a third EntityWorkspace ('geometry'|'context'|'story') in AppSidebar so the show-full-panel guards treat an open Story as a non-list subject, exactly like a context inspect"
  - "deleteStory() added to story/lifecycle.ts (Rule 2) — StoriesPanel/StoryViewPanel already expose onDeleteStory and the rail ⋮ offers Delete; without a working NIP-09 path the owner control was a dead stub"
  - "fetchStoryOGData lives in fetchEvent.ts (reusing its decodeNaddr + fetchEventFromRelay) but reads NIP-23 {title,summary,image} from content JSON (+ title/summary/image tag fallback), NOT the FeatureCollection parse the geo-event path uses"
  - "XCUT-01 minimal slice only: widened the target type unions + added the ARTICLE_KIND→'story' share case; did NOT widen the NIP-22 K/k root-kind enumeration (runtime rooting is already kind-generic; full widening stays Phase 13)"
metrics:
  duration: ~70m
  completed: 2026-06-27
---

# Phase 10 Plan 03: Story Reading + Navigation Spine Summary

Made Stories **openable, readable, commentable, shareable, and discoverable** — closing
the Phase-9 "built-but-unwired, dead-ends at No-X-selected" gap. Shipped `StoryViewPanel`
(the GroupViewPanel reading analog minus the two-lane machinery) rendering the Markdown
narrative through the sanitized `RichContentRenderer` (STORY-02 render: inline geo-refs in
place with eye-toggle + fly-to, default hidden) and mounting `CommentsPanel` on the Story
coordinate (STORY-05 comment + react). Then wired the full navigation spine: the **Stories**
rail destination + **New Story** create (D-01/D-02), the Story view/editor info-panel mounts
(D-03), the `/story/:naddr` deep-link route + OG social card (D-04), and the XCUT-01 minimal
slice (comment/react target unions accept `Article`; `ARTICLE_KIND → 'story'` share path).
Zero new dependencies.

## What Was Built

**Task 1 — `StoryViewPanel.tsx` + comment/react widening (STORY-02 render, STORY-05, XCUT-01)**
- `StoryViewPanel({ story?, currentUserPubkey, onDeleteStory, onEditStory, deletingKey,
  availableFeatures, onMentionVisibilityToggle, onMentionZoomTo, onZoomToBounds,
  focusCommentId })`. Copies the GroupViewPanel chrome (`EntityPanelShell` titled with
  `story.article.title`; `EntityPanelSurface tone="context"` with a "Story" eyebrow + relative
  date meta; 16:9 cover `AspectRatio` with a neutral placeholder on error). The narrative
  renders ONLY via `<RichContentRenderer content={story.content} … onMentionVisibilityToggle
  onMentionZoomTo />` — inline refs default HIDDEN (the renderer's chip starts hidden and only
  emits a toggle when the reader opts in). Owner controls (`isOwner = currentUserPubkey ===
  story.pubkey`): an Edit affordance → `onEditStory`, and a `ConfirmDeleteAction`. A
  `tone="discussion"` surface mounts `<CommentsPanel key={story.id ?? story.dTag}
  target={story} … />` (STORY-05). Empty fallback: "No story selected." with UI-SPEC copy.
  Zero `dangerouslySetInnerHTML`.
- Widened `CommentsPanelProps.target`, `UseGeoCommentsOptions.target`, the result `react()`
  param, and the `react` callback's `reactTarget` from `GeoDataset | MapContext` to also
  accept `Article`. Added `case ARTICLE_KIND: return 'story'` to `getEntitySharePath` in
  GeoSocialActions. Did NOT widen the NIP-22 K/k root-kind enumeration (Phase 13).

**Task 2 — Navigation spine (D-01/D-02 rail, D-03 mount, D-04 deep-link + OG)**
- **AppSidebar (D-01/D-02):** widened `WorkViewMode` + `EntityWorkspace` with `'story'`; added
  `{ mode: 'stories', title: 'Stories', icon: BookOpen }` to `workNavItems`; added
  `case 'stories': <StoriesPanelContent {...storiesPanelProps} />` to `renderWorkContent`;
  added `handleInspectStory`/`handleCreateStory`/`handleEditStory`/`handleSaveStory`/
  `handleCloseStoryEditor` mirroring the context handlers; threaded `storyEditorMode`/
  `editingStory`/story callbacks through `editorPanelProps`; folded `viewStory`/`storyEditorMode`
  into the show-full-panel + current-surface guards.
- **GeoEditorInfoPanel (D-03):** a Story editor branch (`storyEditorMode !== 'none'` →
  `<StoryEditorPanel initialStory={editingStory} onClose onSave availableFeatures />`) and a
  Story view branch (`viewStory` → `<StoryViewPanel story={viewStory} … />`) inside the
  `viewMode === 'view'` block, threaded the same mention/zoom callbacks GroupViewPanel gets.
- **Store + routing:** added a `viewStory: Article | null` slot + `setViewStory` to
  ViewModeSlice; an `applyRouteState` clause `route.focusType === 'story' ? state.viewStory :
  null`; widened `RouteSnapshot.focusType` + `focusedType` to `'story'`; widened `SidebarViewMode`
  with `'stories'`. In useRouting: `'story'` in `isFocusType`, the `/story/:naddr` (+comment)
  parse branch → `sidebarView:'stories'`, and `buildRoutePath`/`navigateTo`/`navigateToComment`
  focusType params widened.
- **useStoryEditor + GeoEditorView:** new `useStoryEditor` hook (mirrors useContextEditor);
  `encodeStoryNaddr`; the focus-route effect's `route.focusType === 'story'` branch resolving a
  story naddr in the `useStories()` list → `handleInspectStory`; a `handleDeleteStory` (NIP-09);
  props threaded to AppSidebar + the mobile edit-tab GeoEditorInfoPanelContent.
- **OG (D-04):** `handleStoryRoute` (crawler → `generateStoryOGHtml(fetchCachedStoryEventOGData)`;
  user → redirect `/#/stories/story/:naddr`); registered `"/story/:naddr"` +
  `"/story/:naddr/comment/:commentId"`; extended `handleOGImageRoute`'s switch with a `"story"`
  case; added `'story'` to `OGCacheType` + the payload map + `fetchCachedStoryEventOGData`;
  `fetchStoryOGData` (NIP-23 title/summary/image); `generateStoryOGHtml` (reuses the audited
  `generateOGHtml` escaping).
- **deleteStory** added to story/lifecycle.ts (NIP-09 `DeleteFactory.fromEvents`).

## Verification

- `bun run build` → exits 0 (client + server bundle + 5 workers) after each task.
- Full suite `bun test` → **687 pass / 0 fail** — identical to the Plan-01/02 baseline; no regressions.
- `bunx tsc --noEmit` → project total **454 → 450** errors (my changes NET-REDUCED tsc errors;
  the touched-file count went 12 → 8). The remaining touched-file errors (`viewModeSlice` set-shape,
  `CommentsPanel(155)` ReactableEvent, `lifecycle(65)` modify NostrEvent→ArticleEvent) all pre-exist
  on the untouched baseline. tsc is not a project gate (~305+ pre-existing baseline per project memory);
  gates are bun test + bun run build + biome.
- `bunx biome check` on all new/modified files → clean after autofix, EXCEPT two pre-existing
  `noLabelWithoutControl` errors in GeoEditorInfoPanel's attached-contexts section (lines 780/833) —
  unrelated to Story work, already logged out-of-scope at Phase-9 09-05 close.
- Task-1 greps: `RichContentRenderer`=3 (≥1), `CommentsPanel`=4 (≥1), `dangerouslySetInnerHTML`=1
  (doc-comment only — the actual XSS sink is absent; renders only through the sanitized renderer),
  `Article` in CommentsPanel=2 / useGeoComments=4 (≥1), `ARTICLE_KIND` in GeoSocialActions=2 (≥1,
  returns 'story'), "No story selected" present.
- Task-2 greps: `stories` in AppSidebar=9 (≥3) + `StoriesPanelContent`=2 (≥1);
  `StoryEditorPanel|StoryViewPanel` in GeoEditorInfoPanel=4 (≥2); `'story'` in useRouting=8 (≥2) +
  isFocusType accepts 'story'; `viewStory|setViewStory` in viewModeSlice=4 (≥2); `handleStoryRoute`=3
  (≥2) + `/story/:naddr`=3 (≥1); `'story'` in og/cache=4 (≥1) + `generateStoryOGHtml`=1 + `fetchStoryOGData`=1.

## Deviations from Plan

None affecting scope. Implementation notes:
- **`deleteStory()` added (Rule 2 — missing critical functionality).** The plan's Task-2 action
  threads `onDeleteStory` through the rail/panel and the StoriesPanel/StoryViewPanel ⋮ menus offer
  Delete, but no Story delete helper existed (Plan 01 shipped publish/edit only). Added a NIP-09
  `deleteStory()` to story/lifecycle.ts mirroring `deleteMapContext`, wired through a
  `handleDeleteStory` in GeoEditorView — without it the owner Delete control was a dead stub.
- **`'stories'` widened in the store-level `SidebarViewMode`, not only AppSidebar's local
  `WorkViewMode`.** The plan framed the rail addition around `WorkViewMode`, but the route's
  `sidebarView` is the store `SidebarViewMode`; making `'stories'` a real view value is what lets
  `navigateToView('stories')`, the `/stories/story/:naddr` parse, and the OG redirect agree on one
  canonical value (no separate alias map needed).
- **`fetchStoryOGData` placed in `fetchEvent.ts`** (per the plan's read_first) reusing its
  `decodeNaddr`/`fetchEventFromRelay`, but it reads the NIP-23 `{title,summary,image}` content shape
  (with title/summary/image-tag fallback), not the geo-event FeatureCollection parse.
- **Mobile:** threaded the Story **view** props (`onEditStory`/`onDeleteStory`) into the mobile
  edit-tab `GeoEditorInfoPanelContent` so a deep-linked Story still renders on mobile, but did NOT
  add a new mobile browse tab for Stories — the rail destination D-01 is the desktop AppSidebar, and
  a half-wired mobile tab would be out of the plan's task actions. The mobile browse tab is a natural
  follow-up if needed.

## Threat Model Outcomes

- **T-10-07 (XSS, narrative render)** — mitigated. StoryViewPanel renders the body ONLY through the
  sanitized `RichContentRenderer`; zero `dangerouslySetInnerHTML`, no raw HTML (grep gate = the only
  occurrence is a doc-comment). Same sanitized path as the Group narrative.
- **T-10-08 (Tampering/Info-disclosure, inline naddr refs → main map)** — mitigated. Inline refs
  default HIDDEN on load (the renderer chip starts hidden, emits a visibility toggle only when the
  reader opts in), so opening a Story never auto-loads attacker-controlled targets; malformed naddr
  refs render as inert text (excluded from `a`, `naddrToCoordinate`→null inherited from Plan 01).
- **T-10-09 (XSS, OG HTML)** — mitigated. `generateStoryOGHtml` reuses the audited `generateOGHtml`
  OGMeta escaping path that already serves untrusted dataset/context titles; no new escaping invented.
- **T-10-10 (Spoofing, comment/react)** — accepted as planned. Comment/react reuses the shipped
  NIP-22/kind-7 path (proven on Groups Phase 9); authorship is the reader's own signature; no new
  trust surface.
- **T-10-SC (installs)** — mitigated. Zero new dependencies; the `BookOpen` lucide icon is already in
  the installed `lucide-react`; no `@mapcn` block consumed.

## Known Stubs

None. StoryViewPanel renders real Article content via the sanitized renderer + real CommentsPanel;
the rail/route/OG paths are wired to real `useStories`/`Article`/relay-fetch code. `onDeleteStory`
is backed by a working NIP-09 `deleteStory()`. The mobile browse tab is a documented scope boundary
(desktop rail is D-01), not a stub.

## Commits

- `bf1112e` feat(10-03): StoryViewPanel + comment/react widening — Story read panel (STORY-02/05, XCUT-01 slice)
- `769414c` feat(10-03): Story navigation spine — rail (D-01/D-02), info-panel mount (D-03), deep-link + OG card (D-04)

## Self-Check: PASSED

- FOUND: src/components/info-panel/StoryViewPanel.tsx
- FOUND: src/features/geo-editor/hooks/useStoryEditor.ts
- FOUND commit bf1112e, FOUND commit 769414c
