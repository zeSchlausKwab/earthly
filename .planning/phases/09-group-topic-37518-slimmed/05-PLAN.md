---
phase: 09-group-topic-37518-slimmed
plan: 05
type: execute
wave: 4
depends_on: ["09-02", "09-03"]
files_modified:
  - src/features/geo-editor/hooks/usePublishing.ts
  - src/features/geo-editor/components/GroupAttachField.tsx
autonomous: false
requirements: [GROUP-02, GROUP-04]
user_setup: []
must_haves:
  truths:
    - "A contributor can pick a Group to attach to from their dataset publish/edit flow, writing a c tag on the 37515 dataset"
    - "Attaching to a schema Group surfaces inline, per-rule, dismissible validation warnings before publishing"
    - "A valid standalone dataset is NEVER blocked from publishing — 'Publish anyway' is always present (GROUP-04)"
    - "Validation in the publish flow runs off-thread (no in-thread ajv gating)"
  artifacts:
    - path: "src/features/geo-editor/components/GroupAttachField.tsx"
      provides: "Attach-to-a-Group picker + inline off-thread validation warnings + Publish anyway"
      contains: "Publish anyway"
    - path: "src/features/geo-editor/hooks/usePublishing.ts"
      provides: "c-tag write via contextReferences; off-thread warn-not-block replacing the blocking required-context validation"
      contains: "contextReferences"
  key_links:
    - from: "src/features/geo-editor/hooks/usePublishing.ts"
      to: "src/lib/group/attach.ts"
      via: "warn-not-block validation entrypoint (off-thread)"
      pattern: "from '@/lib/group"
    - from: "src/features/geo-editor/components/GroupAttachField.tsx"
      to: "src/lib/group/filterModes.ts"
      via: "validateSchema-backed inline warnings"
      pattern: "filterForeignAttachment|validateSchema"
---

<objective>
Wire the contributor side of the `c`-attach lane: add an "Attach to a Group" picker to the dataset publish/edit flow that writes the `c` tag on the 37515 dataset (GROUP-02), run off-thread schema validation for a schema Group and surface per-rule, dismissible, inline warnings with a prominent "Publish anyway" (D-05/D-06), and REPLACE the legacy blocking `validateDatasetForContext` required-context gate so a valid standalone dataset is never blocked from publishing (GROUP-04, the hard invariant). This turns Plan 01's warnNotBlock.test.ts coverage end-to-end through the real publish path.

Purpose: The contributor experience that feeds the foreign lane. The warn-not-block invariant and the off-thread validation are both phase-mandated. Runs parallel to Plan 04 (disjoint files: editor-feature hook + a new attach component, vs the groups feature panel).
Output: `GroupAttachField.tsx` + the `usePublishing` rewrite. autonomous:false — ends with a human-verify checkpoint for the attach+warn flow.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-group-topic-37518-slimmed/09-PATTERNS.md
@.planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md
@.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md
@src/features/geo-editor/hooks/usePublishing.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace blocking required-context validation with off-thread warn-not-block in usePublishing</name>
  <files>src/features/geo-editor/hooks/usePublishing.ts</files>
  <read_first>
    - src/features/geo-editor/hooks/usePublishing.ts (the whole hook — note: validateDatasetForContext import line 5; mapContexts option line 30; validateRequiredContextAttachments + the 4 publish entrypoints that call it at ~line 259-291, 320, 407, 493, 578; contextReferences() writes at ~line 337,428,515,595; setActiveDatasetContextRefs)
    - src/lib/group/attach.ts (the warn-not-block entrypoint + c-tag discovery; governance-keyed)
    - src/lib/group/filterModes.ts (filterForeignAttachment off-thread)
    - src/lib/nostr/group (Group cast, getGroupContent, getGroupCoordinate, getGroupSchemaHash)
    - src/lib/hooks/useGroups.ts (replace the mapContexts source with useGroups where this hook's caller supplies it)
  </read_first>
  <action>
    Repoint `usePublishing` from `map-context` to `group`: replace the `mapContexts: MapContext[]` option with `groups: Group[]` (or keep the param name but type it `Group[]` and update the caller in a follow-up note), and replace `import { validateDatasetForContext } from '@/lib/context/validation'` with the off-thread warn-not-block entrypoint from `@/lib/group/attach`.

    REMOVE the blocking gate: the legacy `validateRequiredContextAttachments` (built around `context.context.validationMode === 'required'` + `validateDatasetForContext(...,'strict')` returning `{ ok:false, message }` that aborts publish at all four entrypoints ~line 320/407/493/578) MUST be deleted. Under the slimmed governance model there is NO `validationMode:'required'` and NO blocking — REQUIREMENTS "Out of scope: blocking a contributor's publish on schema failure". Publishing proceeds unconditionally for a standalone-valid dataset (GROUP-04). The `c`-tag write via `.contextReferences(activeDatasetContextRefs)` STAYS (that is GROUP-02's attach mechanic) at all four entrypoints.

    Add an off-thread, advisory validation pass: when the dataset's `c` refs include a `schema` Group's coordinate, run the `@/lib/group` warn-not-block entrypoint (which calls `validateSchema` off-thread, after `verifySchemaHash`) and expose the per-rule `errors`/warnings as hook state (e.g. `attachWarnings`) for the UI to render — but NEVER set `publishError` or abort on them. Keep the existing real publish-aborting errors (network/sign failures) intact. Surface a `setActiveGroupAttachWarnings`-style state the component (Task 2) reads.
  </action>
  <verify>
    <automated>bun run build 2>&1 | tail -5 && grep -c "validationMode === 'required'\|validateDatasetForContext" src/features/geo-editor/hooks/usePublishing.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "validateDatasetForContext\\|validationMode === 'required'" src/features/geo-editor/hooks/usePublishing.ts` is 0 — the blocking gate is gone.
    - `grep -n "contextReferences(" src/features/geo-editor/hooks/usePublishing.ts` still present at the publish entrypoints — the `c`-tag write survives (GROUP-02).
    - The hook imports the off-thread warn entrypoint from `@/lib/group` (source assertion: `grep -n "from '@/lib/group" src/features/geo-editor/hooks/usePublishing.ts`); it does NOT import `@/lib/context/validation` for gating.
    - `bun run build` succeeds (the repoint resolves; the caller's `mapContexts`/`groups` prop is updated or flagged).
    - No publish entrypoint calls `setPublishError` as a result of a schema-validation verdict (source assertion: validation warnings flow to `attachWarnings`, not `publishError`).
  </acceptance_criteria>
  <done>usePublishing writes the c tag, runs off-thread advisory validation, and never blocks a standalone-valid publish; the legacy blocking gate is removed; build green.</done>
</task>

<task type="auto">
  <name>Task 2: GroupAttachField — picker + inline per-rule warnings + Publish anyway</name>
  <files>src/features/geo-editor/components/GroupAttachField.tsx</files>
  <read_first>
    - src/features/geo-editor/hooks/usePublishing.ts (the attachWarnings state + activeDatasetContextRefs the field reads/writes)
    - src/components/entity-search (EntitySearchPopover / command + popover — reuse for the Group picker)
    - src/lib/hooks/useGroups.ts (list Groups to pick from)
    - src/lib/group/filterModes.ts (filterForeignAttachment — drives the inline warnings)
    - .planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md (Interaction Contract 3: attach + inline warnings; Alert amber NOT destructive; "Attach to a Group" / "Publish anyway" copy; Spinner "Checking against {Group name}'s rules…"; worker-failure "couldn't check" copy; the GROUP-04 hard invariant that warnings never disable publish)
    - src/components/ui/alert.tsx, src/components/ui/popover.tsx, src/components/ui/command.tsx (existing primitives)
  </read_first>
  <action>
    Create `src/features/geo-editor/components/GroupAttachField.tsx`. Render an "Attach to a Group" picker reusing `EntitySearchPopover`/`command`+`popover` over `useGroups()`; selecting a Group appends its coordinate to the dataset's `c` refs (via the `setActiveDatasetContextRefs` store action `usePublishing` exposes). For a `schema` Group: on selection (and on feature edits) run the off-thread validation and render the result as an `Alert variant="default"` with an AMBER left accent (NOT destructive — a warning is not an error) listing per-rule failures from the worker `errors[]`, each line specific and dismissible (UI-SPEC copy, e.g. "Property `name` is required." / "Geometry type `Polygon` isn't allowed here."). While validating show an inline `Spinner` + "Checking against {Group name}'s rules…"; on worker failure show the "Couldn't check this contribution right now. It's shown unfiltered." copy with publish still enabled.

    HARD INVARIANT (GROUP-04): the warnings NEVER disable the publish button. Place a prominent accent "Publish anyway" affordance beside the normal publish per UI-SPEC; the publish path is the existing `usePublishing` entrypoint, unguarded by the validation verdict. There is no modal — the warnings are already inline and dismissible (UI-SPEC: the button is the confirmation). Use only declared-scale typography/spacing and semantic color tokens (no raw `dark:` variants, no destructive for warnings).
  </action>
  <verify>
    <automated>bun run build 2>&1 | tail -5 && bun test src/lib/group/warnNotBlock.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bun run build` succeeds; `GroupAttachField.tsx` resolves and renders the picker + alert.
    - `grep -n "Publish anyway" src/features/geo-editor/components/GroupAttachField.tsx` present; the publish control is never `disabled` as a function of the validation verdict (source assertion).
    - The warnings use `Alert variant="default"` / amber (NOT `variant="destructive"`) — source assertion.
    - The field drives validation through `filterForeignAttachment`/`validateSchema` off-thread (source assertion: `grep -n "filterForeignAttachment\\|validateSchema" src/features/geo-editor/components/GroupAttachField.tsx`), never `context/validation`.
    - `bun test src/lib/group/warnNotBlock.test.ts` GREEN (the invariant the field upholds).
    - `biome check src/features/geo-editor/components/GroupAttachField.tsx` clean.
  </acceptance_criteria>
  <done>The attach picker writes the c tag and shows dismissible per-rule warnings with an always-available Publish anyway; build + invariant test green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The contributor attach flow: an "Attach to a Group" picker in the dataset publish/edit screen that writes a `c` tag, plus inline per-rule schema-validation warnings (amber, dismissible) when attaching to a Schema Group — with a "Publish anyway" path that never blocks a valid standalone publish.</what-built>
  <how-to-verify>
    1. `bun dev` + `bun relay`. First create at least one Schema Group (from Plan 04's editor) whose schema requires a property (e.g. `name`).
    2. Draw/open a dataset whose features intentionally violate the rule (omit `name` or use a disallowed geometry).
    3. In the publish/edit screen, use "Attach to a Group" and pick the Schema Group.
    4. Confirm: inline AMBER warnings list exactly which rules failed (per-rule, specific copy), each dismissible; a "Checking against {Group}'s rules…" spinner appears briefly; the warnings are NOT red/destructive.
    5. Confirm "Publish anyway" is present and enabled — click it and confirm the dataset publishes with the `c` tag (it appears in the Group's foreign lane once Plan 06 ships; for now confirm publish succeeds and the relay shows the `c` tag).
    6. Attach to an Open Group (no schema) — confirm no warnings, just the attach, publish proceeds normally.
    7. Confirm a fully-conforming dataset attached to the Schema Group shows no warnings.
  </how-to-verify>
  <resume-signal>Type "approved" or describe what looked wrong (picker, warning specificity, destructive-vs-amber, any case where publish was blocked).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| schema Group → contributor's tab | The Group's untrusted schema is run against the contributor's dataset on the publish path — must be off-thread |
| contributor publish decision | The validation verdict must never become an authorization gate (GROUP-04) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-05-DOS-PUBLISH | Denial of Service | publish-path validation | mitigate | Contributor-side validation of a stranger Group's schema runs through the off-thread `validateSchema` (timeout-kill/caps/fail-closed); the in-thread `validateDatasetForContext` blocking path is removed — a hostile Group schema cannot freeze the contributor's publish UI |
| T-09-05-BLOCK | Tampering (integrity of GROUP-04) | publish button | mitigate | "Publish anyway" is always enabled; no code path disables publish on a validation verdict; the warn-not-block test gates the build |
| T-09-05-WORKER-FAIL-OPEN | Availability | worker failure handling | accept | On worker failure the contributor sees "couldn't check" and may publish unfiltered — acceptable: the dataset is a valid standalone 37515 regardless, and read-side filtering (Plan 06) re-validates on the viewer |
| T-09-SC | Tampering | shadcn block installs | mitigate | UI-SPEC Registry Safety: official shadcn blocks only (alert/popover/command already present); no `@mapcn`; no new install |
</threat_model>

<verification>
- `bun run build` green; `bun test src/lib/group/warnNotBlock.test.ts` GREEN; `biome check src/features/geo-editor/components/GroupAttachField.tsx src/features/geo-editor/hooks/usePublishing.ts` clean.
- Human-verify checkpoint: attach + per-rule warnings + Publish anyway confirmed; no block on standalone-valid publish.
</verification>

<success_criteria>
- GROUP-02: a contributor attaches a dataset to a Group via a `c` tag from their own publish flow.
- GROUP-04: schema-Group attach shows specific per-rule warnings but never blocks a valid standalone publish; validation is off-thread.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-05-SUMMARY.md` when done.
</output>
