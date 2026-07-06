# Phase 11: Temporal Sighting - Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 18 (new + modified)
**Analogs found:** 18 / 18

> **Phase posture: REUSE-AND-EXTEND.** Almost every net-new file is a near-1:1 clone of its Phase-10 Story twin, swapping `Article`→`TemporalSighting`, kind 37520→37522, `useStories`→`useSightings`. There are exactly **two net-new pieces of logic**: (1) a `geometry` content field on kind 37522 + bbox/g derivation (D-02), and (2) a distinct, observation-state-aware Sighting map marker layer (D-05/D-06). The planner should treat all "clone" rows as mechanical and spend its risk budget on those two.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/nostr/temporal-sighting/helpers.ts` (MODIFY) | model | transform | `geo-event/helpers.ts` (geometry) + self | exact (extend self) |
| `src/lib/nostr/temporal-sighting/factory.ts` (MODIFY) | model | transform | `temporal-sighting/factory.ts` (self) + `geo-event/helpers.ts` derivation | exact |
| `src/lib/nostr/temporal-sighting/lifecycle.ts` (NEW) | service | CRUD | `story/lifecycle.ts` | role+flow match |
| `src/lib/nostr/temporal-sighting/draft.ts` (NEW) | service | file-I/O (localStorage) | `story/draft.ts` | exact |
| `src/lib/hooks/useSightings.ts` (NEW) | hook | pub-sub | `lib/hooks/useStories.ts` | exact |
| `src/components/SightingsPanel.tsx` (NEW) | component | event-driven (browse) | `components/StoriesPanel.tsx` | exact |
| `src/components/info-panel/SightingViewPanel.tsx` (NEW) | component | request-response | `info-panel/StoryViewPanel.tsx` | exact |
| `src/components/info-panel/SightingEditorPanel.tsx` (NEW) | component | CRUD (form) | `info-panel/StoryEditorPanel.tsx` + `GroupAttachField` | role+flow match |
| `src/components/AppSidebar.tsx` (MODIFY) | component | event-driven | self (story rail wiring) | exact (extend self) |
| `src/features/geo-editor/hooks/useRouting.ts` (MODIFY) | hook | request-response | self (`'story'` focusType) | exact (extend self) |
| `src/index.ts` (MODIFY) | route | request-response | self (`handleStoryRoute`) | exact (extend self) |
| `src/lib/og/fetchEvent.ts` (MODIFY) | service | request-response | self (`fetchStoryOGData`) | exact (extend self) |
| `src/lib/og/cache.ts` (MODIFY) | service | request-response | self (`OGCacheType`) | exact (extend self) |
| `src/lib/og/template.ts` + `index.ts` (MODIFY) | utility | transform | self (`generateStoryOGHtml`) | exact (extend self) |
| `src/features/geo-editor/core/managers/LayerManager.ts` (MODIFY or new sibling source) | config | event-driven (render) | `LayerManager` main point layer (lines 285-324) | role match, net-new paint |
| `src/features/geo-editor/core/GeoEditor.ts` (consume) | controller | event-driven | `DrawPointMode` click flow (lines 301-306) | reuse as-is |
| `src/features/social/comments/CommentsPanel.tsx` (MODIFY type) | component | event-driven | self (target union, line 20) | exact (extend self) |
| `src/features/social/hooks/useGeoReactions.ts` + `useGeoComments.ts` (MODIFY type) | hook | event-driven | self (`ReactableEvent`, line 12) | exact (extend self) |

---

## Pattern Assignments

### `src/lib/nostr/temporal-sighting/helpers.ts` (model, transform) — NET-NEW LOGIC (D-02)

**Analog (self, extend):** `src/lib/nostr/temporal-sighting/helpers.ts:30-38` — add a `geometry` field to the content interface. The defensive getter (lines 61-71) already spreads over defaults, so an event WITHOUT `geometry` parses to `geometry: undefined` — backward-tolerant, no migration (RESEARCH line 225).

Add to `TemporalSightingContent` (current lines 30-38):
```typescript
import type { LineString, Point, Polygon } from 'geojson'

export interface TemporalSightingContent {
	modelVersion?: string
	title?: string
	description?: string
	start?: number
	end?: number
	/** NEW (D-02): precise placement. Point by default; small Line/Polygon for "area where I saw it". */
	geometry?: Point | LineString | Polygon
}
```
The getter at lines 61-71 needs NO change (it already `{ ...DEFAULT, ...parsed }`). Keep it defensive — never throw.

---

### `src/lib/nostr/temporal-sighting/factory.ts` (model, transform) — NET-NEW LOGIC (D-02)

**Analog (geometry derivation):** `src/lib/nostr/geo-event/helpers.ts:154-179` — `computeBboxFor`/`computeGeohashFor` wrap `@turf/turf` `bbox`/`centroid` in try/catch returning undefined on invalid geometry. **Mirror this for a single Sighting geometry** (turf accepts a bare Geometry; wrap in a Feature if A4 proves false).

**`geometry` derivation pattern** to add (mirror geo-event helpers):
```typescript
import { bbox, centroid } from '@turf/turf'
// in lifecycle.ts (preferred) or the factory build path:
const box = bbox(geometry) as [number, number, number, number]            // [w,s,e,n] → .bbox(box)
const c = centroid(geometry).geometry.coordinates as [number, number]     // → .geohash([lon,lat])
```
The factory's existing setters consume these directly — `factory.ts:86-92` `.bbox()` / `.geohash()` delegate to the shared `tags.ts` seam (`setBbox`/`setGeohash`); `setGeohash` already clamps precision 5–7 and handles NaN (RESEARCH line 177). The `sighting()` setter (lines 58-76) and `.expiration()` (lines 79-84) are already in place; do NOT re-inline tag writes.

---

### `src/lib/nostr/temporal-sighting/lifecycle.ts` (service, CRUD) — NEW

**Analog:** `src/lib/nostr/story/lifecycle.ts:36-85`. Clone the three-function shape (`publishStory`/`editStory`/`deleteStory`) → (`publishSighting`/`editSighting`/`deleteSighting`). Substitute the Story-specific `a`-tag re-derive (lines 40-46) with the **bbox/g-from-geometry re-derive** (Pattern above). Every publish derives tags from `content.geometry`.

**Publish skeleton** (mirrors `story/lifecycle.ts:36-51` + RESEARCH Code Examples):
```typescript
export async function publishSighting(content, signer) {
	const box = content.geometry ? bbox(content.geometry) : undefined
	const c = content.geometry ? centroid(content.geometry).geometry.coordinates : undefined
	const signed = await TemporalSightingFactory.create(content)
		.bbox(box as GeoBoundingBox | undefined)
		.geohash(c as [number, number] | undefined)
		.expiration(expiryTtl ? unixNow() + expiryTtl : undefined)   // D-04, independent of `end`
		.contextReferences(groupCoords)                               // SIGHT-02
		.sign(signer)
	await publish(signed, { routing: 'outbox' })                      // mirrors lifecycle.ts:49
	return signed
}
```
`editSighting` uses `TemporalSightingFactory.modify(existingEvent)` (preserves `d` — factory.ts:50-55). `deleteSighting` clones `deleteStory` (lifecycle.ts:75-85, `DeleteFactory.fromEvents`). The service does NOT cast — callers cast via `castEvent(signed, TemporalSighting, eventStore)`.

---

### `src/lib/nostr/temporal-sighting/draft.ts` (service, file-I/O) — NEW

**Analog:** `src/lib/nostr/story/draft.ts` (whole file) — clone verbatim. Substitute:
- `StoryDraft` type's `Pick<ArticleContent,...>` → `Pick<TemporalSightingContent, 'title' | 'description' | 'start' | 'end' | 'geometry'>`
- key constant `'earthly:story:drafts:v1'` → `'earthly:sighting:drafts:v1'`, sentinel `'new-story'` → `'new-sighting'`
Keep the defensive `readDraftMap` (lines 28-45 — malformed value → `{}`, never throws) and the `readScopedStorage`/`writeScopedStorage` pubkey-scoped primitives.

---

### `src/lib/hooks/useSightings.ts` (hook, pub-sub) — NEW

**Analog:** `src/lib/hooks/useStories.ts` (whole file). Clone, substituting `ARTICLE_KIND`→`TEMPORAL_SIGHTING_KIND`, `isArticle`→`isTemporalSighting`, `Article`→`TemporalSighting`. **ADD the `dropExpired` filter** (SIGHT-03) inside the `useMemo` — this is the one addition over the Story clone:
```typescript
// clone of useStories.ts:31-34 + dropExpired (expiry.ts:28)
const sightings = useMemo(
	() => dropExpired(events.filter(isTemporalSighting), unixNow())
		.map((event) => castEvent(event, TemporalSighting, eventStore)),
	[events],
)
```
**CRITICAL (Pitfall P-2):** filter `isTemporalSighting` BEFORE `castEvent` — the cast ctor THROWS on a non-37522/legacy event (`cast.ts:29-32`), exactly as `useStories.ts:32` filters before casting.

---

### `src/components/SightingsPanel.tsx` (component, browse) — NEW

**Analog:** `src/components/StoriesPanel.tsx` (whole file). Clone the structure: `useFilterState` + `useSortedFilteredItems` + `EntitySearchToolbar`, the accent **New Sighting** button at top (`StoriesPanel.tsx:214-220`), the `Card`-per-row with `DropdownMenu` (Open/Edit/Copy link/Delete, lines 153-174), skeleton loading + empty states (lines 231-247), and the Draft-chip detection via the draft helper (lines 195-202).

**Substitutions:**
- `useStories()` → `useSightings()` (already `dropExpired`s — but if the panel enumerates a second source, `dropExpired` again per Pitfall P-1)
- `storyFilterConfig` searchable text `[title, summary, dTag]` → `[title, description, dTag]` (sighting has no summary)
- Row body: swap the 16:9 cover thumbnail (lines 109-122) for the **observation-state cue** (LIVE/Upcoming/past-date chip — see Shared Pattern "Observation-state classifier") + the **expiry countdown** ("Fades in 6 days"). Copy strings from UI-SPEC Copywriting Contract.
- `readStoryDraft` → `readSightingDraft`
- Empty-state copy → "No sightings yet" / "Spotted something? Drop your first sighting on the map." (UI-SPEC).
- **Security (T-10-05 carry-over):** title/description render as escaped React text nodes (lines 125-139 pattern) — NO `dangerouslySetInnerHTML`.

---

### `src/components/info-panel/SightingViewPanel.tsx` (component, request-response) — NEW

**Analog:** `src/components/info-panel/StoryViewPanel.tsx` (whole file). Clone the `EntityPanelShell`/`EntityPanelSurface`/`EntityPanelSectionHeader` chrome (lines 31, 107-153), the owner Edit/Delete vs non-owner action split (lines 114-152 — but Sighting has NO propose-edit/proposals; STRIP the `StoryProposalsPanel`/`StoryProposeEditDialog` lines 24, 184-225), and the **CommentsPanel mount** (lines 200-213) verbatim — that is the entire SIGHT-04 implementation.

**No-selection fallback** (clone lines 87-97): "No sighting selected" (UI-SPEC).

**Net-new view content** (replace the Markdown `RichContentRenderer` block, lines 169-178): render `sighting.sighting.title`/`.description` as escaped text + an **observation-time range** row ("Observed …" / "Until …") + an **expiry countdown** ("Fades in 6 days" / "Fades soon" / none if never). Use the observation-state classifier (Shared Pattern).

**Comment mount (SIGHT-04) — clone lines 200-213 unchanged except the cast type:**
```typescript
<EntityPanelSurface tone="discussion" className="space-y-4">
	<EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
	<CommentsPanel key={sighting.id ?? sighting.dTag} target={sighting /* TemporalSighting */} ... />
</EntityPanelSurface>
```
`GeoCommentFactory.root` takes `rootKind` as a runtime param (no allowlist) — kind 37522 needs no comment-factory change. The ONLY code change for the mount is widening the `target` union type (see Shared Pattern "Comment/React target-union widening").

---

### `src/components/info-panel/SightingEditorPanel.tsx` (component, CRUD form) — NEW

**Analog:** `src/components/info-panel/StoryEditorPanel.tsx` (whole file) for the shell/state/draft/submit spine + `src/features/geo-editor/components/GroupAttachField.tsx` for the `c`-attach (SIGHT-02).

**Clone from StoryEditorPanel:**
- `readInitialContent` pre-fill (edit-existing vs draft fallback, lines 82-109) — substitute `getArticleContent`/`isArticle` → `getTemporalSightingContent`/`isTemporalSighting`, draft helpers → sighting draft helpers.
- field state + reset-on-prop-change effect (lines 128-146).
- `handleSaveDraft`/`handleDiscardDraft` (lines 150-172) via the cloned `draft.ts`.
- `handleSave` (lines 174-220): call `editSighting`/`publishSighting` (NOT a re-inlined factory), `clearSightingDraft`, then `castEvent(signed, TemporalSighting, eventStore)` + `onSave(cast)`.
- The Title `Input` + Description `Textarea` metadata block (lines 230-250). **DROP** the cover-image `BlossomUploaderButton` (lines 251-283) and the TipTap `GeoRichTextEditor`/Tabs body (lines 286-336) — a Sighting has no Markdown body.
- The submit button is accent (`--primary`), reserved (lines 371-377): "Publish Sighting" / "Save changes" (UI-SPEC).

**Net-new form sections (no Story twin):**
1. **Observation time (D-03):** collapsed "Observed now" default with an "Adjust time" affordance revealing `start` + optional `end`. Use existing `@/components/ui/calendar` popover (UI-SPEC confirms it exists; A2/Q2). Maps to content `start`/`end`.
2. **NIP-40 expiry preset (D-04):** a `RadioGroup`/`Select` of 1 day / 1 week / 1 month / Never / Custom. Default **1 month** (UI-SPEC line 119). Selected preset carries the accent ring (reserved-accent #4). Independent of observation `end` (Pitfall P-4).
3. **Group attach (SIGHT-02):** mount `GroupAttachField` (see Shared Pattern). For a Sighting `featureProperties={[sightingProperties ?? {}]}`; `onPublish={handlePublishSighting}`; `canPublish={hasPlacement && signerReady}`; `publishLabel="Publish Sighting"` — never disabled by the validation verdict (GROUP-04).

---

### `src/components/AppSidebar.tsx` (MODIFY — rail wiring)

**Analog:** self — how Stories was added. Concrete extension points (current line numbers):
- `EntityWorkspace` union (line 55): `'geometry' | 'context' | 'story'` → add `'sighting'`.
- `WorkViewMode` (line 56) + `WORK_VIEW_MODES` (line 59): add `'sightings'`.
- `RAIL_DESTINATIONS` (line 78 — `{ mode: 'stories', title: 'Stories', icon: BookOpen }`): add `{ mode: 'sightings', title: 'Sightings', icon: Eye /* or Telescope */ }` (lucide).
- `renderWorkContent` switch (line 615) + the `import { StoriesPanelContent } from './StoriesPanel'` (line 26): add `SightingsPanelContent`.
- The `storyEditorMode`/`viewStory`/`onInspectStory`/`handleInspectStory`/`handleEditStory`/`handleSaveStory` prop + handler family (lines 158-166, 336-468) is the multiplexing template — clone the parallel `sighting*` family, including `setActiveEntity('sighting')` and `navigateToView('sightings')` (line 468).

---

### `src/features/geo-editor/hooks/useRouting.ts` (MODIFY — D-08 route)

**Analog:** self — the `'story'` focusType. Extension points (current line numbers):
- `focusType` union (line 35) + `isFocusType` guard (lines 53-54): add `'sighting'`.
- The story share-form parse (lines 116-122, `first === 'story'`): clone a `first === 'sighting'` block → `{ focusType: 'sighting', naddr: segments[1] }`.
- `buildRoutePath` `focusType` param type (line 249): add `'sighting'`.
- **Scope warning (Pitfall P-5):** keep this a thin per-kind clone of `'story'`; do NOT generalize a canonical entity-router — Phase 13 (XCUT-02) owns that. Flag the overlap at plan time. Use `buildRoutePath` not the `@deprecated buildRouteHash` (line 264).

---

### `src/index.ts` (MODIFY — server OG route)

**Analog:** self — `handleStoryRoute` (lines 146-175). Clone → `handleSightingRoute`:
- `isCrawler(req)` → `fetchCachedSightingEventOGData(naddr, relayUrl)` → `generateSightingOGHtml(...)` (lines 155-166).
- User redirect (lines 172-175): `/#/sightings/sighting/${naddr}` (mirror the story `/#/stories/story/...` form).
- Register the `/sighting/:naddr` (+ optional `/comment/:id`) route alongside the existing story/context/geoevent registrations.
- Import the new OG exports (lines 9-20 import block) — `generateSightingOGHtml`, `fetchCachedSightingEventOGData`.
- **CRITICAL (Pitfall P-1, SIGHT-03):** `fetchSightingOGData` MUST check `expiration` and return null/expired-state if past — the OG server fetch is a SEPARATE read path (raw WebSocket REQ, no cast, no filter). Stories don't expire so the story handler has no such check; add it here. Use `dropExpired`/epoch-seconds, never `Date.now()` ms.

---

### `src/lib/og/fetchEvent.ts` + `cache.ts` + `template.ts` + `index.ts` (MODIFY — OG data)

**Analogs (self):**
- `fetchEvent.ts:172-228` `fetchStoryOGData` — clone → `fetchSightingOGData`: `decoded.kind !== ARTICLE_KIND` → `!== TEMPORAL_SIGHTING_KIND`; parse `title`/`description` from content JSON (Sighting has `description` not `summary`); **ADD the NIP-40 expiry check** (Pitfall P-1) — return null if `expiration` tag is past.
- `cache.ts:12` `OGCacheType = 'geoevent' | 'context' | 'story'` → add `'sighting'`; clone the `fetchAndCacheRecord` branch (lines 192-200) + add `fetchCachedSightingEventOGData`.
- `template.ts` `generateStoryOGHtml` → `generateSightingOGHtml` (substitute copy; no cover image required).
- `index.ts` exports (lines 1-31): add the three new symbols mirroring the story exports (lines 5, 17, 23-25).

---

### `src/features/geo-editor/core/managers/LayerManager.ts` (MODIFY/new source) — NET-NEW VISUAL (D-05/D-06)

**Analog:** `LayerManager.ts:285-324` — the main point layer (`type: 'circle'`, data-driven `'case'` paint on a feature property `active`). This is the exact paint-expression pattern to mirror for a **distinct Sighting marker layer** with its own source.

**Net-new: a data-driven paint keyed on observation state** (instead of `active`). The classifier writes an `obsState`/`isLive`/`expiresAt` property onto each Sighting feature; the paint reads it:
```typescript
// mirror the LayerManager.ts:304-309 'case'/'coalesce' shape, but key on observation state:
'circle-color': [
	'case',
	['==', ['get', 'obsState'], 'live'],     '<--primary accent-->',   // D-06 highlight (the ONE accent on map)
	['==', ['get', 'obsState'], 'upcoming'], '<--secondary blue-->',
	'<--muted-foreground for past-->',
],
// optional D-05 opacity aging toward expiration (nice-to-have, ship if cheap):
'circle-opacity': ['interpolate', ['linear'], ['get', 'agingFactor'], 0, 0.35, 1, 1.0],
```
Use a distinct glyph (lucide `Eye`/`Telescope` motif via a `type: 'symbol'` layer like the annotation text layer at lines 354-358) so the marker reads as an ephemeral observation, not a dataset dot. Touch target ≥ 44px (UI-SPEC; invisible padded hit layer). **Q3/A3:** this extension point was not deep-read in research — the planner's first map task should locate exactly how an existing point source is fed (`SOURCE_ID`, `addSource`) and clone the source+layer pair. **Expired markers are REMOVED by `dropExpired` (Pitfall P-1) before the source data is built — never merely styled hidden.**

---

### `src/features/geo-editor/core/GeoEditor.ts` (CONSUME — map-first create, D-01)

**Analog (reuse as-is, no edit):** `GeoEditor.ts:301-306` — `mode === 'draw_point'` → `drawPointMode.onClick(e)` → `addFeature` + `emit('create', ...)`. The create flow arms `setMode('draw_point')` (line 921 `setMode`), the user clicks, the `'create'` event carries the placed feature; the orchestrator (GeoEditorView) opens `SightingEditorPanel` in the right info panel with the captured geometry. The "draw an area instead" affordance (D-02) switches to the existing line/polygon draw modes (lines 316+). No GeoEditor source change needed — this is a consumption/wiring pattern in GeoEditorView + AppSidebar.

---

## Shared Patterns

### NIP-40 expiry filter (SIGHT-03 — multi-site invariant)
**Source:** `src/lib/nostr/expiry.ts:22-30` (`isExpired`/`dropExpired`).
**Apply to (EVERY read path — Pitfall P-1, no single chokepoint):**
1. `useSightings.ts` subscription (in the `useMemo`).
2. `SightingsPanel.tsx` (if it enumerates a second source).
3. Sighting map layer source-data build in LayerManager (before features become a source).
4. Group foreign-lane list (`{kinds:[37522],'#c':[coord]}`).
5. **`src/lib/og/fetchEvent.ts` server fetch** — the easy miss; raw WS, no cast.
```typescript
import { dropExpired } from '@/lib/nostr/expiry'
const live = dropExpired(events, unixNow())   // epoch seconds UTC — NEVER Date.now() ms
```

### Defensive cast-after-filter (Pitfall P-2)
**Source:** `useStories.ts:32` + `cast.ts:29-32`. The `TemporalSighting` ctor throws on a non-37522/legacy event. ALWAYS `events.filter(isTemporalSighting).map(e => castEvent(e, TemporalSighting, store))` — never cast an unfiltered timeline (one bad event blanks the whole list/map).

### `c`-attach Group picker (SIGHT-02)
**Source:** `src/features/geo-editor/components/GroupAttachField.tsx` (reuse verbatim).
**Apply to:** `SightingEditorPanel`. Props: `contextRefs`/`onContextRefsChange` (drive `contextReferences()` → `c` tag), `featureProperties={[sightingProperties ?? {}]}`, `onPublish`, `canPublish`, `publishLabel="Publish Sighting"`. The off-thread `schema`-Group warn-not-block validation (lines 134-189) and the **GROUP-04 hard invariant** (publish NEVER disabled by verdict, lines 352-360) come for free.

### Comment/React mount + target-union widening (SIGHT-04)
**Sources:** `StoryViewPanel.tsx:200-213` (mount, clone unchanged) + `GeoCommentFactory.root` (parameterized `rootKind`, no allowlist).
**Type changes (the ONLY code change for SIGHT-04):**
- `src/features/social/comments/CommentsPanel.tsx:20` — `target: GeoDataset | MapContext | Article | null` → add `| TemporalSighting`.
- `src/features/social/hooks/useGeoComments.ts:27,39,187` — same union additions.
- `src/features/social/hooks/useGeoReactions.ts:12` — `ReactableEvent = GeoDataset | MapContext | GeoComment | NostrEvent` (already includes `NostrEvent`, so a cast may satisfy it; widen explicitly to `| TemporalSighting` for type clarity).
> Full NIP-22 read-side `K`/`k` widening across all four kinds is **Phase 13 (XCUT-01)** — Phase 11 only needs the Sighting's own thread to work.

### Observation-state classifier (D-06 — net-new, needs a unit test)
A pure helper `classifyObservationState(start?, end?, now): 'live' | 'upcoming' | 'past'`:
- `live` = `now ∈ [start, end]` (or `start ≤ now` and no `end`, within a freshness window)
- `upcoming` = `start > now`
- `past` = `end < now` (or past freshness)
Consumed by the map paint (LayerManager), the browse-row cue chip, and the view-panel time row. No analog — net-new, but trivial and pure; test live/upcoming/past per RESEARCH Wave-0.

### Local-first draft persistence
**Source:** `src/lib/nostr/story/draft.ts` over `readScopedStorage`/`writeScopedStorage`. Pubkey-scoped, keyed by `d`, defensive read → `{}` never throws. Clone for sightings.

---

## No Analog Found

None. Every file has either a self-extension point or a Phase-10 Story / Phase-9 Group twin. The two net-new *logic* concerns (geometry field + observation-state map marker) reuse, respectively, the `geo-event/helpers.ts` turf derivation and the `LayerManager` data-driven `'case'` paint pattern — partial analogs, not greenfield.

| Concern | Closest partial analog | Why not exact |
|---------|------------------------|---------------|
| `geometry` content field + bbox/g derivation | `geo-event/helpers.ts:154-179` (`computeBboxFor`/`computeGeohashFor`) | geo-event derives from a `FeatureCollection`; Sighting derives from a single `Geometry` (may need a Feature wrap — A4). |
| Observation-state / expiry-aware marker | `LayerManager.ts:285-324` main point layer | existing paint keys on `active` (selection); Sighting keys on a net-new `obsState`/`agingFactor` property (D-06/D-05). |

---

## Metadata

**Analog search scope:** `src/lib/nostr/{temporal-sighting,story,geo-event,article,group}/`, `src/lib/hooks/`, `src/lib/og/`, `src/components/`, `src/components/info-panel/`, `src/features/geo-editor/{hooks,components,core,core/managers,core/modes}/`, `src/features/social/{comments,hooks,proposals}/`, `src/index.ts`.
**Files scanned:** ~22 read in full or targeted; ~10 grepped for integration points.
**Pattern extraction date:** 2026-06-27
