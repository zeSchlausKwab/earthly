---
phase: 12-live-beacon-37521
plan: 05
subsystem: live-beacon (kind 37521) — authoring + reading + share UX (control panel, running banner, view panel, controller, deep-link, OG card)
tags: [beacon, ui, watchposition, throwaway-key, running-banner, og-card, deep-link, privacy, no-delete, staleness]

requires:
  - phase: 12-03
    provides: "useBeaconPublisher (throttled watchPosition + per-session throwaway signer; isLive/subState/session/startBeacon/stopBeacon)"
  - phase: 12-04
    provides: "BeaconsPanel browse rail + beaconsPanelProps no-op seams + useMapLayers visibleBeacons option + BEACON_HIT_LAYER + seed fixtures"
  - phase: 12-02
    provides: "LiveBeacon cast (.beacon.label/.geometry/.status/.expiresAt/.dTag) + beaconState + updateBeacon/stopBeacon lifecycle"
provides:
  - "BeaconControlPanel (Start authoring: time-box/visibility/identity/no-delete consent; no pin-drop)"
  - "RunningBeaconBanner (the one net-new always-on 'you are live' chrome + one-tap Stop)"
  - "BeaconViewPanel (label + live/stale/ended status + last-seen + countdown + Copy-share-link with the throwaway pubkey; no Delete; comment/react deferred)"
  - "useBeaconController (Start/Stop/Adjust/inspect binding useBeaconPublisher to the UI)"
  - "fetchBeaconOGData/BeaconOGData + fetchCachedBeaconEventOGData + generateBeaconOGHtml + the 'beacon' OGCacheType + handleBeaconRoute"
  - "the 'beacon' focusType + /beacon/:naddr thin route + a targeted {authors,#d} sub for link-only deep links"
affects: [phase-13-xcut (generalizes the thin per-kind /beacon route + mounts comment/react on 37521)]

tech-stack:
  added: []
  patterns:
    - "kind-substituted Sighting view/editor/controller/route/OG clone for the Live Beacon spine"
    - "controller-composes-publisher: useBeaconController owns the lifecycle + holds useBeaconPublisher; the panels are presentational"
    - "always-on chrome mounted over the map gated on publisher.isLive (no Sighting/Story twin)"
    - "deep-link link-only resolution via a targeted {authors,#d} useBeacons subscription (the #t:['live'] discovery surface never carries link-only)"

key-files:
  created:
    - src/features/geo-editor/hooks/useBeaconController.ts
    - src/components/info-panel/BeaconControlPanel.tsx
    - src/components/info-panel/BeaconViewPanel.tsx
    - src/components/RunningBeaconBanner.tsx
    - src/lib/og/fetchBeacon.ts
    - src/lib/og/relayFetch.ts
  modified:
    - src/features/geo-editor/GeoEditorView.tsx
    - src/components/AppSidebar.tsx
    - src/components/GeoEditorInfoPanel.tsx
    - src/features/geo-editor/hooks/useRouting.ts
    - src/features/geo-editor/store/types.ts
    - src/index.ts
    - src/lib/og/fetchEvent.ts
    - src/lib/og/cache.ts
    - src/lib/og/template.ts
    - src/lib/og/index.ts

key-decisions:
  - "Beacon view/control panels render inside GeoEditorInfoPanel (the entity full-panel multiplexer), not directly in GeoEditorView — mirrors how Sighting/Story panels are mounted; activeEntity gained a 'beacon' member"
  - "The running-banner countdown reads the user's OWN live beacon resolved from the subscription by the session d (+ pubkey for my-account), so the countdown stays honest off the published expiration rather than a separately-tracked timer"
  - "Link-only deep links resolve via a SECOND targeted useBeacons({authors,#d}) subscription because the default #t:['live'] discovery surface deliberately omits link-only beacons (P-6)"
  - "onStopBeacon is adapted at the GeoEditorView boundary (rail/view pass a beacon arg; the controller stops the OWN session, arg-less) — the owner can only ever stop their own live session"

patterns-established:
  - "Net-new always-on map chrome: a fixed .glass-panel banner gated on a live session, mounted once over the map regardless of the open panel"
  - "Controller-owns-publisher: the lifecycle hook composes the live-loop hook and exposes both the handlers AND the live session/subState the banner reads"

requirements-completed: [BEACON-01, BEACON-02, BEACON-03, BEACON-04]

duration: ~40min
completed: 2026-06-28
---

# Phase 12 Plan 05: Live Beacon Authoring + Reading + Share UX Summary

**The end-to-end Live Beacon (kind 37521) Start/Stop/View/Share flow: a no-pin-drop control panel (time-box / visibility-with-honesty-caveat / anonymous-default identity / no-delete consent), the one net-new always-on "you are live" banner with one-tap Stop, a read/detail panel with a throwaway-pubkey Copy-share-link, the `useBeaconController` binding the Plan-03 publisher to the UI, and a thin account-free `/beacon/:naddr` route + OG card with honest staleness.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-06-28
- **Tasks:** 3 auto tasks (re-grouped into 3 logical commits — see note) + 1 deferred human-verify checkpoint
- **Files modified:** 16 (6 created, 10 modified)

## Accomplishments

- **Wired the orphaned components into the real app.** The three beacon UI components (control / banner / view) existed but were imported/rendered nowhere; they are now mounted through the live Start flow.
- **`useBeaconController`** — composes `useBeaconPublisher` and exposes `handleShareLocation` / `handleStartBeacon` / `handleStopBeacon` / `handleAdjustBeacon` / `handleInspectBeacon` + the live `session`/`subState`. No pin-drop (position is GPS).
- **GeoEditorView** feeds `visibleBeacons` to `useMapLayers`, mounts `RunningBeaconBanner` always-on while a session is live, resolves the `/beacon/:naddr` deep link (incl. a targeted `{authors,#d}` sub so a **link-only** beacon opens), and threads the controller into both (desktop + mobile) AppSidebar mount sites.
- **AppSidebar / GeoEditorInfoPanel** — the Plan-04 no-op `beaconsPanelProps` stubs are replaced with the real controller handlers; `GeoEditorInfoPanel` renders `BeaconControlPanel` (control mode) and `BeaconViewPanel` (view mode) gated exactly like the Sighting editor/view branches; `EntityWorkspace`/`entityWorkspace` gained a `'beacon'` member.
- **Account-free share surface** — `/beacon/:naddr` route + the full OG card (fetch/cache/template/index/server) with the honest "Live location — may have ended" copy; the Plan-01 `fetchBeacon` RED test is GREEN.

## Task Commits

Re-grouped into three logical commits (per-original-task atomicity was impossible — a prior run was interrupted mid-plan with the OG surface + the three components already STAGED-but-UNCOMMITTED; this run finished the missing controller + wiring and landed the whole plan):

1. **OG share card + /beacon/:naddr route** — `20b77ba` (feat)
2. **BeaconControlPanel + BeaconViewPanel + RunningBeaconBanner** — `4a4a355` (feat)
3. **useBeaconController + GeoEditorView/AppSidebar/InfoPanel wiring + routing/types** — `3a7b4b0` (feat)

## Files Created/Modified

- `src/features/geo-editor/hooks/useBeaconController.ts` — Start/Stop/Adjust/inspect lifecycle binding the publisher to the UI (created)
- `src/components/info-panel/BeaconControlPanel.tsx` — Start authoring control, no pin-drop (staged → committed)
- `src/components/info-panel/BeaconViewPanel.tsx` — read/detail + Copy-share-link (throwaway pubkey), no Delete (staged → committed)
- `src/components/RunningBeaconBanner.tsx` — always-on "you are live" banner + Stop (staged → committed)
- `src/features/geo-editor/GeoEditorView.tsx` — visibleBeacons feed, banner mount, controller instantiation, /beacon route resolution, AppSidebar threading
- `src/components/AppSidebar.tsx` — 'beacon' EntityWorkspace, real beaconsPanelProps handlers, beacon control/view threaded into editorPanelProps
- `src/components/GeoEditorInfoPanel.tsx` — BeaconControlPanel + BeaconViewPanel render branches
- `src/features/geo-editor/hooks/useRouting.ts` — 'beacons' SIDEBAR_VIEW_MODES (runtime fix) + 'beacon' focusType + thin /beacon/:naddr parse
- `src/features/geo-editor/store/types.ts` — 'beacons' SidebarViewMode + 'beacon' focusType
- `src/lib/og/{fetchBeacon,relayFetch,fetchEvent,cache,template,index}.ts` + `src/index.ts` — account-free OG card + route

## Decisions Made

- Beacon panels render inside `GeoEditorInfoPanel` (the entity full-panel multiplexer), matching Sighting/Story — not directly in GeoEditorView.
- The banner countdown reads the user's own live beacon resolved from the subscription by the session `d` (+ pubkey for my-account), so the countdown is honest off the published `expiration`.
- Link-only deep links resolve via a second targeted `useBeacons({authors,#d})` subscription (the `#t:['live']` discovery surface omits link-only by design, P-6).
- `onStopBeacon` is adapted at the GeoEditorView boundary: the rail/view pass a beacon arg, but the controller stops the OWN session arg-less (an owner can only stop their own live session).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `'beacons'` missing from the runtime `SIDEBAR_VIEW_MODES` array in useRouting**
- **Found during:** Continuation of the interrupted run (carried as an unstaged working-tree edit from the prior run).
- **Issue:** `'beacons'` was added to the `SidebarViewMode` *type* but not the runtime `SIDEBAR_VIEW_MODES` array — beacon nav fell through to the `'contexts'` default, so the rail/route never resolved to the Beacons surface.
- **Fix:** Added `'beacons'` to the runtime array (kept the prior run's edit).
- **Files modified:** `src/features/geo-editor/hooks/useRouting.ts`
- **Verification:** build green; the `/beacon/:naddr` parse + the rail destination resolve to `sidebarView:'beacons'`.
- **Committed in:** `3a7b4b0`

**2. [Rule 3 - Blocking] Removed the now-redundant `onOpenBeacon` AppSidebar prop**
- **Found during:** Wiring (Task 2 equivalent).
- **Issue:** With `onInspectBeacon` becoming the canonical open handler, the destructured `onOpenBeacon` was unused (a biome `noUnusedVariables` error).
- **Fix:** Dropped `onOpenBeacon` from the interface + destructuring; `beaconsPanelProps.onOpenBeacon` now points at the local `handleInspectBeacon` wrapper, and GeoEditorView passes only `onInspectBeacon`.
- **Files modified:** `src/components/AppSidebar.tsx`, `src/features/geo-editor/GeoEditorView.tsx`
- **Verification:** biome clean on the beacon-specific files; build green.
- **Committed in:** `3a7b4b0`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking).
**Impact on plan:** Both necessary for correctness — #1 was the silent bug that broke beacon nav; #2 was a blocking lint error from the canonical-handler consolidation. No scope creep.

## Issues Encountered

- **Pre-existing out-of-scope lint (NOT introduced):** `src/components/GeoEditorInfoPanel.tsx:943` and `:996` carry `lint/a11y/noLabelWithoutControl` on the contributor Group-attach `<label>` rows. These predate Plan 12-05 (present unchanged at HEAD; the beacon diff adds zero `<label>`s). Left untouched per the executor Scope Boundary rule; logged to `deferred-items.md`. All beacon-specific files are biome-clean.

## Verification

- `bun test` full suite — **755 pass / 0 fail** (incl. the Plan-01 `fetchBeacon` test now GREEN 3/3). No regression.
- `bun run build` — green (client + server + 5 workers).
- `bunx biome check` — clean on all beacon-specific files (useBeaconController, the 3 components, GeoEditorInfoPanel beacon branches, useRouting, store/types, the OG surface). The only remaining biome errors are the two pre-existing out-of-scope `noLabelWithoutControl` violations in the GroupAttachField code (above).
- grep confirmed: `BeaconViewPanel` imports NO `CommentsPanel`/`GeoSocialActions` and has NO Delete action; the `/beacon` route + OG card carry the throwaway pubkey and the "may have ended" copy; the caveat string is verbatim.

## Threat Surface

All `mitigate`-disposition threats from the plan threat model are satisfied (and inherited from the staged components verbatim):
- **T-12-05-DEANON** — identity defaults to Anonymous (throwaway key, `useBeaconPublisher`); My-account swaps the consent to the stronger copy.
- **T-12-05-LINKHONESTY** — Link-only reveals the non-dismissible "unlisted, not private" caveat inline.
- **T-12-05-NODELETE** — pressing Start IS the consent; Stop is the only teardown (alert-dialog + no-delete recap); there is NO Delete action.
- **T-12-05-FROZEN** — the view gates on `isExpired`; the banner shows a `searching` sub-state on fix loss; staleness derives off `beaconState`/`created_at`.
- **T-12-05-OGLEAK** — `fetchBeaconOGData` returns null for an expired beacon; the crawler renders the generic fallback (the label is never leaked).
- **T-12-05-XSS** — label renders as auto-escaped React text + the audited `generateOGHtml` escaping; no `dangerouslySetInnerHTML`.
- **T-12-SC** `accept` holds — zero package installs.

No new threat surface beyond the plan's register.

## Checkpoint Status

The plan's terminal `checkpoint:human-verify` (gate="blocking") covers the live-GPS, account-free-link, permission-denied, and discovery-gating behaviors that cannot be unit-tested. Per the project config (`human_verify_mode: end-of-phase`), this is DEFERRED to the consolidated end-of-phase UAT — the automated gates (full suite + build + biome on the beacon files) are all green, which the checkpoint requires regardless. The seed fixtures from Plan 04 (live / stale / ended / expired / link-only) are ready to exercise it.

## Next Phase Readiness

- BEACON-01..04 are delivered end-to-end (Start → live banner → Stop → ended → expire; public-vs-link-only; account-free share with honest staleness).
- Phase 13 (XCUT) is the home for: generalizing the thin per-kind `/beacon/:naddr` route, and mounting comment/react on the 37521 coordinate (explicitly deferred here per research Open Q1).
- One open item for end-of-phase: the deferred blocking human-verify UAT above.

## Self-Check: PASSED

All created files exist on disk (`useBeaconController.ts`, the 3 beacon components, `fetchBeacon.ts`); all three logical commits (`20b77ba`, `4a4a355`, `3a7b4b0`) are present in git history. Full suite 755/0; build green; biome clean on the beacon-specific files.

---
*Phase: 12-live-beacon-37521*
*Completed: 2026-06-28*
