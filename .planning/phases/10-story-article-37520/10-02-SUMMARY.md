---
phase: 10-story-article-37520
plan: 02
subsystem: story-authoring-ui
tags: [story, article, kind-37520, editor-panel, browse-panel, drafts, nip-23]
requires:
  - "src/lib/nostr/story/{lifecycle,draft,index}.ts (Plan 01 — publishStory/editStory/readStoryDraft/writeStoryDraft/clearStoryDraft)"
  - "src/lib/hooks/useStories.ts (Plan 01 — isArticle-filtered kind-37520 timeline)"
  - "src/lib/nostr/article (Article cast/isArticle/getArticleContent/ArticleContent — Phase 8)"
  - "src/components/editor (GeoRichTextEditor + RichContentRenderer — TipTap body + sanitized render)"
  - "src/components/info-panel/EntityPanelShell.tsx (panel chrome)"
  - "src/components/blossom/BlossomUploaderButton.tsx (cover image)"
  - "src/components/data-filter (useFilterState/useSortedFilteredItems) + entity-search (EntitySearchToolbar)"
provides:
  - "StoryEditorPanel — create/edit Story authoring panel (Write/Preview, metadata, draft, in-place edit)"
  - "StoriesPanelContent — kind-37520 browse rail panel body + New Story entry"
affects:
  - "Plan 03 (Story browse/read rail wiring) mounts StoriesPanelContent + StoryEditorPanel via AppSidebar/GeoEditorInfoPanel"
tech-stack:
  added: []
  patterns:
    - "Structural copy of GroupEditorPanel (Article for Group) — no re-inlined ArticleFactory; calls the Plan-01 lifecycle service"
    - "Write/Preview Tabs where Preview renders ONLY via sanitized RichContentRenderer (T-10-04, zero dangerouslySetInnerHTML)"
    - "Structural copy of GeoDatasetsPanelContent browse pattern, swapped DataTable for Card list-rows per UI-SPEC §1"
    - "Local-first draft pre-fill keyed by d-tag (readStoryDraft) with new-story sentinel; clear-on-publish"
key-files:
  created:
    - "src/components/info-panel/StoryEditorPanel.tsx"
    - "src/components/StoriesPanel.tsx"
  modified: []
decisions:
  - "StoryEditorPanel calls Plan-01 publishStory/editStory (not a re-inlined ArticleFactory) so STORY-03 a-derive + STORY-04 d-lineage live in one tested module"
  - "Preview tab uses RichContentRenderer with emptyState copy; NO raw HTML / dangerouslySetInnerHTML (T-10-04 mitigation, grep gate = 0)"
  - "Cover image renders as a plain <img src> with onError→hide (neutral placeholder frame), no HTML injection sink (T-10-05)"
  - "StoriesPanel uses Card list-rows (UI-SPEC §1 row anatomy) rather than the DataTable the dataset analog uses — the UI-SPEC dictates cover-thumb+title+summary+meta+badge+⋮ rows"
  - "Draft chip detection reads readStoryDraft(dTag) per visible Story; Published → Badge secondary, Draft → Badge outline (UI-SPEC color contract)"
  - "Copy link copies the addressable 37520:pubkey:d coordinate as a pre-routing functional fallback — canonical /story/:naddr deep link + OG card is Plan 03"
metrics:
  duration: ~30m
  completed: 2026-06-27
---

# Phase 10 Plan 02: Story Authoring Surface Summary

Shipped the Story (kind 37520) authoring + browse UI by structural reuse: a
`StoryEditorPanel` (create + in-place edit, copied from `GroupEditorPanel` with
Article substituted for Group) and a `StoriesPanelContent` browse rail body (copied
from `GeoDatasetsPanelContent`) with the accent **New Story** create entry at the
top. The editor reuses the TipTap `GeoRichTextEditor` for the Markdown body (with a
Write/Preview tab pair, Preview rendering only through the sanitized
`RichContentRenderer`), the editor's built-in `@`-mention picker for geo-ref/media
insertion (STORY-02 insert half), the `BlossomUploaderButton` for the 16:9 cover
image, and the Plan-01 `publishStory`/`editStory`/draft service for the
publish/edit/draft path (STORY-03/04). No new infrastructure, zero new dependencies.

## What Was Built

**Task 1 — `StoryEditorPanel.tsx` (STORY-01/02/03/04)**
- `StoryEditorPanel({ initialStory?, onClose, onSave, availableFeatures })`. Metadata
  block: Title (`Input`), Summary (`Textarea`), Cover image (`BlossomUploaderButton` +
  16:9 `AspectRatio` preview). Body authored in `GeoRichTextEditor` (`onChange` →
  Markdown string); the editor's built-in `@`-mention / `GeoMentionExtension` /
  `MediaExtensions` cover the STORY-02 insert half (inline `nostr:naddr…` geo-refs +
  image/video embeds).
- Body wrapped in a **Write** / **Preview** `Tabs` pair. Preview renders ONLY through
  `RichContentRenderer` (sanitized, same path readers see) — no raw HTML, no
  inner-HTML injection sink (T-10-04; grep gate = 0).
- Pre-fill: edit mode reads `getArticleContent(initialStory.rawEvent())`; create mode
  falls back to `readStoryDraft(dTag ?? 'new-story')`.
- Submit: accent **Publish Story** (create) / **Save changes** (edit a published
  Article) via `className="rounded-none bg-primary text-primary-foreground"`. Neutral
  **Save draft** (`writeStoryDraft`) and a **Discard draft** alert-dialog
  ("Discard this draft?") gating `clearStoryDraft`.
- `handleSave`: builds `ArticleContent`, calls `editStory(rawEvent, content, signer)`
  when editing (`isArticle` true) else `publishStory(content, signer)` — both from
  Plan 01 (STORY-03 a-derive + STORY-04 d-lineage internal), then `clearStoryDraft`,
  `castEvent(signed, Article, eventStore)`, `onSave(cast)`, `onClose()`. Wrapped in
  try/catch with "Couldn't publish — check your connection and try again." and
  `finally setIsSaving(false)`. Validation copy verbatim: "A title is required to
  publish." / "Add some narrative before publishing."

**Task 2 — `StoriesPanel.tsx` (D-01/D-02 panel body, STORY-04 status chips)**
- `StoriesPanelContent({ currentUserPubkey, onOpenStory, onCreateStory, onEditStory,
  onDeleteStory, deletingKey })`. Subscribes via `useStories()`; feeds casts through
  the same `useFilterState` + `useSortedFilteredItems` hooks + `EntitySearchToolbar`
  the dataset browse uses.
- Accent **New Story** Button at the TOP of the panel (`rounded-none bg-primary
  text-primary-foreground`) → `onCreateStory` (D-02).
- Each row is a `rounded-none` `Card`: 16:9 cover thumbnail (`AspectRatio`, plain
  `<img src>` with onError→hide, neutral placeholder) + title (text-sm semibold) +
  summary one-liner (text-[13px] muted, truncated) + author (`UserProfile
  mode="name-only"`)/date meta (text-[11px]) + status `Badge` (Published →
  `variant="secondary"`; a Story with a local draft → `variant="outline"` "Draft") +
  a ⋮ `DropdownMenu` (Open / Edit / Copy link / Delete). Row click → `onOpenStory`.
- Loading shows `Skeleton` rows; empty shows the `Empty` component with UI-SPEC
  headings ("No stories yet" / "No stories match") and bodies. Rail destination
  wiring deferred to Plan 03 (this plan ships only the panel body + props contract).

## Verification

- `bun run build` → exits 0 (workers + bundle emitted) after each task.
- `bunx biome check` on both new files → clean (one AspectRatio one-line format + one
  import-order auto-fix applied).
- Full suite `bun test` → **687 pass / 0 fail** — identical to the Plan-01 baseline
  (687/0); no regressions.
- Task-1 acceptance greps: `publishStory|editStory` = 6 (≥2 ✓, uses Plan-01 service),
  `GeoRichTextEditor` = 5 (≥1 ✓), `dangerouslySetInnerHTML` = 0 ✓, `TabsTrigger|
  TabsContent` = 9 (≥2 ✓), `bg-primary` = 1 (≥1 ✓), and "Publish Story" / "Save
  changes" / "Save draft" / "A title is required to publish." all present verbatim ✓.
- Task-2 acceptance greps: `useStories` = 3 (≥1 ✓), `useFilterState|
  useSortedFilteredItems` = 4 (≥2 ✓), `DropdownMenu` = 19 (≥1 ✓), "New Story" present
  with a sibling `bg-primary` Button ✓, "No stories yet" + "No stories match" present
  verbatim ✓, `export function StoriesPanelContent` present ✓.

## Deviations from Plan

None affecting scope. Implementation notes:
- **Browse rows use `Card` not `DataTable`.** The dataset analog
  (`GeoDatasetsPanelContent`) renders via `DataTable`, but the plan's Task-2 action +
  UI-SPEC §1 explicitly dictate a Card list-row anatomy (cover thumb + title + summary
  one-liner + author/date + status badge + ⋮ menu). Followed the UI-SPEC; reused the
  same `useFilterState`/`useSortedFilteredItems`/`EntitySearchToolbar` browse hooks the
  analog uses, only the row presentation differs.
- **Author meta uses `UserProfile mode="name-only"`** (the existing profile component)
  rather than a hand-rolled name lookup — keeps parity with comment rows.
- **Copy link copies the `37520:pubkey:d` coordinate** as a functional pre-routing
  fallback; the canonical `/story/:naddr` deep link + OG card is Plan 03 scope.

## Threat Model Outcomes

- **T-10-04 (XSS, Preview tab)** — mitigated. Preview renders the Markdown body ONLY
  through the sanitized `RichContentRenderer`; zero `dangerouslySetInnerHTML`, no raw
  HTML (grep gate = 0). Same sanitized path readers see.
- **T-10-05 (XSS, list-row cover/title/summary)** — mitigated. Title/summary render as
  auto-escaped React text nodes; cover is a plain `<img src>` with `onError`→hide to a
  neutral placeholder frame; no HTML injection sink.
- **T-10-06 (DoS, relay events)** — mitigated (inherited from Plan 01). The list source
  is `useStories()` which `isArticle`-filters BEFORE cast, so malformed/legacy/forged
  kind-37520 events never reach the row map.
- **T-10-SC (Tampering, installs)** — mitigated. Zero new dependencies; all components
  consumed already present in `src/components/ui/`.

## Known Stubs

None. Both panels are wired to real data paths (Plan-01 lifecycle/draft service +
`useStories` timeline + Article cast). `onOpenStory`/`onCreateStory`/`onEditStory`/
`onDeleteStory` are caller-supplied props whose rail wiring is Plan 03 — that is the
documented plan boundary, not a stub.

## Commits

- `188b8a5` feat(10-02): StoryEditorPanel — Write/Preview authoring, metadata, draft, in-place edit
- `245f50c` feat(10-02): StoriesPanelContent — kind-37520 browse list + New Story entry

## Self-Check: PASSED

- FOUND: src/components/info-panel/StoryEditorPanel.tsx (382 lines, ≥120)
- FOUND: src/components/StoriesPanel.tsx (269 lines, ≥80)
- FOUND commit 188b8a5, FOUND commit 245f50c
