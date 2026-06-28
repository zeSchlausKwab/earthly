---
phase: 11-temporal-sighting
verified: 2026-06-28T08:03:27Z
status: human_needed
score: 3/4
overrides_applied: 0
gaps: []
human_verification:
  - test: "Sighting appears in Group contribution lane after c-attach"
    expected: "After a user publishes a Sighting with a Group attached (via GroupAttachField), that Sighting appears in the Group's ForeignLane (Community contributions). ROADMAP SC#2 requires this to be visually observable."
    why_human: "The ForeignLane subscription (buildAttachDiscoveryFilter in src/lib/group/attach.ts) is hardwired to kinds:[37515] and gateForeignLane in src/lib/group/noModMinimum.ts rejects any event whose kind !== 37515. A kind-37522 Sighting with a c tag will never reach the lane render. However, whether this is a known intentional deferral (accepted as incomplete) or a genuine gap that should be fixed now requires a human call — it affects ROADMAP SC#2 wording directly."
  - test: "Map-first pin-drop create flow — full UI walkthrough"
    expected: "New Sighting button arms cursor overlay; click places pin; compact form opens in right panel with title/description/'Observed now'/expiry preset/'Add to a Group'. Publish works end-to-end. Sighting appears on map with distinct marker. Live-now is accent-highlighted. Expired seeded sightings absent from map."
    why_human: "Map interaction, visual marker distinction, and expiry filtering are not verifiable by grep/static analysis. Requires a running app with seeded data (bun run seed + bun dev)."
  - test: "Sighting edit preserves c-tag attachments (CR-01 behavioral verification)"
    expected: "Publishing a Sighting attached to Group A, then editing it with no change to the Group picker, republishes with the Group A c-tag intact (not silently dropped)."
    why_human: "CR-01 was fixed at code level (contextRefs pre-filled from initialSighting.contextReferences). Behavioral regression test to confirm the fix works end-to-end through the UI requires a running app."
  - test: "Comments and reactions on a Sighting (SIGHT-04 end-to-end)"
    expected: "Opening a Sighting's detail view shows CommentsPanel and GeoSocialActions. A user can post a comment and it threads under the Sighting's 37522 coordinate. Reactions (kind 7) work."
    why_human: "Comment/react mount is verified at code level (type unions widened, CommentsPanel wired). The full interaction (posting, rendering, threading) requires a running app with a live relay."
---

# Phase 11: Temporal Sighting Verification Report

**Phase Goal:** Temporal Sighting — Time-bound placed observation (NIP-52 `start`/`end`), optional NIP-40 auto-fade, `c`-attach to Group, comment/react. Kind 37522. Each requirement must have full create/edit/comment/react/attach authoring UI as a distinct first-class entity.
**Verified:** 2026-06-28T08:03:27Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can create a Sighting — placed feature with title, description, observation time (NIP-52 start/optional end) distinct from publish time (SIGHT-01) | VERIFIED | `SightingEditorPanel.tsx` (471 lines) captures title/description/start/end; calls `publishSighting`/`editSighting`; geometry arrives as prop from pin-drop; lifecycle derives bbox+g from `content.geometry` via turf. `TemporalSightingContent.geometry` field exists in `helpers.ts`. Full TDD suite: 24 pass / 0 fail. |
| 2 | A user can attach a Sighting to a Group/Topic via a `c` tag and see it land in that Group's contribution lane (SIGHT-02) | UNCERTAIN | **`c` tag data layer is correct:** `GroupAttachField` is wired in `SightingEditorPanel.tsx:451`, `contextRefs` pre-fills on edit (CR-01 fix at line 125), `publishSighting` receives `groupCoords: contextRefs`. **But the Group contribution lane does NOT show Sightings:** `src/lib/group/attach.ts:31` builds `{ '#c': [groupCoordinate], kinds: [GEO_EVENT_KIND] }` (kind 37515 only); `gateForeignLane` in `noModMinimum.ts` rejects `event.kind !== 37515`. ROADMAP SC#2 says "see it land in the Group's contribution lane" — the observable behavior is not achieved. See Human Verification #1. |
| 3 | A Sighting can carry an expiry so stale sightings auto-fade from the map — always client-filtered at every read path (SIGHT-03) | VERIFIED | All 5 read paths independently apply expiry filtering: (1) `useSightings` subscription: `dropExpired(events.filter(isTemporalSighting), now)` with 60s clock tick (`src/lib/hooks/useSightings.ts:63`); (2) Map layer source: `buildSightingSource` applies `dropExpired(sightings, unixNow())` before building FeatureCollection (`useMapLayers.ts:254`); (3) Detail view: `isExpired(sighting.event, unixNow())` gate renders expired-state copy (`SightingViewPanel.tsx:110`); (4) OG server fetch: `isOGEventExpired(event, Math.floor(Date.now()/1000))` returns null before content parse (`fetchEvent.ts:324`); (5) OG cache: `isContentExpired` hard-evicts sighting records past their `contentExpiresAt` on cache read (`cache.ts:273`). Units are epoch-seconds throughout (never `Date.now()` ms). |
| 4 | A user can comment on and react to a Sighting (SIGHT-04) | VERIFIED | `CommentsPanel` mounted in `SightingViewPanel.tsx:223`; type unions widened to include `TemporalSighting` across `CommentsPanel.tsx:21`, `useGeoComments.ts:28,41,191`, `useGeoReactions.ts:13`; `getEntitySharePath` returns `'sighting'` for `TEMPORAL_SIGHTING_KIND` (`GeoSocialActions.tsx:55`). `GeoCommentFactory.root` is runtime-kind-generic — zero factory change needed. End-to-end behavioral verification requires human testing (Human Verification #4). |

**Score:** 3/4 truths verified (SC#2 is UNCERTAIN pending human decision on Group lane gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/nostr/temporal-sighting/helpers.ts` | `geometry?: Point\|LineString\|Polygon` on `TemporalSightingContent` | VERIFIED | Line 45: `geometry?: Point \| LineString \| Polygon` |
| `src/lib/nostr/temporal-sighting/lifecycle.ts` | `publishSighting`/`editSighting`/`deleteSighting` deriving bbox+g | VERIFIED | turf `bbox`/`centroid` at lines 74,89; try/catch guarded; `editSighting` uses `TemporalSightingFactory.modify` (preserves d) |
| `src/lib/nostr/temporal-sighting/draft.ts` | `readSightingDraft`/`writeSightingDraft`/`clearSightingDraft` | VERIFIED | All three functions exported; `SightingDraft` type; `NEW_SIGHTING_DRAFT_KEY`; defensive `readDraftMap` |
| `src/lib/nostr/temporal-sighting/observationState.ts` | `classifyObservationState(start,end,now): 'live'\|'upcoming'\|'past'` | VERIFIED | Pure total function; no throw on undefined; 30-day open-ended freshness window |
| `src/lib/hooks/useSightings.ts` | filter-before-cast + `dropExpired` + 60s clock tick | VERIFIED | Lines 62-64; `useExpiryClock` adds WR-04 fix |
| `src/components/info-panel/SightingEditorPanel.tsx` | Map-first form: time/expiry/GroupAttachField (min 120 lines) | VERIFIED | 471 lines; GroupAttachField wired; RadioGroup expiry; date picker; CR-01 fix: contextRefs pre-filled from `initialSighting?.contextReferences ?? []` |
| `src/components/SightingsPanel.tsx` | Browse rail with `useSightings` + "New Sighting" button (min 120 lines) | VERIFIED | 271 lines; `SightingsPanelContent` exported; `useSightings()` at line 189; "New Sighting" at line 220 |
| `src/features/geo-editor/hooks/useMapLayers.ts` | Distinct Sighting source+layer with `obsState` paint + `dropExpired` | VERIFIED | `SIGHTING_SOURCE_ID`; `buildSightingSource` with `dropExpired`; 3-layer setup (hit/marker/symbol); data-driven `'circle-color'` case on `obsState` |
| `src/components/info-panel/SightingViewPanel.tsx` | Read view: title/description + observation-time + expiry countdown + CommentsPanel (min 100 lines) | VERIFIED | 238 lines; SIGHT-03 expiry gate at line 110; CommentsPanel at line 223; no `dangerouslySetInnerHTML` |
| `src/lib/og/fetchEvent.ts` | `fetchSightingOGData` — returns null if expiration is past | VERIFIED | `isOGEventExpired` called at line 324 before content parse; guards on `TEMPORAL_SIGHTING_KIND` |
| `src/index.ts` | `handleSightingRoute` + `/sighting/:naddr` registration | VERIFIED | `handleSightingRoute` at line 188; routes registered at lines 366-367 |
| `src/features/geo-editor/hooks/useRouting.ts` | `'sighting'` focusType + `/sighting/:naddr` parse + `buildRoutePath` | VERIFIED | `'sighting'` in union at line 36; `isFocusType` at line 55; `first === 'sighting'` parse at line 131; `buildRoutePath` (not deprecated `buildRouteHash`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `AppSidebar.tsx` | `SightingsPanelContent` | `renderWorkContent` switch case `'sightings'` | WIRED | Lines 749-750: `case 'sightings': return <SightingsPanelContent .../>` |
| `SightingEditorPanel.tsx` | `publishSighting`/`editSighting` | submit handler calls lifecycle service | WIRED | Lines 271-272; NOT re-inlined factory |
| `SightingEditorPanel.tsx` | `GroupAttachField` | c-attach picker driving `contextReferences()` | WIRED | Line 451; `contextRefs` pre-fills on edit (CR-01 fix) |
| `useMapLayers.ts` | `dropExpired` + `classifyObservationState` | filter expired before source; paint keyed on `obsState` | WIRED | `dropExpired` ×6; `obsState`/`classifyObservationState` ×10 |
| `SightingViewPanel.tsx` | `CommentsPanel` + `GeoSocialActions` | mount on Sighting (37522) coordinate (SIGHT-04) | WIRED | Lines 223+; type unions include `TemporalSighting` |
| `fetchEvent.ts` | NIP-40 expiration check | `fetchSightingOGData` returns null when past | WIRED | `isOGEventExpired` called at line 324 |
| `src/index.ts` | `/sighting/:naddr` | `handleSightingRoute` registered | WIRED | Lines 366-367 |
| `GeoSocialActions.tsx` | `getEntitySharePath` | `TEMPORAL_SIGHTING_KIND → 'sighting'` | WIRED | Line 55 |

### Key Link Gap

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `GroupViewPanel.tsx` | kind-37522 events in `ForeignLane` | `useGroupAttachments` subscription | NOT_WIRED | `buildAttachDiscoveryFilter` subscribes `kinds:[37515]` only (`attach.ts:31`); `gateForeignLane` rejects `kind !== 37515`. Sightings with `c` tags are never surfaced in the Group's contribution lane. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `SightingsPanel.tsx` | `sightings` from `useSightings()` | `useTimelineWithEose` subscription (kind 37522) → `dropExpired` → `castEvent` | Yes — real Nostr relay subscription | FLOWING |
| `SightingEditorPanel.tsx` | `contextRefs` state | `initialSighting?.contextReferences ?? []` on edit; `[]` on create | Yes — pre-fills from existing event c-tags | FLOWING |
| `useMapLayers.ts` | `buildSightingSource(visibleSightings)` | `useSightings()` output → `dropExpired` → GeoJSON FeatureCollection | Yes — real events from subscription | FLOWING |
| `SightingViewPanel.tsx` | `sighting.sighting.*` | Cast `TemporalSighting` event passed from `useSightingEditor` | Yes — from `useSightings()` cast | FLOWING |
| `fetchEvent.ts` | OG data for `/sighting/:naddr` | Raw WS relay fetch + `isOGEventExpired` gate | Yes — real relay fetch, gated by expiry | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Temporal Sighting test suite | `bun test src/lib/nostr/temporal-sighting src/lib/nostr/expiry.test.ts src/lib/nostr/geo-comment/sightingComment.test.ts` | 24 pass / 0 fail | PASS |
| SightingViewPanel helpers + OG expiry tests | `bun test src/components/info-panel/SightingViewPanel.test.ts src/lib/og/fetchEvent.test.ts` | 17 pass / 0 fail | PASS |
| Full test suite | `bun test` | 735 pass / 0 fail / 3306 expect() calls / 83 files | PASS |
| Build | `bun run build` | "Build completed in 830.05ms" (green) | PASS |
| Biome on Phase 11 files | `bun run lint` (scoped to Phase 11 touched files) | Zero errors in Phase 11 files; pre-existing errors in APITester.tsx/DebugDialog.tsx are out-of-scope | PASS |
| dropExpired in useSightings subscription | `grep -n 'dropExpired' src/lib/hooks/useSightings.ts` | Line 63: `dropExpired(events.filter(isTemporalSighting), now)` | PASS |
| filter-before-cast order | `grep -n 'filter(isTemporalSighting)' src/lib/hooks/useSightings.ts` | Line 63: filter BEFORE dropExpired BEFORE map/cast | PASS |
| OG expiry null return | `grep -n 'isOGEventExpired' src/lib/og/fetchEvent.ts` | Line 324: called before content parse, returns null | PASS |
| OG cache hard-miss on expired content | `grep -n 'isContentExpired' src/lib/og/cache.ts` | Line 273: `!isContentExpired(cachedRaw, now)` nulls the cache record | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SIGHT-01 | 11-01, 11-02, 11-03 | Create a Sighting with title, description, NIP-52 start/end distinct from publish time | SATISFIED | `publishSighting` lifecycle + `SightingEditorPanel` with observation-time section; geometry field on content; REQUIREMENTS.md checkbox not yet ticked (documentation lag only) |
| SIGHT-02 | 11-01, 11-02, 11-03 | Attach a Sighting to a Group/Topic via c tag | PARTIAL | c-tag DATA MODEL correct (GroupAttachField wired, contextRefs pre-filled on edit, CR-01 fixed). The Group's ForeignLane does NOT show kind-37522 Sightings — only kind-37515 (see GROUP-02 + ForeignLane gap above). REQUIREMENTS.md checkbox not yet ticked |
| SIGHT-03 | 11-01, 11-02, 11-03, 11-04 | NIP-40 auto-fade, client-filtered at every read path | SATISFIED | 5 independent read paths verified (subscription, map source, detail view, OG fetch, OG cache); REQUIREMENTS.md checked |
| SIGHT-04 | 11-01, 11-04 | Comment on and react to a Sighting | SATISFIED | CommentsPanel mounted; type unions widened; share path returns 'sighting'; REQUIREMENTS.md checked |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TBD/FIXME/XXX in Phase 11 modified files | Info | Clean |
| `src/lib/og/cache.ts` | 175-176 | `isStaleButUsable` does NOT check `contentExpiresAt` — WR-02 fix in `isContentExpired` gates BEFORE stale check (line 273) | Info | Correct: the WR-02 fix nulls `cached` before `isStaleButUsable` is reached |
| `src/components/info-panel/group-lane/ForeignLane.tsx` | 6 | Kind gate `kind === 37515` explicitly — intentional Phase-9 scope boundary, but means SIGHT-02 "land in lane" observable behavior is not met | WARNING | See SC#2 uncertainty above |

### Code Review Fix Verification

All 7 post-execution code review commits verified in git history:

| Finding | Fix Commit | Verified |
|---------|-----------|---------|
| CR-01 (c-tag data loss on edit) | `32e58ed` | `contextRefs: initialSighting?.contextReferences ?? []` at line 125 |
| WR-01/WR-02/WR-05/IN-02 (OG hardening) | `d30810b` | `isOGEventExpired`, `isContentExpired` hard-miss, `Number(raw)` strict parse |
| WR-03 (setFocused missing 'sighting') | `72597a2` | `store/types.ts:316` includes `'sighting'` |
| WR-04 (expiry useMemo no clock) | `1280719` | `useExpiryClock` 60s interval in `useSightings.ts` |
| WR-06 (comment deep-link ignored) | `4972eba` | `handleInspectSighting(sighting, route.commentId)` at `GeoEditorView.tsx:1739` |
| IN-01 (font-load console.log) | `a339693` | Log dropped from `renderImage.ts:48` |
| IN-03 (duplicate formatters) | `7e5f1c5` | `format.ts` extracted; both panels import from shared module |

### Human Verification Required

### 1. Group Contribution Lane for Sightings (ROADMAP SC#2 — BLOCKER DECISION)

**Test:** Publish a Sighting with GroupAttachField pointing to a test Group. Open the Group view. Check if the Sighting appears in the "Community contributions" (ForeignLane) section.
**Expected:** ROADMAP SC#2 says "see it land in that Group's contribution lane."
**Current state:** The `c` tag is correctly attached to the Sighting event. But `buildAttachDiscoveryFilter` subscribes only `kinds:[37515]` and `gateForeignLane` rejects any event with `kind !== 37515`. Kind-37522 Sightings with a `c` tag will never appear in the ForeignLane.
**Why human:** This requires a product decision: (a) accept the gap as a deferral to Phase 13 or a follow-up (ForeignLane kind-widening); or (b) classify as a blocking gap requiring a fix before verification passes. The `c` tag data model and GroupAttachField wiring are correct — the missing piece is ForeignLane accepting kind 37522.

### 2. Map-First Create Flow — Full UI Walkthrough

**Test:** `bun run seed && bun dev`. Open the app.
- Confirm Sightings tab in left rail; browse panel shows New Sighting button + seeded sightings with LIVE/Upcoming/past cues + "Fades in N days" countdowns.
- Click New Sighting → overlay "Click the map to drop your sighting" appears → click the map → pin drops → compact create form opens in right panel.
- Form shows: "What did you see?" / "Add details…" fields; "Observed now" with "Adjust time" affordance; RadioGroup expiry defaulting to "After 1 month"; optional Group attach.
- On the map: Sighting markers are visually distinct from dataset dots; live-now sighting is accent-highlighted; expired seeded Sighting is absent.
- Use "Draw an area instead" → draw a polygon → confirm geometry captured.
- Publish → Sighting appears on map + in browse list.
**Expected:** All steps work end-to-end.
**Why human:** Map interaction, visual marker distinction, overlay behavior, and expiry filtering require a running app.

### 3. Sighting Edit Preserves Group Attachments (CR-01 Behavioral)

**Test:** Publish a Sighting attached to Group A. Reopen it in edit mode (without changing the Group picker). Save. Verify the republished event still has the `c` tag for Group A.
**Expected:** The `c` tag persists because `contextRefs` is pre-filled from `initialSighting?.contextReferences ?? []` (CR-01 fix).
**Why human:** Code fix is verified at the static level. End-to-end data flow through publish/re-read requires a live relay + running app.

### 4. Comment and React on a Sighting (SIGHT-04)

**Test:** Open a Sighting's detail view. Post a comment. Post a reaction. Verify comments thread under the Sighting's 37522 coordinate; reactions count increments.
**Expected:** CommentsPanel and GeoSocialActions work end-to-end on a kind-37522 event.
**Why human:** Type unions widened at code level; actual NIP-22 comment rooting and kind-7 reaction posting require a live relay.

### Gaps Summary

No hard BLOCKER gaps at the code level — all 4 plans executed, all commits verified, full test suite 735/0, build green. The one uncertainty is ROADMAP SC#2: the Group contribution lane is not widened to accept kind-37522 Sightings (only kind-37515 GeoDatasets appear there). Whether this is acceptable as a deferral or must be fixed before the phase is verified is a human decision.

If the Group lane gap is accepted as a known deferral (the `c` tag DATA MODEL is correct; the Group view widening was always a cross-cutting concern — see GROUP-02 note in REQUIREMENTS.md), the phase passes. If the human tester requires the full observable behavior ("see it land in the lane"), a fix is needed to `attach.ts` + `ForeignLane.tsx` + `gateForeignLane` to accept kind 37522.

---

_Verified: 2026-06-28T08:03:27Z_
_Verifier: Claude (gsd-verifier)_
