---
phase: 09-group-topic-37518-slimmed
plan: 02
type: execute
wave: 2
depends_on: ["09-01"]
files_modified:
  - src/lib/nostr/group/helpers.ts
  - src/lib/nostr/group/cast.ts
  - src/lib/nostr/group/factory.ts
  - src/lib/nostr/group/index.ts
  - src/lib/nostr/tags.ts
  - src/lib/hooks/useGroups.ts
  - src/lib/nostr/index.ts
autonomous: true
requirements: [GROUP-01]
must_haves:
  truths:
    - "A user can create a Group with name, description, and governance (open|schema|closed) that serializes to kind-37518 content carrying the current modelVersion"
    - "A legacy kind-37518 context event (no modelVersion) is rejected by isGroup and never rendered as a Group (clean-break, SPEC-03)"
    - "Editing a Group preserves its d-tag lineage (comments/reactions do not detach)"
    - "Every Group tag read/write delegates to the shared tags.ts seam — no copy-pasted getters/setters"
  artifacts:
    - path: "src/lib/nostr/group/helpers.ts"
      provides: "GroupContent interface (governance enum), isGroup modelVersion gate, defensive content getter, coordinate + schema-hash + curated-ref getters"
      contains: "hasCurrentModelVersion"
    - path: "src/lib/nostr/group/cast.ts"
      provides: "class Group extends EventCast — maintainer-mandated read view"
      contains: "extends EventCast"
    - path: "src/lib/nostr/group/factory.ts"
      provides: "GroupFactory extends EntityFactory — create/modify d-lineage, modelVersion re-assertion, tag setters via tags.ts, schemaHash + referencedAddresses setters"
      contains: "extends EntityFactory"
    - path: "src/lib/hooks/useGroups.ts"
      provides: "subscribe 37518 → cast Group reactive hook"
      contains: "useGroups"
    - path: "src/lib/nostr/tags.ts"
      provides: "setSchemaHash transformer (schema-hash tag) for the article-style delegation"
      contains: "setSchemaHash"
  key_links:
    - from: "src/lib/nostr/group/factory.ts"
      to: "src/lib/nostr/tags.ts"
      via: "setBbox/setHashtags/setLabels/setReferencedAddresses/setSchemaHash delegation"
      pattern: "from '@/lib/nostr/tags'"
    - from: "src/lib/nostr/group/helpers.ts"
      to: "src/lib/nostr/modelVersion.ts"
      via: "hasCurrentModelVersion gate in isGroup"
      pattern: "hasCurrentModelVersion"
    - from: "src/lib/hooks/useGroups.ts"
      to: "src/lib/nostr/group"
      via: "castEvent(e, Group, eventStore)"
      pattern: "castEvent\\(.*Group"
---

<objective>
Build the `src/lib/nostr/group/` module — the per-kind Factory+Cast foundation the rest of the phase consumes — by refactoring `src/lib/nostr/map-context/` in place: slim the `contextUse`/`validationMode`/`allowForeignAttachments` triad to a single `governance: 'open'|'schema'|'closed'` enum, add the SPEC-03 `hasCurrentModelVersion` clean-break gate to `isGroup`, switch the factory to `EntityFactory` with `tags.ts`-delegated setters, add the `useGroups` subscribe hook, and add the `setSchemaHash` transformer to `tags.ts`. Keep the constant name `MAP_CONTEXT_KIND` (37518) — only the module/types rename. This turns Plan 01's group.test.ts GREEN (GROUP-01).

Purpose: Everything else in the phase (validation pipeline, editor, attach, two-lane view) imports from `@/lib/nostr/group` and `useGroups`. This is the blocking foundation.
Output: The four-file `group/` module + `useGroups` hook + `setSchemaHash` tags transformer, with the `nostr/index.ts` barrel wired.
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
@.planning/phases/09-group-topic-37518-slimmed/09-PATTERNS.md
@.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md
@src/lib/nostr/map-context/helpers.ts
@src/lib/nostr/map-context/factory.ts
@src/lib/nostr/map-context/cast.ts
@src/lib/nostr/article/helpers.ts
@src/lib/nostr/article/factory.ts
@src/lib/nostr/tags.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create group/ module (helpers, cast, factory, index) + setSchemaHash transformer</name>
  <files>src/lib/nostr/group/helpers.ts, src/lib/nostr/group/cast.ts, src/lib/nostr/group/factory.ts, src/lib/nostr/group/index.ts, src/lib/nostr/tags.ts</files>
  <read_first>
    - src/lib/nostr/map-context/helpers.ts (the file being slimmed — MapContextContent, isMapContext, getters)
    - src/lib/nostr/map-context/factory.ts (MapContextFactory — schemaHash + referencedAddresses + contextReferences setters; deleteMapContext)
    - src/lib/nostr/map-context/cast.ts (class MapContext extends EventCast — the read-view shape to mirror)
    - src/lib/nostr/article/helpers.ts (isArticle modelVersion gate — the exact shape isGroup must take)
    - src/lib/nostr/article/factory.ts (ArticleFactory extends EntityFactory — create strips+re-asserts modelVersion, modify preserves d, tag setters delegate to tags.ts)
    - src/lib/nostr/entityFactory.ts (EntityFactory base — bare sign-function override)
    - src/lib/nostr/tags.ts (existing get/set transformers — add setSchemaHash next to setReferencedAddresses)
    - src/lib/nostr/modelVersion.ts (MODEL_VERSION, hasCurrentModelVersion)
    - src/lib/nostr/group/group.test.ts (the RED contract from Plan 01 — implement to satisfy it)
  </read_first>
  <behavior>
    - GroupFactory.create({name:'X',governance:'schema'}) → content JSON with governance:'schema', name:'X', modelVersion===MODEL_VERSION; generates d if absent.
    - GroupFactory.modify(group) preserves the same d-tag.
    - isGroup(event) true for current-model 37518 with d; FALSE for legacy 37518 lacking modelVersion; false for wrong kind.
    - getGroupContent merges parsed content over DEFAULT_GROUP_CONTENT only (no legacy field migration).
    - All tag setters route through tags.ts transformers; setSchemaHash writes ["schema-hash", value].
  </behavior>
  <action>
    Create `src/lib/nostr/group/helpers.ts`. Define `GroupGovernance = 'open' | 'schema' | 'closed'`, `GroupGeometryConstraints { allowedTypes: GroupGeometryType[] }` reusing the `MAP_CONTEXT_GEOMETRY_TYPES` tuple (re-export it under both names so existing geometry-checkbox consumers keep working), and `GroupContent { modelVersion?, name, description?, descriptionFormat?:'markdown', governance: GroupGovernance, geometryConstraints?, schema?: Record<string,unknown>, image? }`. Set `DEFAULT_GROUP_CONTENT = { name:'', descriptionFormat:'markdown', governance:'open' }`. Drop `contextUse`/`validationMode`/`allowForeignAttachments`/`references`/`schemaDialect` from the content interface (clean break — they are simply absent, not migrated). Write `isGroup` mirroring `isArticle` (`article/helpers.ts:49`): `event.kind === MAP_CONTEXT_KIND && getTagValue(event,'d') !== undefined && hasCurrentModelVersion(event)` — this is the SPEC-03 gate the legacy `isMapContext` lacked. Write the defensive `getGroupContent` via `getOrComputeCachedValue` + try/catch → `{ ...DEFAULT_GROUP_CONTENT }` merge (mirror `getMapContextContent`). Keep `getGroupId`, `getGroupCoordinate` (`${kind}:${pubkey}:${d}`), `getGroupSchemaHash` (reads `schema-hash` tag via `getTagValue`), and delegate `getGroupBoundingBox`/`getGroupHashtags`/`getGroupReferencedAddresses`/`getGroupContextReferences` to the `tags.ts` getters (no copy-paste — mirror `article/helpers.ts:74-97`).

    Create `src/lib/nostr/group/cast.ts`. Define `class Group extends EventCast<GroupEvent>` mirroring `map-context/cast.ts`: throw in the ctor when `!isGroup(event)` with message "Event is not a Group (kind 37518)"; expose raw proxies (`kind`/`pubkey`/`tags`/`content`/`created_at`/`id`) and helper-backed getters `get group()` (was `context()`), `get groupCoordinate()`, `get referencedAddresses()` (curated lane), `get schemaHash()`, plus `rawEvent()`. This is the maintainer-mandated `EventCast` contract — never hand-roll a wrapper.

    Create `src/lib/nostr/group/factory.ts`. Define `class GroupFactory extends EntityFactory<typeof MAP_CONTEXT_KIND>` (NOT raw EventFactory — article uses the shared base for the bare-sign-function Wave-0 contract). `static create(content)`: `blankEventTemplate(MAP_CONTEXT_KIND)`, strip caller `modelVersion` then re-assert `MODEL_VERSION` last (`JSON.stringify({ ...DEFAULT_GROUP_CONTENT, ...rest, modelVersion: MODEL_VERSION })`), generate `d` via `generateShortDTag()` only if absent — copy `article/factory.ts:33-49`. `static modify(event)`: throw if `!isGroup(event)`, else `resolve(toEventTemplate(event))` (preserves `d` — Pitfall 4). Chain setter `group(content)` re-asserts `modelVersion` (mirror `article()` at `article/factory.ts:60-78`). Tag setters delegate to `tags.ts`: `bbox`/`geohash`/`hashtags`/`labels`/`contextReferences`/`referencedAddresses` → `setBbox`/`setGeohash`/`setHashtags`/`setLabels`/`setContextRefs`/`setReferencedAddresses` (mirror `article/factory.ts:80-102`), and add `schemaHash(value)` → `setSchemaHash`. Carry over `deleteGroup(group, signer, reason?)` from `deleteMapContext` (`map-context/factory.ts:124-134`, `DeleteFactory.fromEvents` + `publish({routing:'outbox'})`).

    In `src/lib/nostr/tags.ts`, add `export function setSchemaHash(tags: string[][], value: string | undefined): string[][]` mirroring `setReferencedAddresses` (`tags.ts:125`): drop existing `schema-hash` tags, append `['schema-hash', value]` when value is truthy. This resolves the flagged "schema-hash transformer" decision in favor of adding it to `tags.ts` (matches the article delegation posture; removes the inline form from the factory).

    Create `src/lib/nostr/group/index.ts` barrel: `export * from './cast'; export * from './factory'; export * from './helpers'` (mirror `article/index.ts`).
  </action>
  <verify>
    <automated>bun test src/lib/nostr/group/group.test.ts src/lib/nostr/tags.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bun test src/lib/nostr/group/group.test.ts` passes (GROUP-01 GREEN): governance serialization, modelVersion re-assertion, create-generates-d / modify-preserves-d, isGroup rejects legacy-37518-without-modelVersion.
    - `grep -n "setSchemaHash" src/lib/nostr/tags.ts` returns the new transformer.
    - `grep -c "tags\\[0\\] === 'schema-hash'\\|filter((t) => t\\[0\\] !== 'schema-hash')" src/lib/nostr/group/factory.ts` — the factory does NOT inline-build the schema-hash tag; it calls `setSchemaHash` (assert via `grep -n "setSchemaHash" src/lib/nostr/group/factory.ts`).
    - `class Group extends EventCast` present in cast.ts; `class GroupFactory extends EntityFactory` present in factory.ts.
    - `isGroup` body contains `hasCurrentModelVersion` (source assertion).
    - No `contextUse`/`validationMode`/`allowForeignAttachments` identifiers remain in `group/helpers.ts` (`grep -c` filtered for non-comment lines returns 0).
  </acceptance_criteria>
  <done>The group/ module compiles and group.test.ts is GREEN; setSchemaHash exists in tags.ts and the factory delegates to it; the existing tags.test.ts still passes.</done>
</task>

<task type="auto">
  <name>Task 2: Add useGroups hook + wire the nostr barrel; migrate map-context import sites</name>
  <files>src/lib/hooks/useGroups.ts, src/lib/nostr/index.ts</files>
  <read_first>
    - src/lib/hooks/useGeoDatasets.ts (useTimelineWithEose + castEvent; useMapContexts at ~line 46-60; the null-to-skip filter pattern ~line 27-43)
    - src/lib/nostr/hooks.ts (useTimelineWithEose, eventStore, castEvent)
    - src/lib/nostr/index.ts (barrel — where map-context is currently exported; add group export)
    - src/lib/nostr/group/cast.ts (the Group cast just created)
  </read_first>
  <action>
    Create `src/lib/hooks/useGroups.ts` mirroring `useMapContexts` (`useGeoDatasets.ts:46-60`): `export function useGroups(additionalFilters: Omit<Filter,'kinds'>[] = [{}])` maps each filter to `{ ...f, kinds: [MAP_CONTEXT_KIND] }`, runs `useTimelineWithEose(filters)`, and returns `{ events: events.map(e => castEvent(e, Group, eventStore)), eose }`. Also export a thin attach-discovery hook (or document that the `#c` subscription uses `useTimelineWithEose([{ '#c':[coord], kinds:[GEO_EVENT_KIND] }])` with the null-to-skip pattern — Plan 06 consumes it).

    Wire `src/lib/nostr/index.ts`: add `export * from './group'` alongside the existing `map-context` export. Keep the `map-context` export for now so the ~34 existing import sites do not break in this plan — they migrate in Task 3 of the consuming plans. Do NOT delete `map-context/` files yet; they are superseded but their removal happens once all consumers (editor, view, publishing, scope/validation/references, columns) are repointed in Plans 03–06. Note in the SUMMARY which import sites remain on `map-context` so later plans repoint them.
  </action>
  <verify>
    <automated>bun test src/lib/nostr/group && bun run build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    - `src/lib/hooks/useGroups.ts` exports `useGroups` using `useTimelineWithEose` + `castEvent(e, Group, eventStore)` (source assertion: `grep -n "castEvent(.*Group" src/lib/hooks/useGroups.ts`).
    - `grep -n "export \\* from './group'" src/lib/nostr/index.ts` present.
    - `bun run build` succeeds (the new barrel export resolves; no import-cycle regression — a build-time circular-import startup crash is the known Phase-2 failure mode, so build must be clean).
    - The Phase-8 + new group test files all pass: `bun test src/lib/nostr/group` GREEN.
  </acceptance_criteria>
  <done>useGroups subscribes and casts; the nostr barrel exports group/; build is green; map-context export retained until consumers migrate.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| relay → client (event parse) | Legacy/forged kind-37518 content is untrusted; `isGroup`/`getGroupContent` defensively parse |
| caller → factory | Caller-supplied `modelVersion` is untrusted and stripped before re-assertion |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-02-LEGACY | Spoofing | isGroup gate | mitigate | `hasCurrentModelVersion` clean-break gate (SPEC-03) — a legacy 37518 event masquerading as a current Group is rejected and never rendered |
| T-09-02-VERSION-OVERRIDE | Tampering | GroupFactory.create/group() | mitigate | Caller-supplied `modelVersion` stripped then re-asserted last so it can never be forced to a stale/foreign value |
| T-09-02-LINEAGE | Tampering | GroupFactory.modify | mitigate | `toEventTemplate` preserves `d`; never regenerate on edit (comments/reactions stay attached — Pitfall 4) |
| T-09-02-PARSE-CRASH | Denial of Service | getGroupContent | mitigate | Defensive `try/catch → defaults`; malformed relay content can never throw in a render path |
| T-09-SC | Tampering | npm/pip/cargo installs | mitigate | No installs (RESEARCH audit N/A — zero new deps); slopcheck N/A |
</threat_model>

<verification>
- `bun test src/lib/nostr/group src/lib/nostr/tags.test.ts` GREEN.
- `bun run build` succeeds (no circular-import startup regression).
- `biome check src/lib/nostr/group src/lib/hooks/useGroups.ts src/lib/nostr/tags.ts` clean.
</verification>

<success_criteria>
- GROUP-01 is GREEN: a Group create/modify round-trips governance + name/description with the current modelVersion, preserving d-lineage; legacy 37518 drops.
- Group tag I/O delegates entirely to `tags.ts` (including the new `setSchemaHash`); no copy-pasted getters/setters in `group/`.
- `useGroups` + the `group/` barrel are available to downstream plans; build is green.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-02-SUMMARY.md` when done.
</output>
