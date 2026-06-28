---
status: complete
phase: 11-temporal-sighting
source: [11-VERIFICATION.md]
started: 2026-06-28T10:24:40Z
updated: 2026-06-28T11:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Map-first create flow — full UI walkthrough
expected: New Sighting → pin-drop overlay → compact form (time/expiry/Group attach) → publish → distinct marker on map (live=amber, upcoming=blue, past=grey); expired sightings absent. Run `bun run seed:sightings` first for spread, varied-state data.
result: pass
evidence: Browser UAT 2026-06-28 — pin-drop form had expected fields/presets/group attach; publish created "UAT test sighting 2026-06-28" as a LIVE row/marker.

### 2. Sighting edit preserves Group attachments (CR-01 behavioral)
expected: Publish a Sighting attached to a Group, reopen it in edit mode without changing the Group picker, save → the republished event still carries the Group `c` tag (not silently dropped).
result: pass
evidence: Browser UAT — created group-attached sighting, edited title only, re-open showed "Detach from Vienna Cycling Routes"; `nak` confirmed the `["c","37518:…"]` tag remained.

### 3. Comment + react on a Sighting (SIGHT-04 end-to-end)
expected: Open a Sighting's detail view → CommentsPanel + GeoSocialActions render; posting a comment threads it under the 37522 coordinate; like/zap/react work.
result: pass
evidence: Browser UAT — comment posted; like flipped to "Unlike" with count; zap dialog opened; comment annotation showed "1 geometry", Hide/Show toggled the map geometry and the geometry Zoom worked.

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Post-execution UI polish — extra browser checks (NOT phase-gating)

These exercised the post-execution UX added on top of the Phase-11 plans (compact
rows, inline social, map click+hover, inspect-panel zoom). Not formal UAT items.

- **Inspect-panel Zoom-to (all entities):** PASS — header Zoom worked for Sighting,
  Story, Group, Dataset; the area sighting "Beaver dam — Lobau" stayed centered on
  its marker after Zoom (the geometry-derived-bbox fix).
- **Map marker hover + click:** ISSUE → FIXED. Hover popups (point + area) and
  click→detail worked, but after returning to the Sightings list the clicked row
  was NOT highlighted (`ring-primary`/`bg-primary/5` count 0). Root cause: the list
  highlight keyed off `viewSighting`, which clears when the detail closes — and the
  detail hides the list full-panel, so the highlight was never visible. Fixed by
  persisting a `lastInspectedSightingKey` (survives the detail closing) and keying
  the rail highlight + scroll off it (useSightingEditor / GeoEditorView / AppSidebar).
  Awaiting a quick browser re-check.

## Gaps

### SC2 (ROADMAP success criterion) — Group contribution-lane rendering of Sightings — DEFERRED to Phase 13 (XCUT-01)

A Sighting attached to a Group emits its `c` tag correctly (SIGHT-02's literal
requirement, "attach via a `c` tag", is met). However the Group's ForeignLane
(`buildAttachDiscoveryFilter` / `gateForeignLane`, built in Phase 9) filters
`kinds:[37515]` only, so a kind-37522 Sighting never renders in the Group's
"Community contributions" lane. ROADMAP SC#2 ("see it land in that Group's
contribution lane") therefore is not observably met.

**Disposition:** deferred to **Phase 13 (Cross-Cutting / XCUT-01)** — the same
phase that owns the NIP-22 K/k comment-root widening. Phase 11's CONTEXT.md
explicitly scoped SIGHT-02 to *emitting* the `c` tag and *reusing* the existing
Phase-9 lane; the ForeignLane entity-kind widening is cross-cutting work, not
Phase-11 scope. Not a Phase-11 UAT pass/fail blocker.
