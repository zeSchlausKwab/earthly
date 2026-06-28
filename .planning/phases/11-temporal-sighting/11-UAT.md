---
status: testing
phase: 11-temporal-sighting
source: [11-VERIFICATION.md]
started: 2026-06-28T10:24:40Z
updated: 2026-06-28T10:24:40Z
---

## Current Test

number: 1
name: Map-first create flow — full UI walkthrough
expected: |
  New Sighting arms cursor overlay; clicking the map drops a pin and opens a
  compact create form (title / description / "Observed now" / NIP-40 expiry preset
  default "After 1 month" / optional Group attach). Publish works end-to-end. The
  Sighting renders as a distinct, observation-state-aware marker; live-now is the
  accent focal point; expired seeded sightings are absent from the map.
awaiting: user response

## Tests

### 1. Map-first create flow — full UI walkthrough
expected: New Sighting → pin-drop overlay → compact form (time/expiry/Group attach) → publish → distinct marker on map (live=amber, upcoming=blue, past=grey); expired sightings absent. Run `bun run seed:sightings` first for spread, varied-state data.
result: [pending]

### 2. Sighting edit preserves Group attachments (CR-01 behavioral)
expected: Publish a Sighting attached to a Group, reopen it in edit mode without changing the Group picker, save → the republished event still carries the Group `c` tag (not silently dropped).
result: [pending]

### 3. Comment + react on a Sighting (SIGHT-04 end-to-end)
expected: Open a Sighting's detail view → CommentsPanel + GeoSocialActions render; posting a comment threads it under the 37522 coordinate; like/zap/react work. (Note: informally exercised during live testing — commenting on the seeded "Red fox" sighting worked; a comment geometry annotation now toggles on the map after the annotation-wiring fix.)
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

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
