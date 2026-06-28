---
phase: 12-live-beacon-37521
plan: 02
subsystem: live-beacon (kind 37521) — data layer (content shape + lifecycle + beaconState + useBeacons)
tags: [beacon, nip40, lifecycle, visibility, staleness, privacy, configured-routing]
dependency_graph:
  requires:
    - "12-01 Nyquist Wave-0 RED baseline (lifecycle/visibility/useBeacons test contracts)"
    - "Phase 8 LiveBeacon Factory+Cast scaffold (src/lib/nostr/live-beacon/{helpers,factory,cast,index}.ts)"
    - "src/lib/nostr/expiry.ts (isExpired/dropExpired, epoch seconds)"
    - "src/lib/nostr/store.ts (eventStore — store-free castEvent stamping)"
    - "temporal-sighting/lifecycle.ts + useSightings.ts (clone templates)"
  provides:
    - "updateBeacon/stopBeacon lifecycle service (the single source-of-truth publish path) for Plan 03 (useBeaconPublisher) + Plan 04 (control panel)"
    - "LiveBeaconContent.geometry (Point) + .status ('live'|'ended') content shape for Plans 03–05"
    - "LiveBeacon.status + .geometry cast getters"
    - "beaconState(beacon, now) + BEACON_* cadence constants for Plan 04 (map marker paint) + Plan 03 (throttle heartbeat)"
    - "useBeacons() + selectVisibleBeacons() read seam for Plan 04 (BeaconsPanel + map layer)"
  affects:
    - "Plan 03 consumes updateBeacon + BEACON_HEARTBEAT_MS/BEACON_DISTANCE_FLOOR_M for the throttled publish loop"
    - "Plan 04 consumes useBeacons + beaconState for the live-map marker + BeaconsPanel"
tech_stack:
  added: []
  patterns:
    - "near-verbatim Phase-11 Sighting clone (kind + visibility branch + routing flag substituted)"
    - "filter-before-cast + dropExpired pure read-path selector (selectVisibleBeacons)"
    - "cadence constant derived from heartbeat (BEACON_STALE_THRESHOLD_S = heartbeat/1000 × factor)"
    - "attachStore (EventStoreSymbol) for store-free castEvent on the freshly-signed event"
key_files:
  created:
    - src/lib/nostr/live-beacon/lifecycle.ts
    - src/lib/nostr/live-beacon/beaconState.ts
    - src/lib/hooks/useBeacons.ts
  modified:
    - src/lib/nostr/live-beacon/helpers.ts
    - src/lib/nostr/live-beacon/cast.ts
    - src/lib/nostr/live-beacon/index.ts
decisions:
  - "updateBeacon options carry `existing?: NostrEvent` (the test's modify-path threading) rather than a bare `dTag` string — matches lifecycle.test.ts which passes `existing: first` to preserve the session d on heartbeat"
  - "stopBeacon(existingEvent, signer) takes the event directly (not options) per the test contract; it re-derives visibility from the existing event's t:'live' presence so a public beacon ends public and a link-only beacon ends link-only, and pulls the retained expiration via getExpirationTimestamp(existingEvent)"
  - "beaconState accepts EITHER a LiveBeacon cast OR a raw NostrEvent (`'rawEvent' in beacon` discriminant) — useBeacons.test.ts calls beaconState(rawEvent, now) directly while Plan 04's map layer will pass a cast"
  - "beaconState + BEACON_* constants live in src/lib/nostr/live-beacon/beaconState.ts (data layer) and are RE-EXPORTED from src/lib/hooks/useBeacons.ts so the 12-01 test contract (import from @/lib/hooks/useBeacons) is satisfied and Plan 04 can import from either the hook or the barrel"
metrics:
  duration: ~12min
  tasks: 2
  files: 6
  completed: 2026-06-28
---

# Phase 12 Plan 02: Live Beacon Data Layer Summary

Built the kind-37521 beacon data layer that Plans 03–05 consume: extended the content shape (a GeoJSON `Point` geometry + a `status:'live'|'ended'` discriminator defaulting to `live`), shipped the `updateBeacon`/`stopBeacon` lifecycle service (the single source-of-truth publish path with the D-10 public/link-only visibility branch and the `{ routing:'configured' }` divergence), the `beaconState` derivation (live/stale/ended/removed off `created_at` + NIP-40 expiry), and the `useBeacons` reactive subscription (filter-before-cast + `dropExpired` + a 15s expiry tick + the `#t:['live']` discovery filter). Turned the Plan-01 lifecycle/visibility/useBeacons RED tests GREEN.

## What Was Built

**Task 1 — content shape + cast getters + lifecycle service (commit `43a4a3c`)**
- `helpers.ts` — replaced the `position?: [number, number]` placeholder with `geometry?: Point` (mirrors `TemporalSightingContent`) and added `status?: 'live' | 'ended'`; set `DEFAULT_LIVE_BEACON_CONTENT = { status: 'live' }`. The defensive `getLiveBeaconContent` body is unchanged (it merges over DEFAULT, so a geometry-less / legacy beacon yields `status:'live'` + `geometry:undefined` and never throws).
- `cast.ts` — added `get status(): 'live' | 'ended'` (defaults `'live'`) and `get geometry()` mirroring the existing `beacon`/`expiresAt` getters.
- `lifecycle.ts` (new) — cloned `temporal-sighting/lifecycle.ts`: `deriveBbox`/`deriveCentroid` (turf, try/catch→undefined) + `attachStore` (the `eventStore`-direct import) verbatim. `updateBeacon(options, signer)` publishes via `LiveBeaconFactory.create|modify(...).beacon(content).bbox(isPublic?…).geohash(isPublic?…).hashtags(isPublic?['live']:[]).expiration(expiration).sign(signer)` then `await publish(signed, { routing: 'configured' })`. The `isPublic = visibility === 'public'` branch omits `t:'live'` + `g` + `bbox` for link-only (P-6). `stopBeacon(existingEvent, signer)` publishes one final `status:'ended'` event keeping the same `d` + the retained NIP-40 expiration (D-04).
- `index.ts` — exported `./lifecycle`.

**Task 2 — beaconState + cadence constants + useBeacons (commit `53f8908`)**
- `beaconState.ts` (new) — named, derived constants (`BEACON_HEARTBEAT_MS = 30_000`, `BEACON_DISTANCE_FLOOR_M = 25`, `BEACON_STALE_FACTOR = 4`, `BEACON_STALE_THRESHOLD_S = (BEACON_HEARTBEAT_MS / 1000) * BEACON_STALE_FACTOR` = 120, NOT a literal) and `beaconState(beacon, now)` with precedence `removed > ended > stale > live` — a past-threshold `status:'live'` beacon resolves to `stale` (P-3). Epoch-seconds only; `isExpired` from `expiry.ts`; no `Date.now()`.
- `useBeacons.ts` (new) — cloned `useSightings.ts`: `EXPIRY_TICK_MS = 15_000`, the `useExpiryClock` body, the filter defaulting to `[{ '#t': ['live'] }]`, each mapped to `{ ...f, kinds: [LIVE_BEACON_KIND] }`. `selectVisibleBeacons(events, now)` is the pure read-path selector (`dropExpired(events.filter(isLiveBeacon), now).map(castEvent(.., LiveBeacon, eventStore))`); the `useMemo` calls it with the ticking `now`. Re-exports `beaconState` + the `BEACON_*` constants from the live-beacon barrel.
- `index.ts` — exported `./beaconState`.

## Verification

- `bun test src/lib/nostr/live-beacon/lifecycle.test.ts src/lib/nostr/live-beacon/visibility.test.ts` — **6 pass / 0 fail** (Task 1 contract GREEN).
- `bun test src/lib/hooks/useBeacons.test.ts` — **4 pass / 0 fail** including the past-threshold-status-live → `stale` (P-3), the inclusive boundary at exactly 120s, the filter-before-cast (P-2), and the `selectVisibleBeacons` dropExpired (P-1) cases.
- `bun test` full suite — **747 pass / 8 fail**. All 8 failures are the still-RED seams owned by LATER plans, not regressions: 5× `useBeaconPublisher` (Plan 03 — `Cannot find module …/useBeaconPublisher`) + 3× `fetchBeaconOGData` (Plan 05). The `relay-echo.test.ts` self-skipped (no local relay). No shipped Sighting/Story/Group data layer regressed.
- `bunx biome check` clean on all 6 touched files (one auto-format applied to `beaconState.ts` — collapsed a wrapped ternary; cosmetic).
- `bun run build` green (client + server + 5 workers).

## Pitfall / Invariant Coverage

| Invariant | Where |
|-----------|-------|
| P-1 epoch-seconds clock | `beaconState` + `useBeacons` compare against the passed/ticked `now`; the only ms value is `EXPIRY_TICK_MS` |
| P-2 filter-before-cast | `selectVisibleBeacons` runs `events.filter(isLiveBeacon)` before `castEvent` |
| P-3 frozen-as-live-is-stale | `beaconState`: `now - created_at >= BEACON_STALE_THRESHOLD_S` returns `stale` regardless of `status` |
| P-6 link-only-not-discoverable | `updateBeacon` omits `t:'live'` + `g` + `bbox` for `visibility:'link-only'` |
| D-04 ended keeps expiration | `stopBeacon` reuses `getExpirationTimestamp(existing)` + same `d` |
| D-05 configured routing | `publish(signed, { routing: 'configured' })` — no `routing:'outbox'` (grep-confirmed) |
| D-08 derived threshold | `BEACON_STALE_THRESHOLD_S = (BEACON_HEARTBEAT_MS / 1000) * BEACON_STALE_FACTOR`, not a magic 120 |

## Deviations from Plan

None — plan executed exactly as written. Two contract-driven shaping notes (both anticipated by the test contracts, not deviations): `updateBeacon` takes `existing?: NostrEvent` (the test's modify-path threading) and `stopBeacon(existingEvent, signer)` takes the event directly; `beaconState` accepts a cast OR a raw event (the test calls it with raw events while Plan 04's map layer will pass a cast). One cosmetic biome auto-format on `beaconState.ts`.

## Threat Surface

All four `mitigate`-disposition threats from the plan threat model are satisfied: T-12-02-FORGED (filter-before-cast in `selectVisibleBeacons`), T-12-02-EXPIRED (`dropExpired` at the read path + 15s tick), T-12-02-FROZEN (`beaconState` stale-regardless-of-status), T-12-02-LINKONLY (lifecycle omits `t:'live'`+geo for link-only), T-12-02-CLOCK (epoch-seconds only). T-12-SC `accept` holds — zero package installs (`@turf/turf`, `applesauce-core`, `geojson` all pre-existing). No new production surface beyond the planned 6 files; no new network endpoints (the lifecycle's sole network touch is the existing `publish`).

## Notes for Plan 03–05

- Plan 03 (`useBeaconPublisher`) imports `updateBeacon` + `BEACON_HEARTBEAT_MS`/`BEACON_DISTANCE_FLOOR_M` from here; the throttle's heartbeat publishes go through `updateBeacon({ existing, content:{geometry,status:'live'}, expiration, visibility }, sessionSigner)` to preserve the session `d`. The final Stop calls `stopBeacon(lastEvent, sessionSigner)`.
- Plan 04 (map marker + BeaconsPanel) imports `useBeacons` + `beaconState` from `@/lib/hooks/useBeacons` (or `beaconState` from the `@/lib/nostr/live-beacon` barrel); pass each `cast.rawEvent()` (or the cast) to `beaconState(beacon, unixNow())` for the data-driven paint.
- `selectVisibleBeacons(events, now)` is exported as the pure read-path selector for any non-hook read path (e.g. an OG fetch) that needs the same filter-before-cast + dropExpired ordering.

## Self-Check: PASSED

All 3 created files (`lifecycle.ts`, `beaconState.ts`, `useBeacons.ts`) + 3 modified files exist on disk; both per-task commits (`43a4a3c`, `53f8908`) are present in git history. Plan-01 lifecycle/visibility/useBeacons tests GREEN (10/10 across the 3 files); the 8 remaining suite failures are exclusively Plan-03/05-owned seams; build + biome clean on all 6 files.
