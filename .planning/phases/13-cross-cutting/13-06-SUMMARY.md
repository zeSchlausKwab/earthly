---
phase: 13-cross-cutting
plan: 06
subsystem: map-stack
tags: [gap-closure, map-stack, live-beacon, temporal-sighting, privacy, UAT-5b]
gap_closure: true
requires:
  - "13-03 deriveVisibleEntitiesFromStack render gate (individualLookupSet seam)"
  - "13-04 expiry-sweep effect + add-to-map-stack handlers"
provides:
  - "addedBeaconCacheRef / addedSightingCacheRef — per-entry resolved-entity cache keyed by stack entityKey"
  - "shouldSweepStackEntry(status) — pure sweep-decision predicate (unit-testable)"
  - "sightingLookupSuperset / addedBeaconLookupSuperset — widened individual-lookup sets (discovery ∪ routed ∪ cached-added)"
affects:
  - "src/features/geo-editor/GeoEditorView.tsx (add handlers, selector memos, expiry-sweep effect)"
tech-stack:
  added: []
  patterns:
    - "resolved-entity cache (useRef<Map> + version tick) to keep an explicitly-added out-of-subscription entity resolvable without touching discovery"
    - "extract-pure-predicate (shouldSweepStackEntry) to make an in-effect decision unit-testable"
key-files:
  created: []
  modified:
    - "src/features/geo-editor/GeoEditorView.tsx"
    - "src/features/geo-editor/GeoEditorView.stackLayers.test.ts"
decisions:
  - "Widen the individual-lookup INPUT to the existing helper (unchanged signature + body) rather than change deriveVisibleEntitiesFromStack — the aggregate branch keeps seeding ONLY from subscriptionSet, so the privacy invariant is preserved structurally."
  - "Chose UAT missing-options a+c+d (cache + sweep-guard + honest toast); deliberately did NOT take option b (targeted subscription for the added beacon) — zero new network surface, the object is already in hand at add time."
  - "STALE (beaconState 120s) is explicitly NOT treated as expiry; the sweep evicts only on NIP-40 isExpired (or true unresolvability)."
metrics:
  duration: ~18min
  tasks: 2
  files: 2
  completed: 2026-07-03
---

# Phase 13 Plan 06: Add-to-Stack Phantom-Entry Fix Summary

Killed the UAT test-5b phantom: adding a stale/own/link-only (out-of-discovery) beacon or sighting to the Map Stack now actually resolves + renders it (marker on the map AND a Map Stack panel row), with the success toast gated on resolvability — while the aggregate discovery layer stays discovery-only (no GPS/privacy leak).

## What Was Built

**Task 1 — keep an explicitly-added out-of-discovery entity resolvable + rendered.**
Added a per-entry resolved-entity cache: `addedBeaconCacheRef` (`useRef<Map<string, LiveBeacon>>`) and `addedSightingCacheRef` (`useRef<Map<string, TemporalSighting>>`), plus an `addedCacheTick` state counter that bumps on every deposit so the selector memos re-derive against the fresh cache. `addBeaconToMapStack`/`addSightingToMapStack` deposit the resolved entity into the cache under the SAME `entityKey` (`encode*NaddrPure(entity) ?? dTag ?? id`) BEFORE calling `addMapStackEntry`. The beacon individual-lookup memo now unions the cache on top of `beaconLookupSuperset` (→ `addedBeaconLookupSuperset` = `(beacons ∪ routedBeacons) ∪ cached-added`), and the sighting selector gets an explicit `sightingLookupSuperset` (= `sightings ∪ cached-added`); both are passed as `deriveVisibleEntitiesFromStack`'s `individualLookupSet`. The helper signature + body are unchanged — the aggregate `beacon-layer`/`sighting-layer` branch still seeds ONLY from `subscriptionSet` (discovery).

**Task 2 — stop evicting not-yet-expired user-added entries + honest toast.**
Extracted a pure `shouldSweepStackEntry({ resolved, expired }) => !resolved || expired` at module scope. The expiry-sweep effect now builds its per-kind lookup maps from the SAME widened cache-inclusive sets, so a faded-from-live-but-not-expired user-added entry resolves in the sweep and is judged on NIP-40 expiry ALONE (D-02 honesty preserved: genuinely expired entities are still evicted; the cache key is pruned on eviction). The add handlers now only `toast.success(...)` when the entity has a keyable identity, else emit an honest `toast.error("Couldn't add this …")` with no phantom entry.

## Deviations from Plan

None — plan executed as written. (The two tasks were committed together as one atomic `fix` commit because their edits interleave in the same file hunks and share the widened-lookup + cache seam; TDD RED→GREEN was preserved — the failing `shouldSweepStackEntry` import gated the RED state before implementation.)

## Privacy Invariant (T-13-06-01 / T-13-03-GPSREGRESS / D-05)

Preserved structurally. An added out-of-discovery beacon renders ONLY via its individual stack entry (resolved from the client-local cache fed to `individualLookupSet`); it is never tagged into `#t:['live']`, `useBeacons`'s discovery filter is untouched, and the aggregate-layer branch of the helper only ever iterates `subscriptionSet`. New test proves: with ONLY a `beacon-layer` aggregate entry present, the out-of-discovery entity is NOT returned (no leak).

## Verification

- `bun test src/features/geo-editor/GeoEditorView.stackLayers.test.ts` → 16 pass / 0 fail (9 existing green + 7 new: out-of-discovery individual resolves via widened superset; unions with a discovery pin; NO aggregate leak; isolation-solo; `shouldSweepStackEntry` keep-not-expired / evict-expired / evict-unresolvable).
- `git diff --stat src/features/geo-editor/hooks/useMapLayers.ts` → EMPTY (shared render seam byte-for-byte unchanged).
- `bun run build` → succeeds (client + server + 5 workers).
- `bunx biome check src/features/geo-editor/GeoEditorView.tsx` → clean.
- `grep -c "BEACON_STALE_THRESHOLD_S\|beaconState"` → 1 (pre-existing, not increased for the sweep — STALE not conflated with expiry).
- Full suite: 775 pass / 2 fail + 1 error = the SAME pre-existing `storyProposal.test.ts` full-suite ordering flake (confirmed 6/0 in isolation), NOT a regression from this plan.

## Threat Flags

None — no new network endpoint, subscription, auth path, or schema surface. Option (b) targeted-subscription deliberately not taken (zero new network surface). No new packages.

## Self-Check: PASSED
