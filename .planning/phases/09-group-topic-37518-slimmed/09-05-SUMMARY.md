---
phase: 09-group-topic-37518-slimmed
plan: 05
subsystem: ui
tags: [group, governance, attach, c-tag, warn-not-block, off-thread, publish, contributor, green]
requires:
  - phase: 09 (Plan 02)
    provides: "group/ module — Group cast, GroupGovernance enum, useGroups; groupCoordinate/schemaHash getters"
  - phase: 09 (Plan 03)
    provides: "src/lib/group — validateAttachment, canPublishStandalone, filterForeignAttachment (off-thread)"
  - phase: 09 (Plan 01)
    provides: "warnNotBlock.test.ts GROUP-04 invariant contract"
provides:
  - "src/features/geo-editor/hooks/usePublishing.ts — c-tag write via contextReferences + off-thread warn-not-block advisory validation; legacy blocking required-context gate REMOVED"
  - "src/features/geo-editor/components/GroupAttachField.tsx — Attach-to-a-Group picker + inline off-thread per-rule warnings + always-available Publish anyway"
affects: ["09-06 (foreign-lane view consumes the c-attached datasets this lane produces)", "map-context consumer migration tail"]
tech-stack:
  added: []
  patterns:
    - "Repoint a publish hook from map-context to group: drop the validationMode:'required' blocking gate entirely (GROUP-04), keep the c-tag write"
    - "Off-thread advisory validation in the publish UI: filterForeignAttachment('warn',…) per feature → dismissible amber Alert; never gates the publish button"
    - "Thread optional publish props (onPublishNew/canPublishNew) through AppSidebar → GeoEditorInfoPanel to mount a contributor surface without disturbing the legacy attach UI"
key-files:
  created:
    - src/features/geo-editor/components/GroupAttachField.tsx
  modified:
    - src/features/geo-editor/hooks/usePublishing.ts
    - src/features/geo-editor/GeoEditorView.tsx
    - src/components/AppSidebar.tsx
    - src/components/GeoEditorInfoPanel.tsx
key-decisions:
  - "Removed the legacy validateRequiredContextAttachments gate + validateDatasetForContext import outright (slimmed governance has NO validationMode:'required' — GROUP-04 hard invariant). The c-tag write (.contextReferences) STAYS at all four publish entrypoints."
  - "GroupAttachField owns its own off-thread validation via filterForeignAttachment (so the field's off-thread provenance is a direct source assertion, never context/validation). usePublishing ALSO exposes a parallel attachValidation/runAttachValidation advisory state (Task 1 contract) — both honour warn-not-block; neither disables publish."
  - "Mounted the field in the desktop GeoEditorInfoPanel attach section (gated on onPublishNew presence) rather than rewriting the legacy MapContext attach rows — lowest-risk, no disruption to the map-context migration tail."
  - "Warnings render as Alert variant='default' with an amber left accent (border-l-amber-500) — NOT variant='destructive' (a warning is not an error, per UI-SPEC color contract)."
requirements-completed: [GROUP-02, GROUP-04]
metrics:
  duration: ~35m
  completed: 2026-06-25
  tasks: "2 automated complete + 1 human-verify checkpoint (deferred to end-of-phase UAT)"
  files: 5
---

# Phase 9 Plan 05: Contributor Group-Attach Lane Summary

**The contributor side of the `c`-attach lane: an "Attach to a Group" picker that writes the `c` tag on the 37515 dataset (GROUP-02), off-thread per-rule schema-validation warnings (amber, dismissible) when attaching to a Schema Group, and a "Publish anyway" path that NEVER blocks a valid standalone publish (GROUP-04). The legacy blocking `validateRequiredContextAttachments` required-context gate is removed entirely.**

## Performance

- **Duration:** ~35 min (2 automated tasks)
- **Completed:** 2026-06-25
- **Tasks:** 2 automated complete + 1 human-verify checkpoint (deferred to end-of-phase UAT)
- **Files:** 1 created + 4 modified

## Accomplishments

- **usePublishing rewrite (Task 1, GROUP-02/04):** Replaced `import { validateDatasetForContext } from '@/lib/context/validation'` with the off-thread warn-not-block entrypoint `validateAttachment` from `@/lib/group`. **Deleted** the `validateRequiredContextAttachments` blocking gate and its four call sites (the publish entrypoints no longer abort on a schema verdict). The `.contextReferences(activeDatasetContextRefs)` `c`-tag write **survives at all four entrypoints** (handlePublishNew / handlePublishWithBlossomUpload / handlePublishUpdate / handlePublishCopy). Repointed the hook option from `mapContexts: MapContext[]` to `groups: Group[]`, resolving a `c` ref to its schema Group by coordinate. Added an **advisory** `attachValidation` state + `runAttachValidation`/`clearAttachValidation` (off-thread via `validateAttachment`) that flow ONLY to hook state — they NEVER set `publishError` and NEVER abort a publish. Updated the caller in `GeoEditorView` to supply `groups` from `useGroups()`.
- **GroupAttachField (Task 2, D-05/D-06):** New `src/features/geo-editor/components/GroupAttachField.tsx`. An "Attach to a Group" picker (`command`+`popover` over `useGroups()`) whose selection appends the Group coordinate to the dataset's `c` refs via the store action. For a `schema` Group it runs the **off-thread** `filterForeignAttachment('warn', …)` per feature (the Phase-8 `validateSchema` worker — never `context/validation`), rendering per-rule failures as an **amber `Alert variant="default"`** (NOT destructive) with dismissible lines, a "Checking against {Group}'s rules…" `Spinner`, and the "Couldn't check this contribution right now. It's shown unfiltered." worker-failure copy. The **"Publish anyway"** affordance is always rendered; its `disabled` is `!canPublish || isPublishing` — a pure function of publish readiness, NEVER the validation verdict (GROUP-04 hard invariant).
- **Mount:** wired the field into the desktop `GeoEditorInfoPanel` attach section (gated on `onPublishNew` presence), threading `onPublishNew`/`canPublishNew`/`isPublishing` through `AppSidebar` → `GeoEditorInfoPanel` so the contributor surface is a real, exercised build path without disturbing the legacy MapContext attach rows.

## Task Commits

1. **Task 1: replace blocking required-context gate with off-thread warn-not-block in usePublishing** — `dd6962b` (feat)
2. **Task 2: GroupAttachField — picker + inline per-rule warnings + Publish anyway** — `3506c18` (feat)
3. **Task 3: human-verify checkpoint (contributor attach + warn flow)** — DEFERRED to end-of-phase UAT (see below); not performed live.

**Plan metadata:** this `docs(09-05)` commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing unused `GeoProposal` import removed from usePublishing**
- **Found during:** Task 1 (biome gate on the rewritten file).
- **Issue:** `import { GeoProposal, GeoProposalFactory } …` — `GeoProposal` was unused on master (confirmed `noUnusedImports` error present on the original file via a `git stash` baseline). Since the file is fully rewritten in this plan, the dangling import was removed.
- **Fix:** dropped `GeoProposal` from the import; behavior unchanged.
- **Files modified:** src/features/geo-editor/hooks/usePublishing.ts
- **Commit:** dd6962b

### Clarifications (no functional deviation)

**2. Field owns its own off-thread validation (in addition to the hook's advisory pass).**
- The plan's `key_links` requires `GroupAttachField` → `filterModes.ts` via `filterForeignAttachment|validateSchema` as a direct source assertion. To honour that (and keep the field's off-thread provenance unambiguous and `context/validation`-free), the inline warnings are computed by the field itself via `filterForeignAttachment`. `usePublishing` ALSO exposes a parallel `attachValidation`/`runAttachValidation` advisory state (the Task 1 contract). Both paths uphold warn-not-block; neither disables publish. This is belt-and-suspenders, not drift.

## Out of Scope (deferred, logged)

- `src/components/GeoEditorInfoPanel.tsx`: 2 × `lint/a11y/noLabelWithoutControl` in the LEGACY "Attached contexts" `<label>` rows. **Pre-existing on master** (confirmed via `git stash` baseline — present before Plan 05). In the legacy MapContext attach UI this plan does NOT touch. Logged to `deferred-items.md`; fix during the map-context consumer-migration tail. My own new/modified code (`GroupAttachField.tsx`, `usePublishing.ts`, `AppSidebar.tsx`, `GeoEditorView.tsx`) is biome-clean.
- `src/lib/group/noModMinimum.test.ts` remains RED (GROUP-08, a later plan) — unrelated to Plan 05.

## Human-Verify Checkpoint — DEFERRED to end-of-phase UAT (approved-to-finalize)

Task 3 is a `checkpoint:human-verify` (gate="blocking") for the contributor attach + warn flow. Per the phase's `human_verify_mode: end-of-phase` configuration, the live in-browser verification is **DEFERRED to the consolidated end-of-phase UAT** and was **NOT performed in this execution**. The user explicitly **approved finalizing** the plan with this deferral. No claim of live browser verification is made; no dev server was started.

**Verification steps to run at end-of-phase UAT** (preserved verbatim from the plan so UAT can execute them):

1. `bun dev` + `bun relay`. First create at least one Schema Group (from Plan 04's editor) whose schema requires a property (e.g. `name`).
2. Draw/open a dataset whose features intentionally violate the rule (omit `name` or use a disallowed geometry).
3. In the publish/edit screen, use "Attach to a Group" and pick the Schema Group.
4. Confirm: inline AMBER warnings list exactly which rules failed (per-rule, specific copy), each dismissible; a "Checking against {Group}'s rules…" spinner appears briefly; the warnings are NOT red/destructive.
5. Confirm "Publish anyway" is present and enabled — click it and confirm the dataset publishes with the `c` tag (it appears in the Group's foreign lane once Plan 06 ships; for now confirm publish succeeds and the relay shows the `c` tag).
6. Attach to an Open Group (no schema) — confirm no warnings, just the attach, publish proceeds normally.
7. Confirm a fully-conforming dataset attached to the Schema Group shows no warnings.

**Resume signal at UAT:** "approved" or describe what looked wrong (picker, warning specificity, destructive-vs-amber, any case where publish was blocked).

## Verification (automated — green)

- `bun run build` → **succeeds** (~0.9s; schema worker re-emitted; no circular-import startup crash).
- `bun test src/lib/group/warnNotBlock.test.ts` → **3 pass / 0 fail** (GROUP-04 invariant the field upholds).
- `bunx biome check` on `GroupAttachField.tsx` / `usePublishing.ts` / `AppSidebar.tsx` / `GeoEditorView.tsx` → **clean** (no errors). The 2 remaining errors are pre-existing legacy `noLabelWithoutControl` in `GeoEditorInfoPanel.tsx` (out of scope, logged).

## Acceptance Grep Assertions (re-confirmed on committed code)

Task 1 (`usePublishing.ts`):
- `grep -c "validateDatasetForContext\|validationMode === 'required'"` → **0** (blocking gate gone).
- `grep -c "contextReferences("` → **4** (the `c`-tag write survives at all entrypoints — GROUP-02).
- `grep -n "from '@/lib/group"` → present (`validateAttachment`); `grep -c "context/validation"` → **0**.
- No publish entrypoint sets `setPublishError` from a schema verdict (warnings flow to `attachValidation`).

Task 2 (`GroupAttachField.tsx`):
- `grep -c "Publish anyway"` → **4** (present + prominent).
- `grep -c "filterForeignAttachment\|validateSchema"` → **6** (off-thread validation provenance).
- `grep -c 'variant="destructive"'` → **0** (warnings are amber `variant="default"`, not destructive).
- `grep -c "context/validation"` → **0**.
- Publish control `disabled={!canPublish || isPublishing}` — never a function of the validation verdict (GROUP-04).

## Threat Mitigations Applied

- **T-09-05-DOS-PUBLISH:** contributor-side validation of a stranger Group's schema routes through the off-thread `filterForeignAttachment`/`validateSchema` worker (timeout-kill/caps/fail-closed); the in-thread `validateDatasetForContext` blocking path is **removed** — a hostile Group schema cannot freeze the publish UI.
- **T-09-05-BLOCK:** "Publish anyway" is always enabled; no code path disables publish on a validation verdict; the warn-not-block test gates the build.
- **T-09-05-WORKER-FAIL-OPEN (accept):** on worker failure the contributor sees "couldn't check… shown unfiltered" and may publish — acceptable (the dataset is a valid standalone 37515; read-side re-validates in Plan 06).
- **T-09-SC:** zero new dependencies — only official shadcn primitives already present (`command`/`popover`/`alert`/`button`/`spinner`).

No new threat surface beyond the plan's `<threat_model>`.

## Next Phase Readiness

- The contributor `c`-attach lane (GROUP-02 attach + GROUP-04 warn-not-block) is in place and feeds the foreign lane.
- Plan 06 (GroupViewPanel NO-MOD two-lane) can now consume the `c`-attached datasets this lane produces.
- One open item carried for UAT: the live in-browser human-verify of the attach + warn flow (deferred to consolidated end-of-phase UAT, steps preserved above).

## Self-Check: PASSED

- Created file exists on disk: `src/features/geo-editor/components/GroupAttachField.tsx` (verified).
- Both task commits exist: `dd6962b`, `3506c18` (verified via `git log`).
- Automated gates green: build OK, warnNotBlock 3/0, own files biome-clean.

---
*Phase: 09-group-topic-37518-slimmed*
*Completed: 2026-06-25*
