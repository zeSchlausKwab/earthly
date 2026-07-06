---
phase: 12-live-beacon-37521
verified: 2026-07-02T00:00:00Z
status: passed
uat_closed: "2026-07-02 — /gsd-verify-work 12: UAT 4/4 PASS (human_verification items confirmed live; several beacon UX gaps found + fixed during UAT — see 12-UAT.md notes)"
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/4 must-haves verified (BEACON-02 partial)
  gaps_closed:
    - "A beacon auto-expires via NIP-40 and the user can explicitly stop sharing at any time, leaving an unambiguous ended state (BEACON-02) — CR-01 (no unmount cleanup) and CR-02 (no session teardown before re-Start) are both fixed and regression-tested."
  gaps_remaining: []
  regressions: []
deferred: []
human_verification:
  - test: "Start a beacon, move physically (or simulate GPS >25m movement), confirm the live dot re-paints on the map and the running banner shows the countdown."
    expected: "The marker updates position; the banner shows LIVE + countdown; Stop ends it with a clean ENDED marker (not disappearance)."
    why_human: "Requires live GPS movement / device location hardware or simulated geolocation in a real browser session — not observable via static code analysis."
  - test: "Copy the share link from BeaconViewPanel and open it in a fresh private/incognito browser window with no logged-in account."
    expected: "The beacon opens account-free showing label + live/stale/ended status + last-seen + countdown; an expired beacon shows 'This beacon has ended.'"
    why_human: "Requires an actual cross-session browser test (private window, no account) to confirm the account-free access path truly requires no auth at runtime."
  - test: "Deny the browser's location permission prompt when starting a beacon."
    expected: "Start is disabled / shows the permission-denied copy, not a silent failure or a frozen 'searching' state."
    why_human: "Requires triggering and denying an actual browser permission dialog — not derivable from source alone (permission callback wiring is present and correct in code, but UX behavior on real denial needs confirmation)."
  - test: "Seed-based UAT: run `bun run seed` + `bun dev`, confirm 4 marker states render (live/stale/ended/removed) and the link-only fixture does not appear in the Beacons rail or the map discovery layer."
    expected: "Visual confirmation of the 4 states and the discovery-gating boundary."
    why_human: "Visual/rendering confirmation in a live map session; also note the 'stale' seed fixture is still BROKEN (WR-03, open warning, not fixed in this pass) so this specific check will currently fail for the stale state until that seed bug is fixed."
---

# Phase 12: Live Beacon (37521) Verification Report

**Phase Goal:** A user can run a real-time, time-boxed position beacon that updates on the map as their position changes, auto-expires via NIP-40 with an explicit stop leaving an unambiguous ended state, shows viewers an honest staleness indicator so a stopped/stale beacon is never shown as current, and can be made public or shared via an account-free link.

**Verified:** 2026-07-02
**Status:** human_needed
**Re-verification:** Yes — after gap closure (commit bfb954f fixing CR-01/CR-02)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can start a live position beacon that updates on the map as their position changes (BEACON-01) | ✓ VERIFIED | Unchanged from prior pass — regression check only. `useBeaconPublisher.ts` owns a separate `watchPosition` session via `openBeaconWatch` (lines 368-391), throttles publish via `createBeaconThrottle`/`shouldPublishBeacon` (distance-floor 25m OR heartbeat 30s). Map layer (`useMapLayers.ts`) paints beaconState-tagged features. Unit tests green (8/8 in `useBeaconPublisher.test.ts`, up from 5/5 — 3 new CR-01/CR-02 tests added). |
| 2 | A beacon auto-expires via NIP-40 and the user can explicitly stop sharing at any time, leaving an unambiguous "ended" terminal state; user warned last point stays public (BEACON-02) | ✓ VERIFIED (gap closed) | **Full re-verification, not a regression skim.** Read `useBeaconPublisher.ts` end-to-end. CR-01: a `useEffect(() => teardown, [teardown])` is now present (line 303) — confirmed by direct read, not grep-only; on unmount this calls `teardown()` which releases both the geolocation watch and the heartbeat interval via `loopRef.current?.teardown()` and discards the session/signer. CR-02: `startBeacon` (line 340) now calls `teardown()` unconditionally as its FIRST session-mutating statement, before `startBeaconSession(...)` mints a new signer — confirmed this precedes all ref writes, so Adjust/double-Start can no longer orphan a prior watch+heartbeat. The watch+heartbeat acquisition was refactored into a pure, dependency-injected `openBeaconWatch()` (lines 235-266) returning an idempotent `teardown()` (guarded by a `released` boolean, line 257-263) — the single release choke point used by Stop, unmount, and re-Start alike. `stopBeacon` (line 398) still correctly publishes the terminal `status:'ended'` event before calling `teardown()`. `useBeaconController.handleAdjustBeacon` → `handleStartBeacon` → `publisher.startBeacon` (the exact CR-02 attack path) now flows through the fixed `startBeacon`, so Adjust no longer orphans the prior session. |
| 3 | A viewer sees a beacon's current position with an honest staleness indicator ("last seen N min ago") so a stopped/stale beacon is never shown as current (grey-out past threshold) | ✓ VERIFIED | Unchanged from prior pass — not touched by this fix, regression-only re-check via passing `beaconState.ts`/`useBeacons.test.ts`/`lifecycle.test.ts` (part of the 758/0 full-suite green run). |
| 4 | A user can make a beacon public/discoverable or share it via a link a viewer can open without an account (BEACON-04) | ✓ VERIFIED | Unchanged from prior pass — not touched by this fix, regression-only re-check via passing `visibility.test.ts`/`fetchBeacon.test.ts` (part of the 758/0 full-suite green run). |

**Score:** 4/4 truths verified. BEACON-02 gap from the prior verification is closed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | throttled publish loop + per-session throwaway signer + safe lifecycle (start/stop/teardown, no orphaning) | ✓ VERIFIED | Full re-read confirms: `openBeaconWatch()` (new pure helper, lines 235-266) is the single OS-resource acquire/release choke point; `teardown()` (lines 287-297) is idempotent-safe via the loop handle's own `released` guard; unmount `useEffect` (line 303) wired to `teardown`; `startBeacon` (line 340) calls `teardown()` before minting a new session; `stopBeacon`/`stop` (line 398+) publishes `ended` then calls `teardown()`. The prior "STUB-ADJACENT (leak-prone)" classification no longer applies. |
| `src/features/geo-editor/hooks/useBeaconController.ts` | Start/Stop/Adjust/inspect controller | ✓ VERIFIED | `handleAdjustBeacon` (lines 117-128) → `handleStartBeacon` (lines 87-104) still calls `publisher.startBeacon` directly with no controller-level stop-first logic — but this is now safe because `startBeacon` itself guarantees teardown-before-mint (CR-02 fix lives in the publisher, correctly, since it's the single source of truth for session state). No regression introduced at the controller layer. |
| `src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | regression coverage for CR-01/CR-02 | ✓ VERIFIED | New `describe('useBeaconPublisher — no orphaned publish loop (CR-01 unmount / CR-02 re-Start)')` block (lines 171-278) with 3 tests, all passing: (1) `teardown()` releases both the geolocation watch AND the heartbeat interval, (2) a torn-down loop stops delivering fixes and a fresh loop after teardown leaves exactly one active watch (the literal Adjust/double-Start scenario), (3) `teardown()` is idempotent (double-call clears exactly once — covers the Stop-then-unmount double-teardown race). Tests exercise the extracted `openBeaconWatch` primitive directly, which is the exact function the hook's `startBeacon`/`teardown`/unmount path calls — this is a legitimate, non-trivial regression pin, not a tautological test. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `useBeaconPublisher.ts` (unmount) | teardown | React `useEffect` cleanup | ✓ WIRED (was NOT_WIRED) | `useEffect(() => teardown, [teardown])` confirmed present at line 303, correctly memoized (teardown is itself a `useCallback` with stable deps), fires exactly once on true unmount. |
| `useBeaconController.ts` (`handleAdjustBeacon`) | `useBeaconPublisher.ts` (`startBeacon`) | Adjust re-invokes `startBeacon`, which now tears down first | ✓ WIRED (was LEAK-PRONE) | `startBeacon`'s first session-mutating line is `teardown()` (line 340) — confirmed to run before `startBeaconSession(...)`, `sessionRef.current = session`, and `openBeaconWatch(...)`. The Adjust path is safe. |
| `useBeaconPublisher.ts` (`stopBeacon`) | teardown | explicit Stop path | ✓ WIRED | Unchanged — still publishes `ended` before `teardown()`. |

### Data-Flow Trace (Level 4)

Not re-run — this fix is a lifecycle/resource-management correction, not a data-flow change. The prior pass's FLOWING verdicts for the map layer, BeaconsPanel, and RunningBeaconBanner are unaffected and remain valid (confirmed by the unchanged 758/0 green suite covering those paths).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `bun test` | 758 pass / 0 fail (one pre-existing unrelated worker-timeout warning in `optimizeClient.test.ts`, not a failure) | ✓ PASS |
| Beacon publisher tests (isolated) | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | 8 pass / 0 fail, 22 expect() calls (up from 5/5 pre-fix — 3 new CR-01/CR-02 tests) | ✓ PASS |
| Unmount cleanup exists | Direct read of `useBeaconPublisher.ts:303` | `useEffect(() => teardown, [teardown])` present | ✓ PASS (confirms CR-01 fixed) |
| Session-teardown-before-restart exists | Direct read of `useBeaconPublisher.ts:329-341` | `teardown()` called as the first statement inside `startBeacon`, before `startBeaconSession(...)` | ✓ PASS (confirms CR-02 fixed) |
| Regression test exercises the real fix path (not a tautology) | Read `useBeaconPublisher.test.ts:210-252` | Test opens loop A, tears it down, opens loop B on the same geolocation mock, asserts only B is active and A no longer delivers fixes — this is the literal Adjust/double-Start scenario | ✓ PASS |
| Biome on touched files | `bunx biome check useBeaconPublisher.ts useBeaconPublisher.test.ts useBeaconController.ts` | Checked 3 files, no fixes needed | ✓ PASS |
| Commit exists and matches claimed diff | `git show --stat bfb954f` | Confirmed: `useBeaconPublisher.ts` (+103/-24), `useBeaconPublisher.test.ts` (+109 new) | ✓ PASS |
| No new debt markers | `grep -n "TBD\|FIXME\|XXX" useBeaconPublisher.ts useBeaconPublisher.test.ts useBeaconController.ts` | 0 matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BEACON-01 | 12-01,02,03,04,05 | Start a live position beacon that updates on the map | ✓ SATISFIED | Unchanged, regression-confirmed. |
| BEACON-02 | 12-01,02,03,05 | Auto-expire (NIP-40) + explicit stop → unambiguous ended state | ✓ SATISFIED (previously BLOCKED) | CR-01/CR-02 fixed and regression-tested; the session-lifecycle safety gap that undermined "explicit stop is the only way a session ends" is closed. |
| BEACON-03 | 12-01,02,04,05 | Honest staleness indicator, stopped/stale never shown as current | ✓ SATISFIED | Unchanged, regression-confirmed. |
| BEACON-04 | 12-01,02,04,05 | Public/discoverable or account-free link share | ✓ SATISFIED | Unchanged, regression-confirmed. |

REQUIREMENTS.md's `[x]` Complete marks for all four BEACON-* IDs are now substantiated by the codebase. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | — | Missing unmount cleanup (CR-01) | — | **RESOLVED** — `useEffect` cleanup now present and confirmed by direct read. |
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | — | No existing-session teardown at top of `startBeacon` (CR-02) | — | **RESOLVED** — `teardown()` now called first in `startBeacon`, confirmed by direct read. |
| `scripts/seed-entities.ts` | 480 | Discarded immutable-builder return value (`factory.created(createdAt)` not reassigned) | ⚠️ WARNING (open, deliberately deferred) | The seeded "stale" UAT fixture silently fails to backdate (WR-03). User has explicitly deferred this — noted as an open warning, not a blocker. |
| `src/components/BeaconsPanel.tsx` / `BeaconViewPanel.tsx` | 245 / 124 | Ownership keyed on raw pubkey equality, never matches anonymous throwaway identity (the default mode) | ⚠️ WARNING (open, deliberately deferred) | Owner's own anonymous live beacon shows no inline Stop/Adjust in panel/detail (WR-02). User has explicitly deferred this — the always-on `RunningBeaconBanner` still provides Stop, so this does not block the goal. Noted as an open warning. |
| `src/features/geo-editor/hooks/useBeaconController.ts` | 116-128 | "Adjust" still forks a brand-new session/lineage rather than preserving the existing beacon's `d` (WR-01, pre-existing, not addressed by this fix) | ℹ️ INFO (unchanged, not a BEACON-02 blocker) | Adjust is now SAFE (no orphaning) but still not a true "continue the same lineage" edit — it stops the old beacon cleanly and starts a genuinely new one. This is a UX/behavior nuance distinct from the "unambiguous ended state" guarantee, which is satisfied (the old beacon does reach a clean `ended` state). Not re-opened as a gap since it was WR-01 in the original review, not a CRITICAL. |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in the fixed files.

### Human Verification Required

### 1. Live GPS movement updates the map marker

**Test:** Start a beacon, physically move (or simulate a GPS fix change of ≥25m), observe the map.
**Expected:** The live accent dot re-paints at the new position; the running banner continues showing LIVE + countdown.
**Why human:** Requires real or simulated device geolocation hardware/browser permission flow — not verifiable from static code.

### 2. Account-free share link opens for a logged-out viewer

**Test:** Copy the share link from `BeaconViewPanel`, open it in a fresh private/incognito window with no signed-in account.
**Expected:** The beacon opens without requiring auth, showing label + live/stale/ended status + last-seen + countdown (or the "This beacon has ended." terminal copy if expired).
**Why human:** Requires an actual cross-session browser test; code wiring (`/beacon/:naddr` route, OG fetch, client route) is confirmed present but the true "no account required" runtime behavior needs a live check.

### 3. Permission-denied UX

**Test:** Deny the browser's location permission prompt when starting a beacon.
**Expected:** Start is disabled with permission-denied copy, not a silent failure or a frozen "searching" state.
**Why human:** Requires triggering a real browser permission dialog and denial; the code path (`error.code === error.PERMISSION_DENIED` branch, `useBeaconPublisher.ts:376-382`) looks correct — and now correctly calls `teardown()` + `setIsLive(false)` on denial, closing the loop it opened — but the actual browser-level UX needs live confirmation.

### 4. Seed-based four-state visual UAT

**Test:** Run `bun run seed` + `bun dev`, confirm all four marker states (live/stale/ended/removed) render distinctly and the link-only fixture is absent from the Beacons rail and map discovery layer.
**Expected:** Visual confirmation of the states and the discovery-gating boundary.
**Why human:** Visual rendering confirmation. Note: the "stale" fixture is still broken (WR-03, open warning, deliberately deferred by the user) — it will NOT actually backdate `created_at`, so this check is expected to FAIL for the stale state specifically until that seed bug is fixed in a future pass.

## Gaps Summary

No gaps remain. The BEACON-02 gap from the prior verification (2026-07-02, initial pass) — two CRITICAL, UI-reachable session-lifecycle defects (CR-01 no unmount cleanup, CR-02 no teardown-before-restart) in `useBeaconPublisher.ts` — is closed as of commit `bfb954f`. Direct code read confirms:

- CR-01: a `useEffect(() => teardown, [teardown])` unmount cleanup now exists and releases both the geolocation watch and the heartbeat interval.
- CR-02: `startBeacon` now calls `teardown()` unconditionally as its first session-mutating action, so Adjust and double-Start can no longer orphan a prior watch+heartbeat+throwaway-key session.
- Both fixes route through a new pure, dependency-injected `openBeaconWatch()` helper with an idempotent `teardown()`, giving the hook a single release choke point used identically by Stop, unmount, and re-Start.
- Three new regression tests pin exactly this invariant (unmount releases both resources; a torn-down loop stops delivering fixes and a fresh loop after teardown leaves exactly one active watch — the literal Adjust/double-Start scenario; teardown is idempotent). These are not tautological — they exercise the same `openBeaconWatch` primitive the hook's real lifecycle calls into.
- Full suite is 758 pass / 0 fail (up from 755, net +3 new tests), `bun run build` and biome are clean on the touched files.

All four BEACON-* success criteria (SC1–SC4) are now satisfied by the codebase. Two WARNING-level items remain open and are explicitly acknowledged by the user as deliberately deferred, not gaps: WR-02 (owner inline Stop/Adjust doesn't detect ownership for the default anonymous beacon identity — the always-on `RunningBeaconBanner` still provides a working Stop, so this is a UX polish item, not a functional gap) and WR-03 (the seed script's "stale" fixture silently fails to backdate due to a discarded immutable-builder return value, which will make the seed-based visual UAT fail specifically for the stale-marker check until fixed).

Four items remain that require human verification and cannot be resolved by static analysis: live GPS movement re-painting the map, opening the account-free share link in a fresh unauthenticated browser session, the real browser permission-denied UX, and the seed-based four-marker-state visual check (expected to partially fail on the stale state per WR-03 above). None of these are code-verifiable gaps — they are legitimate runtime/UX confirmations appropriate for end-of-phase UAT. Status is therefore `human_needed`, not `gaps_found`.

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
