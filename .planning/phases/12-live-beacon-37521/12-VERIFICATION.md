---
phase: 12-live-beacon-37521
verified: 2026-07-02T00:00:00Z
status: gaps_found
score: 3/4 must-haves verified (BEACON-02 partial)
overrides_applied: 0
gaps:
  - truth: "A beacon auto-expires via NIP-40 and the user can explicitly stop sharing at any time, leaving an unambiguous ended state (BEACON-02)"
    status: partial
    reason: >
      The lifecycle data layer (stopBeacon publishing status:'ended', keeping `d` +
      expiration) is correct and tested. But the net-new publish loop
      (useBeaconPublisher.ts) that OWNS "explicit stop" has two unfixed CRITICAL
      defects identified by the phase's own code review (12-REVIEW.md, CR-01/CR-02)
      that directly undermine the "explicit stop" and "unambiguous ended state"
      guarantees:
        1. No unmount cleanup exists (`grep useEffect` returns zero results in the
           file) — if the component tree holding the publisher unmounts while a
           beacon is live (tab close without triggering React unmount cleanup is
           unaffected, but any SPA remount/route-tree teardown is), the
           `watchPosition` + heartbeat `setInterval` are never cleared and keep
           publishing GPS coordinates under a key with no remaining Stop UI.
        2. `startBeacon` unconditionally overwrites `sessionRef.current`,
           `watchIdRef.current`, `intervalIdRef.current` with no check for an
           existing session. This is reachable through the SHIPPED UI:
           `useBeaconController.handleAdjustBeacon` → `handleStartBeacon` →
           `publisher.startBeacon` (confirmed by reading useBeaconController.ts:87-104,
           117-128) mints a brand-new session without tearing down the old one.
           Using "Adjust" on a live beacon orphans the original watch + heartbeat,
           which keeps publishing the OLD beacon's location under a key the app can
           no longer reach — for a PUBLIC beacon this keeps broadcasting
           discoverable live location after the user believed they "adjusted" it.
      Neither defect has a regression test (grepped useBeaconPublisher.test.ts for
      "unmount"/"teardown"/"double start"/"Adjust" — zero matches), so the green
      test suite does not cover this failure mode. This is a real, UI-reachable gap
      in "the user can explicitly stop sharing... leaving an unambiguous ended
      state" — Adjust does not stop the prior lineage, so two live sessions can run
      concurrently with only one stoppable from the UI.
    artifacts:
      - path: "src/features/geo-editor/hooks/useBeaconPublisher.ts"
        issue: >
          No `useEffect(() => () => teardown(), [teardown])` unmount cleanup (CR-01);
          `startBeacon` (lines 279-341) does not call `stop()`/`teardown()` on an
          existing `sessionRef.current` before minting a new session (CR-02).
      - path: "src/features/geo-editor/hooks/useBeaconController.ts"
        issue: >
          `handleAdjustBeacon` (lines 117-128) → `handleStartBeacon` (lines 87-104)
          calls `publisher.startBeacon` directly with no prior stop of the active
          session, making CR-02 reachable via the real "Adjust" UI action.
    missing:
      - "Add unmount cleanup to useBeaconPublisher (useEffect returning teardown()) so a live session can never outlive the component (CR-01 fix)."
      - "Tear down (stop()) any existing sessionRef.current at the top of startBeacon before minting a new session, so Adjust/double-Start never orphans a watch+heartbeat (CR-02 fix)."
      - "Add a regression test asserting: (a) unmounting the hook while live calls clearWatch/clearInterval, and (b) calling startBeacon while already live stops the prior session first (no orphaned watchId/intervalId)."
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
    why_human: "Visual/rendering confirmation in a live map session; also note the 'stale' seed fixture is currently BROKEN (WR-03, see below) so this check will currently fail for the stale state specifically until fixed."
---

# Phase 12: Live Beacon (37521) Verification Report

**Phase Goal:** A user can run a real-time, time-boxed position beacon that updates on the map as their position changes, auto-expires via NIP-40 with an explicit stop leaving an unambiguous ended state, shows viewers an honest staleness indicator so a stopped/stale beacon is never shown as current, and can be made public or shared via an account-free link.

**Verified:** 2026-07-02
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can start a live position beacon that updates on the map as their position changes (BEACON-01) | ✓ VERIFIED | `useBeaconPublisher.ts` owns a separate `watchPosition` session (lines 310-331), throttles publish via `createBeaconThrottle`/`shouldPublishBeacon` (distance-floor 25m OR heartbeat 30s, single `lastPublished` guard — P-4 correctly implemented and unit-tested: `useBeaconPublisher.test.ts` 5/5 pass). Map layer (`useMapLayers.ts:342-432`) builds a `beaconState`-tagged, data-driven-painted source that re-derives on tick. Default identity is anonymous throwaway key (`startBeaconSession`, `useBeaconPublisher.ts:174-187`) — foreground-only via standard `watchPosition` semantics (no background wake). |
| 2 | A beacon auto-expires via NIP-40 and the user can explicitly stop sharing at any time, leaving an unambiguous "ended" terminal state; user warned last point stays public | ✗ FAILED (partial) | Data layer: `stopBeacon` (`lifecycle.ts:154-170`) correctly publishes one final `status:'ended'` event, preserves `d` + expiration — unit tested and GREEN. UI copy: the no-delete consent + Stop alert-dialog recap are present verbatim (`BeaconControlPanel.tsx`, `BeaconViewPanel.tsx`). **BUT** the publish-loop that owns the live session has two UNFIXED CRITICAL defects from the phase's own code review (12-REVIEW.md CR-01/CR-02), both confirmed still present by direct code read: no unmount cleanup (leak on unmount) and no teardown of an existing session before `startBeacon` mints a new one (leak on Adjust/double-Start, reachable via the shipped `useBeaconController.handleAdjustBeacon` path). These mean "explicit stop" is not reliably the only way a session ends, and an orphaned session can keep publishing with no reachable Stop UI. See Gaps. |
| 3 | A viewer sees a beacon's current position with an honest staleness indicator ("last seen N min ago") so a stopped/stale beacon is never shown as current (grey-out past threshold) | ✓ VERIFIED | `beaconState(cast, now)` (`beaconState.ts:51-59`) derives `removed > ended > stale > live` precedence with `now - created_at >= BEACON_STALE_THRESHOLD_S` (120s, derived from heartbeat, not a magic literal) marking STALE regardless of claimed `status` (Pitfall P-3 correctly implemented). Map paint (`useMapLayers.ts:955-990`) branches circle color/opacity on the `beaconState` feature property (`#fdc700` live / `#737373` grey for stale+ended). `useBeacons.ts` + map source both apply `dropExpired` before render. Unit tests for `beaconState` precedence + filter-before-cast + dropExpired all pass (`useBeacons.test.ts`, `lifecycle.test.ts`). |
| 4 | A user can make a beacon public/discoverable or share it via a link a viewer can open without an account (BEACON-04) | ✓ VERIFIED | `lifecycle.ts` visibility branch: public emits `t:'live'` + `bbox`/`g`; link-only omits all three (`visibility.test.ts` GREEN, confirms discovery filter match/no-match). `BeaconsPanel.tsx` subscribes via the `#t:['live']` discovery filter only. Account-free path fully wired server-side: `fetchBeaconOGData` (`fetchBeacon.ts`), `generateBeaconOGHtml` (honest "may have ended" copy), `/beacon/:naddr` + `/beacon/:naddr/comment/:commentId` routes registered in `src/index.ts:432-433`, client-side `useRouting.ts` has the thin `'beacon'` focusType + segment block. `BeaconViewPanel.tsx` builds the share naddr with the THROWAWAY pubkey (`nip19.naddrEncode`). The previously-broken `SIDEBAR_VIEW_MODES` routing bug (missing `'beacons'`) is confirmed FIXED — `'beacons'` is present in the array (`useRouting.ts:15`). |

**Score:** 3/4 truths fully verified; 1 partial (BEACON-02) due to two unfixed CRITICAL code-review findings in the live publish loop.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/nostr/live-beacon/lifecycle.ts` | publishBeacon/updateBeacon/stopBeacon, visibility branch, configured routing | ✓ VERIFIED | Present, correct, `routing:'configured'` confirmed, no `'outbox'`. |
| `src/lib/nostr/live-beacon/beaconState.ts` | live/stale/ended/removed derivation + named constants | ✓ VERIFIED | Present, correct precedence, threshold derived from heartbeat (not literal 120). |
| `src/lib/hooks/useBeacons.ts` | filter-before-cast + dropExpired + 15s tick + discovery filter | ✓ VERIFIED | Present (not directly re-read line-by-line this pass, but exercised GREEN by `useBeacons.test.ts` covering the exact must-have assertions). |
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | throttled publish loop + per-session throwaway signer | ⚠️ STUB-ADJACENT (functional but leak-prone) | Core throttle logic (`shouldPublishBeacon`, `createBeaconThrottle`) is correct and unit-tested. Session lifecycle management (start/stop/teardown) has two confirmed unfixed CRITICAL leaks (CR-01, CR-02) — the artifact exists and mostly works but its lifecycle-safety contract (implied by BEACON-02 and the D-05 privacy boundary) is broken. |
| `src/components/BeaconsPanel.tsx` | browse rail over useBeacons, own-beacon pinned to top | ✓ VERIFIED (with WR-02 caveat) | Present, wired via `AppSidebar.tsx` `case 'beacons'`. Ownership detection (`beacon.pubkey === currentUserPubkey`) never matches the DEFAULT anonymous-identity beacons (WR-02, unfixed) — the owner's own anonymous live beacon shows no inline Stop/Adjust in the panel/detail view. The always-on `RunningBeaconBanner` still provides Stop, so this is a WARNING not a blocker. |
| `src/features/geo-editor/hooks/useMapLayers.ts` (beacon layer) | data-driven live/stale/ended paint, dropExpired-before-source | ✓ VERIFIED | `BEACON_SOURCE_ID`/`BEACON_CIRCLE_LAYER` present, `dropExpired` + `beaconState`-per-feature confirmed, color scheme matches spec. |
| `src/components/info-panel/BeaconControlPanel.tsx` | time-box/visibility/identity/consent, no pin-drop | ✓ VERIFIED | Verbatim "unlisted, not private" caveat + no-delete consent strings present; no pin-drop props. |
| `src/components/info-panel/BeaconViewPanel.tsx` | status + last-seen + countdown + copy-share-link, no comments | ✓ VERIFIED | No `CommentsPanel`/`GeoSocialActions` import (deferred to Phase 13 as planned); no Delete action; `isExpired` gate present; naddr carries throwaway pubkey. |
| `src/components/RunningBeaconBanner.tsx` | persistent live banner + one-tap stop | ✓ VERIFIED | LIVE word, countdown, destructive Stop button ≥44px (h-11), searching sub-state. |
| `src/lib/og/fetchBeacon.ts` + cache/template/index | account-free OG card | ✓ VERIFIED | `fetchBeaconOGData` GREEN in tests (naddr round-trip w/ throwaway pubkey, expiry guard, kind gate); wired through cache.ts/template.ts/index.ts/src/index.ts routes. |
| `src/features/geo-editor/hooks/useBeaconController.ts` | Start/Stop/Adjust/inspect controller | ⚠️ WIRED BUT PROPAGATES CR-02 | Correctly composes `useBeaconPublisher` and wires all handlers, but `handleAdjustBeacon`→`handleStartBeacon` is the exact reachable path for CR-02 (no stop-before-restart). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lifecycle.ts` | relay (publish) | `publish(signed, {routing:'configured'})` | ✓ WIRED | Confirmed by grep + test. |
| `useBeacons.ts` | `expiry.ts` + cast | `dropExpired(events.filter(isLiveBeacon)).map(castEvent)` | ✓ WIRED | Confirmed by passing test contract. |
| `useMapLayers.ts` | `live-beacon` (beaconState, dropExpired) | source builder computes `beaconState(cast, now)` per feature | ✓ WIRED | Confirmed by direct read (lines 362-432, 955-990). |
| `useBeaconController.ts` | `useBeaconPublisher.ts` | Start/Stop/Adjust drive publisher session | ⚠️ WIRED, LEAK-PRONE | Wired, but Adjust reuses `startBeacon` with no session teardown (CR-02 propagation). |
| `src/index.ts` | `fetchBeacon.ts` | `handleBeaconRoute` → `fetchCachedBeaconEventOGData` → `generateBeaconOGHtml` | ✓ WIRED | Confirmed via grep: routes registered, OG-image branch present. |
| `BeaconViewPanel.tsx` | `nip19.naddrEncode` | Copy-share-link builds `37521:<throwawayPubkey>:<d>` | ✓ WIRED | Confirmed by direct read (line 142). |
| `useBeaconPublisher.ts` (unmount) | teardown | React `useEffect` cleanup | ✗ NOT WIRED | No `useEffect` in the file at all (grep confirms zero matches) — CR-01. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Map beacon layer | `beaconState` feature property | `useBeacons()` casts → `dropExpired` → `beaconState(cast, now)` | Yes — real relay subscription, real epoch-seconds clock | ✓ FLOWING |
| `BeaconsPanel` rows | `beacon` list | `useBeacons()` (`#t:['live']` filter) | Yes | ✓ FLOWING |
| `RunningBeaconBanner` | `subState`/`countdown`/`isStopping` | `useBeaconPublisher()` session state, threaded via `useBeaconController` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `bun test` | 755 pass / 0 fail (one earlier run showed a flaky 1-fail on an unrelated MCP/network test; a clean re-run was 755/0) | ✓ PASS |
| Beacon-specific data-layer tests | `bun test src/lib/nostr/live-beacon/visibility.test.ts src/lib/nostr/live-beacon/lifecycle.test.ts src/lib/hooks/useBeacons.test.ts src/lib/og/fetchBeacon.test.ts` | 13 pass / 0 fail | ✓ PASS |
| Publisher throttle tests | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | 5 pass / 0 fail | ✓ PASS (but does not cover CR-01/CR-02 — no unmount/double-start assertions exist) |
| Production build | `bun run build` | Build completed, all chunks + workers emitted | ✓ PASS |
| Biome on beacon-touched files | `bunx biome check <6 files>` | Checked 6 files, no fixes needed | ✓ PASS |
| Unmount cleanup exists | `grep useEffect useBeaconPublisher.ts` | 0 matches | ✗ FAIL (confirms CR-01) |
| Session-teardown-before-restart exists | `grep sessionRef.current` in `startBeacon` body | No guard/stop call before overwrite | ✗ FAIL (confirms CR-02) |
| Routing fix (`'beacons'` in SIDEBAR_VIEW_MODES) | `grep beacons useRouting.ts` | Present at line 15 | ✓ PASS (fix confirmed committed) |
| Seed "stale" fixture backdate | `grep -A3 "factory.created" scripts/seed-entities.ts` | `if (createdAt !== undefined) factory.created(createdAt)` — return value discarded | ✗ FAIL (confirms WR-03 unfixed; the seeded "stale" UAT fixture will NOT render as stale) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BEACON-01 | 12-01,02,03,04,05 | Start a live position beacon that updates on the map | ✓ SATISFIED | Publish loop + throttle + map render all present, tested, wired. |
| BEACON-02 | 12-01,02,03,05 | Auto-expire (NIP-40) + explicit stop → unambiguous ended state | ✗ BLOCKED (partial) | Data layer satisfied; session-lifecycle safety broken by CR-01/CR-02 — "explicit stop" is not guaranteed to be the only way a session terminates, and Adjust can orphan a still-live session. |
| BEACON-03 | 12-01,02,04,05 | Honest staleness indicator, stopped/stale never shown as current | ✓ SATISFIED | `beaconState` precedence + map paint + tick-based re-derivation confirmed correct. |
| BEACON-04 | 12-01,02,04,05 | Public/discoverable or account-free link share | ✓ SATISFIED | Visibility branch, discovery filter, OG route, naddr-with-throwaway-pubkey all confirmed wired. |

REQUIREMENTS.md marks all four as `[x]` Complete — BEACON-02 is **not fully substantiated** by the codebase; the checkbox is premature given the two unfixed CRITICAL findings that directly target the "explicit stop" guarantee this requirement describes.

No orphaned requirements found — all four BEACON-* IDs are claimed across the five plans and no additional Phase-12 IDs appear unclaimed in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | 223-370 (whole hook) | Missing unmount cleanup (no `useEffect` cleanup) | 🛑 BLOCKER | Live GPS publishing can outlive the component with no Stop UI reachable (CR-01, code-review-confirmed, unfixed). |
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | 279-341 | No existing-session teardown at top of `startBeacon` | 🛑 BLOCKER | Adjust/double-Start orphans a still-publishing prior session under an unrecoverable key (CR-02, code-review-confirmed, unfixed, reachable via shipped `useBeaconController.handleAdjustBeacon`). |
| `scripts/seed-entities.ts` | 480 | Discarded immutable-builder return value (`factory.created(createdAt)` not reassigned) | ⚠️ WARNING | The seeded "stale" UAT fixture silently fails to backdate — undermines the seed-based UAT check for the stale-marker state (WR-03, code-review-confirmed, unfixed). |
| `src/components/BeaconsPanel.tsx` / `BeaconViewPanel.tsx` | 245 / 124 | Ownership keyed on raw pubkey equality, never matches anonymous throwaway identity (the default mode) | ⚠️ WARNING | Owner's own anonymous live beacon shows no inline Stop/Adjust in panel/detail (WR-02, code-review-confirmed, unfixed); banner Stop still works, so not a blocker. |
| `src/features/geo-editor/hooks/useBeaconPublisher.ts` | 288 | `activeAccount as unknown as SignerLike` double cast | ℹ️ INFO | Fragile but functional; not user-facing (WR-04, unfixed). |
| `src/components/RunningBeaconBanner.tsx` | 43 | `permission-denied` folded into `searching` sub-state, unreachable/misleading if ever rendered | ℹ️ INFO | Low impact — path currently unreachable given teardown-on-deny (WR-05, unfixed). |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in the beacon-touched files (grep for these markers in the 27 reviewed files returned no bare matches beyond the documented review findings themselves, which are tracked in 12-REVIEW.md).

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
**Why human:** Requires triggering a real browser permission dialog and denial; the code path (`error.code === error.PERMISSION_DENIED` branch, `useBeaconPublisher.ts:317-324`) looks correct but the actual browser-level UX needs live confirmation.

### 4. Seed-based four-state visual UAT

**Test:** Run `bun run seed` + `bun dev`, confirm all four marker states (live/stale/ended/removed) render distinctly and the link-only fixture is absent from the Beacons rail and map discovery layer.
**Expected:** Visual confirmation of the states and the discovery-gating boundary.
**Why human:** Visual rendering confirmation. Note: the "stale" fixture is currently broken (WR-03 above) — it will NOT actually backdate `created_at`, so this check is expected to FAIL for the stale state specifically until that seed bug is fixed.

## Gaps Summary

The Live Beacon data layer (lifecycle, beaconState, discovery-gating, OG/account-free sharing) is genuinely solid: tested, correctly wired, and matches the plan's must-haves in full. Three of the four success criteria (SC1, SC3, SC4) are fully achieved and verified in the codebase.

SC2 ("explicit stop... leaving an unambiguous ended state") is only partially achieved. The phase's own code review (12-REVIEW.md, dated after 12-05's execution) found two CRITICAL, UI-reachable defects in `useBeaconPublisher.ts` — no unmount cleanup (CR-01) and no session teardown before a re-Start (CR-02) — and **neither has been fixed** in the current tree. CR-02 is directly reachable through the shipped "Adjust" UI action (`useBeaconController.handleAdjustBeacon` → `handleStartBeacon` → `publisher.startBeacon`), meaning a real user pressing "Adjust" on a live beacon can orphan the original session, which keeps publishing GPS coordinates (potentially publicly, with discovery tags) with no remaining way to stop it from the UI. This directly undermines the "explicit stop... unambiguous ended state" and D-05 privacy-boundary guarantees this phase's own threat model calls BLOCKER-level.

REQUIREMENTS.md marks BEACON-02 as `[x]` Complete; this verification finds that checkbox premature given the unfixed findings.

Two WARNING-level gaps (WR-02 ownership detection never matching the default anonymous identity; WR-03 broken seed backdate) further degrade the UAT-readiness and the polish of the explicit-stop UX, though the always-on `RunningBeaconBanner` provides a working Stop affordance regardless of WR-02.

**Recommendation:** Do not close Phase 12 until CR-01 and CR-02 are fixed (both have concrete, small fixes documented in 12-REVIEW.md) and a regression test is added covering unmount-cleanup and double-Start/Adjust teardown. The four human-verification items should be run as end-of-phase UAT per the plan's original blocking-checkpoint intent, ideally AFTER the CR-01/CR-02 fixes land (since UAT step 5 in 12-05-PLAN.md — "Switch identity to My account on a new Start" — is exactly the Adjust/double-Start path that triggers CR-02).

---

_Verified: 2026-07-02_
_Verifier: Claude (gsd-verifier)_
