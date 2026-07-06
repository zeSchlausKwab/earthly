---
status: complete
phase: 09-group-topic-37518-slimmed
source: [09-VERIFICATION.md]
started: 2026-06-25T14:10:00Z
updated: 2026-06-26T09:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Group authoring flow (GROUP-01)
expected: |
  Create a Group with name, description, and each governance card in turn. The RadioGroup renders 3
  Card-bodied governance cards with verbatim UI-SPEC one-liners; the accent ring on the selected card
  is the only accent; only the Schema card reveals the builder/advanced schema section; selecting away
  from Schema strips the schema fields. Save publishes the Group (observable in the relay / Groups list);
  editing re-saves in place (same d-tag, not a new entry). Builder checkboxes are keyboard-reachable (a11y).
why_human: Write path (GroupFactory → NDK → relay) needs a live relay + signer; d-tag lineage and governance-card visual rendering can only be observed in the running app.
result: pass

### 2. Contributor attach + warn flow (GROUP-02 / GROUP-04)
expected: |
  Attach a schema-violating dataset to a Schema Group in the publish UI. The "Attach to a Group" picker
  appears; selecting a Schema Group triggers a "Checking…" spinner; an amber Alert (NOT red/destructive)
  lists per-rule failures (e.g. "missing required `name`"); "Publish anyway" is always visible AND enabled;
  clicking it publishes and the relay event carries the `c` tag. A valid standalone dataset is never blocked.
why_human: Requires a live relay + two events (Schema Group + violating dataset); amber-vs-red distinction, per-rule specificity, and the `c` tag on the published event require visual + relay-level observation.
result: pass

### 3. Full NO-MOD trust posture (GROUP-06 / GROUP-07 / GROUP-08)
expected: |
  (a) "Canonical references" is top/expanded/amber; "Community contributions (N)" is below/collapsed/grey
  — NOT co-equal tabs. (b) Off/Warn/Strict segmented control works; Strict hides non-conforming with reason
  chips and a "Nothing matches the rules" empty-state. (c) Per-attachment ⋮ → "Mute @name" removes the row
  immediately, shows an undo toast, and the mute is app-wide. (d) Owner "Lock down → Closed" confirm dialog
  fires and the foreign lane disappears. (e) "Add to curated" and search-based bless land in the curated lane.
  (f) Markdown narrative renders (no raw HTML). (g) Comments and reactions on the Group work.
why_human: Two-lane visual hierarchy, filter toggle interactivity, mute undo toast, alert-dialog flow, and comment/react submission require a running dev server + relay + multiple accounts.
result: pass

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none — all open items were found during browser-agent re-verification and fixed; see below]

## Post-verification fixes (browser-agent UAT, 2026-06-26)

Test 3 was re-verified end-to-end with a browser agent against rich seed data
(`bun run seed:entities`). This exercised the community lane for the first time and
surfaced real bugs, all now fixed + covered by `bun test` (682 pass) / `bun run build`:

- **ForeignLane crash (blocker)** — `row.event as unknown as GeoDataset` fed a raw
  NostrEvent (no `.featureCollection`) to `getDatasetName` → `getCollectionName(undefined).name`.
  Crashed the two-lane view for ANY Group with a foreign attachment. Fixed: cast via
  `castEvent(..., GeoDataset, eventStore)` (memoized, try/catch per row) + defensive guard
  in `getCollectionName`. (Also fixes Inspect/Zoom.)
- **(e) curate left source in community lane** — `referencedAddresses` (curated `a` coords)
  was not passed to `ForeignLane`; a blessed dataset showed in both lanes. Fixed: thread
  `curatedCoordinates` through and exclude curated coords from the community lane. → PASS
- **(c) mute undo toast expired too fast** — bumped to 10s; seed now gives one contributor
  multiple rows so app-wide mute is provable. → PASS
- **(b) Strict survivors had no verdict chip** — schema-filtered rows now always carry a
  verdict: amber reason (non-conforming) or emerald "Matches the rules" (conforming). → PASS

Deferred Phase-9 follow-up (not blocking): wire `createGroupColumns` into a dedicated
Groups tab and filter discovery to `isGroup` (earthly/2) so legacy 37518 contexts don't
appear / open as "No Group selected".
