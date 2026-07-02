---
status: diagnosed
trigger: "Phase 13 UAT Tests 2 & 3 — beacon 'Copy share link' produces a malformed URL /#/beacons/beacon/naddr... (doubled prefix). Opening it lands on the beacon LIST, not the beacon inspect panel. Beacon comment deep-links fail the same way. BEACON-ONLY — Story/Group/Sighting/geoevent/mapcontext share links all resolve correctly."
created: 2026-07-02T14:30:00Z
updated: 2026-07-02T14:45:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED — the beacon Copy-share-link button hand-builds a legacy hash URL with a doubled prefix (`/#/beacons/beacon/${naddr}`) instead of routing through the canonical `buildSharePath`/`getEntitySharePath` that every other kind uses.
test: Read BeaconViewPanel.handleCopyShareLink (emit side), GeoSocialActions.buildSharePath/handleShare (canonical emit side), useRouting.parsePathSegments (parse side).
expecting: The beacon builder string contains `beacons/beacon` literally; the canonical builder emits `/beacon/${naddr}` singular.
next_action: Return ROOT CAUSE FOUND — read-only diagnosis complete, no fix applied.

## Symptoms

expected: Clicking "Copy share link" on a live beacon copies `${origin}/beacon/:naddr` (singular `beacon` prefix, matching `SHARE_ROUTES.beacon`). Opening it focuses that specific beacon in the INSPECT view panel. Comment deep-links `/beacon/:naddr/comment/:id` focus the comment.
actual: Copies `http://localhost:3000/#/beacons/beacon/naddr1qvzqqqyjj...` — a legacy hash form with the sidebar-view segment `beacons/` (plural) prepended BEFORE the share segment `beacon/naddr` (singular). Opening it lands on the beacon LIST (sidebar view 'beacons'), shows intro/tour dialogs on fresh land, and does NOT open the specific beacon's inspect panel. Comment deep-links fail identically.
errors: none (no thrown error — silent misroute)
reproduction: Phase 13 UAT Tests 2 & 3. On a live beacon, BeaconViewPanel → "Copy share link" → open the copied URL in a new tab.
started: BEACON-ONLY, discovered 2026-07-02 during Phase 13 UAT. The other four kinds route through the canonical buildSharePath and are correct.

## Eliminated

- hypothesis: "The route dispatcher (SHARE_ROUTES) or parser is wrong for beacon."
  evidence: SHARE_ROUTES.beacon = { focusType:'beacon', sidebarView:'beacons' } is present (useRouting.ts:98) and useRouting.dispatch.test.ts pins /beacon/:naddr byte-for-byte (12/12 pass). Phase-13 VERIFICATION confirms getEntitySharePath now returns 'beacon' for LIVE_BEACON_KIND (GeoSocialActions.tsx:60-61). The parse/dispatch side is correct — the OTHER four kinds share correctly through the SAME dispatcher. The bug is emit-side only.
  timestamp: 2026-07-02T14:40:00Z

- hypothesis: "getEntitySharePath is missing the LIVE_BEACON_KIND case (the CR-02 gap)."
  evidence: That gap WAS the Phase-13 code-review blocker, but it was fixed in commit b6492c3 — GeoSocialActions.tsx:60-61 now has `case LIVE_BEACON_KIND: return 'beacon'`. The canonical GeoSocialActions Share button on a beacon now correctly emits `/beacon/:naddr`. The remaining bug is a SECOND, independent emitter: BeaconViewPanel's own legacy hand-built string, which never calls getEntitySharePath at all.
  timestamp: 2026-07-02T14:42:00Z

## Evidence

- timestamp: 2026-07-02T14:35:00Z
  checked: src/components/info-panel/BeaconViewPanel.tsx:177-197 (handleCopyShareLink)
  found: The URL is hand-constructed as a template literal: `const url = ${window.location.origin}/#/beacons/beacon/${naddr}` (line 191). It nip19.naddrEncode's the beacon itself, then prepends BOTH `#/beacons/` (legacy hash + plural sidebar-view segment) AND `beacon/` (singular share prefix). This is the exact doubled-prefix string the user reported.
  implication: This is the emit-side root cause. The `beacons/` sidebar-view segment is baked into the literal — nothing at runtime "prepends the current sidebar route"; the constant string itself is wrong.

- timestamp: 2026-07-02T14:37:00Z
  checked: src/features/social/comments/GeoSocialActions.tsx — buildSharePath (417-464), getEntitySharePath (48-65), handleShare (524-539)
  found: The canonical path used by EVERY other kind: getEntitySharePath(kind) returns a SINGLE prefix ('geoevent'|'context'|'story'|'sighting'|'beacon'); buildSharePath returns `/${sharePath}/${naddr}` (e.g. `/beacon/naddr`) or `/${sharePath}/${naddr}/comment/${id}`; handleShare does `new URL(sharePath, window.location.origin)` → `${origin}/beacon/naddr` — a CLEAN path (no `#/`), SINGLE prefix. No sidebar-view segment is ever prepended.
  implication: The correct beacon URL is `${origin}/beacon/:naddr`. BeaconViewPanel's builder diverges on two axes at once: (1) legacy `#/` hash form instead of clean path, and (2) an extra `beacons/` sidebar-view segment.

- timestamp: 2026-07-02T14:39:00Z
  checked: src/features/geo-editor/hooks/useRouting.ts — parsePathSegments (108-219), SHARE_ROUTES (90-99), isSidebarViewMode (51-53), SIDEBAR_VIEW_MODES (8-24), upgradeLegacyHashRoute (255-262), parseLocation (227-241)
  found: On load, upgradeLegacyHashRoute rewrites the `#/beacons/beacon/naddr` hash to the clean path `/beacons/beacon/naddr` (replaceState). parsePathSegments then splits to ['beacons','beacon','naddr']. `first='beacons'` is NOT a SHARE_ROUTES key (only the SINGULAR 'beacon' is; SHARE_ROUTES has no 'beacons'). It is not 'user'/'context'. It IS an isSidebarViewMode value ('beacons' ∈ SIDEBAR_VIEW_MODES), so control reaches the sidebar-tail branch (L205-215). There, the branch keys off segments[1]/segments[2], NOT segments[0]. The extra leading 'beacons' segment shifts the naddr from its expected position: in the canonical `/beacon/naddr` the naddr is segments[1]; here it is pushed to segments[2] and the focusType candidate is read from segments[1]='beacon'.
  implication: The extra 'beacons/' segment forces the parse down the isSidebarViewMode('beacons') sidebar branch → sidebarView:'beacons' (the LIST) is always set. Whether focus also fires depends on the exact segment alignment (below).

- timestamp: 2026-07-02T14:41:00Z
  checked: parsePathSegments sidebar-tail branch (useRouting.ts:205-215) against the two reported URL shapes
  found: (A) Share link `/beacons/beacon/naddr` → segments ['beacons','beacon','naddr']: L206 `segments[1]='beacon' && segments[2]='naddr' && isFocusType('beacon')` is TRUE → returns {focusType:'beacon', naddr:'naddr', sidebarView:'beacons'}. So sidebarView is FORCED to the LIST ('beacons') regardless; the render opens the beacon LIST view. (B) Comment deep-link `/beacons/beacon/naddr/comment/:id` → segments ['beacons','beacon','naddr','comment','id']: L206 still matches on segments[1..2]; commentId = segments[3]==='comment' && segments[4] → id. Again sidebarView:'beacons' (list). In BOTH cases the doubled prefix guarantees sidebarView='beacons' (the list) — the user's exact symptom ("landing on the beacon list").
  implication: The `beacons/` segment is what pins the sidebar to the LIST. Even where focusType/naddr are coincidentally still parsed, the app opens the beacon-list sidebar view rather than the intended inspect panel presentation, plus a fresh land shows the tour/intro because it is treated as a plain list-view visit rather than a share-form deep link. The canonical `/beacon/naddr` (2 segments) instead matches SHARE_ROUTES (L148-156) which is the tested, correct path used by all other kinds.

- timestamp: 2026-07-02T14:43:00Z
  checked: Phase 13 VERIFICATION anti-patterns table + 13-UAT gaps
  found: 13-VERIFICATION flags WR-01 explicitly: "BeaconViewPanel.tsx:191 — Legacy `/#/` hash-form Copy-share-link URL" as a non-blocking WARNING. It was logged but never fixed; the verification's SC-2b PASS covers only the GeoSocialActions/CommentsPanel Share button (which was fixed by b6492c3), NOT BeaconViewPanel's separate legacy builder. So two independent beacon share emitters exist; only one was corrected.
  implication: The verification passed because it exercised the canonical emitter; the UAT failed because the user clicked BeaconViewPanel's "Copy share link" button, which uses the un-fixed legacy builder. This is why it is beacon-only AND why prior verification did not catch it.

## Resolution

root_cause: |
  BeaconViewPanel.handleCopyShareLink (src/components/info-panel/BeaconViewPanel.tsx:177-197) is a SECOND, legacy beacon-share emitter that hand-constructs the URL as a template literal:
      const url = `${window.location.origin}/#/beacons/beacon/${naddr}`   // line 191
  This string bakes in TWO defects at once:
    1. Legacy `#/` hash form (WR-01) instead of the canonical clean path.
    2. A doubled prefix: the sidebar-view segment `beacons/` (plural) is prepended BEFORE the share segment `beacon/` (singular). Only the singular `beacon/:naddr` is a SHARE_ROUTES key.
  On open, upgradeLegacyHashRoute rewrites `#/beacons/beacon/naddr` → clean `/beacons/beacon/naddr`, which parsePathSegments splits to ['beacons','beacon','naddr']. Because `beacons` is a valid isSidebarViewMode (SIDEBAR_VIEW_MODES) but NOT a SHARE_ROUTES key, the parse takes the sidebar-tail branch (useRouting.ts:205-215) and FORCES sidebarView:'beacons' — the beacon LIST — instead of matching SHARE_ROUTES.beacon (the tested `/beacon/:naddr` share form). The comment deep-link `/beacons/beacon/naddr/comment/:id` fails the same way.
  It is BEACON-ONLY because every other kind's Share button routes through the canonical GeoSocialActions.buildSharePath → getEntitySharePath → handleShare pipeline, which emits a CLEAN, SINGLE-prefix `/<kind>/:naddr` path. BeaconViewPanel is the only panel that ships its own bespoke share-URL string that bypasses that pipeline. The Phase-13 CR-02 fix (b6492c3) corrected getEntitySharePath, so the canonical beacon Share button is now correct — but BeaconViewPanel's separate legacy builder (flagged as WR-01, deferred) was never aligned, and that is the button the UAT user clicked.

fix: "" # find_root_cause_only — no fix applied

verification: "" # not applicable in diagnose-only mode

files_changed: []
