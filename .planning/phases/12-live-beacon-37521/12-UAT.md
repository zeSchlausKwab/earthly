---
status: testing
phase: 12-live-beacon-37521
source: [12-VERIFICATION.md]
started: "2026-07-02T06:23:31Z"
updated: "2026-07-02T06:23:31Z"
---

## Current Test

number: 1
name: Live GPS movement updates the map marker
expected: |
  Start a beacon, then move (or simulate a GPS fix change of ≥25m). The live
  accent dot re-paints at the new position; the running banner keeps showing
  LIVE + the countdown; Stop ends it with a clean ENDED marker (not a
  disappearance).
awaiting: user response

## Tests

### 1. Live GPS movement updates the map marker
expected: Start a beacon, physically move (or simulate a ≥25m GPS fix change). The live accent dot re-paints at the new position; the running banner keeps showing LIVE + countdown; Stop ends it with a clean ENDED marker (not disappearance).
result: [pending]

### 2. Account-free share link opens for a logged-out viewer
expected: Copy the share link from BeaconViewPanel and open it in a fresh private/incognito window with no signed-in account. The beacon opens without auth, showing label + live/stale/ended status + last-seen + countdown (or "This beacon has ended." if expired).
result: [pending]

### 3. Permission-denied UX
expected: Deny the browser's location permission prompt when starting a beacon. Start is disabled / shows the permission-denied copy — not a silent failure or a frozen "searching" state. (Code now also tears the loop down on denial, closing the CR-01 leak path.)
result: [pending]

### 4. Seed-based four-state visual UAT
expected: Run `bun run seed` + `bun dev`; confirm the four marker states (live/stale/ended/removed) render distinctly and the link-only fixture is ABSENT from the Beacons rail and the map discovery layer. NOTE — the "stale" fixture is known-broken (WR-03, deferred): its backdate is discarded, so the stale state will not render correctly until WR-03 is fixed. Verify the other three states + the discovery-gating boundary.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
