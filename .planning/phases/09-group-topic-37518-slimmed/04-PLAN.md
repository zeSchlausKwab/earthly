---
phase: 09-group-topic-37518-slimmed
plan: 04
type: execute
wave: 4
depends_on: ["09-02", "09-03"]
files_modified:
  - src/features/groups/schemaBuilder.ts
  - src/features/groups/GroupEditorPanel.tsx
  - src/features/groups/groups-columns.tsx
autonomous: false
requirements: [GROUP-01, GROUP-03]
user_setup: []
must_haves:
  truths:
    - "A user can create/edit a Group choosing governance via 3 plain-language radio cards (open/schema/closed)"
    - "A non-developer owner can author a contribution schema via a visual field-rule builder (property rows + geometry checkboxes), with a raw-JSON advanced escape hatch — both compile to draft-2020-12 and feed the off-thread worker"
    - "The schema-authoring section appears ONLY when governance is 'schema'; leaving 'schema' strips geometryConstraints/schema from content"
    - "On save, the Group publishes with a canonical schema-hash tag; edit preserves the d-tag"
  artifacts:
    - path: "src/features/groups/schemaBuilder.ts"
      provides: "compileBuilderSchema (builder rows + geometry → draft-2020-12 JSON Schema)"
      contains: "draft"
    - path: "src/features/groups/GroupEditorPanel.tsx"
      provides: "governance radio cards + conditional schema tab (builder/advanced) + create/edit write path"
      min_lines: 200
      contains: "GroupFactory"
    - path: "src/features/groups/groups-columns.tsx"
      provides: "Group list table columns"
  key_links:
    - from: "src/features/groups/GroupEditorPanel.tsx"
      to: "src/lib/nostr/group"
      via: "GroupFactory.create/modify + sign + publish"
      pattern: "GroupFactory"
    - from: "src/features/groups/GroupEditorPanel.tsx"
      to: "src/features/groups/schemaBuilder.ts"
      via: "compileBuilderSchema then computeSchemaHash"
      pattern: "compileBuilderSchema"
    - from: "src/features/groups/schemaBuilder.ts"
      to: "src/lib/validation/schemaWorker.ts"
      via: "compiled schema accepted by the Phase-8 dialect"
      pattern: "draft-2020-12|2020-12"
---

<objective>
Build the Group authoring UI by refactoring `MapContextEditorPanel` in place into `GroupEditorPanel` (the Discretion default — ~90% carries over): replace the `contextUse`/`validationMode`/`Switch allowForeignAttachments` policy controls with the 3 governance radio cards (D-01), extract the schema builder into `schemaBuilder.ts` with a builder-default + raw-JSON advanced tab (D-04), conditionally mount the schema section only under `governance:'schema'`, and wire the write path through `GroupFactory` with a canonical `schema-hash`. Turn Plan 01's schemaBuilder.test.ts GREEN (GROUP-03) and complete GROUP-01's authoring surface.

Purpose: The owner-facing create/edit surface. Honors the UI-SPEC governance-ladder copy, the builder/advanced contract, and the accent-color reservation. Both schema paths feed the same Phase-8 hardened validator.
Output: `schemaBuilder.ts`, `GroupEditorPanel.tsx`, `groups-columns.tsx`. autonomous:false — ends with a human-verify checkpoint for the authoring flow.
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
@src/features/contexts/MapContextEditorPanel.tsx
@src/features/contexts/contexts-columns.tsx
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extract schemaBuilder.ts (builder rows + geometry → draft-2020-12)</name>
  <files>src/features/groups/schemaBuilder.ts</files>
  <read_first>
    - src/features/contexts/MapContextEditorPanel.tsx (SchemaFieldType + SchemaBuilderField block ~line 50-62; the geometry-checkbox + builder→schema compile logic; Ajv2020/addFormats import ~line 4-5)
    - src/lib/nostr/group/helpers.ts (MAP_CONTEXT_GEOMETRY_TYPES, GroupGeometryConstraints)
    - src/lib/validation/schemaWorker.ts (validateSchema — the compiled schema must pass the Phase-8 dialect: draft-2020-12, no $data, no external $ref, within size/depth/keyword caps)
    - src/features/groups/schemaBuilder.test.ts (Plan 01 RED contract)
  </read_first>
  <behavior>
    - compileBuilderSchema([{name:'name',type:'text',required:true},{name:'count',type:'number'}], [Point]) → draft-2020-12 schema with $schema 2020-12, properties.name (type string), properties.count (type number), required:['name'].
    - an enum row {type:'enum', allowedValues:['a','b']} → properties.x.enum===['a','b'].
    - the compiled schema is accepted by validateSchema (does not fail-closed on the Phase-8 dialect/caps).
  </behavior>
  <action>
    Extract the legacy `SchemaBuilderField` compile logic (`MapContextEditorPanel.tsx:50-62` and the surrounding builder→schema code) into a pure `src/features/groups/schemaBuilder.ts`. Define `export type SchemaFieldType = 'text' | 'number' | 'integer' | 'boolean' | 'enum'`, `export interface SchemaBuilderRow { name: string; type: SchemaFieldType; required?: boolean; allowedValues?: string[] }`, and `export function compileBuilderSchema(rows: SchemaBuilderRow[], allowedGeometryTypes: GroupGeometryType[]): Record<string, unknown>`. The output MUST: set `$schema` to the draft-2020-12 URI (matching the Ajv2020 dialect the Phase-8 worker pins); build `properties` mapping `text→{type:'string'}`, `number→{type:'number'}`, `integer→{type:'integer'}`, `boolean→{type:'boolean'}`, `enum→{enum: allowedValues}`; build `required` from rows flagged required; encode `allowedGeometryTypes` as the geometry constraint (a `properties.geometry.type` enum or the existing GeoJSON-feature shape the legacy builder produced — preserve the legacy semantics). The compiled object must stay within the worker's 64KB/depth-12/4096-keyword caps and use NO `$ref`/`$data`. Provide the inverse `decodeBuilderSchema(schema)` if the legacy panel round-trips a saved schema back into builder rows (mirror whatever the legacy panel did). Keep it pure (no React) so it is unit-testable and reusable by the raw-JSON advanced tab's validate affordance.
  </action>
  <verify>
    <automated>bun test src/features/groups/schemaBuilder.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bun test src/features/groups/schemaBuilder.test.ts` GREEN: builder rows + geometry compile to draft-2020-12 with correct `properties`/`required`/`enum`; the result is accepted by `validateSchema`.
    - `grep -n "2020-12\\|draft" src/features/groups/schemaBuilder.ts` confirms the dialect.
    - `grep -c "\\$ref\\|\\$data" src/features/groups/schemaBuilder.ts` is 0 (the builder never emits forbidden keywords).
    - `schemaBuilder.ts` is pure (no `import ... from 'react'`).
  </acceptance_criteria>
  <done>compileBuilderSchema emits a worker-accepted draft-2020-12 schema; test GREEN; module is pure.</done>
</task>

<task type="auto">
  <name>Task 2: GroupEditorPanel (governance radio cards + schema tabs) + groups-columns</name>
  <files>src/features/groups/GroupEditorPanel.tsx, src/features/groups/groups-columns.tsx</files>
  <read_first>
    - src/features/contexts/MapContextEditorPanel.tsx (the panel being refactored — imports/account/factory at line 1-13; Tabs + ContextEditorTab at ~line 41,51; the policy tab controls to replace; the unlabeled-checkbox a11y bug at ~line 900-913)
    - src/features/contexts/contexts-columns.tsx (the table columns to rename)
    - src/lib/nostr/group/factory.ts (GroupFactory.create/modify/group/labels/schemaHash/referencedAddresses)
    - src/lib/group/schemaHash.ts (computeSchemaHash — write the canonical hash on save)
    - src/features/groups/schemaBuilder.ts (compileBuilderSchema)
    - .planning/phases/09-group-topic-37518-slimmed/09-UI-SPEC.md (governance card copy table; primary-accent reservation; Builder/Advanced tab styling h-8 rounded-none border-b-2; shadcn Checkbox+Label a11y fix; typography 4-size/2-weight scale; spacing standard set)
    - src/components/ui/radio-group.tsx, src/components/ui/card.tsx, src/components/ui/tabs.tsx (existing primitives)
  </read_first>
  <action>
    Refactor `MapContextEditorPanel` in place into `src/features/groups/GroupEditorPanel.tsx` (Discretion: refactor-in-place — the clean-break content shape makes rename lowest-risk). Keep the imports/account/factory pattern (`useActiveAccount`, `castEvent`, `eventStore`/`publish`) but swap `MapContextFactory` → `GroupFactory`.

    Governance ladder (D-01): replace the `policy` tab's `contextUse`/`validationMode`/`Switch allowForeignAttachments` controls with a single-column `RadioGroup` of 3 `Card`-bodied radio cards. Use the EXACT UI-SPEC copy: Open = "Anyone can attach their dataset — contributions appear below your curated picks."; Schema = "Anyone can attach, but contributions are checked against your rules first."; Closed = "Only the references you curate appear — no outside contributions." Card title 14px semibold; explanation 13px body `muted-foreground`. Selected card: `--primary` ring + subtle accent fill (the ONLY accent use besides the submit button per UI-SPEC); unselected neutral `border-border`.

    Schema section (D-04): conditionally mount ONLY when `governance === 'schema'` (mirror the legacy `allowForeignAttachments &&` gating, keyed on the enum). When the radio leaves `schema`, strip `geometryConstraints`/`schema` from the content object (O-02 field-coexistence). Inside: a `Tabs` with Builder (default) and "Advanced (JSON)" triggers styled `h-8 rounded-none border-b-2`. Builder = stacked bordered property rows (Input name + Select type + conditional comma-separated enum values Input + `required?` Checkbox + ghost Remove), an outline "Add property" button, and a geometry-type checkbox grid over `MAP_CONTEXT_GEOMETRY_TYPES`. FIX the legacy a11y bug (`MapContextEditorPanel.tsx:900-913`): use the shadcn `Checkbox` + `Label htmlFor` pairing (not raw `<input type=checkbox>` / bare radix checkbox) so every control is labeled and keyboard-reachable. Advanced = `Textarea` `font-mono text-xs` rows≥12 with live JSON parse-error surfaced inline (UI-SPEC error copy). Both tabs compile to the SAME draft-2020-12 schema via `compileBuilderSchema` (builder) or the parsed raw JSON (advanced), and both feed `validateSchema` for the live "Sample properties" affordance (keep it: valid=secondary/emerald, invalid=amber, parse-error=destructive).

    Write path: on save, compile the schema (when governance=schema), compute `computeSchemaHash(schema)`, then `GroupFactory.create(content).labels(...).schemaHash(hash).sign(account)` → `publish`; edit path uses `GroupFactory.modify(group).group(content)...` preserving `d`. Submit button = primary accent, copy "Create Group" / "Save Group" / "Saving…"; name-missing inline error "Group name is required." Empty-state copy from the UI-SPEC table.

    Rename `contexts-columns.tsx` → `src/features/groups/groups-columns.tsx` (rename + repoint to `useGroups`/`Group`/`isGroup`). Repoint the editor/columns import sites that referenced `@/features/contexts/*` and `@/lib/nostr/map-context` to the new group module (this is one of the map-context consumer migrations Plan 02 deferred — record any remaining sites for Plans 05/06).
  </action>
  <verify>
    <automated>bun run build 2>&1 | tail -5 && bun test src/features/groups</automated>
  </verify>
  <acceptance_criteria>
    - `bun run build` succeeds (the refactored panel + columns resolve; no circular-import startup crash).
    - `grep -n "RadioGroup" src/features/groups/GroupEditorPanel.tsx` present; the 3 governance card copy strings from the UI-SPEC are present verbatim (source assertion on at least the Open/Schema/Closed one-liners).
    - `grep -c "contextUse\\|validationMode\\|allowForeignAttachments" src/features/groups/GroupEditorPanel.tsx` (non-comment) is 0 — the legacy triad controls are gone.
    - The schema section is gated on `governance === 'schema'` (source assertion) and the write path calls `GroupFactory` + `computeSchemaHash` (source assertions).
    - `grep -n "type=\"checkbox\"" src/features/groups/GroupEditorPanel.tsx` is absent for the builder rows — the shadcn `Checkbox` + `Label htmlFor` a11y fix is in place.
    - `biome check src/features/groups` clean.
  </acceptance_criteria>
  <done>GroupEditorPanel renders the governance ladder + conditional builder/advanced schema authoring with the a11y fix, writes via GroupFactory with a canonical schema-hash; columns renamed; build green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>The Group authoring panel: 3 governance radio cards with plain-language copy, a conditional schema tab (visual builder + raw-JSON advanced), live sample-validation, and a create/edit write path that publishes a kind-37518 Group with a canonical schema-hash. The legacy unlabeled-checkbox a11y gap is fixed.</what-built>
  <how-to-verify>
    1. Run `bun dev` and `bun relay` (relay on 3334).
    2. Open the Group editor (the panel that replaced the Map Context editor — via the sidebar/authoring entry).
    3. Create a Group: enter a name + description, pick each governance card in turn — confirm the one-line explanations read as in the UI-SPEC and only the selected card shows the accent ring.
    4. Select "Schema": confirm the schema section appears. Add 2 property rules (one required text, one enum with two values) and check a couple geometry types in the Builder tab. Confirm each checkbox/label is clickable and keyboard-reachable (Tab + Space).
    5. Switch to "Advanced (JSON)": confirm the builder's rules appear as raw JSON; type an invalid `{` and confirm the inline parse-error copy shows; fix it.
    6. Switch governance away from Schema and back — confirm the schema fields clear when leaving Schema.
    7. Save → confirm the Group publishes (check the relay / the Groups list). Edit it and re-save → confirm it updates in place (same entry, not a duplicate — d-tag preserved).
  </how-to-verify>
  <resume-signal>Type "approved" or describe what looked wrong (copy, accent placement, builder behavior, a11y, publish/edit).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| owner input → schema | The owner's builder rows / raw JSON become a published schema other viewers will run — must compile to the hardened dialect only |
| owner input → published event | Name/description/schema-hash written to a signed 37518 event |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-04-BAD-DIALECT | Tampering | compileBuilderSchema / advanced raw JSON | mitigate | Builder emits draft-2020-12 with NO `$ref`/`$data` and within caps (grep-asserted); the advanced tab's raw JSON is run through `validateSchema` (which rejects unsafe dialect) before save so a malformed/hostile schema is caught at authoring time |
| T-09-04-HASH-OMIT | Tampering | save write path | mitigate | `computeSchemaHash` is written on every schema save so viewers can verify-before-validate (Pitfall 3 integrity link) |
| T-09-04-XSS-DESC | Tampering/Elevation | description Markdown | mitigate | Description is Markdown rendered later through the sanitized `RichContentRenderer` (no raw HTML) — authoring stores plain Markdown, never HTML |
| T-09-04-A11Y | (quality, not security) | builder checkboxes | mitigate | shadcn Checkbox+Label htmlFor replaces the legacy unlabeled inputs (keyboard-reachable) |
| T-09-SC | Tampering | shadcn block installs | mitigate | UI-SPEC Registry Safety: all blocks are official shadcn (already in src/components/ui), zero `@mapcn` blocks; no new install, slopcheck N/A |
</threat_model>

<verification>
- `bun test src/features/groups` GREEN (schemaBuilder); `bun run build` green; `biome check src/features/groups` clean.
- Human-verify checkpoint: authoring flow (governance cards, builder/advanced, a11y, create+edit-in-place) confirmed.
</verification>

<success_criteria>
- GROUP-01 authoring + GROUP-03 schema authoring are usable by a non-developer (visual builder default) without trapping a power user (raw-JSON advanced), both feeding the Phase-8 worker.
- The governance ladder uses the exact UI-SPEC copy and the reserved accent; the schema section is governance-gated and field-coexistence-correct.
- Saves write a canonical schema-hash; edits preserve d-lineage; the legacy a11y gap is fixed.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-04-SUMMARY.md` when done.
</output>
