---
status: testing
phase: 10-story-article-37520
source: [10-VERIFICATION.md]
started: 2026-06-27T08:05:00Z
updated: 2026-06-27T08:05:00Z
---

## Current Test

number: 1
name: Deep-link OG social card (/story/:naddr)
expected: |
  The OG HTML for the story appears in page source with the story's title/summary/image
  (og:title / og:description / og:image meta tags); a browser user is redirected to
  /#/stories/story/:naddr.
awaiting: user response

## Tests

### 1. Deep-link OG social card (/story/:naddr)
expected: Open a published Story by deep link (/story/:naddr) in a browser and confirm the OG social card is served to a crawler — check meta og:title / og:description / og:image in the page source; a browser user is redirected to /#/stories/story/:naddr.
result: [pending]

### 2. Author publish + `a` tag mirroring (STORY-03 live path)
expected: Publish a new Story with one inline nostr:naddr ref in the Markdown body, then inspect the published kind-37520 event in the relay — it has exactly one `a` tag whose value is `<kind>:<pubkey>:<identifier>` matching the inline naddr coordinate.
result: [pending]

### 3. Reader inline geo-ref render — eye-toggle + fly-to (STORY-02)
expected: Open a Story in the reading panel. Each inline nostr:naddr ref renders in place as a chip with an eye-toggle (Show/Hide on map) and a fly-to button. Refs default HIDDEN on load — nothing shown on the map until toggled. Eye toggles the referenced dataset on/off on the main map; fly-to pans/zooms the map to the reference.
result: [pending]

### 4. End-to-end propose-edit flow (STORY-06)
expected: As a non-owner reader, click "Propose an edit" on a published Story, modify the body, submit (kind-37519 proposal published). As the author, see the amber "Proposed edits" banner, expand "Review edit", inspect the diff preview, click "Accept edit" — the Story republishes in place (same d-tag, updated body) and the toast "Edit applied — your story is updated." appears.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
