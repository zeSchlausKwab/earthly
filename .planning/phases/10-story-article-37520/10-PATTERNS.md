# Phase 10: Story / Article (~37520) - Pattern Map

**Mapped:** 2026-06-26
**Files analyzed:** 9 (5 new, 4 modified)
**Analogs found:** 9 / 9 (every new surface has a shipped analog — reuse-dominant phase)

> Posture: This phase writes almost no new infrastructure. The data layer (`ArticleFactory`),
> the editor/renderer stack, the comment/react surface, the proposal machinery, the naddr→`a`
> helpers, the rail/info-panel multiplexing, routing, and OG card paths all exist. Each new
> file below has a near-exact analog the executor copies from. The two genuine *seams* are
> (a) widening `CommentsPanel`/`useGeoComments` prop types to accept the `Article` cast, and
> (b) extending the proposal target to a Markdown-content event (STORY-06).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/info-panel/StoryEditorPanel.tsx` *(new)* | component (editor panel) | CRUD / form→publish | `src/features/groups/GroupEditorPanel.tsx` | exact |
| `src/components/info-panel/StoryViewPanel.tsx` *(new)* | component (view panel) | request-response (read) | `src/components/info-panel/GroupViewPanel.tsx` | exact |
| `src/components/StoriesPanel.tsx` (or `StoriesPanelContent`) *(new)* | component (browse panel) | CRUD (list/filter) | `src/components/GeoDatasetsPanel.tsx` (`GeoDatasetsPanelContent`) | exact |
| `src/lib/nostr/story/lifecycle.ts` (publish/edit + a-tag re-derive) *(new)* | service/utility | transform→publish | `GroupEditorPanel.handleSave` + `references.ts` | role-match (logic exists inline in Group save) |
| Story local-draft persistence helper *(new)* | utility | file-I/O (localStorage) | `writePersistedGeoCollectionDraftState` (editor draft pattern) | role-match |
| `src/components/AppSidebar.tsx` *(modify)* | config/route (rail) | event-driven (nav) | existing `RAIL_DESTINATIONS` + `renderWorkContent` switch | exact (extend in place) |
| `src/components/GeoEditorInfoPanel.tsx` *(modify)* | component (multiplexer) | event-driven (dispatch) | existing `GroupEditorPanel`/`GroupViewPanel` mount branches | exact (add Story branches) |
| `src/features/geo-editor/hooks/useRouting.ts` + `src/index.ts` *(modify)* | route + config | request-response (deep-link/OG) | `geoevent`/`mapcontext` focus + `handleGeoEventRoute` | exact (add `story`/`article`) |
| `src/features/social/comments/CommentsPanel.tsx` + `useGeoComments.ts` *(modify)* | component/hook (type widen) | request-response | existing `target: GeoDataset \| MapContext` | role-match (XCUT-01 widening seam) |

---

## Pattern Assignments

### `src/components/info-panel/StoryEditorPanel.tsx` (component, form→publish)

**Analog:** `src/features/groups/GroupEditorPanel.tsx` — copy its structure wholesale. It is the
parameterized-replaceable create/edit panel built on the same `EntityPanelShell` primitives, the
same `GeoRichTextEditor` body, the same `BlossomUploaderButton` for the image, and the same
`factory.modify(...)` vs `factory.create(...)` in-place-edit branch.

**Imports pattern** (`GroupEditorPanel.tsx:27-87`) — replicate the import surface, swap Group→Article:
```typescript
import { castEvent } from 'applesauce-core/casts'
import { useActiveAccount } from 'applesauce-react/hooks'
import { GeoRichTextEditor, type GeoFeatureItem, type GeoRichTextEditorRef } from '@/components/editor'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from '@/components/info-panel/EntityPanelShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs' // Write / Preview tabs
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
  extractReferencedCoordinates,        // STORY-03: body → coordinates
  setAddressReferenceTags,             // STORY-03: a-tag reconcile
} from '@/lib/nostr/references'
```
Swap the Group data imports for the Article ones (these already exist):
```typescript
import { ArticleFactory, Article, getArticleContent, isArticle, type ArticleContent } from '@/lib/nostr/article'
```

**In-place-edit / `d`-tag lineage pattern (STORY-04)** — the load-bearing analog
(`GroupEditorPanel.tsx:396-419`). Copy this exact create-vs-modify shape; `ArticleFactory.modify`
(`article/factory.ts:52-57`) preserves the `d` tag via `toEventTemplate(event)`, never regenerating it:
```typescript
const initialEvent = initialStory?.rawEvent()
const editedEvent = initialEvent && isArticle(initialEvent) ? initialEvent : null
const factory = editedEvent
  ? ArticleFactory.modify(editedEvent).article(content)   // same d-tag lineage
  : ArticleFactory.create(content)                        // new d-tag

const signedEvent = await factory
  .modifyPublicTags(setAddressReferenceTags(referencedCoords))   // STORY-03, see below
  .sign(signer)
await publish(signedEvent, { routing: 'outbox' })
const cast = castEvent(signedEvent, Article, eventStore)
onSave(cast)
```
`ArticleContent` is `{ title?, summary?, image?, content? }` (`article/helpers.ts:30-37`) — these map
to the UI-SPEC metadata block (Title `input`, Summary `textarea`, Cover image
`BlossomUploaderButton` + 16:9 `aspect-ratio`). The body `content` MUST be stored as Markdown
(NIP-23); the `GeoRichTextEditor` `onChange` already yields the serialized Markdown body
(see how `GroupEditorPanel` feeds `description` straight to `GroupContent.description` with
`descriptionFormat: 'markdown'`).

**naddr → `a` re-derivation on every publish (STORY-03)** — the single-source-of-truth chain.
Group does this from `description` at `GroupEditorPanel.tsx:391-394`; Story does the same from the
body `content`:
```typescript
const referencedCoords = extractReferencedCoordinates(storyBodyMarkdown)
// extractReferencedCoordinates = extract naddr refs → naddrToCoordinate → dedupe (references.ts:106-118)
// then setAddressReferenceTags(referencedCoords) reconciles the `a` tags (references.ts:159-197):
//   drops every prior `a` tag, re-appends the dedup'd coordinates — never hand-edited.
```
Malformed `nostr:naddr…` refs are silently excluded (`naddrToCoordinate` returns `null` at
`references.ts:71-82`) and render as plain text — matches UI-SPEC §4 "invisible-but-honest".

**Field/validation/error pattern** — copy `GroupEditorPanel.handleSave` (`:342-434`):
`if (!currentUser) return`, `if (!title.trim()) { setSaveError('A title is required to publish.'); return }`,
`setIsSaving(true)` / `try…catch` with `"Couldn't publish — check your connection and try again."`,
`finally setIsSaving(false)`. Submit button uses the reserved accent
`className="rounded-none bg-primary text-primary-foreground"` (`:805-811`).

**Editor type discretion** — prefer the TipTap `GeoRichTextEditor` (it serializes Markdown cleanly,
as Group already relies on). The UI-SPEC requires a **Write / Preview** `Tabs` pair regardless;
the Preview tab renders through `RichContentRenderer` (see ViewPanel below).

---

### `src/components/info-panel/StoryViewPanel.tsx` (component, read)

**Analog:** `src/components/info-panel/GroupViewPanel.tsx` — the exact reading-panel shape. Strip the
two-lane curated/foreign machinery (Group-only); keep the narrative-render + comments mount.

**Narrative render with inline eye-toggle + fly-to (STORY-02)** — this is fully solved by reuse.
`GroupViewPanel.tsx:220-228` mounts `RichContentRenderer`, which already parses `nostr:naddr…` tokens
into focusable mention buttons with show-on-map + fly-to callbacks. Copy verbatim:
```typescript
<RichContentRenderer
  content={story.content}                         // the Markdown body
  availableFeatures={availableFeatures}
  onMentionVisibilityToggle={onMentionVisibilityToggle}  // eye-toggle → main map filter (D-03)
  onMentionZoomTo={onMentionZoomTo}                       // fly-to → main map camera
/>
```
`RichContentRendererProps` (`RichContentRenderer.tsx:8-19`) is the contract:
`onMentionVisibilityToggle(address, featureId, visible)` and `onMentionZoomTo(address, featureId)`.
Per UI-SPEC §2 inline refs default HIDDEN on load — drive that from the parent visibility set, do not
auto-emit visibility on mount. **Do NOT build a new inline-ref renderer.**

**Comment + react mount (STORY-05)** — copy `GroupViewPanel.tsx:259-275` exactly. The `CommentsPanel`
internally renders `GeoSocialActions` (reactions/zaps) + the comment form + thread; keying it by event
id forces a clean remount per Story:
```typescript
<EntityPanelSurface tone="discussion" className="space-y-4">
  <EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
  <CommentsPanel
    key={story.id ?? story.dTag ?? 'no-story'}
    target={story}                                  // ← the Article cast — see widening seam
    availableFeatures={availableFeatures}
    onMentionVisibilityToggle={onMentionVisibilityToggle}
    onMentionZoomTo={onMentionZoomTo}
    focusCommentId={focusCommentId}
  />
</EntityPanelSurface>
```
`useGeoComments` roots comments at `target.kind:target.pubkey:target.dTag`
(`useGeoComments.ts:60-65`) and reactions the same way — fully generic over kind. The `Article` cast
exposes `kind`/`pubkey`/`dTag` getters (`article/cast.ts:32-51`), so it just works once the prop type
widens (see modify section).

**Owner controls / delete** — reuse `ConfirmDeleteAction` from `GroupViewPanel.tsx:209-215` for the
"Delete this story?" `alert-dialog`. Edit-in-place entry routes back through `StoryEditorPanel`.
`isOwner = currentUserPubkey === story.pubkey`.

**Empty/fallback** — mirror `GroupViewPanel.tsx:162-164`: `if (!story) return <…>No story selected.</…>`.

---

### `src/components/StoriesPanel.tsx` (component, browse list)

**Analog:** `src/components/GeoDatasetsPanel.tsx` (`GeoDatasetsPanelContent`). It is the canonical
rail browse panel: `useFilterState` + `useSortedFilteredItems` (`GeoDatasetsPanel.tsx:125,148-152`) over
the event list, the `EntitySearchToolbar` search/filter header, Favorites/Recent tab narrowing
(`:216-236`), and list rows with star/visibility/overflow. Subscribe to kind-37520 events filtered
through `isArticle` (the SPEC-03 guard, `article/helpers.ts:49-55`), then feed them through the same
filter/sort hooks.

**New Story entry (D-02)** — the panel header carries the accent **New Story** button at the top
(reserved `--primary`), mirroring the Datasets/Group create affordance (`onCreateContext` prop pattern,
`GeoDatasetsPanel.tsx:49,119`). Clicking it opens `StoryEditorPanel` in create mode via the same
info-panel routing the Group "create" path uses (`contextEditorMode !== 'none'` branch — see
GeoEditorInfoPanel modify). List rows per UI-SPEC §1: cover thumb (or placeholder) + title + summary
one-liner + author/date + Draft/Published `badge` + `⋮` `dropdown-menu`; `skeleton` rows on load.

---

### `src/lib/nostr/story/lifecycle.ts` (service, transform→publish) — optional extraction

**Analog:** the inline save logic in `GroupEditorPanel.handleSave` (`:342-434`) + `references.ts`.
If the planner extracts publish/edit/a-tag-derivation into a service (recommended for testability),
it is a thin wrapper over `ArticleFactory` + `extractReferencedCoordinates` + `setAddressReferenceTags`
+ `publish(signed, { routing: 'outbox' })`. No new infrastructure — see STORY-03/04 excerpts above.

---

### Story draft persistence helper (utility, localStorage)

**Analog:** `writePersistedGeoCollectionDraftState` (the editor's local-draft pattern; CONTEXT §5).
Local-first per discretion default: persist `{ title, summary, image, content }` to localStorage keyed
by the Story `d`-tag (or a `new-story` sentinel); clear on publish. A **Draft** status `badge` marks
unpublished Stories. `alert-dialog` "Discard this draft?" gates discard (UI-SPEC destructive table).

---

## Modified Files

### `src/components/AppSidebar.tsx` — add a `stories` rail destination (D-01)

Add to `WORK_DESTINATIONS` (`AppSidebar.tsx:74-76`, the `RAIL_DESTINATIONS` work group):
```typescript
{ mode: 'datasets', title: 'Datasets', icon: Database },
{ mode: 'contexts', title: 'Contexts', icon: Globe },
{ mode: 'stories', title: 'Stories', icon: BookOpen },   // ← new (pick a lucide icon)
{ mode: 'user', title: 'My Entities', icon: UserCircle },
```
Add a `case 'stories'` to the `renderWorkContent` switch (`AppSidebar.tsx:508-526`), returning
`<StoriesPanelContent {...} />` — exactly how `datasets`/`contexts` dispatch. Widen the
`WorkViewMode` union to include `'stories'`. **This explicitly closes the Phase-9 "no Groups tab"
discoverability gap** (the wired rail destination is the whole point of D-01).

### `src/components/GeoEditorInfoPanel.tsx` — mount Story editor/view branches (D-03)

Mirror the existing Group branches:
- Create/edit branch — analog `GeoEditorInfoPanel.tsx:531-541` (the `contextEditorMode !== 'none'`
  `GroupEditorPanel` mount). Add an equivalent Story-editing branch returning `<StoryEditorPanel
  initialStory={…} onClose={…} onSave={…} availableFeatures={…} />`.
- View branch — analog `:543-564` (the `viewMode === 'view' && viewContext` → `GroupViewPanel` mount).
  Add a Story-view branch returning `<StoryViewPanel … />` when the active view target is an Article.
Pass the same `onMentionVisibilityToggle` / `onMentionZoomTo` / `onZoomToBounds` callbacks already
threaded to `GroupViewPanel` (`:559-561`) — these wire the inline eye-toggle/fly-to to the main map.

### `src/features/geo-editor/hooks/useRouting.ts` + `src/index.ts` — deep-link + OG card (D-04)

**Route parse/build** — extend the focus-type machinery. Widen `RouteState.focusType` and
`isFocusType` (`useRouting.ts:34,52-53`) to include `'story'` (or `'article'`); add a parse branch
mirroring `useRouting.ts:99-106`:
```typescript
if (first === 'story' && segments[1]) {
  return { ...base, focusType: 'story', naddr: segments[1] }
}
```
`buildRoutePath` (`:229-250`) already composes `/${focusType}/${naddr}` generically — no change beyond
the type widening. `decodeContextCoordinateFromNaddr`/`nip19.decode` (`:56-65`) is reused as-is.

**OG card (server)** — copy `handleGeoEventRoute` (`src/index.ts:88-113`) to a `handleStoryRoute`, and
register routes mirroring `index.ts:266-270`:
```typescript
"/story/:naddr": handleStoryRoute,
"/story/:naddr/comment/:commentId": handleStoryRoute,
"/og/image/:type/:naddr": handleOGImageRoute,   // extend the `type` switch in handleOGImageRoute
```
This needs a `fetchStoryOGData` + `generateStoryOGHtml` + an `og/cache.ts` `OGCacheType` entry
(`cache.ts:7`) — all copied from the `fetchEvent.ts` / `template.ts` / `cache.ts` geoevent path.
`decodeNaddr` (`fetchEvent.ts:14-23`) and `generateOGImagePNG` (`renderImage.ts`) are reused unchanged.

### `src/features/social/comments/CommentsPanel.tsx` + `useGeoComments.ts` — widen target type (STORY-05 / XCUT-01 seam)

`CommentsPanel` `target` is typed `GeoDataset | MapContext | null` (`CommentsPanel.tsx:18`) and
`useGeoComments` likewise (`useGeoComments.ts:29,45`). The runtime logic is already kind-generic
(keys off `target.kind/pubkey/dTag`), so the only change is widening the prop union to include the
`Article` cast (e.g. `GeoDataset | MapContext | Article`). `GeoSocialActions` `target: ReactableEvent`
is already structural (`GeoSocialActions.tsx:26`) — but note `getEntitySharePath`
(`GeoSocialActions.tsx:41-50`) only maps `GEO_EVENT_KIND`/`MAP_CONTEXT_KIND`; **add an `ARTICLE_KIND`
→ `'story'` case** so the share button produces the correct deep link. This is the minimal slice of
XCUT-01 needed for Phase 10 (full K/k widening across all kinds stays Phase 13).

---

## STORY-06 (Propose narrative edit) — reuse proposal machinery

**Analog:** `src/lib/nostr/geo-proposal/factory.ts` + `src/features/social/proposals/{ProposalsPanel,ProposalCard}.tsx`.

`GeoProposalFactory.create(target, fc)` (`geo-proposal/factory.ts:38-46`) currently targets a dataset
(`a` = `37515:owner:d-tag`) and carries a `FeatureCollection` in `content`. STORY-06 generalizes the
target to the Story's `37520:owner:d-tag` coordinate and carries the **proposed Markdown body** in
`content` instead of a FeatureCollection. **Open question flagged in CONTEXT/ROADMAP:** confirm at
planning whether this is a pure content-type extension (Markdown string vs FC JSON in `content`) or
needs a spec discriminator tag. `ProposalsPanel` props (`ProposalsPanel.tsx:10-12`,
`target: GeoDataset | null`, `isOwner` derived from `currentUserPubkey === target.pubkey`) and
`ProposalCard` are the author-side accept/reject UI to reuse — accept republishes the Story in place
via `ArticleFactory.modify` (same `d`-tag, exactly the STORY-04 path).

---

## Shared Patterns

### naddr → `a` mirroring (STORY-03)
**Source:** `src/lib/nostr/references.ts` (`extractReferencedCoordinates` `:106-118`,
`setAddressReferenceTags` `:159-197`, `naddrToCoordinate` `:71-82`).
**Apply to:** `StoryEditorPanel` publish path (and the proposal-accept republish).
The reconcile is destructive-by-default: every prior `a` tag is dropped and re-derived from the body
on each publish — body is the single source of truth.

### Parameterized-replaceable in-place edit (`d`-tag lineage)
**Source:** `ArticleFactory.modify` (`article/factory.ts:52-57`) — preserves `d` via
`toEventTemplate`; `GroupViewPanel.handleLockDown` (`GroupViewPanel.tsx:122-141`) and
`GroupEditorPanel.tsx:396-401` show the modify-then-publish pattern.
**Apply to:** all Story edits + proposal-accept (STORY-04/06).

### Entity panel chrome
**Source:** `EntityPanelShell` / `EntityPanelSurface` / `EntityPanelSectionHeader` /
`ConfirmDeleteAction` (used throughout `GroupEditorPanel`/`GroupViewPanel`).
**Apply to:** both new panels. `rounded-none` on inputs/buttons; accent `--primary` reserved for
New Story / Publish-Save / Accept-edit only (UI-SPEC color contract).

### Inline geo-ref render (eye-toggle + fly-to)
**Source:** `RichContentRenderer` (`RichContentRenderer.tsx:8-19,616`) — already ships the inline-ref
token parser + `onMentionVisibilityToggle`/`onMentionZoomTo` callbacks proven in comments and Groups.
**Apply to:** `StoryViewPanel` narrative + the editor Preview tab. Reuse, do not rebuild.

### Comment + react mount
**Source:** `CommentsPanel` (`GroupViewPanel.tsx:259-275`); kind-generic root in
`useGeoComments.ts:60-65`.
**Apply to:** `StoryViewPanel`. Only the prop-type union needs widening (XCUT-01 seam).

### Rail destination → panel → open-in-info-panel
**Source:** `AppSidebar.tsx:74-76` + `renderWorkContent` switch (`:508-526`) →
`GeoEditorInfoPanel` mount branches (`:531-564`).
**Apply to:** the `stories` destination + `StoriesPanel` + Story editor/view mounts.

### Deep-link route + OG card
**Source:** `useRouting.ts:99-106,229-250` (focus-type routes) + `src/index.ts:88-113,266-270`
(crawler route + OG html/png) + `src/lib/og/*`.
**Apply to:** `/story/:naddr` route + `handleStoryRoute` + a `story` OG cache type.

---

## No Analog Found

None. Every Story surface maps to a shipped analog (Group panels, dataset browse, references/tags,
comments, proposals, routing, OG). The only genuinely new code is glue + minor type-union widenings.

| Quasi-new concern | Closest pattern | Note |
|-------------------|-----------------|------|
| Markdown-content proposal target (STORY-06) | `GeoProposalFactory.create` (FC-content) | Content-type extension; spec-discriminator question to resolve at planning |
| `CommentsPanel`/`useGeoComments`/`GeoSocialActions` Article kind | existing dataset/context kinds | Minimal XCUT-01 slice: widen prop unions + add `ARTICLE_KIND` share-path case |

---

## Metadata

**Analog search scope:** `src/features/groups/`, `src/components/info-panel/`,
`src/components/`, `src/lib/nostr/article/`, `src/lib/nostr/{references,tags,kinds}.ts`,
`src/features/social/{comments,proposals}/`, `src/components/editor/`,
`src/features/geo-editor/hooks/useRouting.ts`, `src/lib/og/`, `src/index.ts`.
**Files scanned:** ~22
**Pattern extraction date:** 2026-06-26
