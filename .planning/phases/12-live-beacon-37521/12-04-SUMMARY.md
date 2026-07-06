---
phase: 12-live-beacon-37521
plan: 04
subsystem: live-beacon (kind 37521) — live-map render layer + Beacons browse rail + seed fixtures
tags: [beacon, map-marker, beaconState, browse-rail, AppSidebar, seed, staleness, privacy]
dependency_graph:
  requires:
    - "12-02 data layer: beaconState/BEACON_STALE_THRESHOLD_S + useBeacons (#t:['live'] filter-before-cast + dropExpired + 15s tick) + LiveBeacon cast (.status/.geometry/.beacon.label)"
    - "12-01 seam-name flags: BEACON_STALE_THRESHOLD_S exported from where useBeacons lives"
    - "useMapLayers Sighting source/layer block (clone template) + the #fdc700/#737373 hex constants"
    - "SightingsPanelContent (clone template) + AppSidebar sightings rail/render spine"
  provides:
    - "BEACON_SOURCE_ID + BEACON_HIT_LAYER (exported) + BEACON_CIRCLE_LAYER/BEACON_GLYPH_LAYER + buildBeaconSource for the live map render (Plan 05 interactions bind on BEACON_HIT_LAYER)"
    - "useMapLayers visibleBeacons option (LiveBeacon[]) — GeoEditorView feeds useBeacons casts here (Plan 05)"
    - "BeaconsPanelContent + BeaconsPanelProps browse panel (the D-12 index/control home) for Plan 05 to thread its controller handlers into"
    - "'beacons' WorkViewMode + Radio rail destination + beaconsPanelProps + renderWorkContent case in AppSidebar"
    - "Updated 37521 seed fixtures: geometry/status shape covering live/stale/ended/expired + a link-only fixture for discovery-gating UAT"
  affects:
    - "Plan 05 wires the beacon controller (onShareLocation/onOpenBeacon/onWatchOnMap/onStopBeacon/onAdjustBeacon) + feeds visibleBeacons + binds BEACON_HIT_LAYER interactions"
tech_stack:
  added: []
  patterns:
    - "near-verbatim Sighting map-marker clone (separate source/layer pair, dropExpired-before-source, data-driven state paint)"
    - "freshest-per-{pubkey,d} latest-wins de-dup with id-lexicographic tie-break (no clock-skew seq tag)"
    - "SightingsPanelContent → BeaconsPanelContent kind-substituted browse clone over useBeacons"
    - "safe ?? (() => {}) no-op defaults so the rail builds standalone before the Plan-05 controller lands"
key_files:
  created:
    - src/components/BeaconsPanel.tsx
  modified:
    - src/features/geo-editor/hooks/useMapLayers.ts
    - src/components/AppSidebar.tsx
    - scripts/seed-entities.ts
decisions:
  - "beacon glyph = '((•))' broadcast/radio motif for live/stale, '■' stop glyph for ended — distinct from the Sighting '◉' observation eye (UI-SPEC §5)"
  - "ended marker = hollow (transparent fill via rgba(0,0,0,0) + #737373 outline ring); stale = #737373 at 70% opacity, no ring; live = solid #fdc700 + 3px accent ring"
  - "own-active-beacon pin = partition displayed casts into ownBeacons (currentUserPubkey match) rendered first + otherBeacons; own+live row gets an accent ring; inline Stop sharing + Adjust gated on isOwner AND the handler being present"
  - "seed 'stale' fixture = status:'live' with created_at backdated 300s (past the 120s BEACON_STALE_THRESHOLD_S) via the applesauce EventFactory .created() setter — proves the frozen-as-live→stale honesty (P-3) without waiting; 'expired' fixture = expiration now()-60; link-only fixture = NO geohash/hashtags/bbox (no t:'live')"
metrics:
  duration: ~18min
  tasks: 2
  files: 4
  completed: 2026-06-28
---

# Phase 12 Plan 04: Live Beacon Map Render + Beacons Browse Rail Summary

Shipped the visible half of the milestone's one net-new live-render subsystem: a distinct Live Beacon (kind 37521) map marker riding `useMapLayers` with a data-driven `beaconState` paint (live accent / stale grey-70% / ended hollow), `dropExpired`-before-source-build, and a freshest-per-`{pubkey,d}` pick with an id-lexicographic tie-break — re-derived on the `useBeacons` 15s tick so staleness flips and expiry-removal happen live. Plus the D-12 Beacons browse rail: `BeaconsPanelContent` cloned from `SightingsPanelContent` over `useBeacons`, a `beacons` rail destination (Radio icon) + render case in `AppSidebar`, and updated seed fixtures covering all four marker states + a link-only beacon for discovery-gating UAT.

## What Was Built

**Task 1 — beacon map source/layer pair + beaconState paint (commit `6594e76`)**
- `useMapLayers.ts` — added `BEACON_SOURCE_ID`, the exported `BEACON_HIT_LAYER` (for Plan-05 interactions), `BEACON_CIRCLE_LAYER`, `BEACON_GLYPH_LAYER`, and the `#fdc700`/`#737373` hex constants (mirroring the Sighting layer).
- `buildBeaconSource(beacons)` — clones the Sighting source builder: FIRST `dropExpired` against `unixNow()` (per-read-path P-1, defensive even though `useBeacons` already drops), THEN pick the freshest cast per `{pubkey,d}` by `created_at` with the greater `event.id` lexicographically as the tie-break (the research § "seq tag" deterministic latest-wins de-dup), THEN map each surviving cast to a point feature carrying `beaconState: 'live'|'stale'|'ended'` via `beaconState(cast, now)` (a `'removed'` cast is excluded). Representative point = `content.geometry` (precise Point) else the lossy `bbox` centroid; geometry-less beacons are skipped, never crash the layer. Each feature carries an offset `lastSeenLabel` ("last seen Nm ago" / "ended Nm ago").
- Paint is data-driven on `beaconState`: live ⇒ solid `#fdc700` full opacity + 3px accent ring; stale ⇒ `#737373` at 70% opacity, no ring; ended ⇒ hollow (transparent fill + `#737373` outline ring + `■` stop glyph). Live/stale carry the `((•))` broadcast glyph distinct from the Sighting `◉` eye. An invisible 22px (≥44px) hit layer for touch.
- New `visibleBeacons?: LiveBeacon[]` option + a source-update effect keyed on `[visibleBeacons, …]` so the source rebuilds on every tick; `BEACON_SOURCE_ID`/`BEACON_HIT_LAYER`/`BEACON_CIRCLE_LAYER` added to the hook return.

**Task 2 — BeaconsPanel + rail destination + seed fixtures (commit `51b121e`)**
- `BeaconsPanel.tsx` (new) — `BeaconsPanelContent` cloned from `SightingsPanelContent`: subscribes via `useBeacons()` (the `#t:['live']` discovery surface — link-only never matched, P-6), runs casts through `useFilterState` + `useSortedFilteredItems` + `EntitySearchToolbar`, renders `rounded-none` Card rows with a live/stale/ended status chip (from `beaconState`), the honest last-seen age + the NIP-40 countdown (`formatExpiryCountdown`), and a "Watch on map" action (row is the click target). The user's own active beacon(s) partition to the TOP (`ownBeacons` first) as an accent-ringed-when-live card with inline "Stop sharing" (destructive-toned) + "Adjust". Accent "Share live location" CTA at the panel top + in the empty state. UI-SPEC copy ("No live beacons" / the body / "No beacons match"). `BeaconsPanelProps` mirrors `SightingsPanelProps` (currentUserPubkey, onShareLocation, onOpenBeacon, onWatchOnMap, onStopBeacon, onAdjustBeacon, selectedKey). All text auto-escaped — zero `dangerouslySetInnerHTML`.
- `AppSidebar.tsx` — `'beacons'` added to the `WorkViewMode` union + `WORK_VIEW_MODES` + a `{ mode:'beacons', title:'Beacons', icon: Radio }` `workNavItems` row (Radio imported from lucide-react); a `beaconsPanelProps` object (beacon handlers threaded as new optional AppSidebar props with safe `?? (() => {})` defaults — Plan-05 controller fills them); a `case 'beacons': return <BeaconsPanelContent {...beaconsPanelProps} />`. The pre-existing `selectedSightingKey` sighting-highlight wiring was left untouched.
- `scripts/seed-entities.ts` — rewrote the 37521 fixture block to the new content shape: `geometry: { type:'Point', coordinates: pos }` + `status`, with `bbox`/`g`/`hashtags(['live'])` derived from the point. Now seeds all four marker states — live (×2), **stale** (status:'live' with `created_at` backdated 300s past the 120s threshold via `.created()`), **ended** (status:'ended'), **expired** (expiration `now()-60`) — PLUS a **link-only** beacon (no geohash/hashtags/bbox → no `t:'live'`) that must stay off the discovery surface.

## Verification

- `bun run build` — green (client + server + 5 workers); `grep -iE 'error|fail'` ⇒ BUILD-OK. The shipped Sighting/dataset map layers + panels are unchanged.
- `bunx biome check` — clean on `BeaconsPanel.tsx` + `AppSidebar.tsx` (the two lintable files; `scripts/` is biome-ignored by config). One biome auto-format applied to `useMapLayers.ts` (collapsed a wrapped `if`; cosmetic).
- `bun build scripts/seed-entities.ts` — bundles cleanly (711 modules), so the updated fixtures compile (caught the `.createdAt`→`.created` setter-name fix).
- `bun test src/lib/hooks/useBeacons.test.ts src/lib/nostr/live-beacon/` — 16 pass / 0 fail (data-layer contract unaffected).
- `bun test` full suite — **752 pass / 3 fail**. The 3 failures are EXCLUSIVELY Plan-05's still-RED `fetchBeaconOGData` (round-trip / expiry-null / kind-gate) — confirmed by name. No regression to any shipped surface; the wave-context expectation (only Plan-05's fetchBeacon stays RED) holds.
- grep confirms: AppSidebar has a `'beacons'` WorkViewMode + `case 'beacons'` render case + the Radio row; BeaconsPanel imports + calls `useBeacons` and `beaconState`; seed beacon block uses `geometry`/`status` + the ended + link-only fixtures.

## Pitfall / Threat Coverage

| Threat / Pitfall | Where |
|------------------|-------|
| T-12-04-FROZEN (stale painted as live) | `buildBeaconSource` paints data-driven on `beaconState(cast, now)`; the source rebuilds on the 15s tick so past-threshold status:'live' greys to STALE without a new event |
| T-12-04-EXPIRED (expired still rendered) | `dropExpired` at the source builder (per-read-path) AND in `useBeacons`; the tick re-derives so removal happens without a new event |
| T-12-04-LINKLEAK (link-only in list/map) | `BeaconsPanel` + the map source read the `#t:['live']` surface; the seed link-only fixture (no `t:'live'`) proves it stays off the list |
| T-12-04-XSS (label XSS) | label/title render as auto-escaped React text nodes; zero `dangerouslySetInnerHTML` |
| T-12-SC (installs) | zero package installs — lucide-react (Radio), MapLibre, applesauce all pre-existing |
| D-07/D-08 (state precedence + derived threshold) | reuses Plan-02 `beaconState` (removed>ended>stale>live) + `BEACON_STALE_THRESHOLD_S` (derived); no redefinition |

## Deviations from Plan

None — plan executed exactly as written. Two contract-driven shaping notes (not deviations): (1) the seed backdate uses the applesauce `EventFactory.created()` setter (not a non-existent `createdAt`) to age the stale fixture; (2) `scripts/` is biome-ignored by the project config, so the seed file's clean-CLI criterion is satisfied by it not being a lint target — its compile was instead verified via `bun build`. One cosmetic biome auto-format on `useMapLayers.ts`.

## Known Stubs

The Beacons rail panel renders fully and reads live data via `useBeacons`. The beacon control handlers (`onShareLocation`, `onOpenBeacon`, `onWatchOnMap`, `onStopBeacon`, `onAdjustBeacon`) default to no-ops in `AppSidebar` (`?? (() => {})`) because the Start/Stop/Adjust controller + the `visibleBeacons` feed + the `BEACON_HIT_LAYER` map interactions are Plan-05 scope (explicitly deferred by this plan's objective). This is intentional and documented: the rail + marker layer are observably correct (live data, all four states), and Plan 05 wires the control flow. Not a goal-blocking stub for Plan 04.

## Notes for Plan 05

- Feed the live map marker: pass the `useBeacons()` casts as `useMapLayers({ visibleBeacons })` from `GeoEditorView` (mirror `visibleSightings`).
- Bind marker interactions on the exported `BEACON_HIT_LAYER` (open + locate-in-list), mirroring `SIGHTING_HIT_LAYER`.
- Thread the controller handlers into `AppSidebar` (`onShareLocation`/`onOpenBeacon`/`onWatchOnMapBeacon`/`onStopBeacon`/`onAdjustBeacon` + `selectedBeaconKey`) — they already flow into `beaconsPanelProps`.
- The seed fixtures already exercise all four states + link-only; use them for the Plan-05 end-of-phase UAT (live accent dot, greyed stale, hollow ended, gone expired, link-only absent from the list/map but reachable by /beacon/:naddr).

## Self-Check: PASSED

`src/components/BeaconsPanel.tsx` exists on disk; both per-task commits (`6594e76`, `51b121e`) are present in git history. Build green; biome clean on the two lintable touched files; seed compiles. Beacon data-layer tests 16/0; full suite 752/3 with the 3 fails exclusively Plan-05's fetchBeacon (no regression).
