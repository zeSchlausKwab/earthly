---
phase: 12
slug: live-beacon-37521
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-28
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `12-RESEARCH.md` § "Validation Architecture". Task IDs (`12-NN-NN`)
> are assigned at plan time; rows below are keyed by requirement until then.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun's built-in runner) |
| **Config file** | none — Bun test convention (`*.test.ts` colocated) |
| **Quick run command** | `bun test src/lib/nostr/live-beacon` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~quick: <5s · full: existing-suite baseline + new beacon tests |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/lib/nostr/live-beacon` (+ the touched hook test, e.g. `bun test src/lib/hooks/useBeacons.test.ts`)
- **After every plan wave:** Run `bun test` (full) + `bun run build` + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite green + the relay echo integration test green
- **Max feedback latency:** ~5 seconds (quick run)

---

## Per-Task Verification Map

> Keyed by requirement until the planner assigns `12-NN-NN` task IDs. `❌ W0` = test file
> does not exist yet and is created in Wave 0.

| Req | Behavior | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| BEACON-01 | Throttle: publishes on distance≥floor OR time≥heartbeat, not otherwise | T-12-heartbeat-flood | Distance+time floor + single `lastPublishedAt` guard (no self-DoS) | unit | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-01 | Lifecycle: publish/update derive bbox/g (public), preserve `d` | — | N/A | unit | `bun test src/lib/nostr/live-beacon/lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-01 / D-05 | Per-session throwaway key fresh per Start, unlinkable, never persisted | T-12-key-persist | In-memory only; never localStorage/IDB; discarded at Stop | unit | `bun test src/features/geo-editor/hooks/useBeaconPublisher.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-02 | Stop publishes `status:'ended'` keeping expiration; ended stable until expiry | T-12-frozen-as-live | Ended marker distinct; never silent disappear | unit | `bun test src/lib/nostr/live-beacon/lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-02 | Relay echo: same-`d` republish → latest-wins; expired served-but-client-dropped | T-12-expired-served | Client `dropExpired` at every read; relay GC untrusted (SPEC-05) | integration | `bun test src/lib/nostr/live-beacon/relay-echo.test.ts` (against `bun relay`) | ❌ W0 | ⬜ pending |
| BEACON-03 | `beaconState` derivation: live/stale/ended/removed at threshold boundary | T-12-frozen-as-live | Past-threshold = STALE regardless of `status`; staleness off `created_at` | unit | `bun test src/lib/hooks/useBeacons.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-03 | `dropExpired` + ticking clock greys/removes without a new event | T-12-expired-served | Never render expired; clock-tick re-derivation | unit | `bun test src/lib/hooks/useBeacons.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-03 | filter-before-cast: legacy/forged 37521 never reaches the cast ctor | T-12-forged-crash | `isLiveBeacon` modelVersion gate before cast; defensive getter never throws | unit | `bun test src/lib/hooks/useBeacons.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-04 | Public beacon matches `#t:['live']` discovery; link-only does NOT | T-12-link-not-private | Discovery-gating is client-side only; honest "unlisted not private" caveat | unit | `bun test src/lib/nostr/live-beacon/visibility.test.ts` | ❌ W0 | ⬜ pending |
| BEACON-04 | naddr round-trip (encode throwaway pubkey → decode → fetch) | — | naddr decode wrapped (returns null on bad input) | unit | `bun test src/lib/og/fetchBeacon.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/nostr/live-beacon/lifecycle.test.ts` — BEACON-01/02 (derive bbox/g, preserve `d`, ended state)
- [ ] `src/lib/nostr/live-beacon/relay-echo.test.ts` — BEACON-02 (relay latest-wins + lazy-GC + client drop) against `bun relay`
- [ ] `src/lib/nostr/live-beacon/visibility.test.ts` — BEACON-04 (public vs link-only discovery filter)
- [ ] `src/lib/hooks/useBeacons.test.ts` — BEACON-03 (filter-before-cast, `dropExpired`, `beaconState`, ticking clock)
- [ ] `src/features/geo-editor/hooks/useBeaconPublisher.test.ts` — BEACON-01 / D-05 (throttle, per-session key)
- [ ] `src/lib/og/fetchBeacon.test.ts` — BEACON-04 (naddr / OG card)
- [ ] Test harness for `navigator.geolocation` (mock `watchPosition`) — shared fixture, none exists yet

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live dot moves on the map as the sharer physically moves | BEACON-01 | Requires a real moving GPS fix; `watchPosition` can't be unit-tested end-to-end | Start a beacon, walk/simulate movement >distance floor, observe the marker re-paint on the live canvas |
| Real-relay NIP-40 GC lazy-serve window | BEACON-02 | Depends on the running Khatru relay's 1h GC ticker timing | Publish a 37521 with a short expiration against `bun relay`, re-query after expiry but before GC tick; confirm the client `dropExpired` hides it even though the relay returns it (relay-echo.test automates the assertion; the live-relay timing is observed manually) |
| Account-free share link opens for a logged-out viewer | BEACON-04 | Cross-session/guest-scope browser behavior | Open `/beacon/:naddr` in a fresh private window with no account; confirm the beacon renders with staleness + OG card |
| Geolocation permission-denied / fix-unavailable UX | BEACON-01 | Browser permission prompt + device sensor state | Deny location at Start; confirm Start is disabled / the permission-gate UX from the UI-SPEC shows |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
