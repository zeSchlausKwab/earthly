# Phase 9: Group / Topic (37518 slimmed) - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 16 (new/modified)
**Analogs found:** 16 / 16 (this is a refactor-and-wire phase — every new file mirrors shipped code)

> **Posture:** Phase 9 is overwhelmingly a rename/refactor of `map-context/` (kind 37518) → `group/`, plus wiring into Phase-8 seams. Almost nothing is greenfield. The two genuinely new surfaces are (a) the off-thread validate-on-fetch wiring and (b) the NO-MOD-MINIMUM two-lane UX. Constant `MAP_CONTEXT_KIND = 37518` stays (SPEC keeps the name); only the module folder/types rename.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/nostr/group/helpers.ts` | model | transform | `src/lib/nostr/map-context/helpers.ts` (slim) + `article/helpers.ts` (modelVersion gate) | exact (rename+slim) |
| `src/lib/nostr/group/cast.ts` | model | request-response (read view) | `src/lib/nostr/map-context/cast.ts` | exact (rename) |
| `src/lib/nostr/group/factory.ts` | model | request-response (write) | `src/lib/nostr/article/factory.ts` (EntityFactory + modelVersion) + `map-context/factory.ts` (tag setters) | exact |
| `src/lib/nostr/group/index.ts` | config | barrel | `src/lib/nostr/article/index.ts` | exact |
| `src/lib/hooks/useGroups.ts` | hook | event-driven (subscribe) | `src/lib/hooks/useGeoDatasets.ts` `useMapContexts` | exact |
| `src/lib/group/attach.ts` (lane resolution) | service | event-driven (CRUD-on-lanes) | `src/lib/context/scope.ts` (rewrite `allowForeignAttachments`→governance) | role-match (rewrite) |
| `src/lib/group/filterModes.ts` | service | transform (filter-on-fetch) | `src/lib/context/validation.ts` (gating rewritten off-thread) | role-match |
| `src/lib/group/schemaHash.ts` | utility | transform (hash) | `src/lib/nostr/geo-event/helpers.ts:181` `computeChecksum` | role-match (compose) |
| `src/lib/mute/useMuteStore.ts` | store | event-driven (local persisted) | `src/features/chat/store.ts:965` `persist(...)` | role-match |
| `src/features/groups/GroupEditorPanel.tsx` | component | request-response (authoring) | `src/features/contexts/MapContextEditorPanel.tsx` (refactor in place) | exact (refactor) |
| `src/features/groups/schemaBuilder.ts` | utility | transform (builder→JSON Schema) | `MapContextEditorPanel.tsx` `SchemaBuilderField` block (extract) | partial (extract+reuse) |
| `src/features/groups/groups-columns.tsx` | component | CRUD (table) | `src/features/contexts/contexts-columns.tsx` | exact (rename) |
| `src/components/info-panel/GroupViewPanel.tsx` | component | request-response (two-lane view) | `src/components/info-panel/MapContextViewPanel.tsx` | exact (refactor) |
| (modify) contributor dataset publish/edit flow — `c`-tag attach + inline warn | hook | request-response | `usePublishing` + `validateSchema()` call | role-match |
| (reuse) Group comment/react | component | event-driven | `src/lib/nostr/geo-comment/factory.ts` + `src/features/social/comments` | exact (incremental) |
| Wave-0 test files (`group.test.ts`, etc.) | test | unit | `src/lib/nostr/article/article.test.ts` | exact |

---

## Pattern Assignments

### `src/lib/nostr/group/helpers.ts` (model, transform)

**Analog:** `src/lib/nostr/map-context/helpers.ts` (slim the content triad) + `src/lib/nostr/article/helpers.ts:49` (add the modelVersion gate).

**`isGroup` guard — MUST add `hasCurrentModelVersion` (unlike `isMapContext`).** Mirror `isArticle` (`article/helpers.ts:49-55`), not the legacy `isMapContext` which only gates on `kind + d`:
```typescript
// article/helpers.ts:49 — copy this shape, swap kind to MAP_CONTEXT_KIND
export function isGroup(event: NostrEvent): event is GroupEvent {
  return (
    event.kind === MAP_CONTEXT_KIND &&            // 37518 — constant name stays
    getTagValue(event, 'd') !== undefined &&
    hasCurrentModelVersion(event)                 // SPEC-03 clean-break — legacy 37518 drops
  )
}
```

**Defensive content getter — `getOrComputeCachedValue` + try/catch → defaults** (`map-context/helpers.ts:68-78`, identical shape in `article/helpers.ts:62-72`):
```typescript
export function getGroupContent(event: NostrEvent): GroupContent {
  return getOrComputeCachedValue(event, GroupContentSymbol, () => {
    if (!event.content) return { ...DEFAULT_GROUP_CONTENT }
    try {
      const parsed = JSON.parse(event.content) as Partial<GroupContent>
      return { ...DEFAULT_GROUP_CONTENT, ...parsed }   // merges ONLY over defaults — no legacy migration
    } catch {
      return { ...DEFAULT_GROUP_CONTENT }
    }
  })
}
```

**Slimmed content interface — collapse the triad to one enum** (replaces `map-context/helpers.ts:35-55`):
```typescript
export type GroupGovernance = 'open' | 'schema' | 'closed'
export interface GroupContent {
  modelVersion?: string                            // re-asserted by create()
  name: string
  description?: string
  descriptionFormat?: 'markdown'
  governance: GroupGovernance                      // replaces contextUse/validationMode/allowForeignAttachments
  geometryConstraints?: GroupGeometryConstraints   // meaningful only under governance:'schema'
  schema?: Record<string, unknown>                 // draft-2020-12; only under governance:'schema'
  image?: string
}
export const DEFAULT_GROUP_CONTENT: GroupContent = {
  name: '', descriptionFormat: 'markdown', governance: 'open',
}
```
Reuse `MAP_CONTEXT_GEOMETRY_TYPES` (`map-context/helpers.ts:20-28`). Keep `getGroupCoordinate` (`${kind}:${pubkey}:${d}`, `map-context/helpers.ts:80-85`) and `getGroupSchemaHash` reading the `schema-hash` tag (`map-context/helpers.ts:116-118`). **All tag reads delegate to `tags.ts`** — never re-implement getters (`article/helpers.ts:74-97` shows the full delegation set: `getBbox`/`getGeohash`/`getHashtags`/`getLabels`/`getContextRefs`/`getReferencedAddresses`).

---

### `src/lib/nostr/group/cast.ts` (model, read view)

**Analog:** `src/lib/nostr/map-context/cast.ts` (near-verbatim rename).

**`EventCast` subclass — throw in ctor on guard failure, raw-event proxies + helper-backed getters** (`map-context/cast.ts:23-91`):
```typescript
export class Group extends EventCast<GroupEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isGroup(event)) throw new Error('Event is not a Group (kind 37518)')
    super(event, store)
  }
  get kind() { return this.event.kind }
  get pubkey() { return this.event.pubkey }
  // ... raw proxies (tags/content/created_at) ...
  get group() { return getGroupContent(this.event) }              // was `get context()`
  get groupCoordinate() { return getGroupCoordinate(this.event) }
  get referencedAddresses() { return getGroupReferencedAddresses(this.event) }  // curated lane
  get schemaHash() { return getGroupSchemaHash(this.event) }
  rawEvent() { return this.event }
}
```
**This file is the maintainer-mandated casting contract** — `EventCast` read view; never hand-roll a wrapper.

---

### `src/lib/nostr/group/factory.ts` (model, write)

**Analog:** `src/lib/nostr/article/factory.ts` (EntityFactory base + modelVersion injection) merged with `map-context/factory.ts` (the `schemaHash`/`referencedAddresses`/`contextReferences` tag setters this Group needs).

**Extend `EntityFactory`, NOT raw `EventFactory`** (article uses the shared base for the bare-sign-function override Wave-0 tests pin — `entityFactory.ts:42-51`):
```typescript
export class GroupFactory extends EntityFactory<typeof MAP_CONTEXT_KIND> { ... }
```

**`create()` strips + re-asserts modelVersion last (clean-break discriminator)** — copy `article/factory.ts:33-49` exactly:
```typescript
static create(content: Partial<GroupContent> = {}): GroupFactory {
  return new GroupFactory((resolve) => {
    const tpl = blankEventTemplate(MAP_CONTEXT_KIND)
    const { modelVersion: _ignored, ...rest } = content     // strip caller value
    tpl.content = JSON.stringify({ ...DEFAULT_GROUP_CONTENT, ...rest, modelVersion: MODEL_VERSION })
    if (!tpl.tags.some((t) => t[0] === 'd')) tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
    resolve(tpl)
  })
}
```

**`modify()` preserves `d` via `toEventTemplate` (never regenerate — Pitfall 4 lineage fork)** (`article/factory.ts:52-57`):
```typescript
static modify(event: GroupEvent): GroupFactory {
  if (!isGroup(event)) throw new Error('GroupFactory.modify: event is not a kind 37518 group')
  return new GroupFactory((resolve) => resolve(toEventTemplate(event)))
}
```

**Tag setters delegate to `tags.ts` transformers (article pattern, NOT the inline filter/map in `map-context/factory.ts`)** (`article/factory.ts:80-102`): `bbox`/`geohash`/`hashtags`/`labels`/`contextReferences`/`referencedAddresses` → `setBbox`/`setGeohash`/`setHashtags`/`setLabels`/`setContextRefs`/`setReferencedAddresses`. **Carry over the `schemaHash(value)` setter** from `map-context/factory.ts:101-106` (writes `["schema-hash", value]`); it has no `tags.ts` equivalent yet — either add one to `tags.ts` or keep the inline filter form. The `referencedAddresses([...])` setter is the curated-lane "bless/pin" write (D-03).

**`content()` chain setter re-asserts modelVersion** (`article/factory.ts:60-78`) — was `context()` in map-context; rename to `group()`.

Carry over `deleteGroup` from `deleteMapContext` (`map-context/factory.ts:124-134`, `DeleteFactory.fromEvents` + `publish({routing:'outbox'})`).

---

### `src/lib/hooks/useGroups.ts` (hook, subscribe)

**Analog:** `src/lib/hooks/useGeoDatasets.ts:46-60` `useMapContexts`.

**Subscribe → EventStore → cast via `useTimelineWithEose` + `castEvent`** (`useGeoDatasets.ts:46-60`):
```typescript
export function useGroups(additionalFilters: Omit<Filter, 'kinds'>[] = [{}]) {
  const filters = additionalFilters.map((f) => ({ ...f, kinds: [MAP_CONTEXT_KIND] }))
  const { events, eose } = useTimelineWithEose(filters)
  const groups = useMemo(() => events.map((e) => castEvent(e, Group, eventStore)), [events])
  return { events: groups, eose }
}
```

**Attach-discovery (`c`-lane) — same hook, `#c` filter** (`useGeoDatasets.ts:27-43` shows the `null`-to-skip pattern for "fire only when a coordinate exists"):
```typescript
const { events } = useTimelineWithEose(
  groupCoord ? [{ '#c': [groupCoord], kinds: [GEO_EVENT_KIND] }] : null
)
const attachments = useMemo(() => events.map((e) => castEvent(e, GeoDataset, eventStore)), [events])
```

---

### `src/lib/group/attach.ts` + lane resolution (service, event-driven)

**Analog:** `src/lib/context/scope.ts` (rewrite the `allowForeignAttachments` branch) + `src/lib/context/references.ts:128` `getContextReferencedDatasets` (curated `a`-ref resolution).

**Rewrite the governance branch** — `scope.ts:35` and `:48` currently key off `context.context.allowForeignAttachments`; change to `group.group.governance !== 'closed'`:
```typescript
// scope.ts:35 (BEFORE)  if (coordinate && context.context.allowForeignAttachments) { ... }
// AFTER                  if (coordinate && group.group.governance !== 'closed') { ... }   // open|schema have a foreign lane
```
Curated lane = the event's `a`-refs resolved through `references.ts` (`resolveContextReferences:66`, `getContextReferencedDatasets:128`). Keep the dedup-by-scope-key map pattern (`scope.ts:20-22, 29-42`).

---

### `src/lib/group/filterModes.ts` (service, filter-on-fetch — off/warn/strict)

**Analog (gating engine):** `src/lib/validation/schemaWorker.ts:133` `validateSchema` (off-thread). **Anti-pattern:** the in-thread `src/lib/context/validation.ts` `ajv.compile` path MUST NOT be used for gating (Pitfall 1).

**Off-thread gate — boolean verdict, fails closed** (`schemaWorker.ts:133-145`, verdict `{ ok, error? }` from `schema.worker.ts:56-63`):
```typescript
import { validateSchema } from '@/lib/validation/schemaWorker'
const verdict = await validateSchema(group.group.schema, datasetProperties, { schemaHash })
// strict: verdict.ok === false → hide + reason chip
// warn:   show + badge + reason
// off:    show all
```
**D-06 per-rule messages caveat (Pitfall 5 / Assumption A3):** the worker returns only `{ ok }` (`schema.worker.ts:160` `valid ? { ok:true } : { ok:false, error }`) — it discards `validate.errors`. Planner must pick: (a) extend the worker response to carry structured `errors` (preferred, stays off-thread), or (b) keep an in-thread *display-only* re-validate using the existing `ContextValidationIssue[]` shape (`context/validation.ts:288-300`) for messages while gating stays on the off-thread `ok`. Flag as an explicit task.

**Rewrite the deprecated mode resolvers** — `getEffectiveContextUse`/`getEffectiveContextValidationMode`/`defaultContextFilterMode` (`context/validation.ts:37-57`) are keyed off the removed fields; re-derive from the enum: `closed`→no foreign lane; `schema`→strict default; `open`→off default (still capped + curated-first).

---

### `src/lib/group/schemaHash.ts` (utility, hash)

**Analog:** `src/lib/nostr/geo-event/helpers.ts:181` `computeChecksum` (reuse — do NOT add new crypto).

**Canonicalize (deep sort keys) then SHA-256-hex via the existing helper** — `JSON.stringify` is key-order-dependent so author/viewer must sort first (Pitfall 3):
```typescript
import { computeChecksum } from '@/lib/nostr/geo-event/helpers'   // crypto.subtle SHA-256-hex, guarded
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonicalize((v as any)[k])]))
  return v
}
// author: `sha256:${await computeChecksum(JSON.stringify(canonicalize(schema)))}`
// viewer: verify tag === recompute; mismatch ⇒ DO NOT validate, show warning (never silently use a different schema)
```

---

### `src/lib/mute/useMuteStore.ts` (store, local persisted)

**Analog:** `src/features/chat/store.ts:965` `persist(...)` middleware.

**Zustand `persist` — device-local, app-global pubkey set, no signing/publish** (`chat/store.ts:5` imports `persist` from `zustand/middleware`; `:965` wraps `create()(persist(...))`):
```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
export const useMuteStore = create(persist<{
  muted: string[]; mute: (pk: string) => void; unmute: (pk: string) => void
}>((set) => ({
  muted: [],
  mute: (pk) => set((s) => ({ muted: [...new Set([...s.muted, pk])] })),
  unmute: (pk) => set((s) => ({ muted: s.muted.filter((x) => x !== pk) })),
}), { name: 'earthly-muted-contributors' }))   // localStorage key; consider a partialize allow-list like chat/store.ts:945
```
Mute is global per-contributor (D-11): consumed by the foreign-lane filter AND any other feed.

---

### `src/features/groups/GroupEditorPanel.tsx` (component, authoring)

**Analog:** `src/features/contexts/MapContextEditorPanel.tsx` (refactor in place — Discretion default).

- **Imports/account/factory pattern** (`MapContextEditorPanel.tsx:1-13`): `useActiveAccount` (applesauce-react), `castEvent`, `eventStore`/`publish` from `@/lib/nostr`, `MapContextFactory`→`GroupFactory`.
- **Tabbed authoring** (`:41` `Tabs/TabsContent`, `:51` `ContextEditorTab = 'content'|'policy'|'schema'`): replace the `policy` tab's `contextUse`/`validationMode`/`Switch allowForeignAttachments` controls with **3 governance radio cards** (D-01). Show the `schema` tab only when `governance === 'schema'` (D-04). Strip `geometryConstraints`/`schema` from content when the radio leaves `schema` (research note "field coexistence").
- **Schema builder block** (`:50-62` `SchemaFieldType` + `SchemaBuilderField` rows; `:4-5` `Ajv2020`/`addFormats` already imported) — extract to `schemaBuilder.ts`; keep the builder-default + raw-JSON advanced tab (D-04), both compiling to draft-2020-12, both feeding `validateSchema()`.
- **Write path:** `GroupFactory.create(content).labels(...).schemaHash(hash).sign(account).then(publish)`; edit path uses `GroupFactory.modify(group)` to preserve `d`.

---

### `src/components/info-panel/GroupViewPanel.tsx` (component, two-lane view)

**Analog:** `src/components/info-panel/MapContextViewPanel.tsx` (refactor).

- **Shell + imports** (`MapContextViewPanel.tsx:1-25`): `EntityPanelShell`/`EntityPanelSurface`/`EntityPanelSectionHeader`, `EntityActionBar`, `ConfirmDeleteAction`, `RichContentRenderer` (Markdown narrative — sanitized path, XSS mitigation), `CommentsPanel` from `@/features/social/comments`.
- **Curated lane (default, expanded, privileged)** — resolve `a`-refs via `resolveContextReferences` (`references.ts:66`) / `getContextReferencedDatasets` (`references.ts:128`). Render FIRST.
- **Foreign lane (collapsed "Community contributions (N)", D-08)** — subscribe `{kinds:[37515],'#c':[groupCoord]}`; per coordinate, **validate before render** (GROUP-08):
```typescript
import { verifyEvent } from 'nostr-tools'
if (event.kind !== GEO_EVENT_KIND) continue   // kind-validate 37515
if (!verifyEvent(event)) continue             // signature-validate
if (mutedSet.has(event.pubkey)) continue      // local mute D-10/11
// governance:'schema' → validateSchema gate (off/warn/strict, D-09; default strict)
```
Sort newest-first (O-01 fallback — no follows source in app; trust-sort deferred). Cap 50 + "load more" (D-07). Every hidden/flagged item gets a legible reason chip.
- **Owner-only "Lock down → closed" button (D-02)** — visible on the panel when `currentUserPubkey === group.pubkey`; confirm → `GroupFactory.modify(group).group({governance:'closed'}).sign().then(publish)`.
- **Mute trigger (D-12)** — per-attachment `⋮` overflow menu → `useMuteStore.mute(pubkey)`.
- **Replace deprecated imports** (`:6-12`): `getEffectiveContextUse`/`getEffectiveContextValidationMode`/`validateDatasetForContext` from `context/validation.ts` → the new `group/filterModes.ts`; `resolveContextMapScope` → `group/attach.ts`.

---

### Group comment / react (reuse, GROUP-07)

**Analog:** `src/lib/nostr/geo-comment/factory.ts:45` `GeoCommentFactory` + `static reply` (`:70`) + `src/features/social/comments` `CommentsPanel`. Kind 37517 + kind 7 reused against the Group coordinate. **Open Question 3:** if the existing K/k comment-root enum hard-rejects 37518, scope a minimal local allowance; full comment-root widening across all kinds stays Phase 13.

---

### Wave-0 test files (test, unit)

**Analog:** `src/lib/nostr/article/article.test.ts` (create/modify/isGuard round-trip shape). Colocated `*.test.ts`, Bun runner, `bun test src/lib/nostr/group`. Cover: governance serialization + `isGroup` modelVersion gate (legacy 37518 drops), `c`-discovery, never-block invariant, off/warn/strict, NO-MOD (sig/kind/mute/cap/sort/escape), canonical schema-hash, builder→schema compile, mute persist. DoS proof reuses the existing `schemaWorker.test.ts` (Phase 8).

---

## Shared Patterns

### modelVersion clean-break gate
**Source:** `src/lib/nostr/modelVersion.ts:25` `hasCurrentModelVersion` (`MODEL_VERSION='earthly/2'`)
**Apply to:** `group/helpers.ts` `isGroup`, `group/factory.ts` `create()`/`group()` re-assertion.
Legacy 37518 "context" events carry no `modelVersion` ⇒ silently drop. No migration.

### Shared tag I/O seam (no copy-paste)
**Source:** `src/lib/nostr/tags.ts` — `getBbox`/`setBbox`, `getGeohash`/`setGeohash`, `getHashtags`/`setHashtags`, `getLabels`/`setLabels`, `getContextRefs`/`setContextRefs` (the `c` lane), `getReferencedAddresses`/`setReferencedAddresses` (the `a` curated lane).
**Apply to:** ALL `group/` tag reads (helpers) and writes (factory). `article/` is the canonical consumer to mirror. (`schema-hash` has no transformer yet — add one or keep `map-context/factory.ts:101` inline form.)

### Off-thread hardened validation (DoS-safe)
**Source:** `src/lib/validation/schemaWorker.ts:133` `validateSchema(schema, data, { schemaHash })` → `{ ok, error? }`, fails closed; falls back to synchronous pure engine under `bun test`/SSR (`:143`).
**Apply to:** write-side inline warn (publish dialog, D-05/06) AND read-side foreign-lane filter (D-09). NEVER the in-thread `context/validation.ts` for gating.

### Subscribe→EventStore→cast read
**Source:** `src/lib/nostr/hooks.ts` `useTimelineWithEose` + `castEvent` (`useGeoDatasets.ts:35-39`).
**Apply to:** `useGroups`, the `#c` attach subscription, curated-lane resolution.

### EntityFactory lineage base
**Source:** `src/lib/nostr/entityFactory.ts:42` (`create`=fresh `d`, `modify`=preserve via `toEventTemplate`, bare-sign-function `sign()` override).
**Apply to:** `GroupFactory extends EntityFactory<typeof MAP_CONTEXT_KIND>`.

### Canonical content hash
**Source:** `src/lib/nostr/geo-event/helpers.ts:181` `computeChecksum` (SHA-256-hex, `crypto.subtle`, guarded).
**Apply to:** `group/schemaHash.ts` (over `canonicalize(schema)`).

### Local persisted store
**Source:** `src/features/chat/store.ts:965` `persist(...)` (`zustand/middleware`, named localStorage key, optional `partialize` allow-list at `:945`).
**Apply to:** `useMuteStore`.

### Applesauce casting contract (maintainer-mandated)
**Source:** `src/lib/nostr/map-context/cast.ts:23` `class MapContext extends EventCast` (guard-throws in ctor; raw proxies + helper-backed getters).
**Apply to:** `group/cast.ts`. Never hand-roll an NDK-style wrapper (NDK→applesauce migration is complete).

---

## No Analog Found

None. Every Phase-9 file mirrors a shipped analog (this is a refactor-and-wire phase). The only *new-shape* decisions are planner choices already flagged:
- Per-rule validation messages (extend worker response vs in-thread display) — Pitfall 5 / A3.
- `schema-hash` tag transformer (add to `tags.ts` vs keep inline) — see factory note.

---

## Metadata

**Analog search scope:** `src/lib/nostr/{map-context,article,geo-event,geo-comment}/`, `src/lib/nostr/{tags,modelVersion,entityFactory}.ts`, `src/lib/validation/`, `src/lib/context/`, `src/lib/hooks/`, `src/features/{contexts,chat,social}/`, `src/components/info-panel/`.
**Files scanned/read:** ~16 source files (full or targeted).
**Pattern extraction date:** 2026-06-25
