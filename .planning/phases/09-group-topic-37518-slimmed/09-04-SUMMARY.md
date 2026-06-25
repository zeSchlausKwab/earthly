---
phase: 09-group-topic-37518-slimmed
plan: 04
subsystem: ui
tags: [group, governance, schema-builder, draft-2020-12, authoring, radio-cards, a11y, green]
requires:
  - phase: 08-spec-v2-foundation
    provides: "off-thread hardened schema worker (validateSchema), draft-2020-12 dialect pin, EntityFactory base"
  - phase: 09 (Plan 02)
    provides: "group/ module — GroupFactory, GroupContent governance enum, isGroup gate, useGroups"
  - phase: 09 (Plan 03)
    provides: "computeSchemaHash (canonical SHA-256), filterModes/attach/mute service layer"
provides:
  - "src/features/groups/schemaBuilder.ts — compileBuilderSchema (builder rows + geometry → draft-2020-12 JSON Schema), pure/React-free"
  - "src/features/groups/GroupEditorPanel.tsx — governance radio ladder (open/schema/closed) + conditional builder/advanced schema authoring + GroupFactory create/edit write path with canonical schema-hash"
  - "src/features/groups/groups-columns.tsx — Group list table columns (repointed to useGroups/Group/isGroup)"
affects: ["09-05 (contributor attach UI)", "09-06 (GroupViewPanel)", "map-context consumer migration tail"]
tech-stack:
  added: []
  patterns:
    - "Pure compile module (schemaBuilder.ts) shared by both the visual builder and the advanced raw-JSON validate affordance"
    - "Governance-gated schema section: mount only under governance==='schema'; strip geometryConstraints/schema when leaving schema (O-02 field-coexistence)"
    - "Refactor-in-place rename of MapContextEditorPanel → GroupEditorPanel (D-01 clean-break content shape, lowest-risk)"
    - "shadcn Checkbox + Label htmlFor pairing replaces legacy unlabeled raw checkboxes (a11y)"
key-files:
  created:
    - src/features/groups/schemaBuilder.ts
    - src/features/groups/GroupEditorPanel.tsx
    - src/features/groups/groups-columns.tsx
  modified:
    - src/components/info-panel/GeoEditorInfoPanel.tsx (edit-branch repoint to GroupEditorPanel)
key-decisions:
  - "Refactor MapContextEditorPanel in place into GroupEditorPanel (D-01) — the clean-break governance content shape made rename lowest-risk; legacy contextUse/validationMode/allowForeignAttachments triad removed from code entirely"
  - "schemaBuilder.ts kept pure (no React) so the same compileBuilderSchema feeds both the Builder tab and the Advanced raw-JSON tab's validate affordance, and stays unit-testable against the Phase-8 worker dialect"
  - "Governance ladder uses the EXACT UI-SPEC copy verbatim; the accent ring on the selected card is the only accent use besides the submit button (UI-SPEC accent reservation)"
  - "Schema section governance-gated (governance==='schema'); leaving schema strips geometryConstraints/schema from content (O-02)"
patterns-established:
  - "Both authoring paths (visual builder + raw JSON) compile to ONE draft-2020-12 schema and feed the SAME Phase-8 off-thread validator — no second in-thread compile"
requirements-completed: [GROUP-01, GROUP-03]
duration: ~20m
completed: 2026-06-25
---

# Phase 9 Plan 04: Group Authoring Panel Summary

**Owner-facing Group create/edit surface: a 3-card governance ladder (open · schema · closed), a conditional visual schema builder with a raw-JSON advanced escape hatch (both compiling to a worker-accepted draft-2020-12 schema), and a GroupFactory write path that publishes a kind-37518 Group with a canonical schema-hash — the legacy unlabeled-checkbox a11y gap fixed.**

## Performance

- **Duration:** ~20 min (automated tasks); finalize as continuation after end-of-phase-deferred checkpoint approval
- **Completed:** 2026-06-25
- **Tasks:** 2 automated complete + 1 human-verify checkpoint (deferred to end-of-phase UAT)
- **Files modified:** 3 created + 1 repointed consumer

## Accomplishments

- **schemaBuilder.ts (GROUP-03 GREEN):** `compileBuilderSchema(rows, allowedGeometryTypes)` extracted from the legacy `MapContextEditorPanel` builder logic into a pure, React-free module. Emits `$schema` draft-2020-12 with `properties` (text→string, number→number, integer→integer, boolean→boolean, enum→{enum}), `required[]` from flagged rows, and the geometry constraint — within the Phase-8 worker's 64KB/depth-12/4096-keyword caps and emitting NO `$ref`/`$data`. The compiled schema is accepted by `validateSchema` (does not fail-closed on the hardened dialect). Turns Plan 01's `schemaBuilder.test.ts` GREEN (3 pass / 0 fail).
- **GroupEditorPanel.tsx (GROUP-01 authoring surface):** `MapContextEditorPanel` refactored in place — the `contextUse`/`validationMode`/`Switch allowForeignAttachments` triad replaced by a single-column `RadioGroup` of 3 `Card`-bodied governance radio cards using the verbatim UI-SPEC copy. The schema-authoring section mounts ONLY under `governance === 'schema'` (and strips `geometryConstraints`/`schema` when leaving schema, O-02), with a `Tabs` Builder (default, stacked property rows + geometry checkbox grid) / Advanced (raw-JSON `Textarea` with live parse-error surfacing). On save the schema is compiled, hashed via `computeSchemaHash`, and published through `GroupFactory.create(...).schemaHash(hash)` (create) / `GroupFactory.modify(group)...` (edit, d-tag preserved). The legacy unlabeled-checkbox a11y bug is fixed with shadcn `Checkbox` + `Label htmlFor`.
- **groups-columns.tsx:** `contexts-columns` renamed and repointed to `useGroups`/`Group`/`isGroup`; `GeoEditorInfoPanel` edit-branch repointed to `GroupEditorPanel` (one of the map-context consumer migrations Plan 02 deferred).

## Task Commits

Each task was committed atomically by the prior (initial) executor; this continuation finalizes the plan artifacts:

1. **Task 1: Extract schemaBuilder.ts (builder rows + geometry → draft-2020-12)** — `ef32fd8` (feat, TDD GREEN)
2. **Task 2: GroupEditorPanel governance ladder + schema tabs + groups-columns + InfoPanel edit-branch repoint** — `00f4a53` (feat)
3. **Task 3: human-verify checkpoint (Group authoring flow)** — DEFERRED to end-of-phase UAT (see below); not performed live.

**Plan metadata:** this `docs(09-04)` commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS).

## Files Created/Modified

- `src/features/groups/schemaBuilder.ts` — pure `compileBuilderSchema` (builder rows + geometry → draft-2020-12), shared by Builder + Advanced tabs.
- `src/features/groups/GroupEditorPanel.tsx` — governance radio ladder + conditional builder/advanced schema authoring + GroupFactory create/edit write path with canonical schema-hash; a11y fix.
- `src/features/groups/groups-columns.tsx` — Group list table columns (repointed to useGroups/Group/isGroup).
- `src/components/info-panel/GeoEditorInfoPanel.tsx` — edit-branch repointed from the Map Context editor to `GroupEditorPanel`.

## Decisions Made

- **Refactor-in-place (D-01):** renamed `MapContextEditorPanel` → `GroupEditorPanel` rather than scaffolding new; the governance clean-break content shape made rename the lowest-risk path. The legacy triad is gone from code (only referenced in a JSDoc header describing the refactor).
- **Pure schemaBuilder module:** kept React-free so the same compile path serves both the visual Builder and the Advanced raw-JSON validate affordance, and stays unit-testable against the Phase-8 dialect.
- **Exact UI-SPEC governance copy + accent reservation:** the 3 one-liners are present verbatim; the selected-card accent ring is the only accent besides the submit button.
- **Governance gating + field-coexistence (O-02):** schema section mounts only under `governance === 'schema'`; leaving schema strips `geometryConstraints`/`schema`.

## Deviations from Plan

None — the two automated tasks executed as written. The plan's `verify` greps for `grep -c '$ref\|$data' === 0`: the file shows 2 matches, but both are in the JSDoc header prose ("never emits `$ref`/`$data`"), not emitted schema keywords — the acceptance intent ("the builder never emits forbidden keywords") is satisfied. The legacy-triad grep similarly matches only the JSDoc refactor note, not code.

## Human-Verify Checkpoint — DEFERRED to end-of-phase UAT (approved-to-finalize)

Task 3 is a `checkpoint:human-verify` (gate="blocking") for the Group authoring flow. Per the phase's `human_verify_mode: end-of-phase` configuration, the live in-browser verification is **DEFERRED to the consolidated end-of-phase UAT** and was **NOT performed in this execution**. The user explicitly **approved finalizing** the plan with this deferral. No claim of live browser verification is made.

**Verification steps to run at end-of-phase UAT** (preserved verbatim from the plan so UAT can execute them):

1. Run `bun dev` and `bun relay` (relay on 3334).
2. Open the Group editor (the panel that replaced the Map Context editor — via the sidebar/authoring entry).
3. Create a Group: enter a name + description, pick each governance card in turn — confirm the one-line explanations read as in the UI-SPEC and only the selected card shows the accent ring.
4. Select "Schema": confirm the schema section appears. Add 2 property rules (one required text, one enum with two values) and check a couple geometry types in the Builder tab. Confirm each checkbox/label is clickable and keyboard-reachable (Tab + Space).
5. Switch to "Advanced (JSON)": confirm the builder's rules appear as raw JSON; type an invalid `{` and confirm the inline parse-error copy shows; fix it.
6. Switch governance away from Schema and back — confirm the schema fields clear when leaving Schema.
7. Save → confirm the Group publishes (check the relay / the Groups list). Edit it and re-save → confirm it updates in place (same entry, not a duplicate — d-tag preserved).

**Resume signal at UAT:** "approved" or a description of what looked wrong (copy, accent placement, builder behavior, a11y, publish/edit).

## Verification (automated — green; re-confirmed at finalize)

- `bun test src/features/groups/schemaBuilder.test.ts` → **3 pass / 0 fail** (GROUP-03 GREEN; re-run at finalize).
- `bun run build` → **succeeds** (refactored panel + columns resolve; no circular-import startup crash; re-run at finalize).
- `bunx biome check src/features/groups` → **clean** (4 files, no fixes).
- No source under `src/features/groups/` changed between the Task-2 commit (`00f4a53`) and this finalize (empty `git diff 00f4a53 HEAD -- src/features/groups/`).

## Acceptance Grep Assertions (re-confirmed on committed code)

- `grep -c "2020-12" src/features/groups/schemaBuilder.ts` → 8 (dialect present).
- `$ref`/`$data` matches in schemaBuilder.ts → JSDoc prose only (no emitted forbidden keywords).
- `grep -c "from 'react'" src/features/groups/schemaBuilder.ts` → 0 (pure module).
- `grep -c "RadioGroup" GroupEditorPanel.tsx` → 4 (governance ladder present).
- Legacy triad (`contextUse`/`validationMode`/`allowForeignAttachments`) in code → 0 (only a JSDoc refactor note matches).
- `grep -c "GroupFactory" GroupEditorPanel.tsx` → 4; `computeSchemaHash` → 3; `compileBuilderSchema` → 6.
- `grep -c 'type="checkbox"' GroupEditorPanel.tsx` → 0; `Checkbox`/`htmlFor` → 11 (a11y fix in place).
- `grep -c "governance === 'schema'" GroupEditorPanel.tsx` → 2 (schema section gated).
- All 3 governance copy one-liners ("Anyone can attach their dataset…", "…checked against your rules first.", "…no outside contributions.") present verbatim (1 each).

## Threat Mitigations Applied

- **T-09-04-BAD-DIALECT:** builder emits draft-2020-12 with NO `$ref`/`$data` within caps (grep-asserted); both Builder and Advanced paths feed the Phase-8 `validateSchema` worker, which rejects unsafe dialect at authoring time.
- **T-09-04-HASH-OMIT:** `computeSchemaHash` written on every schema save (verify-before-validate link).
- **T-09-04-XSS-DESC:** description stored as plain Markdown (rendered later through the sanitized renderer), never raw HTML.
- **T-09-04-A11Y:** shadcn `Checkbox` + `Label htmlFor` replaces legacy unlabeled inputs (keyboard-reachable).
- **T-09-SC:** zero new dependencies — all primitives are official shadcn already present.

No new threat surface beyond the plan's `<threat_model>`.

## Next Phase Readiness

- The owner-facing Group authoring surface (GROUP-01 authoring + GROUP-03 schema authoring) is in place and feeds the Phase-8 worker via one compile path.
- Plan 05 (contributor attach UI) and Plan 06 (GroupViewPanel NO-MOD two-lane) can proceed.
- One open item carried for UAT: the live in-browser human-verify of the authoring flow (deferred to consolidated end-of-phase UAT, steps preserved above).

## Self-Check: PASSED

- All 3 created files exist on disk (`schemaBuilder.ts`, `GroupEditorPanel.tsx`, `groups-columns.tsx`); verified.
- Both prior task commits exist (`ef32fd8`, `00f4a53`); verified via `git log`.
- Automated gates re-confirmed green at finalize (test 3/0, build OK, biome clean).

---
*Phase: 09-group-topic-37518-slimmed*
*Completed: 2026-06-25*
