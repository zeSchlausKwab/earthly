---
phase: 09-group-topic-37518-slimmed
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/nostr/group/group.test.ts
  - src/lib/group/schemaHash.test.ts
  - src/lib/group/attach.test.ts
  - src/lib/group/warnNotBlock.test.ts
  - src/lib/group/filterModes.test.ts
  - src/lib/group/noModMinimum.test.ts
  - src/features/groups/schemaBuilder.test.ts
  - src/lib/mute/useMuteStore.test.ts
  - src/lib/validation/schemaErrors.test.ts
autonomous: true
requirements: [GROUP-01, GROUP-02, GROUP-03, GROUP-04, GROUP-05, GROUP-06, GROUP-07, GROUP-08]
must_haves:
  truths:
    - "Every Phase-9 seam has a colocated RED test file that pins its exact export contract before any implementation exists"
    - "bun test surfaces the new group test files as failing (RED) — they import symbols that do not yet exist"
    - "No existing Phase-8 test regresses (615-pass baseline holds)"
  artifacts:
    - path: "src/lib/nostr/group/group.test.ts"
      provides: "GROUP-01 governance serialization + isGroup modelVersion gate (legacy 37518 drops) RED baseline"
      contains: "isGroup"
    - path: "src/lib/group/schemaHash.test.ts"
      provides: "O-03 canonical (key-order-independent) hash + verify-mismatch RED baseline"
    - path: "src/lib/group/attach.test.ts"
      provides: "GROUP-02 c-discovery filter shape RED baseline"
    - path: "src/lib/group/warnNotBlock.test.ts"
      provides: "GROUP-04 never-block invariant RED baseline"
    - path: "src/lib/group/filterModes.test.ts"
      provides: "GROUP-05 off/warn/strict RED baseline"
    - path: "src/lib/group/noModMinimum.test.ts"
      provides: "GROUP-08 sig/kind/mute/cap/sort/escape RED baseline"
    - path: "src/features/groups/schemaBuilder.test.ts"
      provides: "GROUP-03 builder→draft-2020-12 compile RED baseline"
    - path: "src/lib/mute/useMuteStore.test.ts"
      provides: "device-local global mute persist RED baseline"
    - path: "src/lib/validation/schemaErrors.test.ts"
      provides: "D-06 worker verdict carries structured errors[] RED baseline"
  key_links:
    - from: "src/lib/nostr/group/group.test.ts"
      to: "src/lib/nostr/group/helpers.ts"
      via: "import isGroup, GroupFactory, getGroupContent"
      pattern: "from '@/lib/nostr/group'"
---

<objective>
Nyquist Wave-0 RED baseline for Phase 9. Create the nine colocated `*.test.ts` files that pin every Phase-9 seam's export contract and behavioral expectation BEFORE any implementation exists, so subsequent plans implement against a fixed contract rather than inventing one. Each file imports symbols that do not yet exist and asserts the precise behavior the requirement demands; running `bun test` on them MUST surface them RED (failing to import / failing assertion), proving the harness samples every requirement.

Purpose: Pin the seam contracts (symbol names, signatures, behaviors) so the refactor-and-wire plans (02–06) cannot drift. The Phase-8 RED-baseline plan (08-01) used the identical strategy.
Output: Nine failing test files covering GROUP-01..08 + O-03 + the D-06 worker-error extension + the mute store.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-group-topic-37518-slimmed/09-RESEARCH.md
@.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md
@.planning/phases/09-group-topic-37518-slimmed/09-PATTERNS.md
</context>

<artifacts_this_phase_produces>
This phase (across all plans) creates the following NEW symbols — they do not exist yet, so do not flag them as drift:
- Module `src/lib/nostr/group/` exporting: `GroupContent`, `GroupGovernance` (`'open'|'schema'|'closed'`), `GroupGeometryConstraints`, `GroupEvent`, `DEFAULT_GROUP_CONTENT`, `MAP_CONTEXT_GEOMETRY_TYPES` (re-export), `isGroup`, `getGroupContent`, `getGroupId`, `getGroupCoordinate`, `getGroupReferencedAddresses`, `getGroupSchemaHash`, `getGroupBoundingBox`, `getGroupHashtags`, class `Group` (extends `EventCast`), class `GroupFactory` (extends `EntityFactory`), `deleteGroup`.
- Hook `src/lib/hooks/useGroups.ts` exporting `useGroups`.
- `src/lib/nostr/tags.ts` new transformer `setSchemaHash` (+ existing `getSchemaHash` via helper).
- `src/lib/group/schemaHash.ts` exporting `canonicalizeSchema`, `computeSchemaHash`, `verifySchemaHash`.
- `src/lib/group/attach.ts` exporting `resolveGroupMapScope` / lane-resolution helpers (rewritten from `context/scope.ts`).
- `src/lib/group/filterModes.ts` exporting `GroupFilterMode` (`'off'|'warn'|'strict'`), `resolveGroupFilterDefault`, `filterForeignAttachment` (off-thread).
- `src/lib/mute/useMuteStore.ts` exporting `useMuteStore`.
- `src/features/groups/schemaBuilder.ts` exporting `compileBuilderSchema`, `SchemaBuilderRow`, `SchemaFieldType`.
- `src/features/groups/GroupEditorPanel.tsx`, `src/features/groups/groups-columns.tsx`, `src/components/info-panel/GroupViewPanel.tsx`.
- `src/lib/validation/schema.worker.ts` extended `SchemaValidationVerdict.errors?: SchemaRuleError[]` and exported `SchemaRuleError` type.
</artifacts_this_phase_produces>

<tasks>

<task type="auto">
  <name>Task 1: Create the nostr/group + validation + mute RED test stubs</name>
  <files>src/lib/nostr/group/group.test.ts, src/lib/group/schemaHash.test.ts, src/lib/validation/schemaErrors.test.ts, src/lib/mute/useMuteStore.test.ts</files>
  <read_first>
    - src/lib/nostr/article/article.test.ts (create/modify/isGuard round-trip shape — mirror exactly)
    - src/lib/nostr/article/helpers.ts (isArticle modelVersion gate — the shape isGroup must take)
    - src/lib/nostr/article/factory.ts (create injects MODEL_VERSION + generates d; modify preserves d)
    - src/lib/nostr/modelVersion.ts (MODEL_VERSION='earthly/2', hasCurrentModelVersion)
    - src/lib/nostr/geo-event/helpers.ts (computeChecksum at line ~182 — SHA-256-hex source for schemaHash)
    - src/lib/validation/schema.worker.ts (SchemaValidationVerdict shape — runSchemaValidation returns {ok,error}, discards validate.errors at runSchemaValidation ~line 160)
    - src/features/chat/store.ts (persist(...) middleware pattern ~line 965 — mute store analog)
  </read_first>
  <action>
    Create four colocated test files, each importing not-yet-existing symbols so they fail RED.

    `src/lib/nostr/group/group.test.ts` (GROUP-01): import `{ GroupFactory, Group, isGroup, getGroupContent, getGroupCoordinate, DEFAULT_GROUP_CONTENT }` from `@/lib/nostr/group`. Mirror `article.test.ts` structure. Assert: (a) `GroupFactory.create({ name:'X', governance:'schema' })` produces content whose parsed JSON has `governance:'schema'`, `name:'X'`, and `modelVersion === MODEL_VERSION`; (b) `create()` generates a `d` tag when absent and `modify()` preserves the same `d` (lineage — Pitfall 4); (c) `isGroup` returns true for a freshly-created+signed Group event and FALSE for a legacy kind-37518 event with `contextUse`/`validationMode` content and NO modelVersion (clean-break drop — the legacy event has kind 37518 and a `d` tag but lacks `hasCurrentModelVersion`); (d) `isGroup` returns false for a wrong-kind event. Sign with a bare sign-function as `article.test.ts` does (EntityFactory contract).

    `src/lib/group/schemaHash.test.ts` (O-03): import `{ canonicalizeSchema, computeSchemaHash, verifySchemaHash }` from `@/lib/group/schemaHash`. Assert: (a) two schemas with identical content but different key insertion order produce the SAME `computeSchemaHash` result (key-order-independent canonicalization — Pitfall 3); (b) the hash string is prefixed `sha256:`; (c) `verifySchemaHash(schema, correctHash)` is true and `verifySchemaHash(schema, 'sha256:deadbeef')` is false (mismatch rejected). Guard the crypto.subtle path the way `computeChecksum` is guarded.

    `src/lib/validation/schemaErrors.test.ts` (D-06 / A3, decision: EXTEND the worker verdict — option (a)): import `{ runSchemaValidation }` and the new `SchemaRuleError` type from `@/lib/validation/schema.worker`. Assert that when validation FAILS, the verdict carries a non-empty `errors` array of `SchemaRuleError` items, each with at least a human `message` field and an `instancePath`/`keyword` so the UI can render per-rule reasons (e.g. a schema requiring property `name` validated against an object missing `name` yields an error mentioning `name` and `required`). Assert that on PASS, `ok===true` and `errors` is absent or empty. This pins the chosen resolution of the flagged decision: the off-thread worker carries structured errors rather than an in-thread re-validate.

    `src/lib/mute/useMuteStore.test.ts`: import `{ useMuteStore }` from `@/lib/mute/useMuteStore`. Drive the store outside React via `useMuteStore.getState()`. Assert: (a) `mute(pk)` then `getState().muted` includes `pk`; (b) muting the same `pk` twice does not duplicate it (Set semantics); (c) `unmute(pk)` removes it; (d) the store is created via zustand `persist` with localStorage name `earthly-muted-contributors` (assert the persisted key name is present on the store's persist options, mirroring `chat/store.ts`).
  </action>
  <verify>
    <automated>bun test src/lib/nostr/group/group.test.ts src/lib/group/schemaHash.test.ts src/lib/validation/schemaErrors.test.ts src/lib/mute/useMuteStore.test.ts 2>&1 | grep -qE "fail|error|Cannot find" && echo "RED-OK (expected failures present)"</automated>
  </verify>
  <acceptance_criteria>
    - All four files exist and are valid TypeScript that Bun can parse (import-resolution failures are the expected RED signal, not syntax errors).
    - `group.test.ts` asserts the legacy-37518-without-modelVersion event is rejected by `isGroup` (clean-break, SPEC-03).
    - `schemaHash.test.ts` asserts key-order-independence (canonicalization) — two differently-ordered equal schemas hash identically.
    - `schemaErrors.test.ts` asserts the verdict carries a structured `errors` array on failure (pins the EXTEND-worker decision).
    - `useMuteStore.test.ts` asserts Set-dedup, unmute, and the `earthly-muted-contributors` persist key.
    - Running the command surfaces the files RED (failing to import not-yet-existing symbols).
  </acceptance_criteria>
  <done>Four RED test files exist; bun test reports them failing because the target symbols/files do not yet exist; no Phase-8 test regresses.</done>
</task>

<task type="auto">
  <name>Task 2: Create the lib/group lane + the features/groups builder RED test stubs</name>
  <files>src/lib/group/attach.test.ts, src/lib/group/warnNotBlock.test.ts, src/lib/group/filterModes.test.ts, src/lib/group/noModMinimum.test.ts, src/features/groups/schemaBuilder.test.ts</files>
  <read_first>
    - src/lib/context/scope.ts (allowForeignAttachments branch at ~line 35,48 — the governance rewrite target)
    - src/lib/context/validation.ts (getEffectiveContextValidationMode/defaultContextFilterMode ~line 37-57; ContextValidationIssue shape ~line 288-300)
    - src/lib/hooks/useGeoDatasets.ts (useTimelineWithEose c-filter discovery shape; useMapContexts ~line 46)
    - src/lib/validation/schemaWorker.ts (validateSchema(schema,data,{schemaHash}) → {ok,error} off-thread; bun-test pure-engine fallback)
    - src/features/contexts/MapContextEditorPanel.tsx (SchemaBuilderField block ~line 50-62, 900-913 — the builder to extract; Ajv2020 import)
    - src/lib/nostr/kinds.ts (GEO_EVENT_KIND=37515, MAP_CONTEXT_KIND=37518)
  </read_first>
  <action>
    Create five colocated test files importing not-yet-existing symbols (RED).

    `src/lib/group/attach.test.ts` (GROUP-02): import the lane-resolution helper and the discovery-filter builder from `@/lib/group/attach`. Assert: (a) the attach-discovery filter for a group coordinate equals `{ '#c': [groupCoord], kinds: [GEO_EVENT_KIND] }` (37515); (b) given a Group with `governance:'closed'` the foreign lane is suppressed (no `#c` subscription), while `governance:'open'` and `governance:'schema'` produce the foreign-lane filter (rewrite of the `allowForeignAttachments` branch → `governance !== 'closed'`).

    `src/lib/group/warnNotBlock.test.ts` (GROUP-04 — the hard invariant): import the attach-validation entrypoint from `@/lib/group` (the function the publish dialog calls). Assert that for a schema Group whose schema rejects the dataset properties, the result is a NON-blocking verdict — it returns `{ ok:false, errors:[...] }` (warnings) but exposes NO mechanism that prevents publish; assert the publish-decision function (e.g. `canPublishStandalone`) returns true regardless of the validation verdict. The invariant under test: a valid standalone 37515 ALWAYS publishes (GROUP-04 / REQUIREMENTS "warn-not-block").

    `src/lib/group/filterModes.test.ts` (GROUP-05): import `{ filterForeignAttachment, GroupFilterMode, resolveGroupFilterDefault }` from `@/lib/group/filterModes`. Assert: (a) `resolveGroupFilterDefault('schema')` === `'strict'`, `('open')` === `'off'`, `('closed')` yields no foreign lane; (b) in `'strict'` a non-conforming attachment is hidden and the result carries a legible `reason` string; (c) in `'warn'` it is shown WITH a `reason`/badge; (d) in `'off'` everything is shown. Drive `validateSchema` via the bun-test synchronous pure-engine fallback.

    `src/lib/group/noModMinimum.test.ts` (GROUP-08): import the foreign-lane gate from `@/lib/group/noModMinimum` (or `attach`). Assert the per-coordinate gate ORDER and outcomes: (a) an event whose `kind !== 37515` is dropped before render; (b) an event failing `verifyEvent` (forged/bad sig) is dropped; (c) an event whose pubkey is in the mute set is dropped; (d) the lane is capped at 50 with a "load more" remainder (51 valid events → 50 returned + hasMore true); (e) sort is newest-first by `created_at`; (f) the "flip to closed" produces a modify template with `governance:'closed'` and the SAME `d` (escape hatch republish, D-02). Use synthetic events; sign valid ones with a real key so `verifyEvent` passes, and hand-corrupt the `.sig` on the forged one.

    `src/features/groups/schemaBuilder.test.ts` (GROUP-03): import `{ compileBuilderSchema }` from `@/features/groups/schemaBuilder`. Assert: (a) a builder row set [{name:'name',type:'text',required:true},{name:'count',type:'number'}] + allowed geometry [Point] compiles to a valid draft-2020-12 JSON Schema object (has `$schema` draft-2020-12, `properties.name`, `required:['name']`); (b) an `enum` row with allowed values ['a','b'] compiles to `enum:['a','b']`; (c) the compiled schema is accepted by the Phase-8 worker dialect (validateSchema does not fail-closed on it). This pins the builder→schema contract both the builder UI and the raw-JSON advanced tab must satisfy.
  </action>
  <verify>
    <automated>bun test src/lib/group/attach.test.ts src/lib/group/warnNotBlock.test.ts src/lib/group/filterModes.test.ts src/lib/group/noModMinimum.test.ts src/features/groups/schemaBuilder.test.ts 2>&1 | grep -qE "fail|error|Cannot find" && echo "RED-OK (expected failures present)"</automated>
  </verify>
  <acceptance_criteria>
    - All five files exist and Bun parses them; import-resolution failures are the RED signal.
    - `attach.test.ts` pins the `{ '#c':[coord], kinds:[37515] }` discovery filter and the `governance !== 'closed'` foreign-lane condition.
    - `warnNotBlock.test.ts` pins that validation NEVER blocks a standalone publish (GROUP-04 invariant).
    - `filterModes.test.ts` pins default-strict-for-schema / default-off-for-open and the off/warn/strict outcomes each with a legible reason.
    - `noModMinimum.test.ts` pins kind-gate → sig-gate → mute-gate ORDER, the 50-cap+load-more, newest-first sort, and the flip-to-closed-preserves-d escape hatch.
    - `schemaBuilder.test.ts` pins builder→draft-2020-12 compile accepted by the Phase-8 worker.
  </acceptance_criteria>
  <done>Five RED test files exist; bun test reports them failing on missing symbols; no Phase-8 test regresses.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test harness → not-yet-built modules | Test files import symbols that do not exist; no untrusted runtime input is processed in this plan |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-01-FALSEGREEN | Tampering | RED baseline tests | mitigate | Tests assert behavior (not just import existence) so a stub that merely satisfies imports without correct behavior still fails — prevents a fake-GREEN in plans 02–06 |
| T-09-01-DOS-PIN | Denial of Service | schemaErrors / filterModes stubs | mitigate | The schema-DoS proof is pinned to the Phase-8 worker path (`validateSchema`/`runSchemaValidation`); these stubs forbid any in-thread `ajv.compile` gating by importing only the off-thread entrypoint |
| T-09-SC | Tampering | npm/pip/cargo installs | mitigate | No installs in this plan; RESEARCH Package Legitimacy Audit = N/A (zero new deps). slopcheck N/A. |
</threat_model>

<verification>
- `bun test src/lib/nostr/group src/lib/group src/lib/mute src/features/groups src/lib/validation/schemaErrors.test.ts` surfaces the nine new files RED.
- `bun test` overall: the Phase-8 615-pass baseline still passes for all pre-existing files (only the nine NEW files are RED).
- `biome check src/lib/nostr/group src/lib/group src/lib/mute src/features/groups` is clean (test files are lint-clean).
</verification>

<success_criteria>
- Nine colocated RED test files exist, each pinning a requirement's behavioral contract (not just symbol existence).
- The flagged D-06 decision is pinned: `schemaErrors.test.ts` asserts the worker verdict carries structured `errors[]` (option a, EXTEND worker).
- Running bun test shows exactly the nine new files failing (RED), with the Phase-8 baseline intact.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-01-SUMMARY.md` when done.
</output>
