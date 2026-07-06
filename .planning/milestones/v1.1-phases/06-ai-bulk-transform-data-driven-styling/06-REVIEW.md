---
phase: 06-ai-bulk-transform-data-driven-styling
reviewed: 2026-06-22T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/features/chat/safeEditing/DatasetDiffDisclosure.tsx
  - src/features/chat/safeEditing/gateBulkEdit.ts
  - src/features/chat/tools/bulk-tools.test.ts
  - src/features/chat/tools/bulk-tools.ts
  - src/features/chat/tools/registry.ts
  - src/features/chat/tools/schemas.ts
  - src/features/geo-editor/api/authoring.ts
  - src/features/geo-editor/api/dedup.test.ts
  - src/features/geo-editor/api/dedup.ts
  - src/features/geo-editor/api/diff.test.ts
  - src/features/geo-editor/api/diff.ts
  - src/features/geo-editor/api/geometryValidation.test.ts
  - src/features/geo-editor/api/geometryValidation.ts
  - src/features/geo-editor/api/predicate.test.ts
  - src/features/geo-editor/api/predicate.ts
findings:
  critical: 3
  warning: 6
  info: 3
  total: 12
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-06-22
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the AI bulk-transform + data-driven-styling toolset: the pure authoring-API
primitives (`predicate`, `dedup`, `diff`, `geometryValidation`), the safe-editing
gate generalization (`gateBulkEdit`), the five registered bulk tools (`bulk-tools`),
the diff disclosure UI, and the schemas/registry wiring.

The pure primitives are well-tested and largely sound. The defects cluster at the
seam between the gate and the host-side `apply()` callback. The most serious problem
is that **`gateBulkApply` provides no exception safety**: if the caller's `apply()`
throws partway through a real, interceptor-routed bulk mutation, the editor is left
in a partially-mutated state with a dangling undo snapshot, and the gate's own
"net-zero on cancel" guarantee silently does not extend to the throw path. This is
directly reachable from `style_by_attribute` (an unknown style key throws mid-batch)
and from `batch_edit_features` declarative/template ops. The single-feature unit
tests mask it because partial application requires ≥2 matching features.

A second class of defect is **predicate-value validation**: `parsePredicate` validates
`field` and `op` but never validates the `value`, so an `in` clause with a missing/
non-array value throws an unhelpful `undefined is not an object` instead of the
self-correctable error the module docstring promises ("the engine's matchers are
themselves never-throw on bad values" — this claim is false).

## Critical Issues

### CR-01: `gateBulkApply` has no exception safety — a throwing `apply()` leaves partial mutation + a dangling snapshot

**File:** `src/features/chat/safeEditing/gateBulkEdit.ts:76-87`
**Issue:**
The gate pushes a dataset snapshot, then calls `apply()`, then classifies:

```ts
const before = editor.getAllFeatures()
editor.pushDatasetSnapshot(deps.label)   // unconditionally pushed
apply()                                   // <-- can throw mid-batch
const after = editor.getAllFeatures()
const diff = classifyMutation(before, after, intent)
```

`apply()` runs the real, interceptor-routed mutation feature-by-feature
(`runFixAllRule` in `bulk-tools.ts:348/518`, or the `authoring.modifyFeature` loop
at `bulk-tools.ts:386-394`). If it throws partway through:
- Every feature already iterated has been committed to the editor (the writes are
  not buffered — `runFixAllRule` calls `authoring.modifyFeature` per feature).
- The snapshot pushed on line 79 is **never popped**, so it sits on the bounded
  `DatasetSnapshotManager` stack as a phantom undo step.
- The exception propagates uncaught out of `gateBulkApply`. The diff is never
  emitted, the user never confirms/cancels, and the editor is left half-edited.

This is reachable today: `style_by_attribute`'s `transform` calls
`normalizeStyleOptions(chosen)` (`bulk-tools.ts:499`), which **throws
`InvalidStyleOptionError` on an unknown style key**. With ≥2 matching features and a
bad key, the first feature(s) get restyled, then the throw aborts mid-batch — leaving
a partially-restyled dataset and a dangling snapshot. The existing test
(`bulk-tools.test.ts:420-435`) seeds only ONE feature, so it cannot observe the
partial-apply / dangling-snapshot state. The same hazard applies to
`batch_edit_features` declarative ops if any `transform` step can throw.

**Fix:** Wrap `apply()` in try/catch and roll back the snapshot on throw so the
net-zero guarantee holds for the error path too:

```ts
editor.pushDatasetSnapshot(deps.label)
try {
  apply()
} catch (err) {
  editor.undoLastDatasetSnapshot() // restore: zero net mutation on throw
  throw err                        // re-throw so dispatch() yields a ToolError
}
```

Additionally, validate style keys for ALL buckets/fallback BEFORE the gated apply
(call `normalizeStyleOptions` on each bucket style once up front in
`parseStyleBuckets`) so an unknown key is rejected before any feature is touched.

### CR-02: `parsePredicate` never validates clause `value`; `in` with a missing/non-array value throws `undefined is not an object`

**File:** `src/features/chat/tools/bulk-tools.ts:104-130` and `src/features/geo-editor/api/predicate.ts:74-75`
**Issue:**
`parsePredicate` validates `field` and `op` but never validates `value`. The schema
(`schemas.ts`) marks only `['field','op']` as required, so the model can legitimately
send `{ field: 'category', op: 'in' }` with no `value`. `matchesClause` then runs:

```ts
case 'in':
  return clause.value.includes(value as ...)   // predicate.ts:75
```

When `clause.value` is `undefined` (or any non-array), this throws
`undefined is not an object (evaluating 'clause.value.includes')` — verified by
direct execution. The module docstring explicitly claims the matchers "are themselves
never-throw on bad values" (predicate.ts:128, predicate.ts:14) — that claim is false
for `in`. The numeric ops (`lt/lte/gt/gte`) and `contains` also assume `value` is the
right type but do not crash; `in` does crash. Although `dispatch()` catches it into a
`handler_error` ToolError, the message is the raw `undefined is not an object`, which
is not self-correctable — defeating the V5 "model self-corrects in one shot" intent.

**Fix:** Validate `value` per-op in `parsePredicate`:

```ts
if (op === 'in' && !Array.isArray((clause as { value?: unknown }).value)) {
  throw new Error("predicate op 'in' requires an array `value`")
}
if (['lt','lte','gt','gte'].includes(op) &&
    typeof (clause as { value?: unknown }).value !== 'number') {
  throw new Error(`predicate op '${op}' requires a numeric \`value\``)
}
if (['eq','neq','contains'].includes(op) &&
    (clause as { value?: unknown }).value === undefined) {
  throw new Error(`predicate op '${op}' requires a \`value\``)
}
```

And/or harden `matchesClause` for `in`: `return Array.isArray(clause.value) && clause.value.includes(...)`.

### CR-03: `gateBulkApply` emits the diff and returns `'applied'` even when the diff is empty (no-op apply silently reported as applied)

**File:** `src/features/chat/safeEditing/gateBulkEdit.ts:88-98` and `src/features/chat/tools/bulk-tools.ts:343-357`
**Issue:**
When `apply()` produces no net change (e.g. a declarative `set` writes the value a
feature already has, so `classifyMutation` finds no modify), `diff` is empty,
`destructive` is false, `mustConfirm` is false, and the gate returns
`status: 'applied'` with an empty diff. For `batch_edit_features` this is then
reported to the model as `edited: outcome.diff.modified.length` = 0 with
`matched: N` (the predicate matched N features) and `cancelled: false`. The model
sees "matched N, edited 0, not cancelled" with no explanation — it cannot tell
whether the gate suppressed the edit, the values were already set, or something
failed. More importantly, the snapshot WAS pushed (line 79) for a zero-change batch,
so the user accrues a phantom "undo AI edit" step that undoes nothing. This is a
correctness/data-integrity issue for the undo stack and a confusing contract for the
model loop.

**Fix:** Detect the empty-diff case and avoid pushing/keeping a snapshot for a no-op,
or pop it:

```ts
editor.pushDatasetSnapshot(deps.label)
apply()
const after = editor.getAllFeatures()
const diff = classifyMutation(before, after, intent)
const isNoop = diff.added.length === 0 && diff.modified.length === 0 && diff.deleted.length === 0
if (isNoop) {
  editor.undoLastDatasetSnapshot() // drop the phantom snapshot
  // emit an 'applied' (or a dedicated 'noop') diff WITHOUT leaving an undo step
}
```

## Warnings

### WR-01: declarative `copy` op reads the *mutated* properties, making ops order-dependent in a surprising way

**File:** `src/features/chat/tools/bulk-tools.ts:228-229`
**Issue:**
`applyDeclarativeOps` mutates a single `next` accumulator, and `copy` reads
`next[op.source]`:

```ts
case 'copy':
  next[op.field] = next[op.source]   // reads in-progress, not original
```

If an earlier op in the same `ops` array overwrote `op.source`, `copy` silently
copies the *new* value, not the feature's original. Likewise `template`
(`renderTemplate(op.template, next)`, line 232) interpolates against already-mutated
properties. This order-coupling is undocumented and easy to trip: a model that does
`set name=X` then `copy oldName from name` gets X, not the original name. The
docstring says copy "copies property `source` into `field`" with no mention of
order semantics.

**Fix:** Either copy/template against a frozen snapshot of the *original* props
(`const original = { ...props }` and read sources from `original`), or document the
left-to-right cumulative semantics explicitly in the schema description so the
behavior is intentional.

### WR-02: `dedup_features` reports `survivors` even when no group was actually deleted / on cancel

**File:** `src/features/chat/tools/bulk-tools.ts:451-461`
**Issue:**
On cancel, `deleted` is correctly 0, but the return still reports
`survivors: groups.length` and `groups: groups.length`, implying survivors were
"kept" when in fact nothing was deleted (the dataset is unchanged). The success
message path is fine, but the structured fields conflate "groups detected" with
"survivors kept after deletion." A model reading `groups: 3, survivors: 3, deleted: 0,
cancelled: true` may conclude 3 survivors remain *as a result of dedup*, when nothing
happened.

**Fix:** Zero out `survivors`/`groups` (or add an explicit `applied: boolean`) on the
cancel path, mirroring how `deleted` is already zeroed.

### WR-03: `dedup_features` `keys` validation silently drops non-string entries instead of rejecting

**File:** `src/features/chat/tools/bulk-tools.ts:428-430`
**Issue:**
```ts
const keys = Array.isArray(args.keys)
  ? (args.keys.filter((k) => typeof k === 'string') as string[])
  : undefined
```
A `keys: ['code', 123, null]` arg silently becomes `['code']`. For `by:'attributes'`
or `by:'both'` this changes the dedup tuple the user asked for without any signal,
potentially deleting features the user did not intend to treat as duplicates (a
destructive op). The V5 contract elsewhere in this file (predicate, ops, buckets) is
"reject malformed input so the model self-corrects" — `keys` violates that pattern.

**Fix:** Throw on a non-string entry, or at minimum require a non-empty `keys` array
when `by !== 'geometry'` (see WR-04).

### WR-04: `dedup_features` does not require `keys` for `by:'attributes'` / `by:'both'` → silently dedups everything as duplicates

**File:** `src/features/chat/tools/bulk-tools.ts:427-431` and `src/features/geo-editor/api/dedup.ts:88-89`
**Issue:**
`dedup.ts` documents that empty/absent `keys` "make every feature's attribute tuple
equal — caller's responsibility to supply keys." But the tool layer does not enforce
this: if the model calls `dedup_features { by: 'attributes' }` with no `keys`,
`attributeTuple` returns `[]` for every feature, every feature compares equal, and the
tool **deletes every feature except the first** — a catastrophic, gated-but-confirmable
mass delete from an under-specified call. The schema description says
"attributes/both require `keys`" but nothing enforces it.

**Fix:** In the `dedup_features` handler, throw when `by !== 'geometry'` and `keys` is
absent or empty:

```ts
if (by !== 'geometry' && (!keys || keys.length === 0)) {
  throw new Error("dedup by 'attributes'/'both' requires a non-empty `keys` array")
}
```

### WR-05: `validate_geometry` `withZeroArea` is suppressed for self-intersecting polygons, but a single shared `safeArea`/`hasInvalidRing` pass also misses MultiPolygon ring validity per-polygon

**File:** `src/features/geo-editor/api/geometryValidation.ts:62-89, 144-150`
**Issue:**
`polygonRings` flattens a MultiPolygon's rings (line 69) before `hasInvalidRing`
iterates them. That is fine for ring closure, but `safeArea`/`hasSelfIntersection`
operate on the *whole* feature. A MultiPolygon where ONE part is a valid large polygon
and another part is a degenerate sliver will report `area` as the sum (well above the
threshold), so the sliver part is never flagged `zero-area`. The per-feature aggregate
hides per-part defects. This is a soft correctness gap in the validator's reported
coverage (it claims to flag near-zero-area slivers; it flags them only when the whole
feature is near-zero-area). Note this is a reporting accuracy issue, not a crash.

**Fix:** Document the per-feature (not per-part) granularity in the report, or iterate
MultiPolygon parts and flag any part below the threshold.

### WR-06: `batch_edit_features` intelligence-mode `valuesById` order is non-deterministic for the cap, so which 100 ids win is unspecified

**File:** `src/features/chat/tools/bulk-tools.ts:368-378`
**Issue:**
`Object.entries(valuesById)` order follows JS object insertion order, then the first
`BULK_EDIT_MAX_FEATURES` are applied and the rest "reported for rerun." Because the
applied set depends on JSON object key ordering (which the model and transport control,
and which is not guaranteed for integer-like keys), *which* 100 of 112 ids get edited
on the first call is effectively unspecified. On rerun the model must diff what it
already applied — but it only receives counts (`edited`, `skippedOverCap`), not WHICH
ids were applied. So the model cannot reliably compute the remainder, risking
double-application or skipped ids across reruns.

**Fix:** Return the applied id list (or the skipped/remaining id list) so the rerun is
deterministic, e.g. `appliedIds: [...capById.keys()]` and
`remainingIds: knownEntries.slice(BULK_EDIT_MAX_FEATURES).map(([id]) => id)`.

## Info

### IN-01: `dedup_features` re-resolves `editor.getAllFeatures()` and an inner `parsePredicate` even after `requireEditor`

**File:** `src/features/chat/tools/bulk-tools.ts:423-426`
**Issue:** `selectByPredicate(editor.getAllFeatures(), parsePredicate(args.predicate))`
calls `getAllFeatures()` twice across the two branches and re-parses; minor
readability/consistency nit versus the `select_features` handler which hoists `all`.
**Fix:** Hoist `const all = editor.getAllFeatures()` once and reuse.

### IN-02: `requireEditor` is duplicated in `bulk-tools.ts` and inlined in `registry.ts` (`set_dataset_metadata`, `capture_map_snapshot`)

**File:** `src/features/chat/tools/bulk-tools.ts:89-95`, `src/features/chat/tools/registry.ts:304-306, 352-354`
**Issue:** The identical "Map editor is not ready…" guard is hand-rolled in three
places with the same message string. Drift risk if the message/behavior changes.
**Fix:** Export a single `requireEditor()` helper and reuse it across the host-builtin
handlers.

### IN-03: `featureLabel` is duplicated across `bulk-tools.ts` and `DatasetDiffDisclosure.tsx`

**File:** `src/features/chat/tools/bulk-tools.ts:133-140`, `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx:58-62`
**Issue:** Two near-identical name-or-id label helpers. Low-risk duplication; consider
extracting to a shared util so the "name, falling back to id" rule has one home.
**Fix:** Extract a shared `featureLabel(feature)` utility.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
