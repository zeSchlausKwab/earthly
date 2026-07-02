---
phase: 12-live-beacon-37521
reviewed: 2026-06-28T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - scripts/seed-entities.ts
  - src/components/AppSidebar.tsx
  - src/components/BeaconsPanel.tsx
  - src/components/GeoEditorInfoPanel.tsx
  - src/components/RunningBeaconBanner.tsx
  - src/components/info-panel/BeaconControlPanel.tsx
  - src/components/info-panel/BeaconViewPanel.tsx
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/hooks/useBeaconController.ts
  - src/features/geo-editor/hooks/useBeaconPublisher.ts
  - src/features/geo-editor/hooks/useMapLayers.ts
  - src/features/geo-editor/hooks/useRouting.ts
  - src/features/geo-editor/store/types.ts
  - src/index.ts
  - src/lib/hooks/useBeacons.ts
  - src/lib/nostr/live-beacon/beaconState.ts
  - src/lib/nostr/live-beacon/cast.ts
  - src/lib/nostr/live-beacon/helpers.ts
  - src/lib/nostr/live-beacon/index.ts
  - src/lib/nostr/live-beacon/lifecycle.ts
  - src/lib/og/cache.ts
  - src/lib/og/fetchBeacon.ts
  - src/lib/og/fetchEvent.ts
  - src/lib/og/index.ts
  - src/lib/og/relayFetch.ts
  - src/lib/og/template.ts
  - src/test/geolocationMock.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-06-28
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Phase 12 implements the Live Beacon (kind 37521) per-session throwaway-key location-sharing
feature. The data-layer privacy/visibility/expiry plumbing is largely sound: the public vs
link-only branch in `lifecycle.ts` correctly strips `t:'live'` + `bbox` + `g` for link-only beacons
(the shared `tags.ts` setters use filter-out-then-append replace semantics, so a public→link-only
heartbeat does not leak old tags); clock discipline is consistently epoch-seconds (`unixNow()`,
never `Date.now()` ms) at every read path; `dropExpired` is applied independently at the
subscription, the map-source build, the OG raw fetch, and the OG cache hard-miss; the OG template
escapes all interpolated untrusted content and validates URL schemes; and the cast ctor +
`isLiveBeacon` filter-before-cast ordering defends against forged/legacy events.

However, the **net-new live subsystem (`useBeaconPublisher`) has two BLOCKER-level privacy/lifecycle
defects**: it has NO unmount cleanup (a live beacon keeps publishing the user's GPS location and
leaks a `watchPosition` + heartbeat interval when the component unmounts), and `startBeacon` does
not tear down a pre-existing session before minting a new one (Adjust / double-Start orphans the
prior watch + interval + throwaway signer, which keep publishing the user's location under a key the
app can no longer Stop). These directly violate the stated D-05 privacy boundary and the geolocation
lifecycle requirement. Several warnings follow around owner-action affordances for anonymous beacons,
a broken stale-fixture in the seed script, and an `as unknown as` signer cast.

## Critical Issues

### CR-01: `useBeaconPublisher` has no unmount cleanup — a live beacon leaks the geolocation watch + heartbeat and keeps publishing the user's location after the component unmounts

**File:** `src/features/geo-editor/hooks/useBeaconPublisher.ts:223-370` (absence of a cleanup `useEffect`)
**Issue:**
The hook owns a `navigator.geolocation.watchPosition` session and a `setInterval` heartbeat, both
stored in refs (`watchIdRef`, `intervalIdRef`). `teardown()` (which calls `clearWatch` +
`clearInterval` and discards the session signer/secret) is only ever invoked from the explicit
`stop()` path and the `PERMISSION_DENIED` branch. There is **no `useEffect(() => () => teardown(), [])`
unmount cleanup**.

Consequence: if `GeoEditorView` (or any ancestor mounting the controller/publisher) unmounts while a
beacon is live — an in-app SPA route transition that remounts the tree, a React StrictMode
remount, or simply navigating away — the watch and the heartbeat interval are never cleared. The
orphaned heartbeat continues calling `updateBeacon(...)` and **keeps publishing the user's live GPS
coordinates to public relays under the throwaway key**, with no UI left to Stop it. This is the exact
failure the D-05 privacy boundary and the geolocation-lifecycle requirement (clearWatch on
stop/unmount) are meant to prevent. The publisher even ships a test fixture (`geolocationMock.ts`)
whose stated purpose is to "assert that `clearWatch` was called" — but no unmount path triggers it.

**Fix:**
Add an unmount cleanup that runs the existing teardown (and, ideally, publishes the terminal
`status:'ended'` first, mirroring `stop()`):
```ts
// inside useBeaconPublisher, after teardown is defined
useEffect(() => {
	// On unmount: tear down the watch + heartbeat and discard the session signer.
	// (Cannot reliably await an ended-publish during teardown; at minimum stop the
	// watch + interval so the orphaned loop can never keep publishing.)
	return () => {
		teardown()
	}
}, [teardown])
```
Note `teardown` is memoized with `[]`, so this cleanup will only fire on true unmount (not on every
render), which is the intended behavior. If a best-effort terminal `ended` event is desired on
unmount, fire `stopBeacon(lastEventRef.current, session.signer)` (fire-and-forget) before
`teardown()`.

### CR-02: `startBeacon` does not tear down an existing session before starting a new one — Adjust / double-Start orphans a still-publishing watch + heartbeat under an unrecoverable throwaway key

**File:** `src/features/geo-editor/hooks/useBeaconPublisher.ts:279-339`
**Issue:**
`startBeacon` unconditionally overwrites `sessionRef.current`, `throttleRef.current`,
`watchIdRef.current`, and `intervalIdRef.current` without first checking for — or tearing down — an
already-active session:
```ts
const session = await startBeaconSession(...)
sessionRef.current = session              // overwrites prior session (signer/secret lost)
...
watchIdRef.current = navigator.geolocation.watchPosition(...)  // prior watch id LOST
...
intervalIdRef.current = setInterval(...)  // prior interval id LOST
```
If `startBeacon` is called while a beacon is already live, the previous `watchId` and `intervalId`
become unreachable (the refs now hold the new ids), so they can never be cleared — the **old watch
keeps firing and the old heartbeat keeps publishing the user's location under the OLD throwaway
key**, which the app can no longer Stop. `useBeaconController.handleAdjustBeacon` → `handleStartBeacon`
→ `publisher.startBeacon` is exactly this path: "Adjust" on a live beacon starts a second session
without ending the first. (This also compounds the privacy story: a user who "switches to link-only"
via Adjust leaves the original PUBLIC beacon — with its `t:'live'`/`g`/`bbox` tags — heartbeating
forever.)

This same bug means CR-01's leak is reachable even without an unmount: any second Start leaks the
first session's watch + interval.

**Fix:**
Tear down any existing session at the top of `startBeacon` (and, for Adjust, publish the prior
session's terminal `ended` first so the old lineage stops cleanly):
```ts
const startBeacon = useCallback(async ({...}) => {
	if (typeof navigator === 'undefined' || !navigator.geolocation) {
		setSubState('error')
		return
	}
	// Stop any already-active session before minting a new one — never orphan a
	// still-publishing watch/heartbeat under a now-unreachable throwaway key.
	if (sessionRef.current) {
		await stop() // publishes ended (if any) + teardown()
	}
	...
}, [activeAccount, publishFix, teardown, stop])
```
Separately, decide whether "Adjust" should preserve the session `d` (the documented contract in
`useBeaconController.ts:116` and `lifecycle.ts:22` says it should) — see WR-02.

## Warnings

### WR-01: "Adjust" does not preserve the session `d` — it forks a brand-new beacon lineage, contradicting the documented contract

**File:** `src/features/geo-editor/hooks/useBeaconController.ts:116-128`, `src/features/geo-editor/hooks/useBeaconPublisher.ts:174-187`
**Issue:**
`handleAdjustBeacon` is documented as "Reopen the control panel pre-filled to adjust an active beacon
(preserves `d`)", and `lifecycle.ts:22` describes `updateBeacon` preserving the session `d`-tag on
every heartbeat. But the Adjust submit path (`handleStartBeacon` → `publisher.startBeacon` →
`startBeaconSession`) ALWAYS mints a fresh `d` via `generateShortDTag()` and a fresh throwaway key.
There is no code path that threads the existing beacon's `d` (or `existing` event) into a re-Start.
So "Adjust" actually creates a NEW, unlinked beacon rather than continuing the existing one — the
opposite of the stated behavior, and (with CR-02) leaves the original beacon running.
**Fix:**
Either (a) honor the contract by passing the adjusting beacon's `d` + last event into the publisher
so `updateBeacon` heartbeats the same lineage, or (b) if Adjust is genuinely "stop + start fresh",
update the docs/UX copy and ensure the prior session is stopped first (CR-02). Do not leave the
code and the documented invariant contradicting each other.

### WR-02: Owner inline Stop/Adjust never appears for an ANONYMOUS beacon (the default mode) because ownership is keyed on `pubkey`

**File:** `src/components/BeaconsPanel.tsx:245`, `src/components/info-panel/BeaconViewPanel.tsx:124`
**Issue:**
Owner detection is `beacon.pubkey === currentUserPubkey` (BeaconsPanel `ownBeacons` split and
`BeaconViewPanel.isOwner`). An anonymous beacon — the DEFAULT and primary privacy mode — is signed
with a throwaway key, so `beacon.pubkey` is the throwaway pubkey and never equals the user's account
pubkey. Result: while a user's own anonymous beacon is live, they see NO inline "Stop sharing" /
"Adjust" affordance in the Beacons rail or the detail view; their own beacon is rendered as
"someone else's". The always-on `RunningBeaconBanner` (driven by publisher session state, not pubkey)
is the only Stop affordance, so this is a degraded-UX bug rather than data loss — but the
documentation ("Owner viewing their own live beacon also sees inline Stop sharing + Adjust",
`BeaconViewPanel.tsx:18`) is not met for the default mode.
**Fix:**
Match ownership against the active publisher session, not just `pubkey`: pass the session `d` (and,
for anonymous, the session's throwaway pubkey) down so a row/view whose `dTag` === `session.d` (and
pubkey === session signer pubkey) is treated as owned. e.g. thread `beaconSession` into the panel
props and compute `isOwner = !!session && beacon.dTag === session.d && beacon.pubkey === sessionPubkey`.

### WR-03: Seed script's "stale (frozen tab)" beacon fixture is published FRESH — `factory.created(...)`'s return value is discarded against an immutable builder

**File:** `scripts/seed-entities.ts:480`
**Issue:**
```ts
const factory = LiveBeaconFactory.create({...}).hashtags(['live']).geohash(pos).bbox(...).expiration(...)
if (createdAt !== undefined) factory.created(createdAt)   // return value DISCARDED
await publish(factory, b.who.signer)
```
The applesauce `EventFactory.chain()` (which `created()` flows through) returns a NEW factory
instance — it is an immutable builder (verified in `node_modules/applesauce-core/dist/factories/event.js`:
`chain` returns `next`, not `this`). The inline `.hashtags().geohash().bbox().expiration()` calls work
because each is chained, but the conditional `factory.created(createdAt)` discards its result, so the
backdated `created_at` is lost and the published `factory` keeps a fresh `unixNow()` timestamp.
Consequence: the "Park ranger — stale (frozen tab)" UAT fixture (backdate: 300s, past the 120s
staleness threshold) actually renders as LIVE, not stale — the stale marker state is never exercised
by the seed, undermining the UAT coverage it claims to provide.
**Fix:**
Reassign the chained result:
```ts
let factory = LiveBeaconFactory.create({...}).hashtags(['live']).geohash(pos).bbox(...).expiration(now() + b.ttl)
if (createdAt !== undefined) factory = factory.created(createdAt)
await publish(factory, b.who.signer)
```

### WR-04: `my-account` identity passes the account object through an unchecked `as unknown as SignerLike` double cast

**File:** `src/features/geo-editor/hooks/useBeaconPublisher.ts:288`
**Issue:**
```ts
identity === 'my-account' ? (activeAccount as unknown as SignerLike) : undefined,
```
The `as unknown as` double cast suppresses all type checking. It happens to work at runtime because
applesauce's `IAccount extends ISigner` (so it has `signEvent`/`getPublicKey`), but every other
factory-sign call site in the codebase obtains the signer from the account MANAGER
(`accounts.signer`, e.g. `GroupEditorPanel.tsx:378`), not by casting the active-account object. The
double cast is fragile: a future applesauce `IAccount` shape change, or `activeAccount` being null at
call time, would compile clean and fail at runtime. Note also that `activeAccount` can be `undefined`
even on the `my-account` branch (no null guard before the cast), in which case
`startBeaconSession('my-account', undefined)` throws the "requires an active account signer" error —
surfaced only as a generic toast.
**Fix:**
Use the account's signer with a proper type and an explicit guard, e.g.:
```ts
if (identity === 'my-account' && !activeAccount) {
	toast.error('Sign in to share a beacon under your account.')
	return
}
const accountSigner = activeAccount?.signer as SignerLike | undefined
const session = await startBeaconSession(identity, identity === 'my-account' ? accountSigner : undefined)
```
Pass `activeAccount.signer` (the `ISigner`) rather than casting the whole account object.

### WR-05: `RunningBeaconBanner` treats `permission-denied` as `searching` — misleading copy, and effectively dead code given the publisher's teardown

**File:** `src/components/RunningBeaconBanner.tsx:43`, `src/features/geo-editor/hooks/useBeaconPublisher.ts:318-323`
**Issue:**
The banner computes `const searching = subState === 'searching' || subState === 'permission-denied'`
and, when true, renders "searching… your beacon will pick back up when your signal returns". But on
`PERMISSION_DENIED` the publisher calls `teardown()` + `setIsLive(false)`, and the banner only mounts
when `beaconIsLive` (GeoEditorView:2290). So the `permission-denied` arm is unreachable from the
banner — and if it ever did render (e.g. a future change that keeps the banner up on denial), the
"signal will return" copy is wrong: permission denial is a hard stop, not a transient signal loss.
**Fix:**
Remove `permission-denied` from the `searching` condition (it is a terminal state, not a transient
one). If a denied state should be surfaced at all, give it its own honest copy and its own render
branch rather than reusing the "searching" message.

## Info

### IN-01: `useBeacons([])` for an unrouted deep link subscribes with an empty filter array

**File:** `src/features/geo-editor/GeoEditorView.tsx:1614-1618`, `src/lib/hooks/useBeacons.ts:82-88`
**Issue:**
When `routedBeaconAddress` is null, `useBeacons([])` is called. `[].map(...)` yields `[]`, and
`useTimelineWithEose` treats `JSON.stringify([])` ("[]") as truthy, so it issues
`pool.req(relays, [])` — a REQ with an empty filter array on every render where no beacon is routed.
This is wasteful and depends on relay tolerance of an empty filter set (typically a no-op or a
rejected REQ). Harmless today but a latent inefficiency/edge case.
**Fix:**
Pass `null` (not `[]`) to skip the subscription entirely when there is no routed address:
`useBeacons(routedBeaconAddress ? [{...}] : null)` and have `useBeacons` forward a null/empty filter
list to `useTimelineWithEose(null)` so the subscription is skipped (the hook already supports null).

### IN-02: Anonymous own-beacon banner countdown matches on `dTag` alone (40-bit collision surface)

**File:** `src/features/geo-editor/GeoEditorView.tsx:1813-1822`
**Issue:**
For anonymous sessions (`beaconSession.sk` set), `ownLiveBeacon` matches purely on
`b.dTag === beaconSession.d` with `sessionPubkey === undefined`, so any beacon in the timeline
sharing the same 8-char base32 `d` (40 bits) would be picked up for the banner countdown. Collision
is astronomically unlikely in practice, so this is informational, not a real defect.
**Fix:**
Optionally also match the throwaway pubkey for anonymous sessions (derive it from the session signer)
so the match is exact: `b.dTag === session.d && b.pubkey === sessionThrowawayPubkey`.

### IN-03: `BeaconControlPanel` adjust mode is not pre-filled with prior visibility/identity

**File:** `src/components/GeoEditorInfoPanel.tsx:639-646`
**Issue:**
The panel supports `initialVisibility`/`initialIdentity` props, but the Adjust mount only passes
`initialLabel`. Given visibility is intentionally re-asked every Start (D-10, no sticky default),
this is acceptable, but it means Adjust silently resets visibility/identity to defaults, which may
surprise a user who only wanted to tweak the label. Informational / UX-polish.
**Fix:**
If Adjust is meant to continue a session (see WR-01), pre-fill `initialVisibility`/`initialIdentity`
from the adjusting beacon; otherwise document that Adjust re-asks them.

### IN-04: `useBeaconController` `startBeacon` drops the seeding geometry, so the first heartbeat waits for a GPS fix

**File:** `src/features/geo-editor/hooks/useBeaconController.ts:90-95`
**Issue:**
`handleStartBeacon` forwards only `content: options.content.label ? { label } : {}` — it never passes
a starting `geometry`. The publisher's `startBeacon` has a "seed the first fix immediately if
`content.geometry` supplied" path (`useBeaconPublisher.ts:301-305`) that is therefore always dead
from this caller; the first published point only happens after `watchPosition` returns a fix. This is
consistent with "position comes from GPS" (no pin-drop), so it is informational — but the seed-fix
code path is unreachable via the real UI and could be removed or wired intentionally.
**Fix:**
Either remove the unreachable seed-geometry branch in the publisher, or (if a last-known location is
available) pass it through so the beacon appears immediately rather than after the first watch fix.

---

_Reviewed: 2026-06-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
