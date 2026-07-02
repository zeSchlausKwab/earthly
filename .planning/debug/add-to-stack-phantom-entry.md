---
status: investigating
trigger: "Phase 13 UAT Test 5b — Add to map stack for a STALE beacon shows success toast but the beacon never renders and the Map Stack panel stays 0/0 (phantom entry). find_root_cause_only."
created: 2026-07-02
updated: 2026-07-02
---

## Current Focus

hypothesis: The Plan-04 expiry-sweep effect immediately calls removeMapStackEntry on the just-added STALE beacon because a stale beacon has left the #t:['live'] discovery set and is not in routedBeacons, so it is unresolvable in beaconLookupSuperset — the entry is added (toast fires) then removed on the next render tick (phantom). A reinforcing render-side failure: deriveVisibleEntitiesFromStack also can't resolve the stale beacon against beaconLookupSuperset, so it wouldn't render even if it survived.
test: Read addBeaconToMapStack, the expiry-sweep effect, beaconLookupSuperset construction, and deriveVisibleEntitiesFromStack in GeoEditorView.tsx. Determine (a) whether toast fires unconditionally, (b) whether the sweep removes not-yet-expired stale entries, (c) whether the render gate can resolve stale beacons.
expecting: If sweep dep + resolution logic remove any entry absent from beaconLookupSuperset regardless of isExpired, that confirms sweep-removal. If render gate also resolves against beaconLookupSuperset only, that confirms the reinforcing render failure.
next_action: Read GeoEditorView.tsx — addBeaconToMapStack (~L578/598), beaconLookupSuperset memo, expiry-sweep effect after visibleBeaconsFromStack, deriveVisibleEntitiesFromStack, and how STALE vs isExpired are computed for beacons.

## Symptoms

expected: Clicking "Add to map stack" on a STALE beacon's INSPECT panel should add a visible Map Stack entry AND render the beacon marker on the map (matching the success toast "Added beacon to the map").
actual: Toast "Added beacon to the map" shows, but the beacon does NOT render and the Map Stack panel shows "0/0 visible / No map stack entries" — the entry is a phantom (never persists in the store stack, never renders).
errors: none (no error, silent phantom)
reproduction: Phase 13 UAT Test 5b. User is sharing their own LIVE location (separate LIVE beacon). Open beacons list, inspect a DIFFERENT beacon that is STALE ("STALE · last seen 2m ago · Fades soon"), click "Add to map stack" on its INSPECT panel.
started: Surfaced 2026-07-02 during Phase 13 UAT re-test after dev-server restart (genuine code bug, not stale HMR).

## Eliminated

- hypothesis: A STALE beacon has left the #t:['live'] discovery `beacons` set, so beaconLookupSuperset can't resolve it and the sweep removes it on staleness grounds.
  evidence: beaconState (src/lib/nostr/live-beacon/beaconState.ts:51-58) derives STALE purely from `now - created_at >= 120s` (BEACON_STALE_THRESHOLD_S). It is INDEPENDENT of NIP-40 `expiration` and of timeline membership. useBeacons (src/lib/hooks/useBeacons.ts:71-94) drops ONLY EXPIRED beacons (dropExpired), never stale ones. eventStore.timeline({kinds:[37521],'#t':['live']}) keeps the stale beacon's last event (which still carries t:'live') until NIP-40 expiration. BeaconViewPanel short-circuits to "Beacon ended" when isExpired (BeaconViewPanel.tsx:163) — the panel is showing STALE content, so the beacon is NOT expired and IS still in `beacons`. Therefore beaconLookupSuperset resolves it and the sweep does NOT remove it on staleness alone. The phantom is NOT caused by staleness dropping the beacon from discovery.
  timestamp: 2026-07-02

## Evidence

- timestamp: 2026-07-02
  checked: 13-04-SUMMARY.md (Plan 04 expiry-sweep description)
  found: "expiry sweep... resolves each individual sighting/beacon stack entry against sightings / beaconLookupSuperset (discovery ∪ routed) and calls removeMapStackEntry(id) when the entity is isExpired OR no longer resolvable (dropped from the already-dropExpired'd subscription)". Aggregate *-layer entries are NOT swept.
  implication: A stale beacon that has left the #t:['live'] discovery window and is not routed would be "no longer resolvable" in beaconLookupSuperset → swept. This matches the primary hypothesis. Need to confirm in code.

- timestamp: 2026-07-02
  checked: 13-03-SUMMARY.md (beaconLookupSuperset + deriveVisibleEntitiesFromStack)
  found: beaconLookupSuperset = beacons (discovery #t:['live']) ∪ routedBeacons (targeted route subscription). deriveVisibleEntitiesFromStack resolves individual entries via resolveKey against subscription set, with individualLookupSet superset for individual/isolated entries. addBeaconToMapStack derives entityKey from resolved naddr; toast only on source 'manual'.
  implication: Both the sweep AND the render gate resolve individual beacon entries against beaconLookupSuperset. A stale beacon absent from that superset fails BOTH — reinforcing phantom.
