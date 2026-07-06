---
phase: 13-cross-cutting
plan: 01
subsystem: ui
tags: [comments, beacon, nostr, nip-22, live-beacon, react]

# Dependency graph
requires:
  - phase: 08-spec-v2-foundation
    provides: "kind-generic geo-comment factory + useGeoComments #A filter (no allowlist)"
  - phase: 12-live-beacon-37521
    provides: "LiveBeacon cast (kind 37521) exposing .kind/.pubkey/.dTag; BeaconViewPanel with the deferral note"
  - phase: 10-story-article-37520
    provides: "the add-a-comment-kind pattern (bf1112e): union widen + CommentsPanel mount"
provides:
  - "LiveBeacon added to both useGeoComments unions (target + react() param) — beacon comments now type-check"
  - "BeaconViewPanel mounts <CommentsPanel target={beacon} /> on the 37521 coordinate — beacon reaches full comment parity with Story/Group/Sighting"
  - "Phase-12 comment deferral note removed (header + inline)"
  - "useGeoComments.beacon.test.ts — pins the 37521:pubkey:dTag comment-root address derivation + the null-on-missing-dTag path (D-11)"
affects: [13-02-routing, 13-03-map-stack, XCUT-02, verify-phase-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "add-a-comment-kind = type-union widening + generic <CommentsPanel target={...} /> mount (no render-side K/k branching) — mirrors bf1112e"

key-files:
  created:
    - src/features/social/hooks/useGeoComments.beacon.test.ts
  modified:
    - src/features/social/hooks/useGeoComments.ts
    - src/components/info-panel/BeaconViewPanel.tsx

key-decisions:
  - "D-06 — beacon gets FULL comment parity (union widen + panel mount), identical to Story/Sighting; last kind wired"
  - "D-07 — own-pubkey d-reuse misattach recorded as a KNOWN EDGE; no de-dup/scoping built this phase"
  - "Expiry gate preserved — an expired beacon short-circuits to the terminal copy BEFORE the comment surface renders (Phase-12 honesty posture)"

patterns-established:
  - "Beacon comment mount mirrors StoryViewPanel L217-238 byte-for-byte (key/target/onCommentGeojsonVisibilityChange/onZoomToCommentGeojson/availableFeatures/onMentionVisibilityToggle/onMentionZoomTo/focusCommentId)"

requirements-completed: [XCUT-01]

# Metrics
duration: ~10min
completed: 2026-07-02
---

# Phase 13 Plan 01: XCUT-01 Beacon Comment Parity Summary

**Live Beacon (kind 37521) wired to full comment parity — LiveBeacon added to both useGeoComments unions and BeaconViewPanel mounts CommentsPanel on the 37521 coordinate, closing the last unwired kind (Story/Group/Sighting were already done).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-02T13:03Z
- **Completed:** 2026-07-02T13:11Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- `LiveBeacon` added to `UseGeoCommentsOptions.target` and the `react()` param unions — the comment stack has been kind-generic since Phase 8, so this was a pure type-union widening (no comment-machinery change).
- `BeaconViewPanel` now mounts `<CommentsPanel target={beacon} />` inside a `tone="discussion"` surface, identical to `StoryViewPanel`/`SightingViewPanel`; the Phase-12 deferral note is deleted from both the file header and the inline placeholder.
- New RED-then-GREEN test (`useGeoComments.beacon.test.ts`) pins that a real `LiveBeacon` cast flows through the generic `#A` filter to `37521:<pubkey>:<dTag>`, plus the defensive null-on-missing-dTag path (D-11). The derivation is typed against the shipped `UseGeoCommentsOptions['target']` union, so dropping `LiveBeacon` from the union would break the test at compile time.

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen useGeoComments unions to accept LiveBeacon + test** - `0953c40` (feat) — TDD: union widen (GREEN by construction) + `useGeoComments.beacon.test.ts`
2. **Task 2: Mount CommentsPanel in BeaconViewPanel + remove deferral note** - `8e56443` (feat)

_TDD note: because the widened union makes the test GREEN by construction (the pre-widening "RED" state was a compile error, not a runtime failure), Task 1 landed as a single feat commit rather than a separate test→feat pair._

## Files Created/Modified
- `src/features/social/hooks/useGeoComments.ts` — added `LiveBeacon` import + widened the `target` union, the `react()` param union, and the inner `reactTarget` param union (4 `LiveBeacon` occurrences).
- `src/components/info-panel/BeaconViewPanel.tsx` — imported `CommentsPanel`/`GeoFeatureItem`/`GeoComment`; added the 6 comment/mention props to `BeaconViewPanelProps` (verbatim from `StoryViewPanelProps`); mounted `CommentsPanel` on the beacon 37521 coordinate; removed the header + inline deferral notes; rephrased the pre-existing XSS header comment so the file has zero literal `dangerouslySetInnerHTML` tokens.
- `src/features/social/hooks/useGeoComments.beacon.test.ts` — new; 2 tests pinning the beacon comment-root address + null-on-missing-dTag.

## Decisions Made
- Followed the plan as specified (D-06 full parity, D-07 known-edge documented, expiry gate preserved).

## Deviations from Plan

None - plan executed exactly as written.

The one incidental touch worth noting: the pre-existing header-comment reference to `dangerouslySetInnerHTML` (line 30, from Phase 12) was rephrased so the threat-model acceptance `grep -c dangerouslySetInnerHTML == 0` holds literally. This changed a comment only — no render code — and reinforces the T-13-01-XSS mitigation note (the CommentsPanel mount reuses the existing escaped comment render path, adding no injection surface). Not a scope deviation.

## Threat Model Outcomes
- **T-13-01-XSS (mitigate):** satisfied. The mount reuses the existing `CommentsPanel` render path unchanged (escaped React text nodes, zero raw-HTML sink). `grep -c dangerouslySetInnerHTML BeaconViewPanel.tsx == 0`.
- **T-13-01-MISATTACH (accept):** the D-07 own-pubkey `d`-reuse misattach edge is a known residual. Throwaway-key-per-session (Phase 12 D-05) makes `37521:pubkey:d` effectively session-unique, so cross-session misattach only occurs in the own-pubkey opt-in case. **No de-dup/scoping built this phase** (per CONTEXT.md Deferred Ideas). Recorded as a residual.
- **T-13-01-GPS (mitigate):** no regression. The comment mount reads only `beacon.id`/`beacon.dTag`/`beacon.pubkey` for the CommentsPanel `key` + `target` — it does NOT read or emit `beacon.geometry`/position. `grep -c "beacon.geometry\|beacon.position" BeaconViewPanel.tsx == 0`.

## Known Residuals
- **D-07 own-pubkey d-reuse misattach** — a reused `d` across sessions on an own-pubkey (non-throwaway) beacon could let old kind-37517 comments carry onto a new beacon at the same `37521:pubkey:d` address. Documented, not fixed; a session-scoped comment-addressing / `d`-uniqueness fix is out of scope this phase (deferred, see CONTEXT.md Deferred Ideas → cordn agenda).

## Verification Evidence
- `bun test src/features/social/hooks/useGeoComments.beacon.test.ts` → 2 pass / 0 fail.
- `bun test` (full suite) → 760 pass / 0 fail (up from the 755 Phase-12 baseline: +2 new + resolved beacon fixtures; no regression). The "Failed to create optimize worker" log lines are an intentional worker-failure simulation inside a passing test.
- `bun run build` → succeeds (client + server + 5 workers).
- `bunx biome check` on all three files → clean.
- Acceptance greps: `LiveBeacon` in useGeoComments = 4 (≥3); deferral note = 0; `CommentsPanel ` = 3; `target={beacon}` = 1; `focusCommentId` = 3; `dangerouslySetInnerHTML` = 0; `beacon.geometry|beacon.position` = 0.

## Issues Encountered
None. Biome required single-line formatting of the widened `react()` param union and the test's `toEqual` array — both auto-fixed via `biome check --write`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- XCUT-01 comment-root widening is code-complete for all four kinds. XCUT-01 as a ROADMAP requirement remains open because later Phase-13 plans (13-03/13-04 Map Stack unification) also carry the XCUT-01 tag — do not mark the requirement fully done until the phase completes.
- Beacon comment deep-linking (`route.commentId` → `focusCommentId`) is threadable via the new `focusCommentId` prop but is NOT yet wired from the route dispatcher — that is Plan 13-02 (XCUT-02 / D-10, `handleInspectBeacon` commentId thread).
- The `onAddToMapStack` affordance the PATTERNS map anticipates for BeaconViewPanel is NOT part of this plan (Map Stack unification, 13-03/13-04).

## Self-Check: PASSED

- FOUND: src/features/social/hooks/useGeoComments.beacon.test.ts
- FOUND: src/features/social/hooks/useGeoComments.ts (modified)
- FOUND: src/components/info-panel/BeaconViewPanel.tsx (modified)
- FOUND: commit 0953c40 (Task 1)
- FOUND: commit 8e56443 (Task 2)

---
*Phase: 13-cross-cutting*
*Completed: 2026-07-02*
