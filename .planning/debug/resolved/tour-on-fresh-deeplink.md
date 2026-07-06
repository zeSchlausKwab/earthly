---
status: resolved
resolved: 2026-07-03T07:45:45Z
resolved_note: "Resolved by 13-05 (1bc2acf) — deep-link-aware tour auto-start guard; UAT test 2 sub-symptom gone 2026-07-03."
trigger: "Landing FRESH on a beacon deep-link URL (/#/beacons/beacon/naddr...) shows the intro/tour/onboarding dialogs instead of going straight to the shared entity. UAT Phase 13 Test 2."
created: 2026-07-02T15:00:00Z
updated: 2026-07-02T15:00:00Z
---

## Current Focus

hypothesis: The tour/browse-landing prompt fires on a fresh beacon deep-link because the doubled-prefix routing bug (/#/beacons/beacon/naddr) degrades the route to a plain 'beacons' browse view, which resolves stance='browse' + no naddr focus, so the onboarding gate sees a normal cold-start browse landing. Need to determine if independent or downstream.
test: Read useRouting.ts route parsing, GeoEditorView showBrowseLandingPrompt gating, and the SHARE_ROUTES / isSidebarViewMode dispatcher.
expecting: If the landing prompt gate is stance==='browse' && no deep-link check, and the doubled-prefix bug forces stance='browse', then the tour is downstream of the routing bug.
next_action: Read useRouting.ts and grep for showBrowseLandingPrompt gating in GeoEditorView.tsx.

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: A shared/deep-linked beacon view suppresses cold-start onboarding; the recipient sees the specific entity, not the welcome tour.
actual: Landing fresh on /#/beacons/beacon/naddr... shows intro/tour/onboarding dialogs AND lands on the beacon LIST (sidebar view 'beacons') instead of the beacon inspect focus.
errors: (none — behavioral)
reproduction: Phase 13 UAT Test 2 — open a beacon share URL http://localhost:3000/#/beacons/beacon/naddr1qvzqqqyjjypzq... in a fresh tab.
started: Discovered 2026-07-02 during Phase 13 UAT.

## Eliminated
<!-- APPEND only -->

- hypothesis: The tour/onboarding is the BrowseLandingPrompt firing because the doubled-prefix routing bug degrades the beacon deep-link to a plain 'browse' stance.
  evidence: Simulated parsePathSegments(['beacons','beacon','NADDR']) → {focusType:'beacon', naddr, sidebarView:'beacons'}. Because segments[1]='beacon' IS a valid isFocusType(), the sidebar-tail branch (useRouting.ts:206) still extracts focusType='beacon'. applyRouteState (viewModeSlice.ts:80-84) sets stance='focus' when hasFocus, NOT 'browse'. So showBrowseLandingPrompt (GeoEditorView.tsx:834, gated stance==='browse') does NOT fire, and neither does the cold-start aggregate seed (line 851, same gate). The BrowseLandingPrompt is ruled out as the source of the "intro/tour dialogs."
  timestamp: 2026-07-02T15:20:00Z

## Evidence
<!-- APPEND only -->

- timestamp: 2026-07-02T15:10:00Z
  checked: TourManager.tsx + tour/store.ts + App.tsx mount site
  found: TourManager is mounted UNCONDITIONALLY in App.tsx:15 (a top-level sibling of GeoEditorView). Its auto-start effect (TourManager.tsx:13-18) fires driver.js `startTour()` 800ms after mount whenever `hasSeenTour` is false. `hasSeenTour` is seeded ONLY from localStorage key 'earthly-tour-seen' (store.ts:16-18). There is NO check of URL / route / stance / focusType / deep-link anywhere in the tour feature.
  implication: On ANY fresh load in a browser that has never completed/dismissed the tour (localStorage empty) — including a beacon deep-link — the driver.js tour auto-starts. This is route-blind. It is the "intro/tour dialogs" the user reports, independent of routing.

- timestamp: 2026-07-02T15:15:00Z
  checked: BeaconViewPanel.tsx:191 share-link builder vs SHARE_ROUTES keys
  found: The beacon "Copy share link" builds `${origin}/#/beacons/beacon/${naddr}` — the sidebar-view segment 'beacons' (plural) is DOUBLED in front of the 'beacon/naddr' (singular) share path. Server redirects at src/index.ts:257/260 and OG template (lib/og/template.ts:201) do the SAME doubled prefix. SHARE_ROUTES is keyed on singular 'beacon' (useRouting.ts:98); the canonical share path for other kinds is /geoevent/:naddr, /story/:naddr etc (no doubled list prefix).
  implication: The emitted URL is /beacons/beacon/naddr, not the canonical /beacon/naddr. This is the "doubled-prefix" routing bug the sibling gap describes. But see next entry for its actual routing effect.

- timestamp: 2026-07-02T15:20:00Z
  checked: parsePathSegments simulation for ['beacons','beacon','NADDR'] vs ['beacon','NADDR']
  found: Both resolve to focusType='beacon', naddr='NADDR', sidebarView='beacons'. The doubled URL does NOT degrade to a bare list route at the PARSER level — because in the sidebar-tail branch (useRouting.ts:204-213), segments[1]='beacon' passes isFocusType(), so a focus IS extracted. The routing outcome {focus:beacon + view:beacons} is byte-identical to the canonical path. The comment variant ['beacons','beacon','NADDR','comment','CID'] also correctly extracts commentId='CID'.
  implication: (a) The tour is NOT downstream of the doubled-prefix bug — a correct /beacon/naddr URL would produce the SAME stance='focus' and the SAME tour behavior, because the tour ignores routing entirely. (b) The "landing on the beacon LIST not inspect" symptom is a SEPARATE, downstream resolution problem: the route carries focusType='beacon'+naddr, so the routing layer is correct; the failure to open the inspect panel is in how the beacon focus naddr is RESOLVED to a cast/view panel (GeoEditorView.tsx ~2218 resolver / useBeaconController), OR sidebarView='beacons' shows the list UI while the inspect panel fails to mount — not a parser degradation. That belongs to the sibling routing/inspect gap, distinct from this tour gap.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  The driver.js first-run tour (src/features/tour/TourManager.tsx) auto-starts on ANY fresh
  page load whenever localStorage 'earthly-tour-seen' is unset. TourManager is mounted
  unconditionally in App.tsx:15 as a top-level sibling of GeoEditorView, and its auto-start
  effect (TourManager.tsx:13-18) calls startTour() 800ms after mount gated ONLY on
  !hasSeenTour. It never inspects the URL, route, stance, focusType, or deep-link state. So a
  fresh beacon deep-link land (never-toured browser) auto-starts the tour, same as any other
  cold load. This is INDEPENDENT of the doubled-prefix routing bug: the deep-link URL
  /#/beacons/beacon/naddr still parses to focusType='beacon' (stance='focus'), so the
  BrowseLandingPrompt / cold-start-seed browse gates do NOT fire — the tour is a separate,
  route-blind onboarding surface. A dedicated deep-link suppression guard is required; fixing
  the routing bug alone would NOT stop the tour.
fix: (diagnose-only — not applied) Suppress the auto-start when the initial URL is a
  shared/deep-linked entity route. Gate the TourManager.tsx:13-18 auto-start effect on a
  deep-link check (e.g. parseLocation().focusType !== 'none' || contextNaddr present, or a
  ?ms= present) so recipients of a shared link see the entity, not the welcome tour. This is
  separate from the doubled-prefix share-URL bug (BeaconViewPanel.tsx:191 + index.ts:257/260
  + og/template.ts:201) and the beacon-inspect-not-list resolution bug — all three are
  independent.
verification: (pending fix)
files_changed: []
