---
phase: 11-temporal-sighting
plan: 04
subsystem: sighting-reading-sharing-ui
tags: [kind-37522, sighting-view-panel, comment-react-mount, nip-40-expiry-og, deep-link-route, og-card, sight-03, sight-04, d-08, xcut-flag]

# Dependency graph
requires:
  - phase: 11-temporal-sighting
    plan: 03
    provides: reserved SightingViewPanel mount point in GeoEditorInfoPanel + /sighting threading; AppSidebar 'sighting'/'sightings' wiring; useSightingEditor (viewSighting/handleInspectSighting); sightings rail
  - phase: 11-temporal-sighting
    plan: 02
    provides: useSightings (dropExpired'd cast subscription), classifyObservationState, TemporalSighting cast + content.geometry, isExpired/dropExpired
  - phase: 10-story-article-37520
    provides: StoryViewPanel (cloned), handleStoryRoute + fetchStoryOGData + generateStoryOGHtml OG path (cloned), useRouting 'story' focusType, audited generateOGHtml escaping (T-10-09)
provides:
  - "SightingViewPanel — read view: escaped title/description, observation-time range row + observation-state cue + expiry countdown, NO Markdown body; CommentsPanel/GeoSocialActions mount on the 37522 coordinate (SIGHT-04); expired-sighting gate (SIGHT-03 detail read path)"
  - "Comment/react target-union widening (+ TemporalSighting) across CommentsPanel/useGeoComments/useGeoReactions; getEntitySharePath 37522 → 'sighting'"
  - "fetchSightingOGData + isOGEventExpired — server OG fetch independently NIP-40-expiry-checks and returns null for an expired sighting (SIGHT-03, Pitfall P-1, 5th read path)"
  - "/sighting/:naddr deep-link route (handleSightingRoute, OG for crawlers + redirect for users) + OG image branch + generateSightingOGHtml (D-08)"
  - "useRouting 'sighting' focusType + share-form parse + buildRoutePath arm; store RouteSnapshot/focusedType widened; GeoEditorView focusType==='sighting' resolve branch"
affects: []  # final plan of Phase 11

# Tech tracking
tech-stack:
  added: []  # zero new deps — clones existing OG/route/comment modules
  patterns:
    - "Per-read-path dropExpired discipline completed: the OG server fetch (raw-WS, no cast) is the 5th and final SIGHT-03 read path — isOGEventExpired gates it independently of the subscription drop (Pitfall P-1)"
    - "Comment/react SIGHT-04 = pure mount + type-only union widening; GeoCommentFactory.root takes rootKind as a runtime param (no allowlist) so kind 37522 needs zero factory change — full NIP-22 K/k read-side widening stays Phase 13 / XCUT-01"
    - "Thin per-kind deep-link clone of the 'story' focusType (parse + buildRoutePath arm), NOT a generalized entity router — Phase 13 owns XCUT-02 (Pitfall P-5)"

key-files:
  created:
    - src/components/info-panel/SightingViewPanel.tsx
    - src/components/info-panel/SightingViewPanel.test.ts
    - src/lib/og/fetchEvent.test.ts
  modified:
    - src/components/info-panel/index.ts
    - src/components/GeoEditorInfoPanel.tsx
    - src/features/social/comments/CommentsPanel.tsx
    - src/features/social/comments/GeoSocialActions.tsx
    - src/features/social/hooks/useGeoComments.ts
    - src/features/social/hooks/useGeoReactions.ts
    - src/lib/og/fetchEvent.ts
    - src/lib/og/cache.ts
    - src/lib/og/template.ts
    - src/lib/og/index.ts
    - src/lib/og/fetchContextEvent.ts
    - src/index.ts
    - src/features/geo-editor/hooks/useRouting.ts
    - src/features/geo-editor/store/types.ts
    - src/features/geo-editor/GeoEditorView.tsx

key-decisions:
  - "SightingViewPanel renders the SIGHT-03 expiry gate at the DETAIL read path independently (isExpired(sighting.event, unixNow())) even though useSightings already dropExpired's at the subscription — the per-read-path discipline (Pitfall P-1) means the view never trusts an upstream filter. An expired sighting shows the UI-SPEC 'This sighting isn't available — it may have expired or been removed.' copy, not the content."
  - "SIGHT-04 widened the type unions ONLY (CommentsPanel target, useGeoComments target/react, useGeoReactions ReactableEvent). The NIP-22 K/k root-kind enum is NOT widened — runtime rooting via GeoCommentFactory.root(kind=targetKind) is already kind-generic, so the Sighting's own thread works end-to-end; full read-side widening across all four kinds is explicitly deferred to Phase 13 / XCUT-01 (Phase-10 XCUT-01 minimal-slice precedent)."
  - "The OG expiry check is a pure exported helper isOGEventExpired(event, now) (epoch seconds, never Date.now() ms) so it is unit-testable without a relay WebSocket. fetchSightingOGData calls it with Math.floor(Date.now()/1000) and returns null when past — applied BEFORE parsing title/description so an expired sighting's content never even reaches the card builder."
  - "The /sighting route was kept a thin per-kind clone of 'story' (parse block + buildRoutePath param + isFocusType + GeoEditorView resolve branch) — NOT generalized into an entity router. Phase 13 (XCUT-02) owns canonical addressing convergence; this avoids double-implementing (Pitfall P-5)."
  - "viewSighting was already hook-local in useSightingEditor (Plan 03 decision) and handleInspectSighting already navigates to 'sightings'. The route resolve branch finds the sighting via the already-dropExpired'd useSightings() casts and calls handleInspectSighting — no promotion of viewSighting into the store/applyRouteState was needed, keeping the wiring minimal (the slice clears viewDataset/viewContext/viewStory on a sighting focus, which is correct — a sighting view is hook-local)."

patterns-established:
  - "All 5 SIGHT-03 read paths now each apply dropExpired/isExpired independently: useSightings subscription (Plan 02), map-layer source build (Plan 03), the detail view-panel render (this plan), the Group foreign lane (inherited), and the OG server fetch (this plan) — no single chokepoint, per Pitfall P-1"

requirements-completed: [SIGHT-03, SIGHT-04]

# Metrics
duration: ~50min
completed: 2026-06-28
---

# Phase 11 Plan 04: Temporal Sighting Reading + Sharing Surface Summary

**The kind-37522 reading + sharing surface: a SightingViewPanel read view (observation-time range + expiry countdown, escaped text, no Markdown body) that mounts comment/react on the Sighting coordinate via a pure type-union widening (SIGHT-04), plus a thin /sighting/:naddr deep-link route and an OG social card whose server-side fetch independently NIP-40-expiry-checks so an expired/removed sighting is never leaked (SIGHT-03, D-08) — closing Phase 11.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-06-28
- **Tasks:** 2 auto (both TDD)
- **Files:** 18 (3 created, 15 modified)

## Accomplishments

- **Task 1 — SightingViewPanel + comment/react mount + target-union widening (`ac95155`):**
  - `SightingViewPanel.tsx`: cloned `StoryViewPanel`'s `EntityPanelShell`/`EntityPanelSurface`/`EntityPanelSectionHeader` chrome + owner Edit/Delete (`ConfirmDeleteAction`) split + no-selection fallback ("No sighting selected"). STRIPPED the `StoryProposalsPanel`/`StoryProposeEditDialog` (a Sighting has no propose-edit) and the Markdown `RichContentRenderer`. The body is now: title/description as ESCAPED React text nodes (no `dangerouslySetInnerHTML`, T-11-04-02), an observation-state cue (LIVE/Upcoming/relative-date via `classifyObservationState`, D-06), an expiry countdown ("Fades in 6 days" / "Fades soon" / none if never, D-05), and an observation-time range row ("Observed …" / "Until …", D-03). **SIGHT-03 detail gate:** `isExpired(sighting.event, unixNow())` ⇒ render the expired/not-found copy instead of content.
  - `CommentsPanel` mount cloned unchanged — that IS the SIGHT-04 implementation. The only code change for SIGHT-04 is the type-union widening: `CommentsPanel.target`, `useGeoComments` target + `react`, `useGeoReactions.ReactableEvent` all `+ TemporalSighting`. `GeoCommentFactory.root(kind=targetKind)` is runtime-kind-generic — zero factory change.
  - `getEntitySharePath` in `GeoSocialActions.tsx` returns `'sighting'` for `TEMPORAL_SIGHTING_KIND` so a Sighting's share link resolves to `/sighting/:naddr`.
  - Mounted `SightingViewPanel` in `GeoEditorInfoPanel`'s view-mode branch (before the Story branch), replacing the Plan-03 reserved `void viewSighting` stub; wired `onEditSighting`/`onDeleteSighting` (un-prefixed from `_`). Both the desktop `AppSidebar` and mobile `MobilePanel` mounts already thread the props (Plan 03).
  - **TDD:** RED test for the pure presentation helpers (`formatObservationRange`, `formatExpiryCountdown`) failed on the missing module, then GREEN (8 pass).
- **Task 2 — /sighting/:naddr route + expiry-aware OG card (`83fb060`):**
  - `fetchEvent.ts`: `isOGEventExpired(event, now)` pure predicate (epoch seconds, defensive on a non-numeric tag) + `fetchSightingOGData` cloning `fetchStoryOGData` — guards on `TEMPORAL_SIGHTING_KIND`, parses `title`/`description` (Sighting has `description`, not the Story's `summary`), and **returns null if the NIP-40 `expiration` is past BEFORE parsing content** (Pitfall P-1, SIGHT-03 — the OG fetch is a separate raw-WS read path with no cast/filter).
  - `cache.ts`: `OGCacheType += 'sighting'`, `fetchAndCacheRecord` branch, `fetchCachedSightingEventOGData`. `template.ts`: `generateSightingOGHtml` reusing the audited `generateOGHtml` escaping (no cover image, T-10-09 carry-over). `index.ts` (og barrel): exports the new symbols.
  - `src/index.ts`: `handleSightingRoute` cloning `handleStoryRoute` (isCrawler → `fetchCachedSightingEventOGData` → `generateSightingOGHtml`; user redirect to `/#/sightings/sighting/${naddr}`), registered `/sighting/:naddr` (+ `/comment/:commentId`) alongside story/context/geoevent, plus a `type === 'sighting'` branch in `handleOGImageRoute`.
  - `useRouting.ts`: `'sighting'` added to the `focusType` union, `isFocusType` guard, a `first === 'sighting'` share-form parse block → `{ focusType: 'sighting', naddr, sidebarView: 'sightings' }`, and the `buildRoutePath`/`navigateTo`/`navigateToComment` focusType params. Uses `buildRoutePath`, NOT `buildRouteHash`. Thin per-kind clone (Pitfall P-5).
  - `store/types.ts`: `RouteSnapshot.focusType` + `focusedType` widened to `'sighting'` so `applyRouteState` accepts the widened route.
  - `GeoEditorView.tsx`: `encodeSightingNaddr` helper + a `route.focusType === 'sighting'` branch in the focus-route resolve that finds the sighting via the already-`dropExpired`'d `useSightings()` casts and calls `handleInspectSighting` (D-08).
  - **TDD:** RED test for `isOGEventExpired` failed on the missing export, then GREEN (5 pass).

## Task Commits

1. **Task 1: SightingViewPanel + comment/react mount + target-union widening (SIGHT-04)** — `ac95155` (feat)
2. **Task 2: /sighting/:naddr route + expiry-aware OG card (D-08, SIGHT-03 server path)** — `83fb060` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

## Deviations from Plan

### Auto-fixed Issues

None that changed behavior. The plan executed as written. Two small, in-scope notes (NOT behavioral deviations):

1. **[Rule 3 — Blocking, in-scope] Widened `store/types.ts` `RouteSnapshot.focusType` + `focusedType`.** The plan's read_first listed `useRouting.ts` for the `'sighting'` focusType but the parsed `RouteState` is passed to the store's `applyRouteState`, whose `RouteSnapshot` type (and the `focusedType` state field) are a structural subset declared in `store/types.ts` to avoid a hook↔store import cycle. Widening both to `'sighting'` was required for the route to typecheck end-to-end. No behavior change — the slice already clears `viewDataset`/`viewContext`/`viewStory` on a non-matching focus, which is correct for a hook-local `viewSighting` (the sighting view is opened by the resolve branch calling `handleInspectSighting`, not by the store).
2. **[Rule 3 — Blocking, in-scope, formatting] Incidental biome reformat of `src/lib/og/fetchContextEvent.ts`.** Running `biome check --write src/lib/og` (a directory, the cleanest scope for the OG module) auto-fixed pre-existing whitespace/argument-wrap drift in `fetchContextEvent.ts`. Formatting-only, zero behavior change; folded into the Task-2 commit since it lives in the same module touched by this plan.

## Authentication Gates

None — comment/react reuse the existing `accounts.signer` contract already proven on Groups/Stories; the OG/route surfaces are read-only server paths with no signer.

## Test Results (success criteria)

- **New TDD tests:** `SightingViewPanel.test.ts` (8 pass — observation-range + expiry-countdown helpers) and `fetchEvent.test.ts` (5 pass — `isOGEventExpired` NIP-40 gate, including the malformed-tag-never-expires defensive case).
- **Temporal Sighting / social scope** (`bun test src/components/info-panel`, `src/lib/og`): green, no regression.
- **Full suite** (`bun test`): **730 pass / 0 fail / 3300 expect() calls / 83 files** (up +13 from Plan 03's 717, exactly the new test count — no regression). The `optimizeClient.test.ts` worker-timeout warnings are that test deliberately exercising the worker-failure path; it passes.
- **`bun run build`:** green (client + server + 5 workers).
- **`biome check`** over the plan scope (`src/components/info-panel/SightingViewPanel*`, `src/components/GeoEditorInfoPanel.tsx`, the 4 comment/react files, `src/lib/og/*`, `src/index.ts`, `src/features/geo-editor/hooks/useRouting.ts`): **clean.** The 2 `noLabelWithoutControl` errors in `GeoEditorInfoPanel` and the 1 `useExhaustiveDependencies` in `CommentsPanel` are **pre-existing** (confirmed unrelated to this plan's diffs — the latter is a hook I did not touch) and explicitly out-of-scope per the SCOPE BOUNDARY.

### key_links verification (grep)

- `fetchEvent.ts`: `isOGEventExpired` returns `expiration < now`; `fetchSightingOGData` calls it and returns null before parsing; guards on `TEMPORAL_SIGHTING_KIND` ✓
- `src/index.ts`: `handleSightingRoute` exists; `/sighting/:naddr` (+ `/comment`) registered; OG-image `type === 'sighting'` branch ✓
- `GeoSocialActions.tsx`: `case TEMPORAL_SIGHTING_KIND: return 'sighting'` ✓
- Comment/react unions: `TemporalSighting` present in `CommentsPanel.tsx` (×2), `useGeoComments.ts` (×4), `useGeoReactions.ts` (×2) ✓
- `useRouting.ts`: `first === 'sighting'` parse via `buildRoutePath` (not `buildRouteHash`) ✓

## Known Stubs

None. The reading surface is fully wired: the detail view renders + gates on expiry, comment/react work end-to-end on the Sighting thread, the `/sighting/:naddr` deep link resolves to the view, and the OG card renders for crawlers (expiry-aware). The Plan-03 `SightingsPanel` "Copy link" still writes the addressable coordinate rather than the new naddr deep-link; promoting it to `/sighting/:naddr` is a trivial follow-up but was outside this plan's `files_modified` (SightingsPanel.tsx is not in scope) — flagged for a Phase-13 / polish pass.

## Threat Flags

None. No security-relevant surface beyond the plan's `<threat_model>` was introduced. All mitigations are in place:
- **T-11-04-01 (OG leak of expired sighting):** `isOGEventExpired` gates `fetchSightingOGData` before content parse — an expired sighting yields null and renders the generic fallback card.
- **T-11-04-02 (XSS):** view renders escaped React text nodes (no `dangerouslySetInnerHTML`); OG html reuses the audited `generateOGHtml` escaping (T-10-09).
- **T-11-04-03 (OG SSRF/exhaustion):** reuses the shipped OG cache + bounded raw-WS `fetchEventFromRelay`; the naddr decode validates kind (`!== TEMPORAL_SIGHTING_KIND` → null) before any render.
- **T-11-04-04 (forged 37522 in resolve):** the resolve finds the sighting via `useSightings()` (filter-before-cast + dropExpired); the view render is gated on `isExpired`.
- **T-11-04-SC:** zero new deps.

## Phase-13 scope flags (recorded)

- **XCUT-01** (NIP-22 read-side K/k root-kind widening across all four kinds): Phase 11 widened only the comment/react TYPE unions so the Sighting's own thread works; the enum widening stays Phase 13.
- **XCUT-02** (canonical entity routing/addressing convergence): the `/sighting/:naddr` route is a thin per-kind clone of `'story'`, not a generalized router; Phase 13 owns generalization.

## Next Plan Readiness

- **Phase 11 is COMPLETE** — all four plans shipped (data layer 02, authoring+discovery 03, reading+sharing 04). SIGHT-01/02 closed in Plans 02/03's UI; SIGHT-03 (all 5 read paths) and SIGHT-04 close here. Automated gates green; the consolidated end-of-phase UAT (Plan-03's deferred human-verify + this plan's reading/route/OG verification) is the remaining human step before `/gsd-verify-work 11` + `/gsd-secure-phase 11`.
- No blockers. `gsd-tools` not on PATH — STATE/ROADMAP/REQUIREMENTS updated manually (the established v1.2 pattern).

## Self-Check: PASSED

- All 3 created files present on disk (`SightingViewPanel.tsx`, `SightingViewPanel.test.ts`, `fetchEvent.test.ts`); 15 modified files updated.
- Both task commits present in git log: `ac95155` (Task 1), `83fb060` (Task 2).

---
*Phase: 11-temporal-sighting*
*Completed: 2026-06-28*
