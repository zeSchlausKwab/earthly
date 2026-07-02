---
status: complete
phase: 12-live-beacon-37521
source: [12-VERIFICATION.md]
started: "2026-07-02T06:23:31Z"
updated: "2026-07-02T07:45:00Z"
---

## Current Test

[testing complete]

## Tests

### 1. Live GPS movement updates the map marker
expected: Start a beacon, physically move (or simulate a ≥25m GPS fix change). The live accent dot re-paints at the new position; the running banner keeps showing LIVE + countdown; Stop ends it with a clean ENDED marker (not disappearance).
result: pass

### 2. Account-free share link opens for a logged-out viewer
expected: Copy the share link from BeaconViewPanel and open it in a fresh private/incognito window with no signed-in account. The beacon opens without auth, showing label + live/stale/ended status + last-seen + countdown (or "This beacon has ended." if expired).
result: pass
note: "Passed after a chain of fixes: (1) Start→no-link (82bb826); (2) share link landed on the LIST not the inspect view, no zoom (f94972f — focus-preserving navigateTo + auto-zoom + Follow toggle); (3) marker not visible on the map for sharer/observer incl. link-only (66a155e — merge viewed/routed/own beacon into the map layer). Verified live: on-route, inspect opens, marker renders + zooms, Follow works, account-free."

### 3. Permission-denied UX
expected: Deny the browser's location permission prompt when starting a beacon. Start is disabled / shows the permission-denied copy — not a silent failure or a frozen "searching" state. (Code now also tears the loop down on denial, closing the CR-01 leak path.)
result: pass

### 4. Seed-based four-state visual UAT
expected: Run `bun run seed` (re-seed) + `bun dev`; confirm the four marker states (live/stale/ended/removed) render distinctly — the "Park ranger — stale" fixture now renders STALE/grey (WR-03 fixed in 41ba498) — and the link-only fixture is ABSENT from the Beacons rail and the map discovery layer.
result: pass

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "After Start, the user reaches the beacon view (BeaconViewPanel) with a Copy-share-link they can hand to a logged-out viewer (BEACON-04 share path)."
  status: resolved
  reason: "User reported: When i click on start beacon im redirected to the inspect panel and dont get a link to see."
  resolution: "Fixed in 82bb826 — useBeaconPublisher surfaces the published beacon as liveBeacon; useBeaconController opens BeaconViewPanel (with Copy-share-link) once the first fix publishes. Awaiting re-test."
  severity: major
  test: 2
  artifacts: [src/features/geo-editor/hooks/useBeaconPublisher.ts, src/features/geo-editor/hooks/useBeaconController.ts]
  missing: []
