# Phase 13: Cross-Cutting - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 10 (1 create-free; all modifications)
**Analogs found:** 10 / 10 (every touchpoint has an in-repo analog — Phase 13 is dedup/extend, not net-new)

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/features/social/hooks/useGeoComments.ts` | hook | request-response | (same file — `Article`/`TemporalSighting` union members) | exact (self-precedent) |
| `src/components/info-panel/BeaconViewPanel.tsx` | component | event-driven | `StoryViewPanel.tsx:217-238`, `SightingViewPanel.tsx` | exact |
| `src/features/geo-editor/hooks/useRouting.ts` | hook | transform (route parse/encode) | self — 5 cloned parsers L108-160 | exact (collapse clones) |
| `src/features/geo-editor/GeoEditorView.tsx` (routing) | component | event-driven | `handleInspectSighting` (commentId-threaded) vs `handleInspectBeacon` (not) | role-match |
| `src/features/geo-editor/store/types.ts` | model | — | `MapStackEntryType`/`MapStackEntry` (L72/L100) | exact (extend union) |
| `src/features/geo-editor/store/mapStackSlice.ts` | store | CRUD | `setMapStackEntryIsolated`/`clearMapStackIsolation` (L82-115) | exact (reuse) |
| `src/features/geo-editor/hooks/useMapLayers.ts` | hook | render pipeline | `visibleGeoEvents` prop path (L447/L460) | exact analog for gating |
| `src/features/geo-editor/GeoEditorView.tsx` (stack sets) | component | transform | `visibleGeoEvents` selector (L960-1028); `addDatasetToMapStack` (L441-457) | exact |
| `src/components/info-panel/SightingViewPanel.tsx` | component | event-driven | `onAddDatasetToMap` affordance pattern | role-match |
| `src/components/BeaconsPanel.tsx` / `SightingsPanel.tsx` | component | event-driven | `onAddDatasetToMap` rail affordance | role-match |
| `src/components/MapStackPanel.tsx` | component | CRUD | `otherEntries` bucket (L738-747); dataset/context render+toggle | exact |

---

## Pattern Assignments

### XCUT-01 — `useGeoComments.ts` + `BeaconViewPanel.tsx` (union widen + panel mount)

**Analog:** `StoryViewPanel.tsx:217-238` (the Phase 10 `bf1112e` add-a-kind slice), plus the union members already present in `useGeoComments.ts:28,41`.

**Union widen** (`useGeoComments.ts` — TWO unions, L28 and L40-42):
```typescript
// L27-30 — target union
export interface UseGeoCommentsOptions {
	target: GeoDataset | MapContext | Article | TemporalSighting | null   // add | LiveBeacon
	maxDepth?: number
}
// L40-42 — react() param union (MUST widen both)
react: (
	target: GeoDataset | MapContext | Article | TemporalSighting | GeoComment,   // add | LiveBeacon
) => Promise<void>
```
Import: add `import type { LiveBeacon } from '@/lib/nostr/live-beacon'` alongside the existing `Article`/`MapContext`/`TemporalSighting` type imports (L15-18). NO other changes — the filter at L55-63 is already kind-generic (`target.kind`/`target.pubkey`/`target.dTag` → `${kind}:${pubkey}:${dTag}` `#A` address); `LiveBeacon` exposes `.kind`/`.pubkey`/`.dTag` so it drops straight in.

**Panel mount** (`BeaconViewPanel.tsx` — replace the deferral note at L273-274 with the Story mount, mirroring `StoryViewPanel.tsx:222-238`):
```tsx
<EntityPanelSurface tone="discussion" className="space-y-4">
	<EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
	<CommentsPanel
		key={beacon.id ?? beacon.dTag ?? 'no-beacon'}
		target={beacon}
		onCommentGeojsonVisibilityChange={(comment, visible) => onCommentGeometryVisibility?.(comment, visible)}
		onZoomToCommentGeojson={(comment) => { if (comment.boundingBox && onZoomToBounds) onZoomToBounds(comment.boundingBox) }}
		availableFeatures={availableFeatures}
		onMentionVisibilityToggle={onMentionVisibilityToggle}
		onMentionZoomTo={onMentionZoomTo}
		focusCommentId={focusCommentId}
	/>
</EntityPanelSurface>
```
Also REMOVE the deferral note in the file header comment (L7-8) and add the new props (`focusCommentId`, `onCommentGeometryVisibility`, `onZoomToBounds`, `availableFeatures`, `onMentionVisibilityToggle`, `onMentionZoomTo`) to `BeaconViewPanelProps` — copy the exact prop names/types from `StoryViewPanel`'s props interface. Import `CommentsPanel` from `@/features/social/comments/CommentsPanel`.

---

### XCUT-02 — `useRouting.ts` dispatcher + `GeoEditorView` handlers

**Analog (the debt to collapse):** `useRouting.ts:108-160` — five byte-identical `if (first === '<kind>' && segments[1])` blocks (`geoevent`/`mapcontext`/`story`/`sighting`/`beacon`), each returning `{ focusType, naddr: segments[1], commentId: segments[2]==='comment' && segments[3] ? segments[3] : undefined, sidebarView }`.

**Dispatcher pattern (D-08/D-09 — preserve byte-for-byte):** replace the five blocks with ONE `prefix→{focusType, sidebarView}` lookup table + one generic body:
```typescript
const SHARE_ROUTES: Record<string, { focusType: RouteState['focusType']; sidebarView: SidebarViewMode }> = {
	geoevent:   { focusType: 'geoevent',   sidebarView: 'datasets' },
	mapcontext: { focusType: 'mapcontext', sidebarView: 'contexts' },
	story:      { focusType: 'story',      sidebarView: 'stories' },
	sighting:   { focusType: 'sighting',   sidebarView: 'sightings' },
	beacon:     { focusType: 'beacon',     sidebarView: 'beacons' },
}
// in parsePathSegments, after the /user branch:
const share = SHARE_ROUTES[first]
if (share && segments[1]) {
	return {
		focusType: share.focusType,
		naddr: segments[1],
		commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
		sidebarView: share.sidebarView,
	}
}
```
UNTOUCHED (D-09): the `/context/:naddr/...` scoped branch (L168-206), the generic `isSidebarViewMode` tail (L208-220), `parseLocation` hash fallback (L231-245), `upgradeLegacyHashRoute` (L259-266). naddr encoders (`encodeGeoEventNaddr` L482-503, `encodeContextNaddr` L508-529) are already generic `nip19.naddrEncode({kind,pubkey,identifier})` — leave them; the kind travels inside the naddr, so no per-kind encoder branching is needed.

**Beacon commentId gap (D-10):** the inspect handlers live in per-kind hooks. The analog to mirror is `useSightingEditor.ts:102-114` — `handleInspectSighting(sighting, commentId?)` accepts `commentId`, stores it via `setFocusCommentId(commentId)` (hook state, because `navigateToView` wipes the URL `/comment/:id` segment — see the comment at L112-113), and exposes it as `sightingFocusCommentId`. `useBeaconController.ts:167-193` `handleInspectBeacon(beacon)` has NO `commentId` param and no `focusCommentId` state. Mirror the Sighting hook: add `commentId?` param, add `focusCommentId` state + `beaconFocusCommentId` in the returned object, pass it to the new `CommentsPanel` mount. The GeoEditorView dispatch site at L1968 (`handleInspectBeacon(beacon)`) must pass `route.commentId` like the Sighting site at L1954 (`handleInspectSighting(sighting, route.commentId)`).

**OG share path (D-09):** `src/lib/og/` (`crawler.ts`, `fetchEvent.ts`) matches the 2-segment share forms — the lookup-table refactor keeps identical URL shapes, so no OG change needed. Verify the crawler's prefix matching still recognizes all five prefixes after refactor.

---

### Map Stack unification (the body)

#### `store/types.ts` — extend the union (analog: the existing `MapStackEntryType`, L72-78)
```typescript
export type MapStackEntryType =
	| 'dataset' | 'context' | 'comment' | 'proposal' | 'draft' | 'ai-result'
	| 'sighting'        // individual sighting pinned by naddr/dTag
	| 'beacon'          // individual beacon pinned by naddr/dTag
	| 'sighting-layer'  // aggregate "Sightings" layer (entityKey: 'all')
	| 'beacon-layer'    // aggregate "Live beacons" layer (entityKey: 'all')
```
`MapStackEntrySource` (L79-98) already has `'browse-default'` and `'route'` — reuse for cold-start (SPEC §3.3) and deep-link-solo. `MapStackEntry` (L100-122) already carries `visible`/`pinned`/`isolated`/`exclusions` — no field additions needed.

#### `store/mapStackSlice.ts` — reuse, do NOT reinvent isolation
The isolation machinery is DONE and entityType-agnostic: `setMapStackEntryIsolated` (L82-98, mutually-exclusive global clear) and `clearMapStackIsolation` (L100-115). Deep-link-solo = `addMapStackEntry({..., isolated: true})` then the existing rule suppresses others. `clearMapStack` (L169-185) already keeps `pinned` + `draft`; new layer entries with `source: 'browse-default'` are non-pinned so they clear normally. **D-02 (pinned-entry expiry auto-remove):** call the existing `removeMapStackEntry(id)` (L47-56) from an expiry sweep — no new slice method.

#### `GeoEditorView.tsx` — stack-derived selectors (analog: `visibleGeoEvents` L960-1028)
Mirror `visibleGeoEvents` exactly for two new memos `visibleSightingsFromStack` / `visibleBeaconsFromStack`:
- Read `mapStackEntries` + `mapStackOrder` (deps like L1028).
- **Isolation branch first** (mirror L990-1004): if an isolated entry exists, render ONLY it — if it's a `sighting`/`beacon` type, return the single matching entity; if it's ANY other type (dataset/context isolated), return `[]` (aggregate layers suppressed under isolation, SPEC §3.2).
- **Aggregate branch** (no L1005-1028 analog for datasets, this is new): if a visible `sighting-layer`/`beacon-layer` entry exists → return the full `sightings`/`beacons` subscription set. Then union in individually-pinned `sighting`/`beacon` entries resolved from the subscription by `dTag`/naddr.
- `buildSightingSource`/`buildBeaconSource` (`useMapLayers.ts:271,360`) stay UNCHANGED — their internal `dropExpired` + freshest-per-`{pubkey,d}` de-dup just receive the gated input.

**Add-to-stack affordance (analog: `addDatasetToMapStack` L441-457):**
```typescript
const addBeaconToMapStack = useCallback((beacon: LiveBeacon, source: 'manual'|'route'|'browse-default' = 'manual') => {
	addMapStackEntry({
		entityType: 'beacon',
		entityKey: beacon.dTag ?? beacon.id,
		title: beacon.beacon.label?.trim() || 'Live location',
		source, visible: true, pinned: false,
		isolated: source === 'route',   // deep-link lands SOLO (SPEC §2.2)
	})
}, [addMapStackEntry])
```
Same shape for sightings. Cold-start Browse adds the two `*-layer` entries with `source: 'browse-default', visible: true, entityKey: 'all'` (reuse whatever effect currently seeds `browse-default` dataset entries — find the `browse-default` seeding site).

**DELETE (commit `66a155e`):** the `extraMapBeacons` state + sync effect + `beaconsForMap` merge at L1164-1167, and change the `useMapLayers` call (L1173-1174) from `visibleSightings: sightings, visibleBeacons: beaconsForMap` to `visibleSightings: visibleSightingsFromStack, visibleBeacons: visibleBeaconsFromStack`.

#### `useMapLayers.ts` — HIGHEST-RISK SEAM (shared render path)
`visibleSightings`/`visibleBeacons` are ALREADY props (L448-451, defaulted `[]` at L461-462) fed into `buildSightingSource`/`buildBeaconSource`. The change is caller-side (GeoEditorView passes stack-derived sets instead of raw subscriptions); **the hook body and the `visibleGeoEvents` dataset/context render path stay byte-for-byte identical**. Do NOT touch `visibleGeoEvents` handling inside the hook — that is the regression surface flagged in CONTEXT.md `<code_context>`. The dataset/context analog proves the prop-gating pattern is already how datasets work (`visibleGeoEvents` is stack-derived in GeoEditorView, passed as a prop); sightings/beacons just adopt the same discipline.

#### `MapStackPanel.tsx` — render/toggle aggregate + individual entries
The `otherEntries` bucket (L738-747) ALREADY catches every entityType that isn't dataset/context/draft — so `sighting`/`beacon`/`sighting-layer`/`beacon-layer` fall through there today with generic rendering. For D-05 (aggregate layers pin to top): add explicit `sightingLayerEntries`/`beaconLayerEntries` memos (mirror `datasetEntries` L734-737) and render them ABOVE `datasetEntries`/`contextEntries`. Per-entry toggle/isolate/remove already work via `toggleMapStackEntryVisible`/`setMapStackEntryIsolated`/`removeMapStackEntry` — the row component (L171-336) branches on `entry.entityType` for label/icon (L245-249, L282); add `sighting`/`beacon`/`*-layer` cases there.

#### View panels + rails — "Add to map stack" (analog: `onAddDatasetToMap`)
`BeaconViewPanel.tsx`/`SightingViewPanel.tsx`: add an `onAddToMapStack?` prop + a `<Button>` alongside the existing "Copy share link" button (`BeaconViewPanel.tsx:263-270` is the exact button shape to clone). `BeaconsPanel.tsx` (`onOpenBeacon` prop L54, row `onOpen` L103-140) and `SightingsPanel.tsx`: add an `onAddToMapStack` handler on the rail row, mirroring how the datasets rail wires `onAddDatasetToMap`.

---

## Shared Patterns

### Isolation / deep-link-solo
**Source:** `store/mapStackSlice.ts:82-115` (`setMapStackEntryIsolated`, `clearMapStackIsolation`) + `GeoEditorView.tsx:990-1004` (isolation branch of `visibleGeoEvents`).
**Apply to:** deep-link landing for sighting/beacon (`isolated: true`), and the isolation branch of both new stack-derived selectors. Reuse — do not add a parallel mechanism.

### Add-to-stack affordance
**Source:** `GeoEditorView.tsx:441-457` (`addDatasetToMapStack`) + `MapStackPanel.tsx:27` (`onAddDatasetToMap`).
**Apply to:** new `addBeaconToMapStack`/`addSightingToMapStack` + view-panel/rail buttons.

### Comment deep-link threading (commentId → focusCommentId)
**Source:** `useSightingEditor.ts:102-122` (param → hook state → returned `sightingFocusCommentId`) + dispatch `GeoEditorView.tsx:1954`.
**Apply to:** `useBeaconController.handleInspectBeacon` (D-10) and the beacon `CommentsPanel` mount.

### Expiry drop (dropExpired parity)
**Source:** `useMapLayers.ts:273-276,362-366` (`dropExpired` in source builders); `store/mapStackSlice.ts:47` (`removeMapStackEntry`).
**Apply to:** D-02 pinned-entry expiry sweep — remove the stack entry when its entity expires.

### Kind constants
**Source:** `src/lib/nostr/kinds.ts` — `LIVE_BEACON_KIND = 37521`, `TEMPORAL_SIGHTING_KIND = 37522`, `ARTICLE_KIND = 37520`. Already imported where needed; naddr carries the kind (no per-kind branching in encoders).

## No Analog Found

None. Every Phase 13 touchpoint has an in-repo precedent — this phase is dedup + extension of shipped machinery, consistent with the CONTEXT.md reality check ("gap-closure, not a from-scratch build").

## Metadata

**Analog search scope:** `src/features/geo-editor/{hooks,store}`, `src/features/social`, `src/components/info-panel`, `src/components`, `src/lib/nostr`, `src/lib/og`.
**Files scanned:** ~14 (all named in CONTEXT.md `<canonical_refs>` + SPEC §6 touchpoints).
**Pattern extraction date:** 2026-07-02
