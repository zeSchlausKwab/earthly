# Phase 12: Live Beacon (kind 37521) - Research

**Researched:** 2026-06-28
**Domain:** Real-time presence/position publishing over Nostr (parameterized-replaceable + NIP-40), live-map rendering, privacy/discovery-gating, throwaway-key identity
**Confidence:** HIGH (all 8 open unknowns resolved against in-repo source: the Khatru relay, applesauce signers, the Phase-11 Sighting twin, and the existing data layer)

## Summary

Phase 12 wraps an already-shipped kind-37521 data layer (`LiveBeaconFactory` / `LiveBeacon` cast / `isLiveBeacon` guard) with three net-new subsystems: (1) a **throttled publish loop** that rides the existing `navigator.geolocation.watchPosition` machinery under a **per-session generated `PrivateKeySigner`** (the throwaway-key default), (2) a **live-map marker layer** with live/stale/ended/removed states that re-derives staleness from `created_at` and removal from NIP-40 on every tick, and (3) a **rail-tab → BeaconsPanel → view/control info-panel → `/beacon/:naddr` deep-link + OG card** UX that clones the Phase-11 Sighting spine almost verbatim. Everything else is reuse.

The phase is unusually low-risk on the data substrate (the factory/cast exist; the Sighting twin is a near-exact template) and concentrated-risk on three things: the **publish-loop throttling discipline** (don't spam the relay; keep `seq`/`created_at` deterministic), the **honest staleness UX** (a closed tab must grey out within ~2 min), and the **privacy posture** (throwaway key + "unlisted, not encrypted" honesty). The relay echo-test question is now **answered from source, not assumed**: Khatru v0.19.1 GCs expired events lazily (≥1h lag) and correctly latest-wins parameterized-replaceable 37521 via its manual replacer path — so the client `dropExpired` seam is the only thing that can be trusted, exactly as SPEC-05 mandates.

**Primary recommendation:** Clone the Phase-11 Sighting stack (lifecycle.ts → useSightings → useMapLayers Sighting source → SightingsPanel → SightingViewPanel/SightingEditorPanel → useRouting `/sighting` → og/fetchSighting), substituting: a `PrivateKeySigner`-generated per-session signer for the active account; a distance+time throttled `watchPosition` publish loop in place of one-shot publish; a `created_at`-derived live/stale step + `status:'live'|'ended'` discriminator in place of the NIP-52 start/end; and an always-on "you are live" banner that has no Sighting twin.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Publish trigger:** Distance + time floor. Re-publish a fresh replaceable 37521 (same `d`) when moved > ~X m OR every ~N s, whichever first. Reuse the existing `watchPosition` loop. Exact thresholds = Claude's discretion (~25 m / ~20–30 s).
- **D-02 — Heartbeat keepalive:** Yes. The time floor doubles as a heartbeat: re-publish on the interval even when stationary. Couples to the D-08 staleness threshold.
- **D-03 — Time box input:** Presets ("15 min / 1 hour / 4 hours / 8 hours") + custom, default pre-selected. Sets NIP-40 `expiration` via `LiveBeaconFactory.expiration()`. Mirror Sighting expiry presets (Phase 11 D-04).
- **D-04 — "Ended" terminal state:** Explicit final event. Stop publishes one last replaceable 37521 with `content.status = 'ended'` AND keeps the NIP-40 expiration. Viewers see "ended" until expiry. Add a `status:'live'|'ended'` discriminator + a precise position/geometry contract (D-09).
- **D-05 — Identity model (DEFAULT = anonymous throwaway pubkey):** Per-session throwaway secp256k1 keypair, generated at Start, reused for every heartbeat through Stop; a new Start mints a fresh unlinkable key. Own-pubkey is explicit opt-in. Needs a generated applesauce signer, not the app's main signer.
- **D-06 — No-delete warning:** Shown at Start as informed consent; brief recap at Stop. Weighted stronger in the own-pubkey case.
- **D-07 — Lifecycle visual states:** live / greyed-stale / removed (+ the distinct "ended" marker). Distinct beacon marker style (live presence, not a dataset dot or a Sighting).
- **D-08 — Staleness threshold:** Derived from cadence (a multiple of the heartbeat interval, e.g. ~4×). Tight intent (a closed tab greys within a couple of minutes). Compare UTC epoch seconds; staleness off latest `created_at`, expiry off the NIP-40 tag.
- **D-10 — Visibility model = ask each time, soft-enforced.** Public = discoverable marker + geo tags. Link-only = omit marker + coarsen/omit geo. Enforcement is client-side discovery-gating, NOT cryptographic — "unlisted, not private." Confirm the exact marker/tag mechanism. naddr form `37521:<pubkey>:<d>`.
- **D-11 — Account-free viewing / share link:** Viewer opens via share link without an account (guest scope exists). Link carries the beacon `naddr`; for throwaway-key beacons it MUST carry the throwaway pubkey. Mirror Story/Sighting deep-link + OG-card pattern. Coordinate scope with Phase 13.
- **D-12 — Entry point / browse surface:** Dedicated "Beacons" rail tab in `AppSidebar` mirroring Stories/Sightings. The map stays the live canvas; the rail tab is the index/control home.

### Claude's Discretion
- **D-09 — Position/geometry contract:** Decide the exact content shape (GeoJSON `Point` carrying `[lon,lat]` + `bbox`/`g` derived for discovery — mirror geo-event/Sighting D-02), reconcile with the `position?: [number, number]` placeholder.
- Exact cadence thresholds (D-01) and staleness factor (D-08).
- Detail / view panel layout.
- Edit/resume semantics (`LiveBeaconFactory.modify` preserves `d`).
- Permission-denied / geolocation-error handling.
- Marker styling specifics within the D-07 scheme.

### Deferred Ideas (OUT OF SCOPE)
- **cordn-style encrypted-GeoJSON transport** (future milestone) — the proper home for cryptographic privacy across all entities and for BEACON-07.
- **Encrypted / private per-viewer beacons (BEACON-07)** — subsumed by cordn; deferred.
- **Beacon driven by external data source / code sandbox (BEACON-05)** — deferred.
- **Beacon trail / breadcrumb history (BEACON-06)** — deferred.
- **Full canonical entity-routing/addressing + comment-root widening (XCUT-01/02)** — Phase 13. The `/beacon/:naddr` route here may be a thin slice Phase 13 generalizes; flag at plan time.
- Always-on / background location tracking — explicit milestone non-goal.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BEACON-01 | Start a live position beacon that updates on the map as position changes | §"Architecture Pattern 2: Throttled publish loop" (watchPosition reuse, distance+time floor + heartbeat); §"Code Examples" publish-loop sketch; D-09 content contract |
| BEACON-02 | Auto-expire via user-set time box (NIP-40) + explicit Stop with unambiguous ended state | §"Architecture Pattern 3: Three clocks" (`LiveBeaconFactory.expiration()` + `status:'ended'` terminal event); §"Common Pitfalls" P-3 (ended-then-still-published); Khatru relay echo-test §"Relay Behavior" |
| BEACON-03 | Honest staleness indicator; stale/stopped never shown as current | §"Architecture Pattern 4: Staleness derivation" (`created_at`-derived live/stale step + `dropExpired` removal); §"Validation Architecture" staleness tests; useSightings expiry-clock precedent |
| BEACON-04 | Public/discoverable OR account-free share link | §"Architecture Pattern 5: Visibility/discovery-gating" (the `t`-marker + geo-tag toggle); §"Architecture Pattern 6: throwaway-key signer"; og/fetchEvent + useRouting clone for `/beacon/:naddr` |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Geolocation capture (watchPosition) | Browser / Client | — | navigator.geolocation is browser-only; foreground-only by milestone constraint. Already implemented in `src/components/ui/map.tsx:912`. |
| Throttled publish decision (distance+time floor) | Browser / Client | — | Pure client logic over the watchPosition callback; no server. |
| Event signing (throwaway key) | Browser / Client | — | `PrivateKeySigner` holds the generated key in memory only; never persisted, never sent to a server. |
| Event persistence + latest-wins replaceable | Relay (Khatru) | Client eventStore | Relay stores 37521 and de-dupes by `{kind,pubkey,d}` via the manual replacer (DeleteEvent-backed). Client eventStore mirrors. |
| Expiry GC | Relay (advisory) | **Client (authoritative)** | Khatru GCs lazily (≥1h); SPEC-05 mandates the client `dropExpired` as the trusted layer. |
| Staleness derivation | Browser / Client | — | `now − created_at` compared client-side against a cadence-derived threshold; a ticking clock re-evaluates. |
| Live-map rendering | Browser / Client | — | MapLibre source/layer pair built from `dropExpired`-filtered casts. |
| Discovery surfacing (public vs link-only) | Browser / Client | Relay (firehose caveat) | Soft client-side discovery-gating; the relay cannot enforce it (firehose-scrapable). |
| Share link + OG card | Frontend Server (OG crawler) | Client (route) | `src/lib/og/` runs server-side for crawlers; `useRouting` handles the in-app route. |

## Relay Behavior — the Khatru NIP-40 / replaceable echo test (Open Unknown #1)

**Answered from source** (`relay/main.go` + `github.com/fiatjaf/khatru@v0.19.1`), not assumed. Constructed as a UAT/verification procedure rather than run live.

### What the relay actually does
- **Backend wiring (`relay/main.go`):** `StoreEvent ← db.SaveEvent`, `QueryEvents ← sqlite3/bluge`, `DeleteEvent ← db.DeleteEvent + search.DeleteEvent`. **`relay.ReplaceEvent` is NOT wired.** `RejectEvent` accepts everything. `[VERIFIED: relay/main.go:85-142]`
- **Parameterized-replaceable 37521 round-trips correctly anyway.** With no `ReplaceEvent` handler, Khatru falls into its **manual replacer path** (`khatru@v0.19.1/adding.go:106-145`): for an addressable kind it queries `{Limit:1, Kinds:[37521], Authors:[pubkey], #d:[dTag]}`, deletes any **older** match via `DeleteEvent`, and refuses to store the new one if a **newer** one already exists (`isOlder` comparison on `created_at`). Net effect: **latest-by-`created_at` wins, one stored beacon per `{pubkey,d}`** — exactly the replaceable semantics the design assumes. `[VERIFIED: khatru@v0.19.1/adding.go:106-145]`
- **NIP-40 GC is real but LAZY and advisory.** Khatru auto-starts an `expirationManager` (`relay.go:48-49`) on a **1-hour ticker**, and its **initial scan only runs after the first tick** (`expiration.go:start` → `initialScan` gated on `initialScanDone`). So an expired 37521 can be served by the relay for **up to ~1h+ past its `expiration`** before GC removes it. `[VERIFIED: khatru@v0.19.1/expiration.go]`
- **Conclusion:** relay-side GC **cannot be relied on** for freshness. The shared `dropExpired`/`isExpired` seam (`src/lib/nostr/expiry.ts`) is the only trustworthy filter and MUST run at every beacon read path — exactly as `useSightings.ts` already does for 37522. `[VERIFIED: src/lib/nostr/expiry.ts:22-30]`

### Echo-test procedure (UAT / verification step — do NOT run live in research)
1. With `bun relay` running, publish a 37521 via `LiveBeaconFactory.create({...}).expiration(unixNow() + 30)` under a generated signer; record its `id`, `created_at`, and `d`.
2. Immediately re-query `{kinds:[37521], authors:[pubkey], '#d':[d]}` → expect exactly one event (the one just published).
3. Republish with the **same `d`**, new `created_at` (heartbeat), short expiration. Re-query → expect exactly **one** event, the **newer** one (latest-wins; the older was deleted by the manual replacer).
4. Wait until past the `expiration`. Re-query within the first hour → the relay **may still return the expired event** (GC ticker hasn't run). Assert the **client** drops it via `dropExpired(events, unixNow())` regardless.
5. (Optional, slow) Wait > 1h → re-query → relay GC should have removed it. This step documents lazy GC; the client filter is what UAT actually asserts.

> **Planner note:** encode steps 1-4 as a Validation Architecture test (a Bun integration test against the local relay) and step 4 as the BEACON-03 honesty assertion. Step 5 is documentation, not a gating test.

## `seq` tag / clock-skew de-dup schema (Open Unknown #2)

**Recommendation: do NOT add a `seq` tag. Rely on `created_at` (epoch seconds), with one explicit tie-break rule.** `[VERIFIED: khatru@v0.19.1/adding.go isOlder; src/lib/hooks/useSightings.ts]`

Rationale:
- The relay's latest-wins is **already** decided by `created_at` via `isOlder` — adding a `seq` tag would not change relay storage behavior (the relay does not read a `seq` tag). A `seq` tag would only matter for **client-side** freshest-pick, and the client already has `created_at`.
- The live-map layer subscribes via `useTimelineWithEose` and casts; applesauce's EventStore keeps the **latest replaceable per address** in its reactive model, so the client naturally renders the freshest. The map source builder should pick the freshest by `created_at` per `{pubkey,d}` defensively (in case both an old and new copy transiently coexist in the store before the relay's delete propagates).
- **Clock skew risk:** the sharer's device clock sets `created_at`. Two heartbeats from the same device cannot collide on `created_at` granularity in practice (publishes are ≥20–30 s apart per D-01), and even sub-second collisions are resolved by the **tie-break rule below**. Cross-device skew is irrelevant — a beacon's lineage is single-author (one throwaway key per session).
- **Tie-break rule (specify in the plan):** when two casts share the same `{pubkey,d}` AND the same `created_at`, pick the one whose `event.id` is lexicographically greater (deterministic, matches the Nostr replaceable-event convention NIP-01 uses for the same-timestamp case). This is a 2-line guard in the map-source builder.

**If a future ephemeral-stream lifecycle (BEACON-06, deferred) is adopted**, a monotonic `seq` becomes necessary because multiple non-replaceable points coexist; note this as a forward-looking comment but do NOT implement it now.

Three clocks stay disjoint: **`created_at`** drives staleness/last-seen; **NIP-40 `expiration`** drives removal; **user time box** sets `expiration` at Start. (SPEC §10, UI-SPEC "Three coexisting clocks".)

## Staleness threshold + cadence defaults (Open Unknowns #3, partly #8)

Concrete starting defaults (Claude's discretion per D-01/D-08, tuned to "a closed tab greys out within a couple of minutes"):

| Knob | Recommended default | Justification |
|------|---------------------|---------------|
| Distance floor | **25 m** | Below GPS consumer accuracy noise (~5–20 m) you republish noise; 25 m is "meaningfully moved" without spamming. `[ASSUMED]` (sensible default; tune in UAT) |
| Time floor / heartbeat interval | **30 s** | Doubles as the D-02 heartbeat. 30 s keeps a stationary beacon "live" with ~120 publishes/hour — acceptable for a single relay, well under any rate limit. `[ASSUMED]` |
| watchPosition options | `{ enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }` | Matches the existing tracking call in `map.tsx:947`. `[VERIFIED: src/components/ui/map.tsx:947]` |
| Staleness threshold | **4 × heartbeat = 120 s** | A closed tab stops publishing; after 4 missed heartbeats (2 min) it greys out. Multiple-of-heartbeat keeps threshold and cadence in sync per D-08. `[ASSUMED]` |
| Expiry-clock re-render tick | **15 s** (tighter than Sighting's 60 s) | useSightings uses a 60 s tick; a 120 s staleness step needs a finer tick so live→stale flips within ~15 s of the threshold. `[VERIFIED: src/lib/hooks/useSightings.ts:36 precedent]` |

Derivations to encode as named constants (not magic numbers), e.g. `BEACON_HEARTBEAT_MS = 30_000`, `BEACON_DISTANCE_FLOOR_M = 25`, `BEACON_STALE_FACTOR = 4`, `BEACON_STALE_THRESHOLD_S = (BEACON_HEARTBEAT_MS/1000) * BEACON_STALE_FACTOR`. The staleness comparison is `unixNow() - latest.created_at >= BEACON_STALE_THRESHOLD_S` (epoch seconds, never `Date.now()` ms — Pitfall P-1).

## Visibility / discovery-gating marker mechanism (Open Unknown #4)

**Recommended marker mechanism — a discovery `t` hashtag, NOT a content field:** `[VERIFIED: src/lib/nostr/tags.ts setHashtags; src/lib/hooks/useSightings.ts filter shape]`

- **Public beacon:** publish with `.hashtags(['live'])` (a `t` tag) **plus** the geo tags `.geohash([lon,lat])` and `.bbox(box)`. The `BeaconsPanel` discovery subscription filters `{ kinds:[37521], '#t':['live'] }` so only public beacons surface in the nearby/beacons list. (The seed script already uses `.hashtags(['live'])` — keep `live` as the canonical public marker. `[VERIFIED: scripts/seed-entities.ts:441]`)
- **Link-only beacon:** **omit** the `t:'live'` marker entirely AND **omit or coarsen** the geo tags (publish no `g`/`bbox`, or a deliberately low-precision geohash). Because the discovery subscription filters on `#t:['live']`, a link-only beacon is **never matched** by it and so never appears in the browse list or the discovery map layer. It opens only by direct address resolution (`37521:<pubkey>:<d>` → `naddr`).
- **naddr form confirmed:** `37521:<pubkey>:<d>`, encoded via `nip19.naddrEncode({ kind: 37521, pubkey, identifier: d, relays })`. `decodeNaddr` already returns `{kind, pubkey, identifier}` and the og/fetchEvent functions gate on `decoded.kind`. `[VERIFIED: src/lib/og/fetchEvent.ts:62-72]`

**Honest "unlisted, not private" caveat (REQUIRED in UI, already in UI-SPEC):** an unencrypted 37521 on a public relay is always firehose-scrapable on `kinds:[37521]`. "Link-only" = **unlisted**, not private. The UI-SPEC copywriting contract already specifies the non-dismissible inline caveat string. The residual is acceptable because beacons are throwaway-keyed (D-05) and time-boxed; closing it cryptographically = BEACON-07 / cordn (deferred). `[CITED: 12-UI-SPEC.md "Honesty caveat"]`

> **Enforcement boundary (state explicitly to the user):** discovery-gating is the Earthly *client's* behavior, not a relay or cryptographic guarantee. Do not imply privacy.

## Position / geometry content contract (Open Unknown #6, D-09)

**Recommended `LiveBeaconContent` shape** (extends the existing scaffold; reconciles the `position?: [number,number]` placeholder by replacing it with a GeoJSON `Point`, mirroring the Sighting `geometry` field):

```ts
export interface LiveBeaconContent {
	modelVersion?: string
	/** Human-readable label for the presence ("Bike courier — live"). */
	label?: string
	/**
	 * Precise current position as a GeoJSON Point ([lon, lat]). The lossy bbox/g
	 * discovery tags are derived from this on every publish (a beacon lifecycle
	 * service, mirroring temporal-sighting/lifecycle.ts) so the tags never drift.
	 * REPLACES the Phase-8 `position?: [number, number]` placeholder.
	 */
	geometry?: Point
	/**
	 * Lifecycle discriminator (D-04). 'live' on every heartbeat; 'ended' on the
	 * one final Stop event. Defaults to 'live' when absent (back-compat with the
	 * Phase-8 scaffold + seeded beacons that predate this field).
	 */
	status?: 'live' | 'ended'
}
```

Reconciliation notes:
- **Drop `position?: [number,number]`.** Use a GeoJSON `Point` for consistency with `TemporalSightingContent.geometry` and so the same `bbox`/`centroid` turf re-derive (`temporal-sighting/lifecycle.ts:71-97`) works unchanged. `[VERIFIED: src/lib/nostr/temporal-sighting/lifecycle.ts]`
- **`status` defaults to `'live'`** in `DEFAULT_LIVE_BEACON_CONTENT` so the seeded beacons (no `status`) and any in-flight Phase-8 events render as live, not undefined. The map layer treats absent/`'live'` identically.
- **Discovery tags are derived, not author-set:** a `publishBeacon`/`updateBeacon`/`stopBeacon` lifecycle service (clone `temporal-sighting/lifecycle.ts`) re-derives `bbox`+`g` from `geometry` on every publish for **public** beacons, and **omits/coarsens** them for **link-only** (D-10). The `g`/`bbox` setters already exist on the factory (`factory.ts:86-92`).
- **Seed script update (UAT fixture):** `scripts/seed-entities.ts:424-446` currently sets `position: pos` and `.geohash(pos)`. Update to `geometry: { type:'Point', coordinates: pos }`, `status:'live'`, and a `t:'live'` marker — and add at least one `status:'ended'` and one link-only (no geo, no `t`) fixture so all four marker states + the discovery-gating are visually testable. `[VERIFIED: scripts/seed-entities.ts:424-446]`

## watchPosition publish-loop reuse (Open Unknown #7)

The continuous geolocation machinery already exists and is the foundation — **do not reinvent it.** `[VERIFIED: src/components/ui/map.tsx:826-957]`

What exists (`MapControls` in `src/components/ui/map.tsx`):
- `startLocateTracking()` (L912) calls `navigator.geolocation.watchPosition(success, error, { enableHighAccuracy:true, timeout:10000, maximumAge:5000 })`, stores the watch id in `locateWatchRef`, sets `locateStatus`, and emits every fix via `onLocate(coords)` (coords include `accuracy`).
- `stopLocateTracking()` (L902) calls `clearWatch`, resets state, emits `onLocate(null)`.
- Cleanup on unmount clears the watch (L852-859).
- **Permission/error handling today:** the `error` callback (L938) logs, sets `locateStatus:'error'`, clears the watch, and auto-resets to `idle` after 3 s. There is **no distinction** today between PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT — the beacon work must add that (D-discretion error handling; UI-SPEC error/permission table).

How to wire the throttled publish loop (the net-new subsystem):
- **Do NOT publish from inside `MapControls`.** Build a dedicated `useBeaconPublisher(session)` hook (or a small controller) that owns its own `watchPosition` session for the beacon (separate from the locate-button tracking, which is a UI affordance). Reusing the *pattern* (and the watchPosition options) is the reuse; sharing the *same watch* would couple the locate button to the beacon.
- The hook holds: the per-session `PrivateKeySigner` (D-05), the `d` tag (stable for the session), the `expiration` (set once at Start), the last-published `{coords, at}`, and `BEACON_*` constants.
- On each `watchPosition` fix: compute haversine distance from last-published point; if `distance >= BEACON_DISTANCE_FLOOR_M` **OR** `now - lastPublishedAt >= BEACON_HEARTBEAT_MS`, call `updateBeacon(...)` (which republishes the same `d`, new `created_at`, `status:'live'`). A `setInterval(heartbeat)` covers the stationary case (D-02) — guard against double-publish when a fix and the interval coincide.
- **Foreground-only** is satisfied automatically: `watchPosition` is throttled/suspended by the browser when the tab is backgrounded, so the beacon naturally goes stale (no publishes) when the tab is hidden — which is the desired honest behavior. Optionally listen to `visibilitychange` to surface the "searching…" sub-state. Always-on/background is an explicit non-goal.
- **Permission-denied at Start:** call `navigator.permissions.query({ name:'geolocation' })` (where supported) to pre-disable Start, and handle the `error.code === error.PERMISSION_DENIED` path with the UI-SPEC copy. **Fix-unavailable mid-session:** do NOT freeze the marker as live — let staleness take over honestly (the beacon greys out because no fresh `created_at` arrives), show the banner "searching…" sub-line. `[CITED: 12-UI-SPEC.md error table]`

`GeoEditorMap.tsx:~177` is a secondary watchPosition reference (accuracy/click-to-stop) — same API, useful as a second example of the success/error shape.

## Generated throwaway-key signer (Open Unknown #5, D-05)

**Confirmed API: `PrivateKeySigner` from `applesauce-signers`, constructed over a freshly generated secp256k1 key.** `[VERIFIED: node_modules/applesauce-signers/dist/signers/private-key-signer.d.ts]`

- `new PrivateKeySigner(key?: Uint8Array)` — **with no argument it generates a fresh in-memory secp256k1 key**; `getPublicKey()` returns the throwaway pubkey. `SimpleSigner` is a deprecated alias of the same class — use `PrivateKeySigner`. It implements `ISigner` (`getPublicKey` + `signEvent`), which is exactly what the `EntityFactory.sign(signer)` path accepts (the base also accepts a bare sign-function, but a full signer is cleaner). `[VERIFIED: src/lib/nostr/entityFactory.ts:42-51]`
- Generate the key with `generateSecretKey()` from `nostr-tools` (already used across the repo) and pass it: `new PrivateKeySigner(generateSecretKey())` — this gives you the key bytes to keep for the session and the matching pubkey for the naddr. `[VERIFIED: src/lib/wallet/actions.ts:32; src/lib/group/noModMinimum.test.ts:19]`
- **Where publishing branches today:** the active-account signer comes from `useActiveAccount()` (applesauce-react) and is passed straight into `publishSighting(options, signer)` (`SightingEditorPanel.tsx:160,251,272`). For a beacon, the branch is: **default (Anonymous)** → construct a per-session `PrivateKeySigner` and pass *it* as the signer; **opt-in (My account)** → pass `useActiveAccount()` as today. `[VERIFIED: src/components/info-panel/SightingEditorPanel.tsx:160,251,272]`
- **Key scope = per session:** generate once at Start, hold in the `useBeaconPublisher` session object (React ref / a small store slice), reuse for every heartbeat and the final `status:'ended'` event, then **discard** at Stop. A brand-new Start generates a fresh key (sessions unlinkable). **Never persist the throwaway key to localStorage** (unlike accounts) — it must die with the session.
- **Publish routing caveat:** `publish(event, { routing:'outbox' })` resolves NIP-65 mailboxes for the *event's* pubkey; a throwaway key has no NIP-65 record, so `resolveRoutedRelays` will time out (1.5 s) and fall back to `config.writeRelays`. In dev, all routing collapses to `writeRelays` anyway. **Recommendation:** publish beacons with the default `routing:'configured'` (or explicit `relays: config.writeRelays`) to avoid the 1.5 s mailbox-timeout on every heartbeat. `[VERIFIED: src/lib/nostr/index.ts:287-344]`
- **No-delete warning severity (D-06):** copy adapts to identity — stronger weight in the My-account case (UI-SPEC already specifies both strings).

## Rail-tab → browse → info-panel → deep-link + OG-card pattern (Open Unknown #8, D-11/D-12)

This is a near-verbatim clone of the Phase-11 Sighting stack. Concrete template per surface:

| Surface | Clone from | Beacon-specific change |
|---------|-----------|------------------------|
| Rail tab | `AppSidebar.tsx` `WorkViewMode` union + `WORK_VIEW_MODES` + `RAIL_DESTINATIONS` (`sightings`/`Eye`) | Add `'beacons'` to the union (`AppSidebar.tsx:58,61`), add `{ mode:'beacons', title:'Beacons', icon: Radio }` to `RAIL_DESTINATIONS` (`:78-82`), add `beaconsPanelProps` + a `case 'beacons'` in `renderWorkContent` (`:755+`). `[VERIFIED: src/components/AppSidebar.tsx:58-92,648-761]` |
| Browse hook | `src/lib/hooks/useSightings.ts` (`useTimelineWithEose` + `isTemporalSighting` filter-before-cast + `dropExpired` + expiry-clock tick) | New `useBeacons()`: filter `{kinds:[37521], '#t':['live']}` for discovery, `isLiveBeacon`-filter before cast, `dropExpired`, **15 s** expiry tick. `[VERIFIED: src/lib/hooks/useSightings.ts]` |
| Browse panel | `SightingsPanel.tsx` (`SightingsPanelContent`) | `BeaconsPanel`: rows show live/stale/ended chip + last-seen + countdown + "Watch on map"; the user's own active beacon pinned to top with Stop/Adjust; accent "Share live location" CTA. (UI-SPEC §Net-New 1.) `[VERIFIED: src/components/SightingsPanel.tsx exists]` |
| View panel | `src/components/info-panel/SightingViewPanel.tsx` | `BeaconViewPanel`: label + status chip + last-seen (primary) + countdown (secondary) + Copy-share-link; owner Stop/Adjust. |
| Editor/control panel | `src/components/info-panel/SightingEditorPanel.tsx` | `BeaconControlPanel`: time-box presets + visibility + identity + consent + Start (no geometry-drawing — position comes from GPS, not a dropped pin). |
| Map marker | `useMapLayers.ts` Sighting source/layers (`SIGHTING_SOURCE_ID`, circle+glyph+hit, `buildSightingSource` with `dropExpired`, color constants `#fdc700`/`#737373`) | Beacon source/layers with a `beaconState:'live'\|'stale'\|'ended'` data-driven paint; reuse the exact hex constants (UI-SPEC mirrors them). `dropExpired`-before-source on every tick. `[VERIFIED: src/features/geo-editor/hooks/useMapLayers.ts:80-325,713+]` |
| Route | `src/features/geo-editor/hooks/useRouting.ts` `/sighting/:naddr` block (`:127-138`) | Add `focusType: 'beacon'`, extend `isFocusType`, add a `first === 'beacon'` block with `sidebarView:'beacons'`. **Flag P-5:** keep it a thin per-kind clone — Phase 13/XCUT-02 generalizes. `[VERIFIED: src/features/geo-editor/hooks/useRouting.ts:36,54,127-138]` |
| OG card | `src/lib/og/fetchEvent.ts` `fetchSightingData` (`:308-361`) + crawler match | `fetchBeaconData`: gate on `decoded.kind === LIVE_BEACON_KIND`, fetch latest-by-`created_at` via the existing `fetchEventFromRelay` (WR-05 already handles parameterized-replaceable), `dropExpired`-equivalent expiry guard, honest copy ("Live location — may have ended"). `[VERIFIED: src/lib/og/fetchEvent.ts:85-92,308-361]` |

**naddr must carry the throwaway pubkey** for the default anonymous beacon (it's not under the user's profile) — encode `{ kind:37521, pubkey: throwawayPubkey, identifier: d }`. The OG fetch path resolves by `{kind, pubkey, '#d'}` so it works for any pubkey. `[VERIFIED: src/lib/og/fetchEvent.ts:92-94]`

## Standard Stack

No new runtime dependencies. Everything is already in the project.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-signers` (`PrivateKeySigner`) | as-installed | In-memory generated secp256k1 signer for the throwaway key | Official applesauce signer; implements `ISigner`; the v1.2 casting/signing discipline. `[VERIFIED: node_modules/applesauce-signers/dist/signers/private-key-signer.d.ts]` |
| `nostr-tools` (`generateSecretKey`) | as-installed | Generate the per-session secp256k1 key | Already the repo's keygen primitive. `[VERIFIED: src/lib/wallet/actions.ts:32]` |
| `applesauce-core` (`castEvent`, `EventStore`, `getExpirationTimestamp`, `unixNow`) | as-installed | Cast 37521, NIP-40 read, epoch-seconds clock | The shared seam the whole entity model uses. `[VERIFIED: src/lib/nostr/expiry.ts; src/lib/hooks/useSightings.ts]` |
| `@turf/turf` (`bbox`, `centroid`) | as-installed | Derive `bbox`/`g` from the `Point` geometry | Already the geo-derive primitive in `temporal-sighting/lifecycle.ts`. `[VERIFIED: src/lib/nostr/temporal-sighting/lifecycle.ts:24]` |
| MapLibre GL (via `useMapLayers`) | as-installed | Live marker source/layers | The existing map abstraction; Sighting layer is the template. `[VERIFIED: src/features/geo-editor/hooks/useMapLayers.ts]` |
| `navigator.geolocation.watchPosition` | browser API | Continuous position capture | Already wired in `map.tsx`; foreground-only by design. `[VERIFIED: src/components/ui/map.tsx:920]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nip19` (nostr-tools) | as-installed | naddr encode/decode for share link | Share-link build + OG decode. `[VERIFIED: src/lib/og/fetchEvent.ts]` |
| Radix UI primitives (`@/components/ui/*`) | installed | All panel/control chrome | UI-SPEC: no new primitives; all already present. `[CITED: 12-UI-SPEC.md Registry Safety]` |
| `applesauce-react` (`useActiveAccount`) | installed | Own-pubkey opt-in signer | The My-account identity branch. `[VERIFIED: src/components/info-panel/SightingEditorPanel.tsx:34]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `PrivateKeySigner` for throwaway key | Bare sign-function via `EntityFactory.sign((tpl)=>finalizeEvent(tpl, sk))` | The bare-function path works (entityFactory supports it) but `PrivateKeySigner` is the canonical applesauce shape and also gives `getPublicKey()` for the naddr — prefer the signer. |
| `created_at` for freshest-pick | monotonic `seq` tag | `seq` adds schema surface for zero benefit while the lifecycle is replaceable (relay already latest-wins by `created_at`). Only needed if BEACON-06 ephemeral-stream is adopted (deferred). |
| Ephemeral kind (20000-range) | replaceable 37521 + NIP-40 | **Locked** at SPEC/roadmap level — do not reopen. Replaceable gives one stable address + clean ended-state; ephemeral would lose the addressable share link. |

**Installation:** none — `bun install` already covers all of the above.

## Package Legitimacy Audit

> No external packages are installed by this phase. All libraries above are pre-existing project dependencies.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| (none added) | — | — | Phase adds zero dependencies |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────┐
        START (control)   │  BeaconControlPanel                      │
   timebox/visibility/    │  ─ generate PrivateKeySigner (D-05)      │
   identity/consent  ───► │  ─ mint stable `d`, set expiration       │
                          │  ─ choose public (t:'live'+geo) | link   │
                          └───────────────┬─────────────────────────┘
                                          │ session {signer, d, exp, visibility}
                                          ▼
   navigator.geolocation  ───►  useBeaconPublisher (throttle loop)
   .watchPosition(fix)         │  if moved≥25m OR ≥30s since last:
   (foreground-only)          │     updateBeacon → LiveBeaconFactory
   + heartbeat setInterval    │       .beacon({geometry, status:'live'})
                              │       .expiration(exp).geohash/.bbox(if public)
                              │       .sign(sessionSigner)
                              │     publish(evt, {routing:'configured'})
                              ▼
                          Khatru relay (37521)
                          ─ manual replacer: latest-by-created_at wins
                          ─ NIP-40 GC: LAZY (≥1h) — NOT trusted
                              │
              ┌───────────────┴───────────────┐
              ▼                                ▼
        discovery sub                    naddr resolve (link-only)
   {kinds:[37521],#t:['live']}          {kinds:[37521],authors,#d}
              │                                │
              ▼                                ▼
        useBeacons():  isLiveBeacon → dropExpired(now) → castEvent
              │   (+15s expiry tick re-renders so live→stale→removed flips)
              ▼
        buildBeaconSource(): pick freshest per {pubkey,d},
        derive beaconState = expired? REMOVED
                            : status==='ended'? ENDED
                            : now-created_at ≥ 120s? STALE : LIVE
              │
              ▼
        MapLibre source/layer (circle+glyph+hit, data-driven paint)
        + always-on "you are live" banner (owner)  +  BeaconsPanel rows
              │
              ▼
   STOP ─► publish one final beacon({status:'ended'}) keep expiration
          → discard session signer
```

### Recommended Project Structure
```
src/
├── lib/nostr/live-beacon/
│   ├── helpers.ts          # EXTEND: LiveBeaconContent { geometry:Point, status }
│   ├── factory.ts          # exists — no change (geohash/bbox/expiration setters ready)
│   ├── cast.ts             # EXTEND: expose `status`, `position`/geometry getters
│   ├── lifecycle.ts        # NEW: publishBeacon/updateBeacon/stopBeacon (clone sighting/lifecycle.ts)
│   └── index.ts            # exists
├── lib/hooks/
│   └── useBeacons.ts       # NEW: clone useSightings.ts, #t:['live'] filter, 15s tick
├── features/geo-editor/
│   ├── hooks/
│   │   ├── useBeaconPublisher.ts   # NEW: watchPosition throttle loop + session signer
│   │   └── useMapLayers.ts         # EXTEND: beacon source/layers + beaconState paint
│   └── hooks/useRouting.ts         # EXTEND: focusType 'beacon', /beacon/:naddr (thin)
├── components/
│   ├── BeaconsPanel.tsx            # NEW: clone SightingsPanel.tsx
│   ├── AppSidebar.tsx              # EXTEND: 'beacons' rail mode (Radio icon)
│   ├── RunningBeaconBanner.tsx     # NEW: always-on "you are live" pill (no twin)
│   └── info-panel/
│       ├── BeaconViewPanel.tsx     # NEW: clone SightingViewPanel.tsx
│       └── BeaconControlPanel.tsx  # NEW: clone SightingEditorPanel.tsx (no pin-drop)
└── lib/og/fetchEvent.ts            # EXTEND: fetchBeaconData (clone fetchSightingData)
```

### Pattern 1: Beacon lifecycle service (clone temporal-sighting/lifecycle.ts)
**What:** A thin testable wrapper over `LiveBeaconFactory` owning the publish path: re-derives `bbox`/`g` from `geometry` for public beacons (omits for link-only), writes `expiration`, preserves `d` on update, sets `status`.
**When to use:** every beacon publish (start, each heartbeat/update, stop). Never re-inline the factory in UI (the Sighting code enforces this discipline).

### Pattern 2: Throttled publish loop (net-new)
**What:** distance+time-floored republish over watchPosition + a heartbeat interval, under a per-session signer.
**When to use:** the BEACON-01 core. See Code Examples.

### Pattern 3: Three clocks, kept disjoint
`created_at` → last-seen/staleness; `expiration` → removal/countdown; time box → sets `expiration`. Never surface all three as raw equal-weight fields (UI-SPEC rule).

### Pattern 4: Staleness derivation on a ticking clock
A `useExpiryClock`-style tick (15 s) makes `dropExpired` and the live→stale step re-evaluate as wall-clock advances even with no new event — exactly the WR-04 fix `useSightings` already ships, just a finer tick.

### Anti-Patterns to Avoid
- **Publishing from inside `MapControls`** — couples the locate button to the beacon. Own a separate watchPosition session in `useBeaconPublisher`.
- **Using `Date.now()` (ms) for staleness/expiry** — the whole seam is epoch **seconds** (`unixNow()`). Mixing units is Pitfall P-1.
- **Trusting relay GC for removal** — it's lazy (≥1h). Always `dropExpired` client-side.
- **Casting an unfiltered 37521 timeline** — the `LiveBeacon` ctor THROWS on a non-conforming event; `isLiveBeacon`-filter BEFORE cast (Pitfall P-2, same as `useSightings`).
- **Persisting the throwaway key** — it must die with the session; never localStorage.
- **Adding a `seq` tag** — unnecessary; `created_at` + id tie-break suffices.
- **Generalizing the `/beacon` route now** — keep it a thin clone; Phase 13 owns the canonical router.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parameterized-replaceable latest-wins | Custom "keep newest" relay logic | Khatru's manual replacer (already works) + applesauce EventStore | Relay+store already de-dupe by `{kind,pubkey,d}` on `created_at`. |
| NIP-40 expiry parsing | Custom tag parse | `getExpirationTimestamp` + `isExpired`/`dropExpired` | Shared seam, aligned with upstream, epoch-seconds clock. |
| Throwaway keypair + signer | Hand-rolled secp256k1 + finalizeEvent | `new PrivateKeySigner(generateSecretKey())` | Canonical applesauce signer with `getPublicKey()` for the naddr. |
| Continuous geolocation | New watchPosition wrapper | Reuse the `map.tsx` pattern + its watchPosition options | Already battle-tested, including cleanup/error reset. |
| bbox/centroid from geometry | Manual coordinate math | `@turf/turf` `bbox`/`centroid` (try/catch → undefined) | Exact precedent in `temporal-sighting/lifecycle.ts`. |
| Marker live/stale/removed | Custom map overlay | `useMapLayers` source/layer pair + data-driven paint | The Sighting layer is a direct template (same hex constants). |
| Share link + OG card | New crawler | `og/fetchEvent.ts` `fetchSightingData` clone | Already handles replaceable latest-wins (WR-05) + expiry. |
| Rail tab / browse / view / route | New nav system | Clone the Sighting `WorkViewMode`/panel/route slots | The whole spine is parameterized by kind already. |

**Key insight:** Phase 12's *only* genuinely new code is (a) the throttled publish loop + session signer, (b) the always-on running banner, and (c) the beacon marker's `beaconState` paint. Everything else is a kind-substituted clone of Phase 11.

## Runtime State Inventory

> Not a rename/refactor/migration phase — this section is N/A. The one persistence-adjacent concern is the throwaway key: it MUST NOT be written to any datastore (localStorage/IDB). Stored data, live-service config, OS-registered state, secrets/env, and build artifacts are all **None — verified**: the beacon publishes ordinary 37521 Nostr events to the existing relay and adds nothing to localStorage/IDB beyond what `publish()`→`eventStore`→IDB cache already does for every event.

## Common Pitfalls

### Pitfall 1: Milliseconds vs epoch seconds (P-1)
**What goes wrong:** staleness/expiry computed with `Date.now()` (ms) against `created_at`/`expiration` (seconds) → off by 1000×; beacons never expire or instantly expire.
**Why:** browser APIs are ms; Nostr is epoch seconds.
**How to avoid:** use `unixNow()` everywhere for the beacon clock; `created_at`, `expiration`, the staleness threshold are all seconds. The watchPosition heartbeat interval is the *only* ms value (`setInterval`).
**Warning signs:** beacons grey out instantly or never.

### Pitfall 2: Casting an unfiltered 37521 timeline (P-2)
**What goes wrong:** the `LiveBeacon` cast ctor throws on a legacy/forged 37521 (no current `modelVersion`) → crashes the whole map/list `.map`.
**How to avoid:** `events.filter(isLiveBeacon)` BEFORE `castEvent` (and before `dropExpired`), exactly as `useSightings`.

### Pitfall 3: "Ended" must still carry a fresh-ish published event (P-3)
**What goes wrong:** Stop sets `status:'ended'` but the publish fails (network) → viewers keep seeing the last `live` point as live until expiry.
**How to avoid:** the Stop path should retry/confirm the ended publish, and the marker should treat *any* event past the staleness threshold as STALE regardless of `status`, so a failed ended-publish still degrades honestly (never frozen-as-live). Surface a Stop error toast (UI-SPEC "Publish failed" copy).

### Pitfall 4: Heartbeat spam / double-publish (P-4)
**What goes wrong:** a watchPosition fix and the heartbeat interval coincide → two publishes one tick apart; or a jittery GPS keeps tripping the distance floor → relay flood.
**How to avoid:** single `lastPublishedAt` guard shared by both the fix path and the interval; debounce the distance check against the *last published* point (not the last fix). 30 s floor caps the rate.

### Pitfall 5: Premature route generalization (P-5)
**What goes wrong:** building a generic entity router here collides with Phase 13/XCUT-02.
**How to avoid:** add `/beacon/:naddr` as a thin per-kind clone of the `/sighting` block; leave a `// Phase 13 / XCUT-02 generalizes` comment (the Sighting block already has this exact comment).

### Pitfall 6: Link-only beacon still discoverable (P-6)
**What goes wrong:** a link-only beacon publishes geo tags or `t:'live'` → it surfaces in the nearby list, defeating D-10.
**How to avoid:** the lifecycle service must omit `t:'live'` AND the geo tags for link-only; the discovery subscription filters `#t:['live']`. Add a test asserting a link-only beacon does NOT match the discovery filter.

## Code Examples

### Per-session throwaway signer (D-05)
```ts
// Source: applesauce-signers PrivateKeySigner + nostr-tools generateSecretKey
import { PrivateKeySigner } from 'applesauce-signers'
import { generateSecretKey } from 'nostr-tools'

function newBeaconSession() {
	const sk = generateSecretKey()              // fresh secp256k1, in memory only
	const signer = new PrivateKeySigner(sk)     // ISigner: getPublicKey + signEvent
	const d = generateShortDTag()               // stable for the whole session
	return { signer, sk, d }                    // NEVER persist sk
}
```

### Throttled publish loop sketch (BEACON-01, D-01/D-02)
```ts
// Pseudocode for useBeaconPublisher — owns its own watchPosition session.
const BEACON_HEARTBEAT_MS = 30_000
const BEACON_DISTANCE_FLOOR_M = 25
let last: { coords: [number, number]; at: number } | null = null

async function maybePublish(coords: [number, number]) {
	const nowMs = Date.now()
	const moved = last && haversineMeters(last.coords, coords) >= BEACON_DISTANCE_FLOOR_M
	const due = !last || nowMs - last.at >= BEACON_HEARTBEAT_MS
	if (!moved && !due) return
	last = { coords, at: nowMs }
	await updateBeacon(                          // lifecycle service, same `d`
		{ content: { geometry: { type: 'Point', coordinates: coords }, status: 'live' },
		  expiration: session.expiration,
		  visibility: session.visibility },
		session.signer,
	)
}
// watchPosition success → maybePublish; setInterval(BEACON_HEARTBEAT_MS) → maybePublish(lastFix)
```

### Beacon state derivation for the map source (BEACON-03, D-07/D-08)
```ts
// Source: mirrors useSightings dropExpired + useMapLayers buildSightingSource
const BEACON_STALE_THRESHOLD_S = 4 * (BEACON_HEARTBEAT_MS / 1000) // 120s
function beaconState(cast: LiveBeacon, now: number): 'live' | 'stale' | 'ended' | 'removed' {
	if (isExpired(cast.event, now)) return 'removed'            // never rendered
	if (cast.beacon.status === 'ended') return 'ended'
	if (now - cast.event.created_at >= BEACON_STALE_THRESHOLD_S) return 'stale'
	return 'live'
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overloaded kind-37518 "context" | Dedicated kind 37521 Live Beacon | v1.2 / Phase 8 | Beacon is a first-class addressable replaceable entity. |
| `SimpleSigner` | `PrivateKeySigner` (alias) | applesauce current | Use `PrivateKeySigner`; `SimpleSigner` is deprecated. `[VERIFIED]` |
| One-shot publish (Sighting) | Throttled continuous republish (Beacon) | this phase | The net-new live subsystem. |
| `position?: [number,number]` placeholder | GeoJSON `Point` `geometry` + `status` | this phase (D-09/D-04) | Consistent with Sighting; derivable bbox/g. |

**Deprecated/outdated:**
- `SimpleSigner` → `PrivateKeySigner`.
- `content.position` placeholder → `content.geometry` (Point).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Distance floor 25 m | Staleness/cadence defaults | Too small → relay spam; too large → laggy dot. Tunable constant; low risk. |
| A2 | Heartbeat 30 s | Staleness/cadence defaults | Affects publish volume + stale threshold. Single relay, low risk; tune in UAT. |
| A3 | Staleness factor 4× (120 s) | Staleness/cadence defaults | Too tight → false "stale" on a slow fix; too loose → violates "couple of minutes." Tune in UAT. |
| A4 | 15 s expiry-clock tick (vs Sighting's 60 s) | Staleness/cadence defaults | Too coarse → live→stale flip lags; 15 s is a safe sub-threshold cadence. Low risk. |
| A5 | `t:'live'` is the canonical public-discovery marker | Visibility mechanism | If a different marker is preferred, the discovery filter changes — confirm at plan/discuss. Seed script already uses `t:'live'`, low risk. |

**All other claims are [VERIFIED] against in-repo source or [CITED] from the UI-SPEC/SPEC.** The relay echo-test, signer API, content contract, watchPosition reuse, and the clone targets are all source-verified.

## Open Questions

1. **Comment/react mount on a throwaway-keyed beacon (D-09 "if cheaply reused").**
   - What we know: Story/Sighting mount `CommentsPanel` + `GeoSocialActions` on the entity coordinate; XCUT-01 K/k widening for 37521 is Phase 13.
   - What's unclear: a throwaway author makes "comment on this beacon" awkward (the author can't be notified/recognized), and the comment root-kind widening isn't done until Phase 13.
   - Recommendation: **defer comment/react for beacons** to Phase 13 (when XCUT-01 widens the root kinds); the UI-SPEC already flags this as deferrable. Don't block Phase 12 on it.

2. **Geo coarsening precision for link-only (D-10).**
   - What we know: link-only should omit/coarsen geo so the discovery layer never surfaces it.
   - What's unclear: whether to omit geo entirely (cleanest) or publish a low-precision geohash.
   - Recommendation: **omit `g`/`bbox` entirely** for link-only — simplest, and the discovery subscription filters on `#t` anyway so omitting the marker is sufficient; omitting geo also reduces the firehose-scrape signal. Confirm at plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | build/test/dev | ✓ | project runtime | — |
| Go relay (Khatru) | echo-test / UAT | ✓ (`bun relay`) | khatru v0.19.1 | — |
| `navigator.geolocation` | BEACON-01 capture | ✓ (browser) | — | Permission-denied UX (UI-SPEC); Start disabled |
| applesauce-signers / nostr-tools | throwaway signer | ✓ installed | as-locked | — |
| @turf/turf | bbox/centroid derive | ✓ installed | as-locked | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** geolocation permission (handled by the permission-gate UX).

## Validation Architecture

> nyquist_validation is not disabled in config — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun's built-in runner) |
| Config file | none — Bun test convention (`*.test.ts` colocated) |
| Quick run command | `bun test src/lib/nostr/live-beacon` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BEACON-01 | Throttle: publishes on distance≥floor OR time≥heartbeat, not otherwise | unit | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | ❌ Wave 0 |
| BEACON-01 | Lifecycle: publishBeacon/updateBeacon derive bbox/g (public), preserve `d` | unit | `bun test src/lib/nostr/live-beacon/lifecycle.test.ts` | ❌ Wave 0 |
| BEACON-02 | Stop publishes `status:'ended'` keeping expiration; ended state stable until expiry | unit | `bun test src/lib/nostr/live-beacon/lifecycle.test.ts` | ❌ Wave 0 |
| BEACON-02 | Relay echo: same-`d` republish → latest-wins; expired served-but-client-dropped | integration | `bun test src/lib/nostr/live-beacon/relay-echo.test.ts` (against `bun relay`) | ❌ Wave 0 |
| BEACON-03 | `beaconState` derivation: live/stale/ended/removed at the threshold boundary | unit | `bun test src/features/geo-editor/hooks/useBeacons.test.ts` | ❌ Wave 0 |
| BEACON-03 | `dropExpired` + ticking clock greys/removes without a new event | unit | `bun test src/lib/hooks/useBeacons.test.ts` | ❌ Wave 0 |
| BEACON-03 | filter-before-cast: legacy/forged 37521 never reaches the cast ctor | unit | `bun test src/lib/hooks/useBeacons.test.ts` | ❌ Wave 0 |
| BEACON-04 | Public beacon matches `#t:['live']` discovery; link-only does NOT | unit | `bun test src/lib/nostr/live-beacon/visibility.test.ts` | ❌ Wave 0 |
| BEACON-04 | naddr round-trip (encode throwaway pubkey → decode → fetch) | unit | `bun test src/lib/og/fetchBeacon.test.ts` | ❌ Wave 0 |
| BEACON-05 (throwaway) | Per-session key is fresh per Start, unlinkable, never persisted | unit | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test src/lib/nostr/live-beacon` (+ the touched hook test)
- **Per wave merge:** `bun test` (full) + `bun run build` + `bun run lint`
- **Phase gate:** full suite green + the relay echo integration test green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/nostr/live-beacon/lifecycle.test.ts` — covers BEACON-01/02 (derive, preserve d, ended state)
- [ ] `src/lib/nostr/live-beacon/relay-echo.test.ts` — covers BEACON-02 (relay latest-wins + lazy-GC + client drop) against `bun relay`
- [ ] `src/lib/nostr/live-beacon/visibility.test.ts` — covers BEACON-04 (public vs link-only discovery)
- [ ] `src/lib/hooks/useBeacons.test.ts` — covers BEACON-03 (filter-before-cast, dropExpired, beaconState, ticking clock)
- [ ] `src/features/geo-editor/hooks/useBeaconPublisher.test.ts` — covers BEACON-01/D-05 (throttle, session key)
- [ ] `src/lib/og/fetchBeacon.test.ts` — covers BEACON-04 (naddr/OG)
- [ ] Test harness for `navigator.geolocation` (mock `watchPosition`) — shared fixture, none exists yet

## Security Domain

> `security_enforcement` not disabled — section included. This phase carries the milestone's **highest privacy surface**.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Beacon viewing is anonymous (guest scope); throwaway-key publishing is keypair-based, no password. |
| V3 Session Management | yes | The throwaway key IS the session secret — hold in memory only, discard at Stop, never persist. |
| V4 Access Control | partial | Discovery-gating is soft (client-side); explicitly NOT an access-control guarantee — document the firehose caveat. |
| V5 Input Validation | yes | `isLiveBeacon` modelVersion gate + defensive `JSON.parse` (never throws); naddr decode wrapped (returns null). XSS: `label` renders as auto-escaped React text (no `dangerouslySetInnerHTML`). |
| V6 Cryptography | partial | `generateSecretKey`/`PrivateKeySigner` (libsecp256k1) — never hand-roll. NO content encryption this phase (BEACON-07/cordn deferred); "link-only" is explicitly unencrypted. |
| V7 Privacy | **yes (defining axis)** | Throwaway key by default (unlinkable sessions); time-boxed via NIP-40; foreground-only; no-delete informed consent; honest staleness; honest "unlisted, not private" caveat. |

### Known Threat Patterns for the beacon stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| De-anonymization (own pubkey leaks a private trail) | Information disclosure | Throwaway key DEFAULT; My-account is explicit opt-in with stronger consent (D-05/D-06). |
| Frozen-as-live (stopped beacon shown current) | Spoofing / integrity | `created_at`-derived staleness step + treat past-threshold as STALE regardless of `status` (P-3); never render expired (`dropExpired`). |
| Relay serving an expired/deleted beacon | Information disclosure | Client `dropExpired` at every read path; relay GC is advisory/lazy and untrusted (SPEC-05). |
| "Link-only" assumed private | Information disclosure | Non-dismissible inline honesty caveat; throwaway key + time-box bound the residual; cryptographic close = cordn (deferred). |
| Forged/legacy 37521 crashing the list | DoS (tab freeze) | `isLiveBeacon` filter-before-cast; defensive content getter never throws (P-2). |
| XSS via `label` | Tampering | Auto-escaped React text node; no raw HTML (Story/Sighting posture). |
| Throwaway key persisted/leaked | Information disclosure | Never write the session key to localStorage/IDB; in-memory only, discarded at Stop. |
| Heartbeat flood (self-DoS the relay) | DoS | Distance+time floor + single lastPublishedAt guard (P-4). |

## Sources

### Primary (HIGH confidence)
- `src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts` — existing data layer (content shape, factory setters, guard).
- `src/lib/nostr/expiry.ts` — `isExpired`/`dropExpired` epoch-seconds seam (SPEC-05).
- `src/lib/nostr/temporal-sighting/lifecycle.ts` + `src/lib/hooks/useSightings.ts` — the clone template (derive bbox/g, filter-before-cast, dropExpired, expiry-clock tick).
- `src/components/info-panel/SightingEditorPanel.tsx`, `src/components/SightingsPanel.tsx`, `src/components/AppSidebar.tsx`, `src/features/geo-editor/hooks/useRouting.ts`, `src/features/geo-editor/hooks/useMapLayers.ts`, `src/lib/og/fetchEvent.ts` — the UX spine clone targets.
- `src/components/ui/map.tsx:826-957` — watchPosition machinery.
- `node_modules/applesauce-signers/dist/signers/private-key-signer.d.ts` — `PrivateKeySigner` API.
- `relay/main.go` + `github.com/fiatjaf/khatru@v0.19.1` (`adding.go`, `expiration.go`, `relay.go`) + `eventstore@0.16.7/sqlite3` — relay echo-test ground truth.
- `SPEC.md` §5/§7/§8/§10 + `12-CONTEXT.md` + `12-UI-SPEC.md` + `REQUIREMENTS.md`.

### Secondary (MEDIUM confidence)
- `scripts/seed-entities.ts:424-446` — beacon seed fixtures (need geometry/status/visibility update).

### Tertiary (LOW confidence)
- Cadence/threshold numeric defaults (A1–A5) — sensible starting values to tune in UAT.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all source-verified in-repo.
- Architecture / clone targets: HIGH — direct Sighting twin, line-referenced.
- Relay behavior (echo test): HIGH — read from khatru/eventstore source, not assumed.
- Signer API: HIGH — read from applesauce type defs.
- Cadence/threshold numbers: MEDIUM — reasoned defaults flagged [ASSUMED], tune in UAT.

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable; the only fast-moving variable is applesauce-signers, pinned in the project)
