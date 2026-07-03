---
phase: 09-group-topic-37518-slimmed
verified: 2026-06-25T14:00:00Z
status: passed
human_verification_resolved_by: 09-UAT.md (3/3 pass, browser-agent UAT 2026-06-26 — all 3 human_verification scenarios below run against live relay + seed data; real bugs found + fixed during it)
human_verification_resolved_at: 2026-07-03T07:45:45Z
score: 5/5 must-haves verified (SC-1 GROUP-01 confirmed via 09-UAT.md live-browser UAT)
overrides_applied: 0
human_verification:
  - test: "Group authoring flow (GROUP-01): create a Group with name, description, and each governance card in turn; confirm the UI-SPEC copy appears, the accent ring on the selected card is the only accent, and only the Schema card shows the schema section."
    expected: "The RadioGroup renders 3 Card-bodied governance cards with verbatim UI-SPEC one-liners; selecting 'Schema' reveals the builder/advanced schema section; selecting away from 'Schema' strips the schema fields; clicking Save publishes the Group (verify in the relay / Groups list); editing re-saves in place (same d-tag, not a new entry)."
    why_human: "The write path (GroupFactory → NDK → relay) requires a live relay + signer; d-tag lineage (same entry after edit) can only be observed in the running app. The governance card visual rendering (accent ring, copy legibility, a11y keyboard-reachability of builder checkboxes) cannot be verified by grep."
  - test: "Contributor attach + warn flow (GROUP-02/04): attach a schema-violating dataset to a Schema Group in the publish UI."
    expected: "The 'Attach to a Group' picker appears; selecting a Schema Group triggers a 'Checking…' spinner; the amber Alert (NOT red/destructive) lists per-rule failures (e.g. 'missing required `name`'); 'Publish anyway' is always visible and enabled; clicking it publishes and the relay event carries the `c` tag."
    why_human: "Requires a live relay + two events (Schema Group + violating dataset); the visual amber-vs-red distinction and per-rule specificity require visual inspection; the `c` tag on the published event requires relay-level observation."
  - test: "Full NO-MOD trust posture (GROUP-06/07/08): verify the two-lane layout, filter behavior, mute scope, escape hatch, pin/bless, narrative, and comment/react on a live Group."
    expected: "(a) 'Canonical references' is top/expanded/amber; 'Community contributions (N)' is below/collapsed/grey — NOT co-equal tabs. (b) Off/Warn/Strict segmented control works; Strict hides non-conforming with reason chips; 'Nothing matches the rules' empty-state shows. (c) Per-attachment ⋮ → 'Mute @name' removes the row immediately, shows undo toast, and the mute is app-wide. (d) Owner 'Lock down → Closed' confirm dialog fires; foreign lane disappears. (e) 'Add to curated' and search-based bless land in the curated lane. (f) Markdown narrative renders (no raw HTML). (g) Comments and reactions on the Group work."
    why_human: "Two-lane visual hierarchy, filter toggle interactivity, mute undo toast, alert-dialog flow, and comment/react submission require a running dev server + relay + multiple accounts."
---

# Phase 9: Group / Topic — kind 37518 slimmed — Verification Report

**Phase Goal:** A user can run an attach-push Group with an explicit governance ladder (open · schema · closed) where datasets/sightings self-attach via `c`, schema-governed Groups validate contributions off-thread without blocking valid standalone publishes, and an open Group is usable and trustworthy with no human moderator — the NO-MOD MINIMUM and the schema DoS guard both ship here, never after.

**Verified:** 2026-06-25T14:00:00Z (automated) · human items closed 2026-06-26 via 09-UAT.md (3/3 pass)
**Status:** passed
**Re-verification:** Status reconciled 2026-07-03 — the 3 `human_verification` scenarios were run and PASSED in 09-UAT.md (browser-agent UAT against live relay + seed, 2026-06-26); this file's `human_needed` flag was stale.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Create a Group with name, description, explicit governance; non-developer can author a contribution schema through the UI | ? UNCERTAIN (human) | `GroupEditorPanel.tsx` (812 lines) exists with `RadioGroup`, verbatim UI-SPEC copy, conditional builder/advanced schema section gated on `governance === 'schema'`; `GroupFactory.create/modify` write path verified by source. Live publish/edit requires browser UAT (deferred by phase config). |
| 2 | Attach a dataset via `c` tag; schema Group surfaces inline warnings but NEVER blocks (GROUP-04 hard invariant) | ✓ VERIFIED | `buildAttachDiscoveryFilter` returns `{ '#c':[coord], kinds:[37515] }`; `canPublishStandalone` is invariantly `true` (no code path returns `false`); `GroupAttachField` `disabled={!canPublish || isPublishing}` — never the validation verdict; `warnNotBlock.test.ts` GREEN (3/0); `validateDatasetForContext` import count in `usePublishing.ts` = 0; c-tag write at all 4 publish entrypoints verified. |
| 3 | Viewer of schema Group sees only conforming attachments by default; per-view override off/warn/strict; legible filter-reason on hidden items | ✓ VERIFIED | `resolveGroupFilterDefault('schema')` returns `'strict'`; `filterForeignAttachment` runs off-thread via `validateSchema`; returns `{ show:false, reason }` on strict + non-conforming; `ForeignLane` renders `ToggleGroup` Off/Warn/Strict; `Badge variant="outline"` reason chips verified; `filterModes.test.ts` GREEN (includes off/warn/strict outcomes with reasons). |
| 4 | NO-MOD MINIMUM: curated lane privileged/expanded first; foreign lane collapsed/opt-in/capped/sorted; every `c` coordinate kind+sig+mute validated before render; viewer can locally mute; owner can flip to closed | ✓ VERIFIED | `gateForeignLane` gates in exact order: kind → `verifyUntrustedEvent` → mute; cap=50 + `hasMore`; newest-first sort; `noModMinimum.test.ts` GREEN (6/0, including corrupted-sig drop, mute drop, cap, sort, flip-to-closed preserves d); `CuratedLane` (tone="context") renders BEFORE `ForeignLane` (tone="neutral") in `GroupViewPanel.tsx` JSX (lines 232 vs 242); `Collapsible` collapsed by default. |
| 5 | Owner can add optional narrative and pin curated refs; any user can comment on and react to a Group | ✓ VERIFIED | `RichContentRenderer` renders `group.description`; `dangerouslySetInnerHTML` count = 0; `CuratedLane` has owner pin/bless via `GroupFactory.modify(...).referencedAddresses([...existing, coord])`; `CommentsPanel` mounted in `GroupViewPanel` against the `viewContext` (MAP_CONTEXT_KIND 37518 coordinate). |

**Score:** 4/5 truths machine-verified (SC-1 deferred to UAT per phase `human_verify_mode: end-of-phase`)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/nostr/group/helpers.ts` | GroupContent, GroupGovernance, isGroup (hasCurrentModelVersion gate) | ✓ VERIFIED | `isGroup` = `kind===37518 && d present && hasCurrentModelVersion`; legacy drop confirmed; no `contextUse`/`validationMode`/`allowForeignAttachments` in code |
| `src/lib/nostr/group/cast.ts` | `class Group extends EventCast` | ✓ VERIFIED | Class present; ctor throws on guard failure |
| `src/lib/nostr/group/factory.ts` | `class GroupFactory extends EntityFactory`; d-lineage preserve | ✓ VERIFIED | `modify()` uses `toEventTemplate` (preserves d); `create()` re-asserts `MODEL_VERSION` last |
| `src/lib/nostr/tags.ts` | `setSchemaHash` transformer | ✓ VERIFIED | Present; factory delegates (no inline schema-hash filter in factory) |
| `src/lib/hooks/useGroups.ts` | `useGroups` + `useGroupAttachments` | ✓ VERIFIED | `castEvent(e, Group, eventStore)` confirmed; `#c` null-to-skip discovery hook present |
| `src/lib/validation/schema.worker.ts` | `SchemaRuleError`, `errors?: SchemaRuleError[]` on verdict, bounded to `MAX_ERRORS=50` | ✓ VERIFIED | `MAX_ERRORS = 50`; `.slice(0, MAX_ERRORS)` cap present; DoS/gate-reject path does NOT allocate errors |
| `src/lib/group/schemaHash.ts` | `canonicalizeSchema`, `computeSchemaHash` (sha256: prefix), `verifySchemaHash`, `resolveSchemaCacheKey` | ✓ VERIFIED | Deep key-sort implemented; `sha256:` prefix; CR-02 fix `resolveSchemaCacheKey` present |
| `src/lib/group/filterModes.ts` | `GroupFilterMode`, `resolveGroupFilterDefault`, `filterForeignAttachment` off-thread | ✓ VERIFIED | `context/validation` import count = 0; `validateSchema` call present; `verifySchemaHash` called before validation |
| `src/lib/group/attach.ts` | attach-discovery filter, `resolveForeignLaneFilter`, `canPublishStandalone` invariant | ✓ VERIFIED | `canPublishStandalone` body is `return true` — hard invariant |
| `src/lib/mute/useMuteStore.ts` | zustand persist; `earthly-muted-contributors` key; Set-dedup; `isMuted` | ✓ VERIFIED | `persist` with `createJSONStorage`; `name: 'earthly-muted-contributors'`; Set-dedup via `[...new Set([...])]` |
| `src/features/groups/schemaBuilder.ts` | `compileBuilderSchema` → draft-2020-12; pure (no React); no `$ref`/`$data` | ✓ VERIFIED | `DRAFT_2020_12_DIALECT` constant; `grep -c 'from 'react'' = 0`; `schemaBuilder.test.ts` GREEN (3/0) |
| `src/features/groups/GroupEditorPanel.tsx` | governance RadioGroup; schema section gated on `governance==='schema'`; GroupFactory write path; a11y fix | ✓ VERIFIED | `RadioGroup` present (4 matches); 3 UI-SPEC copy one-liners present verbatim; `type="checkbox"` = 0; `Checkbox`/`htmlFor` present; `governance === 'schema'` gating at 3 sites; `GroupFactory` + `computeSchemaHash` in write path; CR-03 fix: `readInitialCuratedReferences` seeds on mount |
| `src/features/groups/groups-columns.tsx` | Group list table columns | ✓ VERIFIED | File present; repointed to `useGroups`/`Group`/`isGroup` |
| `src/features/geo-editor/components/GroupAttachField.tsx` | picker + amber warnings (not destructive) + "Publish anyway" always enabled | ✓ VERIFIED | `disabled={!canPublish || isPublishing}`; `Publish anyway` count = 4; `variant="destructive"` = 0; `filterForeignAttachment` from `@/lib/group` confirmed; `context/validation` = 0 |
| `src/features/geo-editor/hooks/usePublishing.ts` | blocking gate REMOVED; c-tag write survives; off-thread advisory | ✓ VERIFIED | `validateDatasetForContext` count = 0; `contextReferences(` at 4 entrypoints; `validateAttachment` import from `@/lib/group` |
| `src/lib/group/noModMinimum.ts` | `gateForeignLane` (kind→sig→mute, cap, sort), `flipToClosed` | ✓ VERIFIED | Order enforced in source; `FOREIGN_LANE_CAP = 50`; `verifyUntrustedEvent` (cache-poisoning resistant); `noModMinimum.test.ts` GREEN (6/0) |
| `src/components/info-panel/group-lane/ForeignLane.tsx` | collapsed, subordinate, gated, filterForeignAttachment, useMuteStore | ✓ VERIFIED | `tone="neutral"`; `Collapsible`; `gateForeignLane` then `filterForeignAttachment`; `useMuteStore`; `context/validation` = 0 |
| `src/components/info-panel/group-lane/CuratedLane.tsx` | expanded, privileged, tone="context", Canonical badge, pin/bless | ✓ VERIFIED | `tone="context"`; `Badge variant="secondary"` "Canonical"; `appendCuratedReference` via `GroupFactory.modify` |
| `src/components/info-panel/GroupViewPanel.tsx` | two-lane shell; CuratedLane before ForeignLane; escape hatch; narrative via RichContentRenderer; CommentsPanel | ✓ VERIFIED | JSX order: CuratedLane line 232, ForeignLane line 242; `GroupFactory.modify(groupEvent).group({ governance:'closed' })`; `dangerouslySetInnerHTML` = 0; `CommentsPanel` mounted |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GroupEditorPanel.tsx` | `src/lib/nostr/group` | `GroupFactory.create/modify + sign + publish` | ✓ WIRED | `GroupFactory` count = 4 in panel |
| `GroupEditorPanel.tsx` | `schemaBuilder.ts` | `compileBuilderSchema` then `computeSchemaHash` | ✓ WIRED | Both present in write path |
| `usePublishing.ts` | `src/lib/group/attach.ts` | `validateAttachment` (off-thread) | ✓ WIRED | `from '@/lib/group'` import present; `validateDatasetForContext` absent |
| `GroupAttachField.tsx` | `src/lib/group/filterModes.ts` | `filterForeignAttachment` | ✓ WIRED | `from '@/lib/group'` (barrel); `filterForeignAttachment` confirmed |
| `ForeignLane.tsx` | `nostr-tools verifyEvent` | `verifyUntrustedEvent` wrapper | ✓ WIRED | Rebuilds plain object, then calls `verifyEvent`; cache-poisoning resistant |
| `ForeignLane.tsx` | `src/lib/group/filterModes.ts` | `filterForeignAttachment` off/warn/strict | ✓ WIRED | `filterForeignAttachment` in `useEffect`; `context/validation` = 0 |
| `ForeignLane.tsx` | `src/lib/mute/useMuteStore.ts` | `mute/unmute/isMuted` | ✓ WIRED | `useMuteStore` counts present; ⋮ menu calls `mute(pubkey)` |
| `GroupViewPanel.tsx` | `src/lib/nostr/group` | `GroupFactory.modify(governance:'closed')` escape hatch | ✓ WIRED | `governance.*'closed'` = 4 in panel; uses `GroupFactory.modify` |
| `filterModes.ts` | `schemaWorker.ts` | `validateSchema` off-thread | ✓ WIRED | `validateSchema` import; `context/validation` import = 0 |
| `schemaHash.ts` | `geo-event/helpers.ts` | `computeChecksum` (SHA-256-hex) | ✓ WIRED | `computeChecksum` call in `computeSchemaHash` |
| `filterModes.ts` | `schemaHash.ts` | `verifySchemaHash` before validating | ✓ WIRED | `verifySchemaHash` called before `validateSchema` on `publishedHash` path |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ForeignLane.tsx` | `attachments` (from props) | `useGroupAttachments(coord)` → `useTimelineWithEose({kinds:[37515],'#c':[coord]})` | Real relay subscription | ✓ FLOWING |
| `ForeignLane.tsx` | `gatedRows` | `gateForeignLane(attachments, {mutedPubkeys})` → `filterForeignAttachment` per row | Real gated events from subscription | ✓ FLOWING |
| `CuratedLane.tsx` | `referencedAddresses` | `getGroupReferencedAddresses(groupEvent)` from relay event tags | Real `a` tags from event | ✓ FLOWING |
| `GroupAttachField.tsx` | `groups` | `useGroups()` → `castEvent` on real 37518 events | Real relay subscription | ✓ FLOWING |
| `GroupViewPanel.tsx` | `groupEvent` | `viewContext.rawEvent()` (store's MapContext cast over the same 37518 event) | Real event from store | ✓ FLOWING (bridge pattern; `isGroup` guard confirmed) |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GROUP-01 module: governance serialization + modelVersion gate | `bun test src/lib/nostr/group/group.test.ts` | 11 pass / 0 fail | ✓ PASS |
| GROUP-04 warn-not-block invariant | `bun test src/lib/group/warnNotBlock.test.ts` | 3 pass / 0 fail | ✓ PASS |
| GROUP-05 off/warn/strict filter with reasons | `bun test src/lib/group/filterModes.test.ts` | pass (subset of 15) | ✓ PASS |
| GROUP-08 NO-MOD gate (kind→sig→mute, cap, sort, flip-to-closed) | `bun test src/lib/group/noModMinimum.test.ts` | 6 pass / 0 fail | ✓ PASS |
| GROUP-03 schemaBuilder → draft-2020-12 | `bun test src/features/groups/schemaBuilder.test.ts` | 3 pass / 0 fail | ✓ PASS |
| Schema worker D-06 bounded errors[] | `bun test src/lib/validation/schemaErrors.test.ts` | pass (subset of 17) | ✓ PASS |
| Full suite (no regression) | `bun test` | 675 pass / 0 fail / 75 files | ✓ PASS |
| Build (no circular-import crash) | `bun run build` | completed in ~834ms | ✓ PASS |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| GROUP-01 | 09-02, 09-04 | Create a Group with name, description, explicit governance (open/schema/closed) | ? HUMAN NEEDED | Factory + GroupEditorPanel code verified; live publish/edit deferred to UAT |
| GROUP-02 | 09-03, 09-05 | Attach dataset via `c` tag; appears in contribution lane | ✓ SATISFIED | `buildAttachDiscoveryFilter`; c-tag at all 4 publish entrypoints; `attach.test.ts` GREEN |
| GROUP-03 | 09-04 | Non-developer owner can author contribution schema via authoring UI | ✓ SATISFIED | `compileBuilderSchema` → draft-2020-12; visual builder + advanced-JSON tab in `GroupEditorPanel`; `schemaBuilder.test.ts` GREEN |
| GROUP-04 | 09-03, 09-05 | Inline warnings before publish but NEVER blocks standalone dataset | ✓ SATISFIED | `canPublishStandalone` invariantly `true`; blocking gate removed (count=0); `warnNotBlock.test.ts` GREEN; publish button disabled only on readiness, never on validation |
| GROUP-05 | 09-03, 09-06 | Schema Group shows only conforming by default; per-view off/warn/strict override | ✓ SATISFIED | `resolveGroupFilterDefault('schema')='strict'`; ForeignLane ToggleGroup; reason chips; `filterModes.test.ts` GREEN |
| GROUP-06 | 09-06 | Owner can add optional narrative and pin curated references | ✓ SATISFIED | `RichContentRenderer` narrative (no raw HTML); CuratedLane pin/bless via `GroupFactory.modify` |
| GROUP-07 | 09-06 | Any user can comment on and react to a Group | ✓ SATISFIED | `CommentsPanel` mounted in `GroupViewPanel` against `viewContext` (MAP_CONTEXT_KIND) |
| GROUP-08 | 09-06 | NO-MOD MINIMUM: privileged curated lane, validated/capped/sorted foreign lane, mute, flip-to-closed | ✓ SATISFIED | `gateForeignLane` order (kind→sig→mute); `noModMinimum.test.ts` GREEN (6/0); `CuratedLane` before `ForeignLane` in JSX; owner escape hatch via `GroupFactory.modify(governance:'closed')` |

Note: `GROUP-01` is recorded as "In progress" in `REQUIREMENTS.md` (checkbox unchecked) because the live publish/edit browser verification is deferred to end-of-phase UAT. The code implementation is complete and verified at the source level.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| No debt markers (TBD/FIXME/XXX) found in any Phase-9 created/modified file | — | — | — | — |

The 6 open code-review WARNINGs are documented and not in fix scope for this phase:

| Finding | File | Severity | Impact |
|---------|------|----------|--------|
| WR-01: sync fallback path has no deadline | `schemaWorker.ts` | WARNING | Test/SSR-only path; no browser DoS risk in practice |
| WR-02: `usePublishing` advisory-validation block is dead code (duplicated in `GroupAttachField`) | `usePublishing.ts` | WARNING | Maintenance/drift risk; both paths uphold warn-not-block |
| WR-03: `flipToClosed` helper unused; live lock-down uses factory path instead | `noModMinimum.ts` | WARNING | Helper pinned by test; factory path behavior is equivalent |
| WR-04: ForeignLane double-caps shown rows; Load-more may be unreachable under strict hiding | `ForeignLane.tsx` | WARNING | UX coherence issue; not a security or correctness blocker |
| WR-05: `readAttachmentProperties` validates only first feature's properties | `ForeignLane.tsx` | WARNING | Multi-feature dataset may show as conforming when it is not; author and viewer disagree |
| WR-06: Advanced-tab schema not validated/sanitized at save time | `GroupEditorPanel.tsx` | WARNING | Owner can publish unsafe schema; viewer-side DoS guard still active |
| IN-04: Stale `MapContext` typing bridge in view/editor lifecycle | `GroupViewPanel.tsx`, `GroupEditorPanel.tsx` | INFO | Fragile dual-cast bridge; `isGroup` guards present; documented deferral |

---

## Human Verification Required

The three `checkpoint:human-verify` tasks from Plans 04, 05, and 06 were deferred to a consolidated end-of-phase UAT by explicit user approval under the phase's `human_verify_mode: end-of-phase` configuration. They are reproduced here for UAT execution.

### 1. Group Authoring Flow (GROUP-01) — Plan 04

**Test:** Run `bun dev` + `bun relay`. Open the Group editor. (1) Create a Group — enter name + description, pick each governance card in turn — confirm the one-line explanations read as in the UI-SPEC and only the selected card shows the accent ring. (2) Select "Schema" — confirm the schema section appears. Add 2 property rules (one required text, one enum with two values) and check a couple geometry types in the Builder tab. Confirm each checkbox/label is clickable and keyboard-reachable (Tab + Space). (3) Switch to "Advanced (JSON)" — confirm the builder's rules appear as raw JSON; type an invalid `{` and confirm the inline parse-error copy shows; fix it. (4) Switch governance away from Schema and back — confirm the schema fields clear when leaving Schema. (5) Save → confirm the Group publishes (check relay / Groups list). Edit it and re-save → confirm it updates in place (same entry, not a duplicate — d-tag preserved).

**Expected:** All governance cards show verbatim UI-SPEC copy; only the selected card shows the primary accent ring; the Schema section appears and disappears correctly; builder checkboxes are keyboard-reachable; save publishes; edit updates in place without creating a duplicate.

**Why human:** The write path (GroupFactory → NDK → relay) requires a live relay + signer; d-tag lineage (same entry after edit) can only be observed in the running app; the governance card visual rendering (accent ring, copy legibility) and a11y (keyboard-reachability) require visual inspection.

### 2. Contributor Attach + Warn Flow (GROUP-02 / GROUP-04) — Plan 05

**Test:** (1) First create at least one Schema Group (from the authoring flow above) whose schema requires a property (e.g. `name`). (2) Draw/open a dataset whose features intentionally violate the rule (omit `name` or use a disallowed geometry). (3) In the publish/edit screen, use "Attach to a Group" and pick the Schema Group. (4) Confirm: inline AMBER warnings list exactly which rules failed (per-rule, specific copy), each dismissible; a "Checking against {Group}'s rules…" spinner appears briefly; the warnings are NOT red/destructive. (5) Confirm "Publish anyway" is present and enabled — click it and confirm the dataset publishes with the `c` tag. (6) Attach to an Open Group (no schema) — confirm no warnings, publish proceeds normally. (7) Confirm a fully-conforming dataset attached to the Schema Group shows no warnings.

**Expected:** Picker appears; amber (not red) per-rule warnings are shown for violations; "Publish anyway" is always present and enabled regardless of warnings; the published dataset has the `c` tag; Open Groups produce no warnings; conforming datasets produce no warnings.

**Why human:** Requires a live relay + two events; the visual amber-vs-red distinction and per-rule specificity require visual inspection; the `c` tag on the published event requires relay-level observation.

### 3. Full NO-MOD Trust Posture (GROUP-05/06/07/08) — Plan 06

**Test:** Open a Schema Group that has at least one curated ref and several `c`-attached datasets. (1) Confirm layout: "Canonical references" is at the top, expanded, amber-toned; "Community contributions (N)" is below, collapsed, grey — NOT co-equal tabs. (2) Expand the foreign lane. Confirm only valid 37515 datasets appear; the count and Load more behave with >50 attachments; confirm newest-first order. (3) Toggle the filter Off/Warn/Strict: Strict hides non-conforming (with reason chip when switching to Warn); Warn shows them with an amber badge + reason; Off shows everything. Confirm "Nothing matches the rules" empty-state copy when Strict hides all. (4) On a foreign row, open ⋮ → "Mute @name". Confirm the row disappears immediately, the undo toast shows, and the same author is muted elsewhere in the app (app-global). Undo restores. (5) As the owner: click "Lock down → Closed", confirm the alert-dialog copy, confirm → the foreign lane disappears and only curated refs remain. Reopen by editing. (6) As the owner: "Add to curated" on a foreign row (bless) and "Add curated reference" via search — both land in the curated lane. (7) Confirm the Markdown narrative renders (no raw HTML), and that you can comment on and react to the Group.

**Expected:** Two-lane hierarchy (curated top/amber/expanded, contributions below/grey/collapsed); filter toggle works with reason chips; mute is app-wide with undo; owner flip-to-closed works; bless/pin land in curated lane; narrative renders sanitized; comments and reactions work.

**Why human:** Two-lane visual hierarchy, filter toggle interactivity, mute undo toast, alert-dialog flow, and comment/react submission require a running dev server + relay + multiple accounts; "app-global" mute scope requires observing the muted author disappear from multiple locations.

---

## Gaps Summary

No code-level gaps found. The phase successfully delivers all technically-verifiable aspects of the phase goal:

- The governance ladder (open/schema/closed) is fully modeled in the `group/` module with a clean-break SPEC-03 gate.
- The schema DoS guard ships via the Phase-8 off-thread worker; all Group validation routes are off-thread (in-thread gating import count = 0 across filterModes, ForeignLane, GroupAttachField).
- The GROUP-04 warn-not-block invariant is structurally enforced (`canPublishStandalone` returns `true` unconditionally; publish button is never disabled by validation).
- The NO-MOD MINIMUM is wired: kind → sig → mute gate before render, curated-first visual hierarchy, 50-cap + newest-first, off/warn/strict filter with reasons, device-local app-global mute, owner flip-to-closed.
- All 3 code-review BLOCKERs (CR-01 `$recursiveRef` bypass, CR-02 shared cache-key collision, CR-03 curated-ref data loss on edit) are fixed and committed.
- `bun test`: 675 pass / 0 fail; `bun run build`: green; biome clean on Phase-9 files.

The remaining `human_needed` status reflects the three browser-based UAT checkpoints that are intentionally deferred under the phase's `human_verify_mode: end-of-phase` policy. The REQUIREMENTS.md checkbox for GROUP-01 remains unchecked pending that UAT (all other GROUP-02..08 checkboxes are marked complete).

---

_Verified: 2026-06-25T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
