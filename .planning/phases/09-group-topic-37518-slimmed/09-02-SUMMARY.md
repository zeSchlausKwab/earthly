---
phase: 09-group-topic-37518-slimmed
plan: 02
subsystem: nostr-group
tags: [group, governance, factory, cast, tags-seam, model-version, refactor, green]
requires:
  - "Plan 01 RED baseline (group.test.ts pins GROUP-01)"
  - "Phase 8 tags.ts / modelVersion.ts / EntityFactory seams"
provides:
  - "src/lib/nostr/group/ — the per-kind Factory+Cast+helpers foundation Plans 03–06 import"
  - "setSchemaHash transformer in tags.ts (article-style delegation)"
  - "useGroups subscribe hook + useGroupAttachments #c discovery hook"
  - "group/ wired into the nostr barrel"
affects:
  - "Plans 03–06 consume @/lib/nostr/group + useGroups; they repoint the ~34 map-context import sites"
tech-stack:
  added: []
  patterns:
    - "EntityFactory bare-sign base (mirrors article/factory.ts)"
    - "modelVersion clean-break gate in isGroup (mirrors isArticle)"
    - "shared tags.ts write delegation (no per-kind copy-paste)"
    - "EventCast guard-throw read view (maintainer-mandated casting contract)"
key-files:
  created:
    - src/lib/nostr/group/helpers.ts
    - src/lib/nostr/group/cast.ts
    - src/lib/nostr/group/factory.ts
    - src/lib/nostr/group/index.ts
    - src/lib/hooks/useGroups.ts
  modified:
    - src/lib/nostr/tags.ts
    - src/lib/nostr/index.ts
decisions:
  - "schema-hash transformer added to tags.ts (setSchemaHash) rather than kept inline in the factory — resolves the flagged decision toward the article delegation posture"
  - "Governance triad (contextUse/validationMode/allowForeignAttachments) dropped from GroupContent entirely — clean break, no migration (absent fields, not mapped)"
  - "map-context/ left intact and importable from its own path; the nostr barrel did NOT previously re-export map-context, so only group/ was added (minor plan-text inaccuracy noted below)"
  - "Added useGroupAttachments (#c, null-to-skip) alongside useGroups so Plan 06 has the foreign-lane discovery hook ready"
metrics:
  duration: ~9m
  completed: 2026-06-25
  tasks: 2
  files: 7
---

# Phase 9 Plan 02: Group Module Foundation Summary

Built the `src/lib/nostr/group/` per-kind Factory+Cast+helpers module by refactoring `map-context/` in place — collapsing the `contextUse`/`validationMode`/`allowForeignAttachments` triad to a single `governance: 'open'|'schema'|'closed'` enum, adding the SPEC-03 `hasCurrentModelVersion` clean-break gate to `isGroup`, switching the factory to the shared `EntityFactory` base with `tags.ts`-delegated setters (plus a new `setSchemaHash` transformer), and wiring `useGroups` + the nostr barrel. This turns Plan 01's `group.test.ts` GREEN (GROUP-01).

## What Was Built

**Task 1 (commit c4d9f17)** — group/ module + setSchemaHash:
- `src/lib/nostr/group/helpers.ts`: `GroupGovernance` enum, slimmed `GroupContent` (governance replaces the triad; `geometryConstraints`/`schema` only under `governance:'schema'`), `DEFAULT_GROUP_CONTENT` (governance defaults to `open`), `MAP_CONTEXT_GEOMETRY_TYPES` re-exported under `GROUP_GEOMETRY_TYPES`/`GroupGeometryType` so existing geometry-checkbox consumers keep working. `isGroup` = `kind===37518 && d present && hasCurrentModelVersion` (the legacy `isMapContext` only gated on kind+d). Defensive `getGroupContent` (try/catch → defaults, no legacy migration). `getGroupId`/`getGroupCoordinate`/`getGroupSchemaHash` kept; `getGroupBoundingBox`/`getGroupHashtags`/`getGroupContextReferences`/`getGroupReferencedAddresses` delegate to `tags.ts`.
- `src/lib/nostr/group/cast.ts`: `class Group extends EventCast<GroupEvent>` — ctor throws `"Event is not a Group (kind 37518)"` on guard failure; raw proxies + helper-backed getters (`group`, `groupCoordinate`, `referencedAddresses` curated lane, `schemaHash`, `rawEvent()`).
- `src/lib/nostr/group/factory.ts`: `class GroupFactory extends EntityFactory<typeof MAP_CONTEXT_KIND>`. `create()` strips caller `modelVersion` then re-asserts `MODEL_VERSION` last, generates `d` only if absent. `modify()` preserves `d` via `toEventTemplate` (Pitfall 4). `group()` chain setter re-asserts `modelVersion`. Tag setters delegate to `tags.ts` (`setBbox`/`setGeohash`/`setHashtags`/`setLabels`/`setContextRefs`/`setReferencedAddresses`/`setSchemaHash`). `deleteGroup` carried over from `deleteMapContext`.
- `src/lib/nostr/group/index.ts`: barrel re-exporting cast/factory/helpers.
- `src/lib/nostr/tags.ts`: added `setSchemaHash(tags, value)` mirroring `setReferencedAddresses` (drops existing `schema-hash`, appends when truthy).

**Task 2 (commit 20dcc0e)** — useGroups + barrel:
- `src/lib/hooks/useGroups.ts`: `useGroups()` maps filters to `kinds:[MAP_CONTEXT_KIND]`, runs `useTimelineWithEose`, returns `events.map(e => castEvent(e, Group, eventStore))`. Plus `useGroupAttachments(groupCoordinate)` — the `#c` foreign-lane discovery hook with the `null`-to-skip pattern (Plan 06 consumes it).
- `src/lib/nostr/index.ts`: added `export * from './group'` alongside the existing Phase-8 per-kind barrels.

## Deviations from Plan

### Plan-text clarifications (no functional deviation)

**1. [Rule 3 - Blocking] The nostr barrel did not previously re-export `map-context`.**
- **Found during:** Task 2
- **Issue:** The plan said "add `export * from './group'` alongside the existing `map-context` export" — but `src/lib/nostr/index.ts` never re-exported `map-context` (consumers import from `@/lib/nostr/map-context` directly). There was no "existing map-context export" to sit alongside.
- **Resolution:** Added only `export * from './group'`. This also sidesteps a wildcard collision: `group/helpers.ts` and `map-context/helpers.ts` both export `MAP_CONTEXT_GEOMETRY_TYPES`/`MapContextGeometryType`, so re-exporting both via wildcard would have errored. Keeping map-context out of the barrel (as it already was) is the correct shape.
- **Files modified:** src/lib/nostr/index.ts
- **Commit:** 20dcc0e

## Import Sites Still on map-context (for Plans 03–06)

`map-context/` is intentionally retained and importable from its own path. The ~34 existing consumers (editor, view, publishing, scope/validation/references, columns) still import from `@/lib/nostr/map-context` and migrate in Plans 03–06 (Discovery: `grep -rl "@/lib/nostr/map-context" src`). The `map-context/` files are NOT deleted in this plan — removal happens once all consumers are repointed.

## Acceptance Criteria

Task 1:
- `bun test src/lib/nostr/group/group.test.ts` GREEN (11 pass) — governance serialization, modelVersion re-assert, create-generates-d / modify-preserves-d, isGroup rejects legacy-37518-without-modelVersion.
- `grep setSchemaHash src/lib/nostr/tags.ts` → transformer present; factory delegates (`schemaHash()` calls `setSchemaHash`), zero inline schema-hash filter in factory.
- `class Group extends EventCast` / `class GroupFactory extends EntityFactory` present; `isGroup` body uses `hasCurrentModelVersion`; no triad identifiers in code (only docblock/comment references).

Task 2:
- `grep "castEvent(.*Group" src/lib/hooks/useGroups.ts` present; `export * from './group'` present in barrel.
- `bun run build` succeeds (1077ms, no circular-import startup regression).
- `bun test src/lib/nostr/group` GREEN.

## Verification

- `bun test src/lib/nostr/group src/lib/nostr/tags.test.ts` → **20 pass / 0 fail / 32 expect()**.
- `bun run build` → ✅ completed in ~1.08s (all worker bundles built; no circular-import crash).
- `biome check` clean on all created/modified files (one accepted non-null-assertion warning on `getGroupId(this.event)!` in cast.ts, matching the original `getContextId(this.event)!` in map-context/cast.ts).

## Threat Mitigations Applied

- T-09-02-LEGACY: `isGroup` `hasCurrentModelVersion` gate — legacy 37518 silently dropped.
- T-09-02-VERSION-OVERRIDE: `create()`/`group()` strip caller `modelVersion`, re-assert last.
- T-09-02-LINEAGE: `modify()` preserves `d` via `toEventTemplate`.
- T-09-02-PARSE-CRASH: `getGroupContent` try/catch → defaults; never throws in a render path.
- T-09-SC: zero new dependencies (no installs).

No new threat surface beyond the plan's `<threat_model>`.

## Self-Check: PASSED

- All 5 created + 2 modified files exist on disk (verified below).
- Both task commits exist (c4d9f17, 20dcc0e).
