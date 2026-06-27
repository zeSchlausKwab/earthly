---
status: testing
phase: 10-story-article-37520
source: [10-VERIFICATION.md]
started: 2026-06-27T08:05:00Z
updated: 2026-06-27T08:05:00Z
---

## Current Test

[testing complete — issues found in 3 & 4]

## Tests

### 1. Deep-link OG social card (/story/:naddr)
expected: Open a published Story by deep link (/story/:naddr) in a browser and confirm the OG social card is served to a crawler — check meta og:title / og:description / og:image in the page source; a browser user is redirected to /#/stories/story/:naddr.
result: pass
note: Verified by reproducing the exact production crawler code path (fetchStoryOGData + generateStoryOGHtml) against a seeded story on the local relay — og:title "A Ride Through Vienna", og:description, og:image, SPA redirect to /#/stories/story/:naddr all present; inline-script sink escaped (XSS-safe). OG routes are production-only so this exercises the same functions the /story/:naddr route runs.

### 2. Author publish + `a` tag mirroring (STORY-03 live path)
expected: Publish a new Story with one inline nostr:naddr ref in the Markdown body, then inspect the published kind-37520 event in the relay — it has exactly one `a` tag whose value is `<kind>:<pubkey>:<identifier>` matching the inline naddr coordinate.
result: pass
note: Logic verified by lifecycle.test.ts (5 green, publishStory a-tag re-derivation) + on-relay evidence — seeded "A Ride Through Vienna" carries 2 `a` tags exactly matching its 2 inline body refs (extractReferencedCoordinates → setAddressReferenceTags, the same path publishStory runs). Also exercised live: the Test-4 author accept republished through editStory and the body re-derived its refs.

### 3. Reader inline geo-ref render — eye-toggle + fly-to (STORY-02 + map-stack consolidation)
expected: Open a Story (e.g. "A Ride Through Vienna" from the seed) in the reading panel. Each inline nostr:naddr ref renders in place as a chip with an eye-toggle and a fly-to button. The referenced datasets are AUTO-SHOWN on the map by default (map-stack consolidation) — the Map Stack shows them as visible (source "story") and their geometry is on the map. Clicking a chip's eye HIDES/SHOWS that dataset on the map and the eye icon tracks map-stack membership; fly-to pans/zooms the map to the reference.
result: issue
reported: "Chips render with pin+eye+fly-to; Map Stack auto-shows 2/2 visible; fly-to recentered/zoomed. BUT Map Stack entries showed source dataset/comment not story, and the eye toggle did not sync: first click changed the icon while Map Stack stayed 2/2, a second click removed the entry (1/1) instead of restoring."
severity: major
fix: "99c82f6 — isMentionVisible now threaded through AppSidebar→editorPanelProps (chip was falling back to local state); toggle flips visibility in place (setMapStackEntryVisible), preserving source 'story'. RE-TEST PENDING (HMR live)."

### 4. End-to-end propose-edit flow (STORY-06)
expected: As a non-owner reader, click "Propose an edit" on a published Story, modify the body, submit (kind-37519 proposal published). As the author, see the amber "Proposed edits" banner, expand "Review edit", inspect the diff preview, click "Accept edit" — the Story republishes in place (same d-tag, updated body) and the toast "Edit applied — your story is updated." appears.
result: issue
reported: "Propose submitted (showed 'Edit proposed'); author saw amber banner + Proposed-vs-Current diff. Accept DID republish (after reload) but: no 'Edit applied' toast observed, the story body did not update immediately, and after reload the stale Proposed edits / Review edit row was still visible (proposal not cleared after accept)."
severity: major
fix: "99c82f6 — 'applied' status publish made non-fatal (a failure there no longer rejects the successful republish/toast); accept returns the republished Article and onStoryUpdated refreshes the view in place (no reload); panel no longer re-shows applied proposals (open-only). RE-TEST PENDING (HMR live)."

## Summary

total: 4
passed: 2
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Inline ref eye-toggle drives map-stack membership as single source of truth; chip icon and Map Stack stay in sync on every click; entries carry source 'story'"
  status: failed
  reason: "Chip falls back to local useState because isMentionVisible does not reach it in the rendered path → toggle hits the legacy handleMentionVisibilityToggle add/remove (source 'comment'), one click behind the map stack"
  severity: major
  test: 3
  artifacts: []
  missing: []
- truth: "Accept proposal republishes the Story and updates the view immediately, shows the 'Edit applied' toast, and clears/marks the accepted proposal so the Proposed-edits row disappears"
  status: failed
  reason: "No toast; body not updated until reload; accepted proposal still listed after reload (not marked handled / no optimistic refresh)"
  severity: major
  test: 4
  artifacts: []
  missing: []
