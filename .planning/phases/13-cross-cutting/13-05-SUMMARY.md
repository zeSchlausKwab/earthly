---
phase: 13-cross-cutting
plan: 05
subsystem: share-links + onboarding
gap_closure: true
tags: [beacon, share-url, deep-link, tour, XCUT-02, WR-01]
requires:
  - "SHARE_ROUTES.beacon dispatch (useRouting.ts, XCUT-02)"
  - "GeoSocialActions.handleShare canonical clean-path pattern"
provides:
  - "BeaconViewPanel.handleCopyShareLink → canonical /beacon/:naddr clean-path emitter"
  - "isDeepLinkLanding() (useRouting.ts) — mount-captured deep-link signal"
  - "TourManager deep-link-aware auto-start guard"
affects:
  - "beacon share recipients (now land on inspect panel, not the LIST)"
  - "fresh deep-link recipients (no onboarding tour interruption)"
tech-stack:
  added: []
  patterns:
    - "clean single-prefix share URL via new URL('/beacon/:naddr', origin)"
    - "read-only URL→boolean deep-link signal, captured once at mount via useRef"
key-files:
  created: []
  modified:
    - src/components/info-panel/BeaconViewPanel.tsx
    - src/features/tour/TourManager.tsx
    - src/features/geo-editor/hooks/useRouting.ts
decisions:
  - "Beacon comment sharing left on the shared CommentsPanel/GeoSocialActions pipeline (already canonical via b6492c3); only the beacon-level Copy-share-link button is fixed here."
  - "isDeepLinkLanding() co-located with parseLocation in useRouting.ts (owns the pathname-then-hash fallback) rather than inlined in TourManager — one home for the hash-fallback logic, unit-testable."
  - "Deep-link signal captured ONCE at mount (useRef initializer) so a later in-app navigation cannot retroactively suppress a legitimately-earned tour; markAsSeen is NOT called on suppression (recipient still earns the tour on a later plain load)."
metrics:
  duration: ~14min
  completed: 2026-07-03
  tasks: 2
  files: 3
---

# Phase 13 Plan 05: Beacon Share-Link + Tour Gap-Closure Summary

Fixed the two `status: failed` UAT defects (tests 2 and 3) behind a single beacon-share
recipient landing in the wrong place: a doubled-prefix share URL and a route-blind
onboarding tour. The beacon Copy-share-link now emits the canonical clean-path
`${origin}/beacon/:naddr` (matching SHARE_ROUTES.beacon), and the welcome tour no longer
auto-starts when a fresh recipient lands directly on a shared/deep-linked route.

## What Shipped

**Task 1 — clean-path beacon share emitter** (`BeaconViewPanel.tsx`, commit `5d25434`)
`handleCopyShareLink` previously hand-built the legacy doubled-prefix hash URL
`${origin}/#/beacons/beacon/${naddr}` — a `#/` hash form with the plural sidebar-view
segment `beacons/` doubled in front of the singular share segment `beacon/`. Because only
the singular `beacon` is a `SHARE_ROUTES` key, `parsePathSegments` took the sidebar-tail
branch → `sidebarView:'beacons'` (the LIST) instead of matching `SHARE_ROUTES.beacon`.
Replaced with `new URL(\`/beacon/${naddr}\`, window.location.origin).toString()` — the exact
pattern `GeoSocialActions.handleShare` uses. This 2-segment path dispatches to
`focusType:'beacon'`, so the recipient lands on the beacon inspect panel. The comment case
(`/beacon/:naddr/comment/:id`) is already handled by the shared CommentsPanel /
GeoSocialActions pipeline (canonical via b6492c3), so it is left there — the beacon-level
button was the only bespoke emitter. The `nip19.naddrEncode({ kind: LIVE_BEACON_KIND,
pubkey, identifier: dTag })` call (throwaway-pubkey, D-05) is unchanged.

**Task 2 — deep-link-aware tour suppression** (`TourManager.tsx` + `useRouting.ts`, commit `1bc2acf`)
Added an exported `isDeepLinkLanding()` to `useRouting.ts` (co-located with `parseLocation`,
which owns the pathname-then-hash fallback). It returns true when the current location either
carries a `?ms=` Map-Stack query param OR resolves (via `parseLocation()`) to an entity/context
deep-link (`focusType !== 'none'` OR a truthy `contextNaddr`). It is read-only — no
transmit/log/persist. `TourManager` captures the signal ONCE at mount via
`useRef(isDeepLinkLanding())` and gates the existing 800ms `startTour` on
`!hasSeenTour && !isDeepLinkLandingRef.current`. `markAsSeen`/localStorage is untouched, so a
suppressed recipient still earns the tour on a later plain load; capturing at mount means an
in-app navigation to an entity cannot retroactively suppress a legitimately-earned tour.

## Verification

| Gate | Result |
|------|--------|
| `grep -c "beacons/beacon" BeaconViewPanel.tsx` | 0 |
| `grep -c "/#/" BeaconViewPanel.tsx` | 0 |
| `nip19.naddrEncode({kind: LIVE_BEACON_KIND, ...})` present | yes (throwaway-pubkey invariant preserved) |
| `export function isDeepLinkLanding` in useRouting.ts | 1 |
| TourManager guard reads deep-link signal + `.has('ms')` | yes (via helper) |
| `markAsSeen` NOT called on suppression path | confirmed (only in `onDestroyStarted`) |
| Signal captured at mount (useRef, not per-render) | yes |
| `bun test useRouting.dispatch.test.ts` | 12/12 pass |
| `bun test` (geo-editor/hooks + tour) | 24/24 pass, no regression |
| `bun run build` | success (client + 5 workers) |
| `bunx biome check` (both changed files + useRouting.ts) | clean |

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with no auto-fixes, no
architectural decisions, no auth gates. The one judgment call the plan explicitly delegated
("verify which" for beacon-comment sharing) resolved to: beacon comments are handled entirely
by the shared GeoSocialActions/CommentsPanel Share button, so only the beacon-level button was
fixed here (as the plan's read-first note anticipated).

## Out of Scope (flagged in plan, not touched)

Per the plan's threat-model note, the server-side redirect (`src/index.ts:257,260`) and OG
template (`src/lib/og/template.ts:201`) still emit the doubled-prefix `/#/beacons/beacon/:naddr`
legacy-hash landing form — but that is the shared all-kinds server-redirect convention (UAT
test 4 confirmed other kinds resolve through it) and was deliberately left unchanged.

## Known Stubs

None.

## Threat Flags

None — no new security-relevant surface. The naddr encoding is byte-identical (same throwaway
pubkey, D-05); the fix moves the beacon emitter ONTO the hardened SHARE_ROUTES.beacon dispatch
path (a net security improvement, T-13-05-02). The tour guard only reads `window.location` to
compute a boolean.

## For the Verifier / UAT (deferred per human_verify_mode: end-of-phase)

- Re-run UAT test 2: on a live beacon, click "Copy share link" → the copied URL is
  `${origin}/beacon/:naddr` (no `#/`, no doubled `beacons/`); opening it in a fresh tab focuses
  the beacon inspect panel (NOT the list) with NO tour dialog.
- Re-run UAT test 3: the beacon comment share link is `/beacon/:naddr/comment/:id`; opening it
  focuses the beacon AND the specific comment.
- Confirm a plain browse land in a never-toured browser STILL auto-starts the welcome tour.

## Self-Check: PASSED

- FOUND: src/components/info-panel/BeaconViewPanel.tsx (modified)
- FOUND: src/features/tour/TourManager.tsx (modified)
- FOUND: src/features/geo-editor/hooks/useRouting.ts (modified)
- FOUND: .planning/phases/13-cross-cutting/13-05-SUMMARY.md
- FOUND: commit 5d25434 (Task 1)
- FOUND: commit 1bc2acf (Task 2)
