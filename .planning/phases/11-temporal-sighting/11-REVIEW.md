---
phase: 11-temporal-sighting
reviewed: 2026-06-28T00:00:00Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - src/components/AppSidebar.tsx
  - src/components/GeoEditorInfoPanel.tsx
  - src/components/SightingsPanel.tsx
  - src/components/info-panel/SightingEditorPanel.tsx
  - src/components/info-panel/SightingViewPanel.tsx
  - src/components/info-panel/index.ts
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/components/MobilePanel.tsx
  - src/features/geo-editor/hooks/index.ts
  - src/features/geo-editor/hooks/useMapLayers.ts
  - src/features/geo-editor/hooks/useRouting.ts
  - src/features/geo-editor/hooks/useSightingEditor.ts
  - src/features/geo-editor/store/types.ts
  - src/features/social/comments/CommentsPanel.tsx
  - src/features/social/comments/GeoSocialActions.tsx
  - src/features/social/hooks/useGeoComments.ts
  - src/features/social/hooks/useGeoReactions.ts
  - src/index.ts
  - src/lib/hooks/useSightings.ts
  - src/lib/nostr/index.ts
  - src/lib/nostr/store.ts
  - src/lib/nostr/temporal-sighting/draft.ts
  - src/lib/nostr/temporal-sighting/helpers.ts
  - src/lib/nostr/temporal-sighting/index.ts
  - src/lib/nostr/temporal-sighting/lifecycle.ts
  - src/lib/nostr/temporal-sighting/observationState.ts
  - src/lib/og/cache.ts
  - src/lib/og/fetchContextEvent.ts
  - src/lib/og/fetchEvent.ts
  - src/lib/og/index.ts
  - src/lib/og/template.ts
  - src/lib/nostr/temporal-sighting/factory.ts
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-28
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

Reviewed the Phase 11 Temporal Sighting (kind 37522) implementation against the four
flagged focus areas. Verdicts on the focus areas:

- **OG-card XSS (T-11-04-02):** SOUND. `generateSightingOGHtml` routes every event-derived
  string through the audited `generateOGHtml`, which escapes via `escapeHtml`/`escapeJsString`
  and validates URL scheme via `sanitizeUrl`. No new injection surface. The Sighting OG path
  passes no untrusted `image`, so the image sink stays on the generated card. No finding.
- **Defensive parsing (filter-before-cast, P-2):** SOUND. `useSightings` applies
  `events.filter(isTemporalSighting)` BEFORE `dropExpired` BEFORE `castEvent`; the cast
  constructor throws on a non-conforming event but never sees one. `getTemporalSightingContent`
  is try/catch total. No finding.
- **c-attach validator warn-not-block (GROUP-04):** SOUND. `GroupAttachField`'s publish
  `disabled` is a pure function of `canPublish` (placement + signer readiness); the schema
  verdict never gates it. `SightingEditorPanel` passes `canPublish={hasPlacement && signerReady}`.
  No finding.
- **SIGHT-03 expiry across read paths:** MOSTLY SOUND but with residual gaps. The three
  primary client paths (`useSightings` subscription, `useMapLayers` source build, `SightingViewPanel`
  detail) and the server OG fetch each apply their own `dropExpired`/`isExpired`/`isOGEventExpired`
  against epoch-seconds `unixNow()`/`Math.floor(Date.now()/1000)`. Units are correct and strict
  (`< now`) and consistent across paths. Two residual leak/staleness gaps are recorded below
  (WR-01 deletion via OG fetch, WR-02 cache TTL outliving expiry).

The one BLOCKER is unrelated to the focus areas: editing an existing Sighting silently wipes its
SIGHT-02 group (`c`-tag) attachments because the editor never pre-fills `contextRefs`.

## Critical Issues

### CR-01: Editing a Sighting silently deletes all its Group (`c`-tag) attachments

**File:** `src/components/info-panel/SightingEditorPanel.tsx:172,190,256`
**Issue:** `contextRefs` state is initialized to `[]` (line 172) and the field-reset effect on
`initialSighting` change resets it back to `[]` (line 190). It is NEVER pre-filled from the
edited event's existing `c` tags (the cast exposes `initialSighting.contextReferences`, and
`getTemporalSightingContextReferences(event)` is available). On save, `editSighting` is invoked
with `groupCoords: contextRefs` (line 256), which flows to `TemporalSightingFactory.contextReferences([])`
→ `setContextRefs(tags, [])`. That transformer (`src/lib/nostr/tags.ts:117`) strips ALL existing
`c` tags and appends nothing:
```ts
return [
  ...tags.filter((t) => t[0] !== 'c'),   // removes every existing c tag
  ...[].filter(Boolean).map(...),         // adds nothing
]
```
Result: every edit of a published Sighting that was attached to one or more Groups silently
DROPS those attachments (SIGHT-02 data loss) — the Sighting falls out of the Group's feed with
no user action or warning. This is a parameterized-replaceable overwrite, so the prior version
(with the `c` tags) is superseded.
**Fix:** Pre-fill `contextRefs` from the edited event when entering edit mode, mirroring how
`title`/`description`/`geometry` are read in `readInitialContent`:
```ts
// in readInitialContent (edit branch), read existing context refs off the cast/event:
const contextRefs = initialSighting ? initialSighting.contextReferences : []
// return it, and in the component:
const [contextRefs, setContextRefs] = useState<string[]>(initial.contextRefs)
// and in the reset effect:
setContextRefs(next.contextRefs)
```
(Use `getTemporalSightingContextReferences(editedEvent)` for the event path so a draft-backed
create still starts empty.)

## Warnings

### WR-01: OG server fetch can leak a NIP-09-deleted (but unexpired) Sighting

**File:** `src/lib/og/fetchEvent.ts:66-110,264-315`
**Issue:** The focus brief requires that an expired *or removed* sighting never leak through any
read path. The client read paths go through the applesauce `eventStore`, which runs a
`DeleteManager` and removes kind-5-deleted events — so deletions are honored there. The server OG
fetch (`fetchEventFromRelay`) is a raw WS `REQ` that resolves on the first `EVENT`; it checks
`isOGEventExpired` but performs NO deletion check. If a user deletes a Sighting (NIP-09) but the
relay has not yet honored the delete (deletes are advisory/best-effort), a crawl of the
`/sighting/:naddr` card will render the deleted Sighting's title/description. Expiry is covered;
deletion is not.
**Fix:** The OG fetch already trusts the relay to GC; deletion is the relay's job too, so this is
partly a relay-trust boundary. To close it client-side, either (a) request the kind-5 deletion
alongside the Sighting and suppress when a matching delete is present, or (b) at minimum document
explicitly in `fetchSightingOGData` that deletion suppression is delegated to the relay (the
current comment only claims expiry coverage, which over-states the guarantee).

### WR-02: OG cache can serve an expired Sighting card for up to 24h after expiry

**File:** `src/lib/og/cache.ts:53-54,175-177,265-271`
**Issue:** `fetchSightingOGData` returns `null` for an expired Sighting, so a *fresh fetch* never
caches expired content. But a Sighting whose payload was cached while still live, and which then
expires, remains servable: `isStaleButUsable` keeps a record usable for `FRESH_TTL_MS +
STALE_WHILE_REVALIDATE_MS` (~24h10m), and `resolveCachedOGData` returns `cached.payload` on the
stale path (lines 265-271) and again on the final fallback (lines 284-289) without re-checking the
Sighting's own `expiration`. The background refresh will eventually evict it (refresh returns null
→ no overwrite, but the stale record's `staleUntil` is unbounded by the Sighting expiry), so an
expired Sighting's title/description can be served from cache for hours after it should have faded.
**Fix:** Make the cached `SightingOGData` carry the event's `expiration` (or a derived
`contentExpiresAt`) and have `resolveCachedOGData`/the sighting route treat a record past that
timestamp as a hard miss (return fallback), independent of the SWR window. Alternatively, cap a
Sighting record's `staleUntil` at its NIP-40 `expiration`.

### WR-03: `setFocused` store action type omits `'sighting'`, diverging from `focusedType`

**File:** `src/features/geo-editor/store/types.ts:316` (and `viewModeSlice.ts:33`)
**Issue:** `focusedType` is `'geoevent' | 'mapcontext' | 'story' | 'sighting' | null` (line 298),
and `applyRouteState` correctly writes `route.focusType` (which includes `'sighting'`) into
`focusedType`. But the standalone `setFocused` setter is typed `(type: 'geoevent' | 'mapcontext'
| 'story', naddr: string)` — `'sighting'` is missing. Any future caller of `setFocused` for a
Sighting focus is a type error, and the omission is an inconsistency that will silently mask a
real wiring gap if a sighting focus is ever set through this path.
**Fix:** Widen the `setFocused` signature to include `'sighting'` to match `focusedType`:
```ts
setFocused: (type: 'geoevent' | 'mapcontext' | 'story' | 'sighting', naddr: string) => void
```

### WR-04: `useSightings` expiry drop never recomputes as wall-clock advances

**File:** `src/lib/hooks/useSightings.ts:37-44`
**Issue:** The `useMemo` computes `dropExpired(..., unixNow())` but depends only on `[events]`.
A Sighting that expires while the timeline is mounted (no new event arriving) is NOT re-dropped —
it stays visible in the browse rail (and, via the same pattern, the map source rebuild in
`useMapLayers` only re-runs when `visibleSightings` changes). So an open tab can keep showing a
Sighting past its `expiration` until the next relay event or remount. This is a staleness window,
not a hard leak (a reload/new-event drops it), but it undercuts the SIGHT-03 "fades from the map"
contract for long-lived sessions.
**Fix:** Add a coarse ticking clock (e.g. a `setInterval`-driven `now` state at ~60s granularity)
into the memo dependency so expiry is re-evaluated as time passes, or recompute `dropExpired` on a
timer near each Sighting's `expiresAt`.

### WR-05: `fetchEventFromRelay` resolves on first EVENT with no `limit`; can return a superseded replaceable

**File:** `src/lib/og/fetchEvent.ts:66-110` (also `fetchContextEvent.ts:21-64`)
**Issue:** The raw OG fetch resolves on the FIRST `EVENT` frame for the subscription and sends no
`limit` in the filter. For an addressable/replaceable kind (37522 is parameterized-replaceable),
a relay may stream an older version before the newest, and this code takes whichever arrives
first. The OG card could therefore render a stale title/description (and, combined with WR-02, an
older non-expired snapshot of a now-expired or edited Sighting). Practically most relays send
newest-first for replaceables, but the code does not enforce it.
**Fix:** Collect events until EOSE and pick the highest `created_at`, or at least add `limit: 1`
to the filter to make the relay's selection explicit. (Same fix applies to the context fetch.)

### WR-06: Sighting OG comment route is registered but the comment deep link is never honored

**File:** `src/index.ts:188-217`, `src/features/geo-editor/GeoEditorView.tsx:1730-1739`
**Issue:** `handleSightingRoute` parses `commentId` and redirects users to
`/#/sightings/sighting/:naddr/comment/:commentId`, and `useRouting` parses the sighting
`commentId` into `RouteState`. But the in-app focus resolver for `route.focusType === 'sighting'`
(GeoEditorView:1730) calls `handleInspectSighting(sighting)` and ignores `route.commentId` — unlike
the comment-aware paths elsewhere. A shared `/sighting/:naddr/comment/:id` link lands on the
Sighting but does not scroll to / focus the referenced comment (the `focusCommentId` prop the
`SightingViewPanel` accepts is never threaded from the route here). Dead-end deep link.
**Fix:** Thread `route.commentId` into `handleInspectSighting` / the `SightingViewPanel`'s
`focusCommentId` for the sighting focus branch, mirroring the geoevent/story comment focus wiring.

## Info

### IN-01: Debug `console.log` left in the OG image render path

**File:** `src/lib/og/renderImage.ts:48`
**Issue:** `console.log(\`[OG] Font loaded: ${fontPath}\`)` logs on every font load in the
server-side OG image renderer. Noise in production logs (the OG renderer runs per crawl on a cache
miss). Not in the Phase-11 diff focus but surfaced while tracing the sighting OG image route.
**Fix:** Drop the log or gate it behind a debug flag.

### IN-02: `isOGEventExpired` accepts trailing-garbage expiration tags as valid

**File:** `src/lib/og/fetchEvent.ts:31-38`
**Issue:** The doc comment says "a malformed/non-numeric tag ⇒ never expired", but
`Number.parseInt('1700000000abc', 10)` returns `1700000000` (finite), so a tag like
`["expiration","1700000000garbage"]` is treated as a valid past timestamp. Behaviorally this is
the safe direction (it expires rather than leaks), so it is informational, but it contradicts the
stated "non-numeric ⇒ never expired" contract and differs from a stricter `Number(raw)` parse.
**Fix:** If strict parsing is intended, use `Number(raw)` (which yields `NaN` for trailing
garbage) and keep the `Number.isFinite` guard; otherwise correct the comment.

### IN-03: Duplicated `formatExpiryCountdown` / `formatRelativeDate` across Sighting surfaces

**File:** `src/components/SightingsPanel.tsx:65-87`, `src/components/info-panel/SightingViewPanel.tsx:64-110`
**Issue:** `formatRelativeDate` and `formatExpiryCountdown` are copy-pasted between the browse row
and the view panel (the view-panel comment even notes it "mirrors the SightingsPanel countdown").
Two copies of the same epoch-seconds arithmetic risk drifting (e.g. the `< 86_400` "Fades soon"
threshold) on future edits.
**Fix:** Extract both into a shared `temporal-sighting` formatting helper and import in both
surfaces.

---

_Reviewed: 2026-06-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
