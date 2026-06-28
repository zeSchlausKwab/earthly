# Phase 12: Live Beacon (~37521) - Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 14 (6 new, 8 modified/extended)
**Analogs found:** 14 / 14 (13 exact Sighting/Story twins, 1 net-new with a watchPosition reuse anchor)

> The whole UX spine is a kind-substituted clone of the Phase-11 Temporal Sighting
> (37522) stack. The ONLY genuinely net-new subsystems are (a) `useBeaconPublisher`
> (throttled `watchPosition` loop + per-session throwaway `PrivateKeySigner`),
> (b) `RunningBeaconBanner` (no twin), and (c) the beacon marker's `beaconState`
> data-driven paint. Everything else: substitute the kind, the cast, and the
> discovery filter.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/nostr/live-beacon/helpers.ts` | model | transform | self (EXTEND content shape) | self-extend |
| `src/lib/nostr/live-beacon/cast.ts` | model | transform | self + `temporal-sighting/cast.ts` | self-extend |
| `src/lib/nostr/live-beacon/lifecycle.ts` | service | pub-sub (publish) | `temporal-sighting/lifecycle.ts` | exact |
| `src/lib/hooks/useBeacons.ts` | hook | event-driven (subscribe) | `src/lib/hooks/useSightings.ts` | exact |
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | hook | streaming (watchPosition→publish) | `map.tsx` watchPosition + `temporal-sighting/lifecycle.ts` | role-match (net-new) |
| `src/features/geo-editor/hooks/useMapLayers.ts` | hook | event-driven (render) | self — Sighting source block | self-extend |
| `src/features/geo-editor/hooks/useRouting.ts` | hook | request-response (route) | self — `/sighting` block | self-extend |
| `src/components/BeaconsPanel.tsx` | component | event-driven (list) | `src/components/SightingsPanel.tsx` | exact |
| `src/components/info-panel/BeaconViewPanel.tsx` | component | request-response (read) | `src/components/info-panel/SightingViewPanel.tsx` | exact |
| `src/components/info-panel/BeaconControlPanel.tsx` | component | request-response (write) | `src/components/info-panel/SightingEditorPanel.tsx` | exact |
| `src/components/RunningBeaconBanner.tsx` | component | event-driven | none (net-new) | no analog |
| `src/components/AppSidebar.tsx` | config | — | self — `WORK_VIEW_MODES`/`workNavItems` | self-extend |
| `src/lib/og/fetchEvent.ts` | service | request-response | self — `fetchSightingOGData` | self-extend |
| `scripts/seed-entities.ts` | config | batch | self — beacon block L424-443 | self-extend |

## Shared Patterns

### Per-session throwaway signer (D-05) — the net-new identity branch
**Source (API):** `node_modules/applesauce-signers` `PrivateKeySigner`; `nostr-tools` `generateSecretKey`
**Apply to:** `useBeaconPublisher.ts` (default Anonymous branch), `BeaconControlPanel.tsx` (identity toggle)

The Sighting publish path takes the active account directly (`SightingEditorPanel.tsx:251`):
```typescript
const signer = currentUser   // useActiveAccount() — applesauce-react
```
For a beacon, branch on the D-05 identity choice. Anonymous (default) mints a fresh
in-memory key per session; My-account opt-in passes `useActiveAccount()` as today:
```typescript
import { PrivateKeySigner } from 'applesauce-signers'
import { generateSecretKey } from 'nostr-tools'
// Anonymous (DEFAULT): fresh secp256k1, in-memory only, NEVER persisted.
const sk = generateSecretKey()
const signer = new PrivateKeySigner(sk)   // ISigner: getPublicKey + signEvent
const throwawayPubkey = await signer.getPublicKey()   // for the naddr
// My-account opt-in: const signer = useActiveAccount()
```
The signer is accepted unchanged by `EntityFactory.sign(signer)` (the `SignerLike`
path the lifecycle service already takes). Hold `{ signer, sk, d, expiration,
visibility }` in a session ref for the whole Start→Stop; discard at Stop; never
write `sk` to localStorage/IDB.

### NIP-40 expiry filter (BEACON-03) — apply at EVERY beacon read path
**Source:** `src/lib/nostr/expiry.ts` (`isExpired`/`dropExpired`, epoch seconds)
**Apply to:** `useBeacons.ts`, `useMapLayers.ts` beacon source builder, `fetchEvent.ts` `fetchBeaconOGData`
Relay GC is lazy (≥1h, untrusted per research). The client `dropExpired(events,
unixNow())` is the only trusted removal. Use `unixNow()` (seconds) everywhere —
never `Date.now()` ms (Pitfall P-1).

### filter-before-cast (Pitfall P-2)
**Source:** `useSightings.ts:60-67`
**Apply to:** `useBeacons.ts`, `useMapLayers.ts` beacon source
The `LiveBeacon` cast ctor THROWS on a non-conforming 37521 (`cast.ts:28`). Always
`events.filter(isLiveBeacon)` BEFORE `dropExpired` and BEFORE `castEvent`.

## Pattern Assignments

### `src/lib/nostr/live-beacon/helpers.ts` (model, EXTEND)

**Analog:** self — replace the `position?` placeholder, add `status` (D-04/D-09).

Current scaffold (`helpers.ts:30-36`):
```typescript
export interface LiveBeaconContent {
	modelVersion?: string
	label?: string
	position?: [number, number]   // ← REPLACE
}
```
Replace with (per research §"Position/geometry content contract"; mirror
`TemporalSightingContent.geometry`):
```typescript
export interface LiveBeaconContent {
	modelVersion?: string
	label?: string
	geometry?: Point                 // GeoJSON Point [lon,lat]; bbox/g derived from it
	status?: 'live' | 'ended'        // D-04 discriminator; defaults to 'live'
}
export const DEFAULT_LIVE_BEACON_CONTENT: LiveBeaconContent = { status: 'live' }
```
`getLiveBeaconContent` (`helpers.ts:59-69`) already merges over
`DEFAULT_LIVE_BEACON_CONTENT` defensively (never throws) — no change to its body.

---

### `src/lib/nostr/live-beacon/cast.ts` (model, EXTEND)

**Analog:** self. Add getters for the new content fields (mirror `beacon`/`expiresAt`
which already exist at `cast.ts:55-61`):
```typescript
get status(): 'live' | 'ended' { return this.beacon.status ?? 'live' }
get geometry() { return this.beacon.geometry }
```
The `expiresAt` getter (`cast.ts:54-57`, via `getExpirationTimestamp`) is the
removal clock; `created_at` (`cast.ts:45-47`) is the staleness clock.

---

### `src/lib/nostr/live-beacon/lifecycle.ts` (service, NEW — exact clone)

**Analog:** `src/lib/nostr/temporal-sighting/lifecycle.ts` (full file, 155 lines)

The factory setters already exist (`factory.ts:79-92`: `expiration`/`bbox`/`geohash`/
`hashtags`). Clone the Sighting derive-and-publish path verbatim, substituting the
beacon factory + the `t:'live'` discovery marker + `status`.

**bbox/g derive helpers** (copy `lifecycle.ts:71-97` unchanged — turf, try/catch→undefined):
```typescript
function deriveBbox(content) { if (!content.geometry) return undefined
	try { const c = bbox(content.geometry); if (c.every(Number.isFinite)) return c } catch {} }
function deriveCentroid(content) { if (!content.geometry) return undefined
	try { const c = centroid(content.geometry).geometry.coordinates; ... } catch {} }
```

**publish path** (clone `lifecycle.ts:103-118`), with the D-10 visibility branch:
```typescript
export async function updateBeacon(options, signer) {
	const { content, expiration, visibility } = options
	const isPublic = visibility === 'public'
	const signed = await LiveBeaconFactory.create(content)        // or .modify(existing) — preserves d
		.bbox(isPublic ? deriveBbox(content) : undefined)        // omit geo for link-only (P-6)
		.geohash(isPublic ? deriveCentroid(content) : undefined)
		.hashtags(isPublic ? ['live'] : [])                      // t:'live' = discovery marker (D-10)
		.expiration(expiration)
		.sign(signer)
	await publish(signed, { routing: 'configured' })             // NOT 'outbox' — throwaway key has no NIP-65 (research)
	return attachStore(signed)
}
```
> **Diverge from the Sighting analog on routing:** Sighting uses `{ routing: 'outbox' }`
> (`lifecycle.ts:116`). Beacons MUST use `{ routing: 'configured' }` — a throwaway
> pubkey has no NIP-65 record, so outbox resolution times out 1.5s on every heartbeat.

`stopBeacon` = one final `updateBeacon` with `content.status='ended'`, keeping the
same `d` and `expiration` (D-04). Copy `attachStore` (`lifecycle.ts:44-49`) verbatim.

---

### `src/lib/hooks/useBeacons.ts` (hook, NEW — exact clone)

**Analog:** `src/lib/hooks/useSightings.ts` (full file, 70 lines)

Clone verbatim, substituting: the kind/cast/guard, the discovery filter, and a
finer tick.

**Expiry-clock tick** (clone `useSightings.ts:36-45`) — use **15s** not 60s (research A4):
```typescript
const EXPIRY_TICK_MS = 15_000   // tighter than Sighting's 60s; live→stale flips within ~15s
function useExpiryClock(): number { /* identical body to useSightings.ts:38-45 */ }
```
**Subscription + filter-before-cast** (clone `useSightings.ts:48-69`):
```typescript
export function useBeacons(additionalFilters = [{ '#t': ['live'] }]) {   // discovery = public marker
	const filters = additionalFilters.map((f) => ({ ...f, kinds: [LIVE_BEACON_KIND] }))
	const { events, eose } = useTimelineWithEose(filters)
	const now = useExpiryClock()
	const beacons = useMemo(
		() => dropExpired(events.filter(isLiveBeacon), now)
			.map((event) => castEvent(event, LiveBeacon, eventStore)),
		[events, now],
	)
	return { events: beacons, eose }
}
```

---

### `src/features/geo-editor/hooks/useBeaconPublisher.ts` (hook, NEW — NET-NEW)

**Anchor 1 (watchPosition machinery):** `src/components/ui/map.tsx:912-949`
**Anchor 2 (publish path):** `live-beacon/lifecycle.ts` `updateBeacon` (above)

Reuse the watchPosition **options/pattern** from `map.tsx:947`, but own a SEPARATE
watch (do NOT publish from inside `MapControls` — anti-pattern). The success/error/
cleanup shape to mirror (`map.tsx:920-948`):
```typescript
navigator.geolocation.watchPosition(
	(pos) => { /* maybePublish([pos.coords.longitude, pos.coords.latitude]) */ },
	(error) => { /* distinguish error.PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT (net-new) */ },
	{ enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },   // exact map.tsx:947 options
)
```
**Net-new throttle** (research §Code Examples), named constants not magic numbers:
```typescript
const BEACON_HEARTBEAT_MS = 30_000
const BEACON_DISTANCE_FLOOR_M = 25
const BEACON_STALE_FACTOR = 4
const BEACON_STALE_THRESHOLD_S = (BEACON_HEARTBEAT_MS / 1000) * BEACON_STALE_FACTOR  // 120s
// On each fix OR setInterval(heartbeat): single lastPublishedAt guard (P-4); publish if
//   moved >= 25m OR now - lastPublishedAt >= 30s. Discard session signer at Stop.
```

---

### `src/features/geo-editor/hooks/useMapLayers.ts` (hook, EXTEND)

**Analog:** self — the Sighting source/layer block (IDs at `useMapLayers.ts:80-97`).

Mirror `SIGHTING_SOURCE_ID`/`SIGHTING_HIT_LAYER`/`SIGHTING_CIRCLE_LAYER`/
`SIGHTING_GLYPH_LAYER` (`:81-86`) → `BEACON_*` IDs. Reuse the EXACT hex constants
(`:92-94`, UI-SPEC mirrors them):
```typescript
const SIGHTING_COLOR_LIVE = '#fdc700'   // beacon live (focal accent)
const SIGHTING_COLOR_PAST = '#737373'   // beacon stale/ended (greyed)
```
Build the source from `dropExpired`-filtered beacon casts, pick freshest per
`{pubkey,d}` by `created_at` (id-lexicographic tie-break), and drive paint from a
per-feature `beaconState`:
```typescript
function beaconState(cast, now) {            // research §Code Examples
	if (isExpired(cast.event, now)) return 'removed'   // never rendered
	if (cast.status === 'ended') return 'ended'
	if (now - cast.event.created_at >= BEACON_STALE_THRESHOLD_S) return 'stale'
	return 'live'
}
```

---

### `src/features/geo-editor/hooks/useRouting.ts` (hook, EXTEND — thin clone, P-5)

**Analog:** self — the `/sighting` block (`useRouting.ts:127-138`), which already
carries the `// thin per-kind clone … Phase 13 / XCUT-02` comment.

Three edits, each mirroring `sighting`:
1. `focusType` union (`:36`) — add `| 'beacon'`.
2. `isFocusType` (`:54-56`) — add `value === 'beacon'`.
3. New segment block (clone `:131-138`):
```typescript
if (first === 'beacon' && segments[1]) {
	return { focusType: 'beacon', naddr: segments[1],
		commentId: segments[2] === 'comment' && segments[3] ? segments[3] : undefined,
		sidebarView: 'beacons' }
}
```
Keep the `// Phase 13 / XCUT-02 generalizes` comment (P-5).

---

### `src/components/AppSidebar.tsx` (config, EXTEND)

**Analog:** self — `WorkViewMode` / `WORK_VIEW_MODES` / `workNavItems` (`:58-83`).

Mirror the `'sightings'` / `Eye` entry exactly:
```typescript
type WorkViewMode = '...' | 'sightings' | 'beacons' | 'user'
const WORK_VIEW_MODES = ['datasets','contexts','stories','sightings','beacons','user']
// workNavItems (:78-83) — add after the Sightings row:
{ mode: 'beacons', title: 'Beacons', icon: Radio },   // import Radio from lucide-react
```
Then add `beaconsPanelProps` + a `case 'beacons'` in `renderWorkContent` (the
research cites `:648-761` for the render switch).

---

### `src/components/BeaconsPanel.tsx` (component, NEW — exact clone)

**Analog:** `src/components/SightingsPanel.tsx` (340 lines, `SightingsPanelContent`)

Clone the list structure; subscribe via `useBeacons()`. Rows show live/stale/ended
chip + last-seen age + countdown + "Watch on map". Net-new vs Sighting: the user's
own active beacon pinned to top with Stop/Adjust, and a "Share live location" CTA.

---

### `src/components/info-panel/BeaconViewPanel.tsx` (component, NEW — exact clone)

**Analog:** `src/components/info-panel/SightingViewPanel.tsx` (261 lines)

Read view: label + status chip + last-seen (primary) + countdown (secondary) +
Copy-share-link; owner Stop/Adjust. naddr build MUST carry the throwaway pubkey for
anonymous beacons: `nip19.naddrEncode({ kind: 37521, pubkey: throwawayPubkey, identifier: d })`.

---

### `src/components/info-panel/BeaconControlPanel.tsx` (component, NEW — exact clone)

**Analog:** `src/components/info-panel/SightingEditorPanel.tsx` (471 lines)

**Expiry presets** — reuse the Sighting `ExpiryPreset`/`DEFAULT_EXPIRY_PRESET` state
machinery (`SightingEditorPanel.tsx:177-178`) for the D-03 time-box presets
(15m/1h/4h/8h + custom).

**Publish call site** — mirror `SightingEditorPanel.tsx:251,260-272` but route
through `updateBeacon`/`stopBeacon` and the D-05 identity-branched signer (see
Shared Patterns). Diverge from the Sighting analog: NO geometry drawing / pin-drop
(position comes from GPS via `useBeaconPublisher`, not a dropped pin) — drop the
`placedGeometry`/`onDrawArea` props and the "Drop a pin" guard (`:245`).

Net-new chrome: visibility toggle (public/link-only, D-10) + identity toggle
(anonymous/my-account, D-05) + no-delete consent (D-06) + the honest "unlisted,
not private" caveat. Start button replaces "Publish".

---

### `src/components/RunningBeaconBanner.tsx` (component, NEW — NO ANALOG)

Always-on "you are live" owner pill driven by the active `useBeaconPublisher`
session — searching/live/stale sub-states + a Stop affordance. No Sighting twin;
use Radix primitives from `@/components/ui/*` (no new primitives per UI-SPEC).

---

### `src/lib/og/fetchEvent.ts` (service, EXTEND)

**Analog:** self — `fetchSightingOGData` (`fetchEvent.ts:307-363`)

Clone to `fetchBeaconOGData`, gating on `decoded.kind === LIVE_BEACON_KIND`
(mirrors `:313`). The replaceable latest-wins fetch shape is identical
(`:315-319`, `{kinds, authors:[decoded.pubkey], '#d':[decoded.identifier]}`) and
works for any pubkey (incl. throwaway). Keep the expiry guard (`:324`,
`isOGEventExpired`) and the WR-02 `contentExpiresAt` carry (`:354-357`). Honest
copy: "Live location — may have ended". Add the crawler route match for `/beacon/:naddr`.

---

### `scripts/seed-entities.ts` (config, EXTEND)

**Analog:** self — beacon block `seed-entities.ts:424-443`

Currently sets `position: pos` + `.geohash(pos)` (`:436-438`). Update to the new
content shape and add fixtures for all four marker states + discovery-gating:
```typescript
LiveBeaconFactory.create({ label: b.label, geometry: { type: 'Point', coordinates: pos }, status: 'live' })
	.hashtags(['live']).geohash(pos).bbox(...).expiration(now() + b.ttl)
// + add one status:'ended' fixture, and one link-only (NO geohash, NO hashtags) fixture
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/RunningBeaconBanner.tsx` | component | event-driven | Always-on "you are live" owner pill — no Sighting/Story twin exists |

> `useBeaconPublisher.ts` is listed as role-match (not no-analog): its watchPosition
> machinery clones `map.tsx:912-949` and its publish path clones the lifecycle service;
> only the throttle/heartbeat logic is genuinely original.

## Metadata

**Analog search scope:** `src/lib/nostr/{live-beacon,temporal-sighting}`, `src/lib/hooks`,
`src/lib/og`, `src/components`, `src/components/info-panel`, `src/features/geo-editor/hooks`,
`src/components/ui/map.tsx`, `scripts`
**Files scanned:** 13 analog files read (5 in full, 8 targeted ranges)
**Pattern extraction date:** 2026-06-28
