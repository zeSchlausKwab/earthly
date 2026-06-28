---
phase: 12-live-beacon-37521
plan: 01
subsystem: live-beacon (kind 37521) — Nyquist Wave-0 RED baseline
tags: [nyquist, red-baseline, test-scaffolding, beacon, nip40, privacy]
dependency_graph:
  requires:
    - "Phase 8 LiveBeacon Factory+Cast scaffold (src/lib/nostr/live-beacon/{helpers,factory,cast,index}.ts)"
    - "src/lib/nostr/expiry.ts (isExpired/dropExpired, epoch seconds)"
    - "src/lib/nostr/kinds.ts (LIVE_BEACON_KIND = 37521)"
    - "src/lib/og/fetchEvent.ts (decodeNaddr — the OG read-path template)"
  provides:
    - "RED test contracts for Plan 02 (updateBeacon/stopBeacon lifecycle + visibility gating)"
    - "RED test contracts for Plan 03 (useBeaconPublisher throttle + throwaway key)"
    - "RED test contracts for Plan 04 (useBeacons + beaconState derivation)"
    - "RED test contracts for Plan 05 (fetchBeaconOGData naddr round-trip + expiry)"
    - "src/test/geolocationMock.ts — reusable watchPosition mock fixture (none existed before)"
  affects:
    - "Plans 02–05 must satisfy these fixed contracts to turn the baseline GREEN"
tech_stack:
  added: []
  patterns:
    - "Nyquist Wave-0 RED baseline (clone of 11-01 / 08-01)"
    - "mock.module('@/lib/nostr', …) to stub publish (clone of temporal-sighting.test.ts)"
    - "Controllable navigator.geolocation mock with emitFix/emitError"
    - "bun-relay-backed integration test that self-skips when no relay is reachable"
key_files:
  created:
    - src/test/geolocationMock.ts
    - src/lib/nostr/live-beacon/lifecycle.test.ts
    - src/lib/nostr/live-beacon/visibility.test.ts
    - src/lib/nostr/live-beacon/relay-echo.test.ts
    - src/lib/hooks/useBeacons.test.ts
    - src/features/geo-editor/hooks/useBeaconPublisher.test.ts
    - src/lib/og/fetchBeacon.test.ts
  modified: []
decisions:
  - "relay-echo.test.ts self-skips (early return + console.warn) when ws://localhost:3334 is unreachable, so CI without a relay still passes while the file documents + exercises the BEACON-02 latest-wins + dropExpired contract locally"
  - "fetchBeacon.test.ts mocks the raw relay fetch via mock.module('@/lib/og/relayFetch', …) — pins that Plan 05 should expose the WebSocket fetch helper at an importable seam (currently module-private in fetchEvent.ts); Plan 05 may instead inject the fetch differently, in which case this mock target is the only line to adjust"
  - "useBeacons.test.ts filter-before-cast case is a GREEN pin (uses the already-shipped isLiveBeacon guard) — intentional, it locks P-2 against a future regression even before beaconState lands"
metrics:
  duration: ~22min
  tasks: 2
  files: 7
  completed: 2026-06-28
---

# Phase 12 Plan 01: Live Beacon Nyquist Wave-0 RED Baseline Summary

Pinned every net-new and extended Live-Beacon (kind 37521) seam as a failing test contract before implementation: 6 new test files + 1 reusable `navigator.geolocation` mock fixture. The five unit RED files fail on the not-yet-existing Plan-02..05 symbols (`updateBeacon`/`stopBeacon`, `beaconState`/`selectVisibleBeacons`, `useBeaconPublisher` + `BEACON_*` constants, `fetchBeaconOGData`); the relay-echo integration file documents the BEACON-02 latest-wins + client-`dropExpired` honesty check against a local `bun relay`.

## What Was Built

**Task 1 — lifecycle + visibility + relay-echo + geolocation mock (commit `29b91de`)**
- `src/test/geolocationMock.ts` — installable controller replacing `navigator.geolocation` with `watchPosition`/`clearWatch`/`getCurrentPosition`; exposes `emitFix`/`emitError`/`clearWatchCount`/`wasCleared`/`activeWatchCount`/`lastOptions`/`uninstall` and the three error codes (`PERMISSION_DENIED`/`POSITION_UNAVAILABLE`/`TIMEOUT`). Success/error/options shape mirrors `src/components/ui/map.tsx:920-948`.
- `lifecycle.test.ts` — RED on `updateBeacon`/`stopBeacon`: a PUBLIC beacon derives `bbox`+`g` from `content.geometry` via turf AND emits `t:'live'`, keeps the NIP-40 `expiration`; round-trip `castEvent(signed, LiveBeacon).beacon.{status,geometry}`; heartbeat preserves the session `d` (no fork) and bumps `created_at`; `stopBeacon` ⇒ `status:'ended'`, same `d`, expiration retained (BEACON-01/02, D-04/D-09).
- `visibility.test.ts` — RED on the PUBLIC-vs-LINK-ONLY discovery gate: public emits `t:'live'`+`g`+`bbox` and matches `{kinds:[37521],'#t':['live']}`; link-only emits NEITHER marker NOR geo tags and does NOT match (BEACON-04, D-10, Pitfall P-6).
- `relay-echo.test.ts` — `bun relay` integration: two same-`d` events ⇒ relay serves exactly one (the newer, latest-wins); an expired beacon ⇒ client `dropExpired` hides it regardless of relay GC (BEACON-02, SPEC-05). Self-skips without a relay.

**Task 2 — useBeacons + useBeaconPublisher + fetchBeacon (commit `d8f891c`)**
- `useBeacons.test.ts` — RED on `beaconState`/`selectVisibleBeacons`/`BEACON_STALE_THRESHOLD_S`: precedence `removed>ended>stale>live`, a past-threshold `status:'live'` beacon resolves to `stale` (P-3), boundary inclusive at exactly 120s; GREEN pin on `isLiveBeacon` filter-before-cast (P-2) + `dropExpired` at a fixed `now` (P-1) (BEACON-03, D-07/D-08).
- `useBeaconPublisher.test.ts` — RED on `shouldPublishBeacon`/`createBeaconThrottle`/`startBeaconSession` + `BEACON_HEARTBEAT_MS`/`BEACON_DISTANCE_FLOOR_M`/`BEACON_STALE_FACTOR`/`BEACON_STALE_THRESHOLD_S`: throttle publishes only on `>= 25m` OR `>= 30s`, a coincident fix+interval publishes once (single guard, P-4); two Starts mint different pubkeys (D-05) and the session key is never written to `localStorage` (BEACON-01, D-01/D-02/D-05).
- `fetchBeacon.test.ts` — RED on `fetchBeaconOGData`: throwaway-pubkey naddr round-trip returns title/description; expired beacon ⇒ null; non-37521 naddr ⇒ null (BEACON-04, D-11).

## Verification

- `bun test` over the 5 unit RED files: **1 pass / 17 fail across 5 files** — every failure attributable to a missing Plan-02..05 symbol (`Cannot find module` / `is not a function` / cast throw), none on syntax/import-typo errors.
- `relay-echo.test.ts` runs standalone and self-skips cleanly (2 pass via the no-relay early return).
- `bunx biome check` clean on all 7 files.
- No production source modified; no production file imports the not-yet-existing seams ⇒ `bun run build` unaffected.

## Pitfall Invariants Pinned

| Pitfall | Pinned by |
|---------|-----------|
| P-1 epoch-seconds clock | every clock assertion uses an explicit `NOW`/epoch-seconds; heartbeat is the only ms value (T-12-01-CLOCK) |
| P-2 filter-before-cast | `useBeacons.test.ts` GREEN pin: `isLiveBeacon` excludes a legacy 37521 before any cast |
| P-3 frozen-as-live-is-stale | `useBeacons.test.ts`: past-threshold `status:'live'` ⇒ `stale` |
| P-4 single-guard throttle | `useBeaconPublisher.test.ts`: coincident fix+interval ⇒ one publish |
| P-6 link-only-not-discoverable | `visibility.test.ts`: link-only omits `t:'live'`+geo, no discovery match (T-12-01-LINKONLY) |

## Deviations from Plan

None — plan executed exactly as written. (Biome auto-formatted line-wrapping in `useBeaconPublisher.test.ts` after creation; cosmetic only, no semantic change.)

## Threat Surface

No new production surface. All 7 files are test-only (`*.test.ts` + `src/test/geolocationMock.ts`); the sole network touch is `relay-echo.test.ts` against a LOCAL `bun relay`. Matches the plan threat model (T-12-01-CLOCK + T-12-01-LINKONLY both `mitigate`d by the assertions above; T-12-SC `accept` — zero package installs).

## Notes for Plan 02–05

- Plan 02 implements `updateBeacon(options, signer)` / `stopBeacon(existing, signer)` in `src/lib/nostr/live-beacon/lifecycle.ts` (clone `temporal-sighting/lifecycle.ts`); `options` carries `{ content, expiration, visibility: 'public'|'link-only', existing? }`. Reconcile the `LiveBeaconContent` scaffold: replace `position?: [number,number]` with `geometry?: Point` + `status?: 'live'|'ended'` (per 12-RESEARCH), and add `beacon`/`geometry`/`status` getters to the cast.
- Plan 03 implements `useBeaconPublisher` + the named `BEACON_*` constants + the pure `shouldPublishBeacon(last, next, heartbeatMs)`, `createBeaconThrottle(onPublish)`, and `startBeaconSession()` (fresh `PrivateKeySigner`, never persisted).
- Plan 04 implements `useBeacons()` + the `beaconState(cast, now)` derivation + a `selectVisibleBeacons(events, now)` pure read-path selector; `BEACON_STALE_THRESHOLD_S` must be re-exported (or imported) from where `useBeacons` lives.
- Plan 05 implements `fetchBeaconOGData(naddr, relayUrl)`. The test mocks `@/lib/og/relayFetch#fetchEventFromRelay` — extract the currently-private WebSocket fetch helper to that seam, or adjust the single mock target if Plan 05 injects the fetch differently.

## Self-Check: PASSED

All 7 created files exist on disk; both per-task commits (`29b91de`, `d8f891c`) are present in git history. RED gate holds (17 fail on missing Plan-02..05 seams + 1 GREEN filter-before-cast pin); biome clean on all 7 files; no production source modified.
