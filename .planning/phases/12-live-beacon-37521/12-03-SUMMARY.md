---
phase: 12-live-beacon-37521
plan: 03
subsystem: live-beacon (kind 37521) — publish loop (useBeaconPublisher: throttled watchPosition + per-session throwaway signer)
tags: [beacon, publish-loop, throttle, heartbeat, throwaway-key, privacy, watchposition, geolocation]
dependency_graph:
  requires:
    - "12-02 data layer: updateBeacon/stopBeacon lifecycle + BEACON_HEARTBEAT_MS/BEACON_DISTANCE_FLOOR_M/BEACON_STALE_* constants + BeaconVisibility"
    - "12-01 Nyquist RED contract (useBeaconPublisher.test.ts) + src/test/geolocationMock.ts"
    - "applesauce-signers PrivateKeySigner + nostr-tools generateSecretKey (pre-existing, zero new deps)"
    - "src/lib/nostr/dTag.ts (generateShortDTag) + src/lib/nostr/entityFactory.ts (SignerLike)"
    - "applesauce-react useActiveAccount (the my-account opt-in signer)"
  provides:
    - "useBeaconPublisher() React hook — { isLive, subState, session, startBeacon, stopBeacon } for Plan 04 (control panel) + Plan 05 (banner)"
    - "Pure throttle primitives: shouldPublishBeacon / createBeaconThrottle / haversineMeters / startBeaconSession (unit-testable, no React)"
    - "BeaconSubState ('idle'|'searching'|'tracking'|'permission-denied'|'error') the banner reads"
  affects:
    - "Plan 04 wires startBeacon/stopBeacon into the BeaconControls panel"
    - "Plan 05 reads subState for the live-banner copy (searching vs tracking vs permission-denied)"
tech_stack:
  added: []
  patterns:
    - "own watchPosition session mirroring map.tsx:912-948 (options { enableHighAccuracy, timeout:10000, maximumAge:5000 }) — SEPARATE from the locate button"
    - "single lastPublished guard shared by fix path + heartbeat setInterval (one throttle, two callers) — P-4"
    - "pure haversine (no turf distance dependency) so the throttle decision is trivially testable"
    - "session secret in a React ref / closure only — never a datastore (D-05)"
    - "constants re-exported from the data layer, never redefined"
key_files:
  created:
    - src/features/geo-editor/hooks/useBeaconPublisher.ts
  modified: []
decisions:
  - "Split `const sk = generateSecretKey(); new PrivateKeySigner(sk)` (vs the inline `new PrivateKeySigner(generateSecretKey())` the acceptance text sketches) because the session ref must retain `sk` to satisfy the BeaconSession.sk contract and discard it explicitly at Stop — same fresh-in-memory-only key, behaviour identical, all D-05 test assertions GREEN"
  - "Exposed pure module-level primitives (shouldPublishBeacon/createBeaconThrottle/startBeaconSession/haversineMeters) the Plan-01 test imports directly without rendering the hook — keeps the throttle + key-mint invariants unit-testable in isolation"
  - "haversine written locally (pure, EARTH_RADIUS_M) instead of a turf `distance` call — avoids a CJS interop surface and makes the distance-floor test a pure-function assertion"
  - "my-account branch casts the applesauce account to SignerLike (the account IS the signer, mirroring SightingEditorPanel `const signer = currentUser`)"
metrics:
  duration: ~9min
  tasks: 1
  files: 1
  completed: 2026-06-28
---

# Phase 12 Plan 03: Live Beacon Publish Loop Summary

Built the one genuinely net-new live subsystem of the milestone — `useBeaconPublisher`, a throttled `watchPosition` publish loop that owns its OWN geolocation session and a per-session throwaway `PrivateKeySigner`. On each qualifying fix it republishes the same replaceable kind-37521 event via the Plan-02 `updateBeacon`, throttled on a distance+time floor with a heartbeat `setInterval` keepalive (D-01/D-02) and a single shared `lastPublished` guard so a coincident fix+tick publishes exactly once (P-4). A Start mints a fresh unlinkable in-memory secp256k1 key by default (D-05); Stop publishes the final `status:'ended'` then discards the signer. Turned the Plan-01 `useBeaconPublisher` RED test GREEN.

## What Was Built

**Task 1 — useBeaconPublisher hook + pure throttle primitives (commit `f70b3dc`)**
- `src/features/geo-editor/hooks/useBeaconPublisher.ts` (new, 370 lines):
  - **Pure primitives (no React, the Plan-01 test imports these directly):**
    - `haversineMeters([lon1,lat1],[lon2,lat2])` — great-circle metres (EARTH_RADIUS_M), no turf dependency.
    - `shouldPublishBeacon(last, next, heartbeatMs)` — publish iff no prior publish OR `next.at - last.at >= heartbeatMs` OR `haversine >= BEACON_DISTANCE_FLOOR_M`; otherwise skip (D-01/D-02).
    - `createBeaconThrottle(onPublish)` → `{ onFix, onHeartbeat, last, reset }` — both `onFix` and `onHeartbeat` funnel through ONE `tryPublish` that consults + advances the single `lastPublished` guard, so a coincident fix+tick at the same timestamp publishes ONCE (P-4).
    - `startBeaconSession(identity='anonymous', accountSigner?)` — anonymous mints `generateSecretKey()` → `new PrivateKeySigner(sk)` (fresh, in-memory only); my-account reuses the passed account signer; both get a stable `generateShortDTag()` session `d`.
  - **The hook `useBeaconPublisher()`** returns `{ isLive, subState, session, startBeacon, stopBeacon }`:
    - `startBeacon({ content, expiration, visibility, identity })` mints the identity-branched session into a ref, seeds the first fix if a starting geometry is supplied, starts a SEPARATE `watchPosition` (options `{ enableHighAccuracy:true, timeout:10000, maximumAge:5000 }`, mirroring `map.tsx:947`) wired to `throttle.onFix`, and a `setInterval(BEACON_HEARTBEAT_MS)` heartbeat wired to `throttle.onHeartbeat`.
    - Each qualifying publish goes through `publishFix` → `updateBeacon({ existing: lastEvent, content:{ geometry: Point, status:'live' }, expiration, visibility }, session.signer)`, threading the session `d` (no fork) and storing the signed event for the next heartbeat.
    - `stopBeacon()` awaits the Plan-02 `stopBeacon(lastEvent, signer)` (final `status:'ended'`, same `d`, retained expiration) BEFORE tearing down — `clearWatch` + `clearInterval` + discard the session ref (drop signer + sk).
    - Error branching: `PERMISSION_DENIED` ⇒ honest hard-stop (`subState:'permission-denied'`, teardown); `POSITION_UNAVAILABLE`/`TIMEOUT` ⇒ `subState:'searching'` and does NOT republish a stale point (lets staleness grey the marker honestly — P-3).
  - Imports `BEACON_*` constants from `@/lib/nostr/live-beacon` and **re-exports** them (never redefined).

## Verification

- `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` — **5 pass / 0 fail** (13 expect()): the BEACON_* derived-constant check; no-publish sub-floor + publish on `>=` floor/heartbeat + first-fix-always; coincident fix+interval → ONE publish; two Starts → different 64-char pubkeys; no localStorage write carrying the throwaway pubkey/secret.
- `bunx biome check src/features/geo-editor/hooks/useBeaconPublisher.ts` — clean (no fixes).
- `bun run build` — green (client + server + 5 workers).
- `bun test` full suite — **752 pass / 3 fail**. The 3 failures are EXCLUSIVELY the still-RED `fetchBeaconOGData` seam (Plan 05) — down from the 8 failures at the end of Wave 1 (the 5 `useBeaconPublisher` RED cases this plan turned GREEN are gone). No shipped seam regressed. (The optimizeClient worker-asset warning is a pre-existing test-env noise, not a failure.)

## Pitfall / Invariant Coverage

| Invariant | Where |
|-----------|-------|
| P-1 epoch-ms throttle clock | `shouldPublishBeacon` compares `next.at - last.at` against `heartbeatMs`; the only ms value is the heartbeat interval |
| P-4 single double-publish guard | `createBeaconThrottle.tryPublish` is the sole writer of `lastPublished`; both `onFix` + `onHeartbeat` route through it |
| P-3 never-frozen-as-live | `POSITION_UNAVAILABLE`/`TIMEOUT` ⇒ `searching` sub-state, no stale-point republish; Stop publishes ended; staleness greys the marker regardless |
| D-01 distance floor | `haversineMeters >= BEACON_DISTANCE_FLOOR_M` (25 m, imported) |
| D-02 heartbeat keepalive | `setInterval(BEACON_HEARTBEAT_MS)` → `onHeartbeat` republishes the last fix |
| D-05 fresh unlinkable in-memory key | `startBeaconSession('anonymous')` mints `new PrivateKeySigner(generateSecretKey())`; `sk` lives in the ref only, discarded at Stop; two Starts ⇒ different pubkeys |
| D-05 my-account opt-in | `identity==='my-account'` reuses `useActiveAccount()` as the signer |

## Deviations from Plan

None functionally. One contract-faithful shaping note (NOT a behavioural deviation): the anonymous-key mint is written as `const sk = generateSecretKey(); new PrivateKeySigner(sk)` rather than the single-expression `new PrivateKeySigner(generateSecretKey())` the acceptance text sketches — because the `BeaconSession.sk` field must retain the secret so Stop can discard it explicitly. The key is identically fresh + in-memory-only; the D-05 "two Starts unlinkable" and "never persisted" assertions both pass. The throttle decision uses a local pure `haversineMeters` rather than a turf `distance` call (the plan offered either: "or reuse a turf distance call").

## Threat Surface

All five `mitigate`-disposition threats from the plan threat model are satisfied:
- **T-12-03-KEYLEAK** — `sk` held in a React ref only, never `localStorage`/`IndexedDB`/`sessionStorage` (grep-confirmed: the only `localStorage` token in the file is a doc comment); discarded at Stop; fresh per Start.
- **T-12-03-DEANON** — anonymous throwaway key is the DEFAULT (`identity='anonymous'`); my-account is an explicit opt-in branch.
- **T-12-03-FLOOD** — single `lastPublished` guard shared by the fix + heartbeat paths; distance+time floor caps the rate.
- **T-12-03-FROZEN** — `POSITION_UNAVAILABLE`/`TIMEOUT` never republishes a stale point.
- **T-12-03-STOPFAIL** — Stop awaits the ended-publish and surfaces an error on failure (`subState:'error'`); the marker still degrades via staleness (data-layer P-3).
- **T-12-SC** `accept` holds — zero package installs (`applesauce-signers`, `nostr-tools`, `applesauce-react` all pre-existing).

No new production surface beyond the single hook file; no new network endpoint (the only network touch is the existing `updateBeacon`/`stopBeacon` → `publish`).

## Notes for Plan 04–05

- Plan 04 (BeaconControls) calls `const { isLive, startBeacon, stopBeacon } = useBeaconPublisher()`; pass `{ content:{ geometry:<Point>, label }, expiration, visibility:'public'|'link-only', identity:'anonymous'|'my-account' }` to `startBeacon`. The hook owns the watch + heartbeat; the panel only toggles.
- Plan 05 (banner) reads `subState`: `'searching'` (no fix yet / fix-unavailable), `'tracking'` (live fixes), `'permission-denied'` (Start disabled / consent copy), `'error'` (publish failure). The hook surfaces these honestly so the banner never claims "live" when the GPS is lost.
- The session secret is never exposed beyond `session.sk` (memory-only) — do NOT log or persist it.

## Self-Check: PASSED

`src/features/geo-editor/hooks/useBeaconPublisher.ts` exists on disk; the per-task commit `f70b3dc` is present in git history. The Plan-01 `useBeaconPublisher` test is GREEN (5/5); the 3 remaining suite failures are exclusively the Plan-05 `fetchBeaconOGData` seam; build + biome clean on the new file.
