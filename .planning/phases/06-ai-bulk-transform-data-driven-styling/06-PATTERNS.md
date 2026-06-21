# Phase 6: AI Bulk Transform & Data-Driven Styling - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 11 (3 new api/, 1 new chat tool + test, 2 modified, plus 5 test files)
**Analogs found:** 11 / 11 — every new/modified file has a same-role, same-data-flow precedent in the repo.

> All analogs verified in source this session. Disposition legend: **NEW** (greenfield, copy structure from analog), **EXTEND** (additive change to existing file), **REUSE-AS-IS** (no change; bulk tools call it).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/features/geo-editor/api/predicate.ts` (NEW) | api / pure module | transform (filter) | `src/features/geo-editor/api/diff.ts` | exact (same AI-free pure-module + boundary contract) |
| `src/features/geo-editor/api/dedup.ts` (NEW) | api / pure module | transform (group) | `src/features/geo-editor/api/diff.ts` (grouping by id) | exact |
| `src/features/geo-editor/api/geometryValidation.ts` (NEW) | api / pure module | transform (read-only report) | `src/features/geo-editor/api/diff.ts` + `styleOptions.ts` (validation) | exact |
| `src/features/chat/tools/bulk-tools.ts` (NEW) | chat tool registrar | request-response + batch | `src/features/chat/tools/ingest-tools.ts` | exact (injected-register + batch tool) |
| `src/features/geo-editor/api/diff.ts` (MODIFY) | api / pure module | transform | self (additive `classifyModifyKind`) | self |
| `src/features/chat/tools/DatasetDiffDisclosure.tsx` ← actually `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (MODIFY) | UI / summary builder | presentation | self (extend `buildDatasetDiffSummary`) | self |
| `src/features/chat/safeEditing/fixAll.ts` (`runFixAllRule`) | api-adjacent runner | batch over-all-ids | self | **REUSE-AS-IS** (D-04a engine, names Phase 6 as consumer) |
| `src/features/geo-editor/api/styleOptions.ts` (`normalizeStyleOptions`) | api / validation | transform | self | **REUSE-AS-IS** (style materialize target) |
| `src/features/geo-editor/api/authoring.ts` (`modifyFeature`/`deleteFeatures`) | api / mutation seam | CRUD | self | **REUSE-AS-IS** (only mutation path) |
| `*.test.ts` (predicate/dedup/geometryValidation/bulk-tools) (NEW) | test | — | `api/diff.test.ts`, `chat/tools/ingest-tools.test.ts` | exact |
| `src/features/chat/tools/schemas.ts` + `registry.ts` (EXTEND) | schema + bootstrap | — | self | self |

> **Path correction for the orchestrator:** the style-aware-headline file is `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (and its `buildDatasetDiffSummary`), NOT `src/features/chat/tools/DatasetDiffDisclosure.tsx`. The classifier helper `classifyModifyKind` belongs in `src/features/geo-editor/api/diff.ts`. Also note: there is no `styleProperties.ts` in `api/` — the canonical keys live in `api/styleOptions.ts` as `CANONICAL_STYLE_KEYS` (the `types/styleProperties.ts` referenced in RESEARCH is the renderer-side types file, not the materialize seam).

## Pattern Assignments

### `src/features/geo-editor/api/predicate.ts` (NEW — api pure module, D-06)

**Analog:** `src/features/geo-editor/api/diff.ts` — the canonical AI-free pure-module shape: a doc-block declaring the D-07 boundary, type-only imports of `EditorFeature`/`MutationIntent`, a private structural helper, and exported pure functions holding no editor reference.

**Boundary doc-block to mirror** (`diff.ts:14-20`):
```typescript
/**
 * Boundary (D-07): imports ONLY the intent enum from `./interceptor`, the
 * canonical style-key set from `./styleOptions`, and the `EditorFeature` type —
 * NOTHING from chat, the tool registry, or Nostr. `boundary.test.ts` enforces it.
 */
```
> `boundary.test.ts` auto-scans every `api/*.ts` file (it reads the dir at `API_DIR`), so `predicate.ts`/`dedup.ts`/`geometryValidation.ts` are covered the moment they land — they must import ONLY `geojson` types + `../core/types` (`EditorFeature`). Forbidden patterns enforced: `@/features/chat`, `chat/tools`, `@/lib/nostr`, `nostr`, NDK/applesauce (`boundary.test.ts:16-22`).

**Import + EditorFeature shape** (`diff.ts:22-24`, `core/types/index.ts:51-53`):
```typescript
import type { EditorFeature } from '../core/types'   // id: string; properties: GeoJsonProperties & {...style keys...}
```
`field` in a predicate reads ONLY from `feature.properties` (per D-06 / RESEARCH Pattern 1). `exists`/`missing` define the "missing" semantics (A4 inclusive default: absent OR null OR empty/whitespace string).

**Surface (from RESEARCH Pattern 1, planner's-discretion to finalize):** `matchesPredicate(feature, predicate): boolean` + `selectByPredicate(features, predicate): EditorFeature[]`; flat `all: PredicateOp[]` AND-list; ops `eq/neq/exists/missing/contains/in/lt/lte/gt/gte`. NOT a nested DSL.

---

### `src/features/geo-editor/api/dedup.ts` (NEW — api pure module, TOOLS-03 dedup half)

**Analog:** `diff.ts` for the by-id grouping idiom (`new Map(features.map(f => [f.id, f]))`, `diff.ts:101`) and its private `deepEqual` (`diff.ts:38-63`) for structural geometry/attribute equality. For geometry equality use `turf.booleanEqual` (verified exported, 7.3.5) or reuse the structural `deepEqual` pattern.

**Recommended surface (RESEARCH §TOOLS-03):** `findDuplicateGroups(features, { by: 'geometry'|'attributes'|'both', keys? })` → groups of ids; survivor `keep-first` (deterministic, mirrors `getAllFeatures()` order). Pure grouping only — the tool wires the non-survivor ids to `authoring.deleteFeatures` through the gate. Default `by: 'geometry'` (A2, flag at plan review).

**deepEqual to reuse** (`diff.ts:37-63`): structural deep-equality for plain JSON (handles arrays, null, key-set). Copy or import-internally; do NOT hand-roll coordinate tolerance.

---

### `src/features/geo-editor/api/geometryValidation.ts` (NEW — api pure module, TOOLS-04)

**Analog:** `styleOptions.ts` for the validation-report idiom (named error class + per-key validators) and `diff.ts` for the pure read-only contract. Read-only — NO gate, NO editor mutation (RESEARCH anti-pattern: "Running validation through the destructive gate").

**Checks (RESEARCH §TOOLS-04, A3):** `turf.kinks(feature).features.length > 0` (self-intersection), `turf.area(feature) < threshold` (zero-area/sliver), structural ring-validity. Cross-feature gaps DEFERRED. Return `{ checked, withSelfIntersections, withZeroArea, invalidRings, issues: [{ featureId, issues: [...] }] }`.

**turf import note:** `@turf/turf@7.3.5` confirmed — `kinks`/`booleanEqual`/`area` all exported. Import via `@turf/turf` (the curated sandbox geometry lib already used elsewhere). This is the one allowed non-type import beyond geojson in the new api modules — verify `boundary.test.ts` forbidden list does NOT include turf (it lists only chat/registry/nostr — turf is fine).

---

### `src/features/chat/tools/bulk-tools.ts` (NEW — chat tool registrar)

**Analog:** `src/features/chat/tools/ingest-tools.ts` — the exact precedent for a multi-tool registrar using the injected-register idiom, a bounded batch tool (`batch_geocode`), and no-silent-truncation reporting.

**Injected-register signature** (`ingest-tools.ts:486`, `primitives-tools.ts:117`):
```typescript
export function registerBulkTools(register: (entry: ToolEntry) => void): void {
  register({ name: 'style_by_attribute', kind: 'authoring-primitive', schema: schemaFor('style_by_attribute'), handler: async (args) => { /* gate + runFixAllRule */ } })
  register({ name: 'batch_edit_features', kind: 'authoring-primitive', schema: schemaFor('batch_edit_features'), handler: async (args) => { /* declarative | intelligence */ } })
  register({ name: 'select_features',   kind: 'host-builtin',         schema: schemaFor('select_features'),   handler: (args) => { /* selectByPredicate, read-only */ } })
  register({ name: 'dedup_features',    kind: 'authoring-primitive', schema: schemaFor('dedup_features'),    handler: async (args) => { /* gate delete */ } })
  register({ name: 'validate_geometry', kind: 'host-builtin',         schema: schemaFor('validate_geometry'), handler: (args) => { /* turf report, read-only */ } })
}
```
> **CRITICAL (Pitfall 4):** export `registerBulkTools(register)`; only a *type* import of `ToolEntry` from `./registry` is allowed. registry.ts calls it inside `bootstrapRegistry()` (`registry.ts:1067-1084`). Importing `register` directly here causes the Bun-HMR null-`register` startup crash (the exact crash UAT caught in Phase 2). Mandatory `kind` field — omitting it is a compile error (`ToolEntry.kind`, `registry.ts:86`; `ToolKind` union `registry.ts:67-73`).

**Bounded batch + no-silent-truncation report** (`ingest-tools.ts:35`, `:614-623`):
```typescript
export const BATCH_GEOCODE_MAX_ROWS = 50        // → mirror as BULK_EDIT_MAX_FEATURES = 100 (D-05, A1)
// ...
return { located: placed, total: totalRowsWithName, failed: failedRows,
  message: `Located ${placed} of ${totalRowsWithName} rows. ${failedRows} couldn't be geocoded.` }
```
Intelligence path (D-04b) must report `Edited N of M; rerun with the remaining ids to continue.` Unknown ids are skipped-and-counted, never a crash (mirror `deleteFeatures` filtering, `authoring.ts:454-458`).

**Declarative path composes `runFixAllRule`** (REUSE-AS-IS, `fixAll.ts:59`):
```typescript
runFixAllRule(editor, {
  predicate: (f) => matchesPredicate(f, spec.predicate),     // ← predicate.ts
  transform: (f) => ({ ...f, properties: applyOps(f.properties, spec.ops) }),
})
```
`runFixAllRule` reads `editor.getAllFeatures()` and takes NO features array — this is the SAFE-05 guard. Declarative/style/dedup schemas MUST NOT expose a `features`/`featureIds` param (Pitfall 1).

**Style path materializes through `normalizeStyleOptions`** (REUSE-AS-IS, `styleOptions.ts:156`):
```typescript
const patch = normalizeStyleOptions(chosen.style)   // throws InvalidStyleOptionError on unknown key → model self-corrects
return { ...f, properties: { ...(f.properties ?? {}), ...patch } }
```

**Gate wiring** (mirror `gateRunCodeBatch`, `gateRunCode.ts:60-98`):
```typescript
const before = editor.getAllFeatures()
editor.pushDatasetSnapshot(label)          // ONE snapshot = one undo (D-11)
runFixAllRule(editor, rule)                // real, interceptor-routed
const diff = classifyMutation(before, editor.getAllFeatures(), 'modify')  // 'delete' for dedup (Pitfall 6)
const handle = emitDiffBlock(diff)         // from pendingDiffStore
if (mustConfirm) { if ((await requestConfirm(handle.id)) === 'cancel') editor.undoLastDatasetSnapshot() }
```
- Bulk MODIFY (batch-edit, restyle) → `classifyMutation(..., 'modify')`.
- Dedup DELETE → pass `intent: 'delete'` so dropped ids populate `diff.deleted` (Level-2 confirms; `diff.ts:122`, Pitfall 6).
- Validation/select → read-only, NO gate, NO snapshot.

---

### `src/features/geo-editor/api/diff.ts` (MODIFY — additive `classifyModifyKind`)

**Disposition:** EXTEND (additive, backward-compatible — Phase 5 `diff.test.ts` unaffected).

Restyle is ALREADY classified `modify` with zero classifier change: `isModified` iterates `CANONICAL_STYLE_KEYS` (`diff.ts:77-87`). The only gap is discriminating style-only modifies for the headline.

**Add alongside `isModified`** (uses the existing `deepEqual` `diff.ts:38` + `CANONICAL_STYLE_KEYS` `styleOptions.ts:45`):
```typescript
export type ModifyKind = 'style' | 'properties' | 'geometry'
export function classifyModifyKind(before: EditorFeature, after: EditorFeature): ModifyKind {
  if (!deepEqual(before.geometry, after.geometry)) return 'geometry'
  const changed = changedPropertyKeys(before.properties ?? {}, after.properties ?? {})
  return changed.every((k) => (CANONICAL_STYLE_KEYS as readonly string[]).includes(k)) ? 'style' : 'properties'
}
```
> `deepEqual` is currently a private (non-exported) function in `diff.ts` (`:38`). `classifyModifyKind` lives in the SAME file so it can call it directly — no need to export `deepEqual`.

---

### `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (MODIFY — style-aware headline)

**Disposition:** EXTEND `buildDatasetDiffSummary` (the pure helper, `DatasetDiffDisclosure.tsx:33-38`). Additive special-case only.

**Current headline** (`:33-38`):
```typescript
export function buildDatasetDiffSummary(diff: DatasetDiff): string {
  return `+${diff.added.length} added · ~${diff.modified.length} changed · −${diff.deleted.length} deleted`
}
```
**Add** (D-02 mitigation): when `diff.added.length === 0 && diff.deleted.length === 0 && diff.modified.length > 0 && every modify is classifyModifyKind === 'style'` → return `~${n} restyled`. Otherwise the existing counts string (keeps Phase 5 `DatasetDiffDisclosure.test.tsx` green — verify after change, Open Question 3). The expanded per-row list (`DiffSection`, `:53`) stays unchanged.

---

## Shared Patterns

### AI-free `api/` boundary (D-07) — applies to predicate.ts, dedup.ts, geometryValidation.ts
**Source:** `src/features/geo-editor/api/diff.ts:14-24` (doc-block + type-only imports) and `src/features/geo-editor/api/boundary.test.ts:16-22` (auto-enforced forbidden-import list).
**Apply to:** All three new `api/` modules. Import ONLY `geojson`, `../core/types` (`EditorFeature`), `./interceptor` (intent enum), `./styleOptions` (`CANONICAL_STYLE_KEYS`), and `@turf/turf`. Never chat/registry/nostr. The test scans the dir automatically — no test-list edit needed.

### Injected-register idiom (Pitfall 4) — applies to bulk-tools.ts
**Source:** `src/features/chat/tools/primitives-tools.ts:106-117`, `ingest-tools.ts:486`, wired at `registry.ts:1067-1084`.
**Apply to:** `bulk-tools.ts` — `export function registerBulkTools(register)`; type-only import of `ToolEntry`; add `registerBulkTools(register)` to `bootstrapRegistry()`.

### Mutation seam — applies to every destructive bulk op
**Source:** `src/features/geo-editor/api/authoring.ts:252` (`modifyFeature`), `:260`/`:454` (`deleteFeatures`), routing through `runInterceptors`. `runFixAllRule` (`fixAll.ts:59-83`) already composes `modifyFeature`.
**Apply to:** batch-edit, restyle (via `runFixAllRule`), dedup (via `deleteFeatures`). Never call `editor.updateFeature`/`editor.deleteFeatures` directly (Pitfall: bypassing facade).

### Gate (snapshot → classify → confirm → undo) — applies to all destructive bulk ops
**Source:** `src/features/chat/safeEditing/gateRunCode.ts:60-98` (snapshot-then-apply-then-restore-on-cancel); `pendingDiffStore` (`emitDiffBlock`/`requestConfirm`).
**Apply to:** batch-edit (`modify`), restyle (`modify`), dedup (`delete`). One bulk op = one snapshot = one undo (D-11).

### No-silent-truncation report — applies to bulk-tools intelligence path
**Source:** `ingest-tools.ts:35` (`BATCH_GEOCODE_MAX_ROWS`), `:622` (`message:` skip report).
**Apply to:** D-04b id→value path — cap `BULK_EDIT_MAX_FEATURES = 100`, report skipped remainder + unknown-id skips.

### Style validation/normalization — applies to style_by_attribute
**Source:** `styleOptions.ts:156` (`normalizeStyleOptions`), `:34` (`InvalidStyleOptionError`), `:45` (`CANONICAL_STYLE_KEYS`).
**Apply to:** every style bucket value → throws on unknown key for model self-correction (Pitfall 3).

### Test harness — applies to all new test files
**Source:** `src/features/geo-editor/core/test-harness.ts` (`createHeadlessEditor`), used by `api/boundary.test.ts:5`, `fixAll.test.ts`, `ingest-tools.test.ts:454`.
**Apply to:** behavior tests (`bulk-tools.test.ts`) use `createHeadlessEditor`; pure-module tests (`predicate`/`dedup`/`geometryValidation`) need no editor.

## No Analog Found

None. Every file has a same-role, same-data-flow precedent. The genuinely-new logic (predicate operators, dedup grouping, turf validation wrappers, `classifyModifyKind`) is small and isolated, but each lands in a file whose *structure* is dictated by an existing analog above.

## Metadata

**Analog search scope:** `src/features/geo-editor/api/`, `src/features/chat/tools/`, `src/features/chat/safeEditing/`, `src/features/geo-editor/core/types/`.
**Files scanned:** 12 read in full/targeted (styleOptions, diff, fixAll, ingest-tools, gateRunCode, DatasetDiffDisclosure, registry, primitives-tools, results, boundary.test, types/index, authoring).
**Pattern extraction date:** 2026-06-21
