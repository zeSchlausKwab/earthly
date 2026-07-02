---
phase: 13-cross-cutting
reviewed: 2026-07-02T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/components/AppSidebar.tsx
  - src/components/BeaconsPanel.tsx
  - src/components/GeoEditorInfoPanel.tsx
  - src/components/MapStackPanel.layerEntries.test.ts
  - src/components/MapStackPanel.tsx
  - src/components/SightingsPanel.tsx
  - src/components/info-panel/BeaconViewPanel.tsx
  - src/components/info-panel/SightingViewPanel.tsx
  - src/features/geo-editor/GeoEditorView.stackLayers.test.ts
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/hooks/useBeaconController.ts
  - src/features/geo-editor/hooks/useRouting.dispatch.test.ts
  - src/features/geo-editor/hooks/useRouting.ts
  - src/features/geo-editor/store/types.ts
  - src/features/social/hooks/useGeoComments.beacon.test.ts
  - src/features/social/hooks/useGeoComments.ts
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-07-02
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 13 stitches four cross-cutting seams together: the `useGeoComments` target
union widening to accept `LiveBeacon`, the collapse of five per-kind route parsers
into one `SHARE_ROUTES` dispatcher, the Map Stack unification (stack-derived
`deriveVisibleEntitiesFromStack` gate + deletion of the `extraMapBeacons`
side-channel), and the add-to-stack / aggregate-layer / cold-start / expiry-sweep UI.

The core pieces are clean and the pure-logic units (route dispatch, bucketing,
stack derivation) are well-tested. GPS-privacy posture holds: `BeaconViewPanel`
renders no coordinates into HTML, and the aggregate layer branch only ever seeds
from the discovery `subscriptionSet` (no link-only beacon leak). The `SHARE_ROUTES`
table is a closed record keyed by known prefixes, so no arbitrary focus type can be
injected from a URL.

However, two integration wiring defects escaped the (passing) unit gates because
they live in the prop-threading between `GeoEditorView` → wrapper → panel, which the
pure tests don't exercise:

1. The beacon "Follow on map" toggle is dead across every render path — neither
   `AppSidebar` nor `MobilePanel` forwards the follow props to the info panel.
2. `GeoSocialActions` never learned about `LIVE_BEACON_KIND`, so the newly-wired
   beacon comment surface + beacon Share buttons produce "No share route available."

Plus a URL-format inconsistency in the beacon Copy-share-link (legacy `/#/` hash
form vs. the clean-path canon the rest of the phase moved to) and a stack-sweep
race worth hardening.

## Critical Issues

### CR-01: Beacon "Follow on map" toggle is unreachable — follow props never threaded to the info panel

**File:** `src/components/AppSidebar.tsx:811-881`, `src/features/geo-editor/components/MobilePanel.tsx:482-514`, `src/features/geo-editor/GeoEditorView.tsx:2455-2456,2806-2807`
**Issue:** `GeoEditorView` computes `isFollowingBeacon` / `toggleFollowBeacon` and
passes them to both `<AppSidebar isFollowingBeacon=… onToggleFollowBeacon=… />`
(desktop, line 2455) and `<MobilePanel …>` (line 2806). But:
- `AppSidebar`'s props interface (`AppSidebarProps`, lines 122-255) does **not
  declare** `isFollowingBeacon` or `onToggleFollowBeacon`, and its `editorPanelProps`
  object (lines 811-881) never forwards them to `GeoEditorInfoPanelContent`.
- `MobilePanel`'s explicit prop lists on the `GeoEditorInfoPanelContent` mounts
  (lines 482-514, 518+) never forward them either.

`BeaconViewPanel` gates the whole Follow button on `onToggleFollow && isLive`
(BeaconViewPanel.tsx:287). Because `onToggleFollow` arrives `undefined` through both
wrappers, the button is **never rendered** — the follow feature (a Phase-12/13
view-panel affordance) is silently dead on desktop and mobile. This isn't caught by
`tsc` since the project runs with ~305 pre-existing tsc errors and gates on
`bun test` + `bun run build` + biome, none of which trace this prop path. The pure
unit tests don't mount the wrapper chain, so they pass while the feature is broken.
**Fix:** Declare the two props on `AppSidebarProps`, destructure them, and add them
to `editorPanelProps`; likewise thread them through `MobilePanel` into each
`GeoEditorInfoPanelContent` beacon mount:
```tsx
// AppSidebar.tsx — interface
isFollowingBeacon?: boolean
onToggleFollowBeacon?: () => void
// ...destructure in the component signature, then:
const editorPanelProps = {
  // ...
  isFollowingBeacon,
  onToggleFollowBeacon,
}
// MobilePanel.tsx — add to props + forward on the beacon-bearing
// GeoEditorInfoPanelContent mount:
isFollowingBeacon={isFollowingBeacon}
onToggleFollowBeacon={onToggleFollowBeacon}
```

### CR-02: `GeoSocialActions` has no `LIVE_BEACON_KIND` case — beacon comment/share buttons return "No share route available"

**File:** `src/features/social/comments/GeoSocialActions.tsx:47-60,412-451`
**Issue:** Phase 13 mounts `CommentsPanel` against the beacon in `BeaconViewPanel`
(BeaconViewPanel.tsx:334, `target={beacon}`), and `CommentsPanel` renders a
`GeoSocialActions` bar (`CommentsPanel.tsx:155`) with that beacon as the target.
`getEntitySharePath(kind)` (lines 47-60) has cases only for `GEO_EVENT_KIND`,
`MAP_CONTEXT_KIND`, `ARTICLE_KIND`, and `TEMPORAL_SIGHTING_KIND` — it returns `null`
for `LIVE_BEACON_KIND`. `buildSharePath` (line 450-451) therefore returns `null` for
a beacon target, and `handleShare` (line 519-521) shows
`toast.error('No share route available for this item')`. The same failure hits the
Share button on any **beacon comment** (a GEO_COMMENT whose `rootAddress` kind is
37521 → `getEntitySharePath(rootKind)` is null at line 430-431). The beacon comment
deep-link this phase explicitly set out to wire (`/beacon/:naddr/comment/:id`) can
never be *copied* from the comment UI. `getEntitySharePath`'s union return type also
lacks `'beacon'`.
**Fix:** Add the beacon case and widen the return union:
```ts
function getEntitySharePath(
  kind: number,
): 'geoevent' | 'context' | 'story' | 'sighting' | 'beacon' | null {
  switch (kind) {
    case GEO_EVENT_KIND: return 'geoevent'
    case MAP_CONTEXT_KIND: return 'context'
    case ARTICLE_KIND: return 'story'
    case TEMPORAL_SIGHTING_KIND: return 'sighting'
    case LIVE_BEACON_KIND: return 'beacon'
    default: return null
  }
}
```
(Requires importing `LIVE_BEACON_KIND` into `GeoSocialActions.tsx`.)

## Warnings

### WR-01: Beacon Copy-share-link builds a legacy `/#/` hash URL, diverging from the clean-path canon

**File:** `src/components/info-panel/BeaconViewPanel.tsx:191`
**Issue:** `handleCopyShareLink` builds
`` `${window.location.origin}/#/beacons/beacon/${naddr}` ``, i.e. the pre-Round-I
hash form. The rest of Phase 13 (and `useRouting`) moved to canonical clean paths:
`buildRoutePath` emits `/beacons/beacon/:naddr`, `useBeaconController.handleInspectBeacon`
navigates to `navigateTo('beacon', naddr, 'beacons')` → `/beacons/beacon/:naddr`, and
`GeoSocialActions.buildSharePath` emits clean `/{sharePath}/{naddr}` links. The hash
link only survives because `parseLocation` still has a legacy-hash fallback +
`upgradeLegacyHashRoute` shim — so the copied link works today but is one shim-removal
away from breaking, and produces a different URL than the Share button on the same
entity. Inconsistent share surfaces for one beacon.
**Fix:** Emit the canonical clean path (and prefer routing over string building):
```ts
const url = `${window.location.origin}/beacons/beacon/${naddr}`
```

### WR-02: Expiry auto-remove sweep can drop a valid deep-linked/pinned beacon during a transient subscription gap

**File:** `src/features/geo-editor/GeoEditorView.tsx:1311-1333`
**Issue:** The sweep removes any individual `beacon` stack entry whose key is absent
from `beaconLookupSuperset` (`!resolved → removeMapStackEntry(id)`, line 1330).
`beaconLookupSuperset = routedBeacons.length ? [...beacons, ...routedBeacons] : beacons`
(line 1284-1287). For a deep-linked link-only beacon, resolution depends on the
targeted `routedBeacons` subscription. If that subscription momentarily yields `[]`
(relay reconnect, EOSE churn, or the 15s expiry tick briefly emptying the set) while
the beacon is genuinely still live, the sweep deletes the isolated `source: 'route'`
stack entry — collapsing the deep-link-solo view the phase just built. "Absent from
subscription" is being treated as "expired," but absence can be transient. A pinned
manual beacon entry has the same exposure.
**Fix:** Only sweep on a positive expiry signal, or require the subscription to have
reached EOSE before treating absence as removal. E.g. remove on
`resolved && isExpired(resolved.event, now)`; for the "dropped from subscription"
case, gate on an EOSE/`hasLoaded` flag so an un-loaded set never triggers removal:
```ts
if (resolved && isExpired(resolved.event, now)) removeMapStackEntry(id)
else if (beaconsEose && !resolved) removeMapStackEntry(id) // only once loaded
```

### WR-03: `contextByKey` and `EntryRow` curated-dataset memos have incomplete dependency arrays

**File:** `src/components/MapStackPanel.tsx:883-890,303-312`
**Issue:** `contextByKey` (line 883) is memoized on `[mapContextEvents]` but its body
reads `context.contextCoordinate ?? context.id ?? context.contextId ?? context.dTag`
— fine — however the sibling `datasetByKey` correctly depends on
`[geoEvents, getDatasetKey]` while `contextByKey` omits nothing it uses, so that one
is ok. The real gap is `EntryRow`'s `curatedDatasets` memo (line 303-312): its
dependency array is `[entry.entityType, context, geoEvents, mapContextEvents]` but the
body also calls `getDefaultContextMapScopeMode(context)` and uses `getDatasetKey`
downstream in `includedCuratedCount`; more importantly `exclusionSet` (line 313)
depends on `entry.exclusions` but `includedCuratedCount` (line 314) is recomputed
every render (not memoized) reading `curatedDatasets` + `exclusionSet`. Not a
correctness bug today, but the mixed memo/non-memo boundary around exclusion counting
is fragile and biome's exhaustive-deps is evidently not catching it.
**Fix:** Recompute `includedCuratedCount` inside a `useMemo` keyed on
`[curatedDatasets, exclusionSet, getDatasetKey]`, and audit the `curatedDatasets`
deps to include every referenced value.

### WR-04: `orderedMapStackEntries` is dead code relative to the render path (two sources of truth for order)

**File:** `src/components/MapStackPanel.tsx:178-187` vs `EntryGroupList` (687-834)
**Issue:** `orderedMapStackEntries(buckets)` defines the flat render order and is what
`MapStackPanel.layerEntries.test.ts` asserts against ("asserting the pure order ==
asserting the visual order", per the test header). But the actual panel renders via
`EntryGroupList`, which independently emits groups in the order
sighting-layer → beacon-layer → draft → context → dataset → other (lines 769-831).
The real render order is hand-maintained in JSX and only *happens* to match
`orderedMapStackEntries`. If someone reorders the JSX groups, the test keeps passing
while the UI diverges — the test guards a function the UI doesn't call. This is a
latent false-confidence trap.
**Fix:** Have `EntryGroupList` map over `orderedMapStackEntries(...)` (or drive the
group sequence from a shared ordered bucket-key list) so the tested function is the
single source of truth for render order; or delete `orderedMapStackEntries` and test
the JSX order directly.

### WR-05: `nodeMap` keys collide on empty string when a comment lacks both `id` and `commentId`

**File:** `src/features/social/hooks/useGeoComments.ts:81-88`
**Issue:** `const nodeId = comment.id ?? comment.commentId ?? ''` — a comment missing
both identifiers maps to `''`. Two such comments overwrite each other in `nodeMap`
(line 82), and any reply whose `parentEventId` is empty would attach to whichever
survived. With the beacon target union now widened, an unsigned/optimistic or
malformed 37521-rooted comment reaching this reducer could silently drop a node.
Pre-existing, but the union widening broadens the input surface.
**Fix:** Skip nodes with no stable id rather than bucketing them under `''`:
```ts
const nodeId = comment.id ?? comment.commentId
if (!nodeId) continue
```

## Info

### IN-01: `MapStackEntrySource` union missing `'story'` label mapping is fine, but `entryTypeMetaLabel`/`entityTypeLabel` duplicate the type switch

**File:** `src/components/MapStackPanel.tsx:80-113`
**Issue:** `entityTypeLabel` and `entryTypeMetaLabel` are two near-parallel switches
over `entityType`, and the `EntryRow` icon block (lines 372-388) is a *third* switch
over the same discriminant. Three places must be updated in lockstep when a new
`MapStackEntryType` is added. Consider a single `const ENTITY_TYPE_META: Record<
MapStackEntryType, { title; meta; icon }>` table to collapse the triplication.

### IN-02: `sourceLabel` record is passed down through three component layers as a prop

**File:** `src/components/MapStackPanel.tsx:59-70,255,669`
**Issue:** The module-constant `sourceLabel` map is threaded as a prop through
`MapStackPanel` → `EntryGroupList` → `EntryRow` despite being a static module value
importable directly. Prop-drilling a constant adds noise to three interfaces for no
runtime benefit.
**Fix:** Import `sourceLabel` directly where used and drop it from the prop
interfaces.

### IN-03: `visibleCount` denominator counts aggregate-layer rows, making "X/Y visible" ambiguous

**File:** `src/components/MapStackPanel.tsx:911,984`
**Issue:** `visibleCount = entries.filter(e => e.visible).length` and the header shows
`{visibleCount}/{entries.length} visible`. Because aggregate `sighting-layer` /
`beacon-layer` entries are counted in `entries`, the denominator conflates
whole-layer toggles with individual dataset/context/pin entries — a cold-start stack
of two aggregate layers reads "2/2 visible" before the user has added any real
content. Cosmetic, but the count no longer means "map objects."

---

_Reviewed: 2026-07-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
