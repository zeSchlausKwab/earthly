# Phase 5: Dataset-Aware Safe Editing - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 14 (6 new, 8 modified/extended)
**Analogs found:** 14 / 14 (every file has a verified in-repo analog — this is an integration phase, not greenfield)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/features/geo-editor/api/diff.ts` | utility (pure) | transform | `src/features/geo-editor/api/authoring.ts` (id-keying) + `interceptor.ts` (pure fold) | role-match |
| `src/features/geo-editor/api/diff.test.ts` | test | transform | `src/features/geo-editor/api/boundary.test.ts` (harness usage) | exact |
| `src/features/geo-editor/core/managers/DatasetSnapshotManager.ts` | manager | event-driven (stack) | `src/features/geo-editor/core/managers/HistoryManager.ts` | exact (role + stack flow) |
| `…/managers/DatasetSnapshotManager.test.ts` | test | event-driven | `boundary.test.ts` + `test-harness.ts` (`createHeadlessEditor`) | exact |
| `src/features/chat/safeEditing/AuthoringGate.ts` | service (orchestrator) | request-response (async confirm) | host-side wrapper over `authoring.ts` + `runCode.ts` replay loop | role-match |
| `src/features/chat/safeEditing/AuthoringGate.test.ts` | test | request-response | `boundary.test.ts` + `test-harness.ts` | exact |
| `src/features/chat/safeEditing/binding.ts` | utility/hook | request-response (read) | binding-chip data source (metadataSlice + store/types) | role-match |
| `src/features/chat/safeEditing/binding.test.ts` | test | — | `settingsStorage.test.ts` (pure-unit style) | role-match |
| `src/features/chat/safeEditing/fixAll.ts` | utility (host-side rule runner) | batch/transform | `editor.getAllFeatures()` iteration (GeoEditor.ts:1155) | partial (new seam) |
| `src/features/chat/safeEditing/fixAll.test.ts` | test | batch | `boundary.test.ts` + harness | exact |
| `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` | component | request-response | `src/features/chat/CodeRunDisclosure.tsx` | exact |
| `src/features/chat/BindingChip.tsx` | component | request-response (read) | `CodeRunDisclosure.tsx` (transcript chip styling) + Radix badge primitives | role-match |
| `src/features/geo-editor/api/authoring.ts` | facade (extend) | CRUD | itself — `addFeature` (262-287), `writeGeoJSON` (289-346) | exact (self-mirror) |
| `src/features/geo-editor/api/interceptor.ts` | middleware (extend) | event-driven | itself — `runInterceptors` fold (47-59) | exact (self) |
| `src/features/chat/settingsStorage.ts` | config (extend) | request-response | itself — `migrateV1ToV2` (61-118) | exact (self) |
| `src/features/chat/store.ts` (`ChatSettingsSnapshot`) | store (extend) | — | itself — `DEFAULT_CHAT_SETTINGS` | exact (self) |
| `src/features/geo-editor/api/boundary.test.ts` | test (tighten A3) | — | itself — A3 scan (90-110) + surface assertion (125-150) | exact (self) |
| `src/features/chat/sandbox/runCode.ts` + `transport/sandbox.worker.ts` | service (cap) | streaming/batch | `REPLAYABLE_AUTHORING_OPS` allow-list (runCode.ts:80-86) | role-match |

## Pattern Assignments

### `src/features/geo-editor/api/diff.ts` (utility, transform) — SAFE-02

**Analog:** `interceptor.ts` (pure, no-side-effect fold) + `authoring.ts` id semantics.

**Pure-module idiom to mirror** — `interceptor.ts` is the model: a single exported type + a pure function, zero imports from chat/Nostr (the A3 boundary test scans this dir, so `diff.ts` MUST keep that constraint).

**Id-keying source of truth:** features are keyed by `feature.id`; `editor.getAllFeatures()` returns `Array.from(this.features.values())` (GeoEditor.ts:1155). The append dedup-by-id loop in `authoring.ts:325-337` is the exact precedent for "same id ⇒ collision":
```typescript
const existingIds = new Set(editor.getAllFeatures().map((f) => f.id))
for (const feature of normalized) {
  if (existingIds.has(feature.id)) { skippedDuplicates += 1; continue }
  // ...
}
```
**Classification contract to implement** (from RESEARCH Pattern 1):
```typescript
export interface DatasetDiff {
  added: EditorFeature[]
  modified: { before: EditorFeature; after: EditorFeature }[]
  deleted: EditorFeature[]
}
export function classifyMutation(current: EditorFeature[], proposed: EditorFeature[], intent: MutationIntent): DatasetDiff
```
- `MutationIntent` imported from `./interceptor` (already the single source, interceptor.ts:25).
- `modify` detection: compare by id first, then deep-equal only matched pairs over geometry + `CANONICAL_STYLE_KEYS` (exported from `api/index.ts`, RESEARCH "Don't Hand-Roll") + `properties`. Reuse the canonical key set — do NOT hand-roll a geometry walker.
- `delete` bucket only populated when `intent === 'delete'` (an `add`-intent write with a colliding id is a `skippedDuplicate`, not a modify — RESEARCH line 216).

---

### `src/features/geo-editor/core/managers/DatasetSnapshotManager.ts` (manager, stack) — SAFE-06 / D-10 / D-11

**Analog:** `HistoryManager.ts` (the full file is the template — mirror its shape, do NOT overload it).

**Class skeleton to mirror** (HistoryManager.ts:4-35) — same `IManager` interface, bounded array + index, `onAdd`/`onRemove`/`clear`:
```typescript
export class HistoryManager implements IManager {
  private history: HistoryAction[] = []
  private currentIndex: number = -1
  private maxHistorySize: number = 100      // ← SnapshotManager: use ~10-20 (Pitfall 3)
  addAction(action) { this.history = this.history.slice(0, this.currentIndex + 1); this.history.push(action); this.currentIndex++; if (this.history.length > this.maxHistorySize) { this.history.shift(); this.currentIndex-- } }
  undo(): HistoryAction | null { if (!this.canUndo()) return null; const a = this.history[this.currentIndex]; this.currentIndex--; return a }
}
```

**Key differences to encode (D-10):**
- Entry shape is NOT `HistoryAction`. Use `{ features: EditorFeature[]; collectionMeta: CollectionMeta; label: string; timestamp: number }` (RESEARCH Pattern 3). HistoryManager carries no `CollectionMeta` — that gap is exactly why this is a separate stack.
- **Memory (Pitfall 3 / A1):** do NOT deep-clone coordinates. HistoryManager's `features.map((f) => ({ ...f }))` (lines 41/48/57) is a shallow copy and is the ceiling to stay under. Hold references to the immutable `EditorFeature` objects (they are replaced wholesale via `set(id, normalized)` at GeoEditor.ts:1113/1123, not mutated in place) plus a structural copy of the id→feature map. Bound `maxHistorySize` to ~10-20.
- **One snapshot per confirmed apply (D-11):** push exactly once per gated apply unit (the whole tool call / recorded batch — RESEARCH Open Q 3), not per feature.

**Cmd+Z wiring (D-10):** `GeoEditor.undo()` is at GeoEditor.ts:1510, keyboard handler at GeoEditor.ts:623-625. On undo, consult the snapshot stack FIRST: if the top entry is the most-recent AI apply, restore via `editor.setFeatures(snapshot.features)` + `setCollectionMeta(snapshot.collectionMeta)`; else fall through to the geometry `HistoryManager`. Cover the manual-edit-between-applies interleave with a test (RESEARCH Open Q 2).

---

### `src/features/geo-editor/api/authoring.ts` (facade, extend) — modify/delete verbs

**Analog:** itself — `addFeature` (262-287) is the template for `modifyFeature`; the delete path mirrors the validate-then-route shape.

**addFeature template to mirror** (authoring.ts:262-287): null → quiet `{ ok:false }`; non-geometry → `throw` (loud, never silent created:0 — V5); then `runInterceptors({ intent, featureIds })` immediately before the editor mutation; return `MutationResult`.

**New methods to add** (RESEARCH Code Examples, lines 306-322 — verified against GeoEditor.ts:1119-1149):
```typescript
function modifyFeature(featureId, feature, source = DEFAULT_SOURCE): MutationResult {
  const existing = editor.getFeature(featureId)
  if (!existing) return { ok: false, intent: 'modify', featureIds: [], counts: emptyCounts() }  // no-op on unknown id (V5: don't crash)
  const usable = coerceToFeature(feature)
  if (!usable) throw new Error(`authoring.modifyFeature: ${describeUnusableFeature(feature)}.`)
  const { intent } = runInterceptors({ intent: 'modify', featureIds: [featureId] })
  editor.updateFeature(featureId, { ...toEditorFeature(usable, source), id: featureId })  // preserve id
  return { ok: true, intent, featureIds: [featureId], counts: { ...emptyCounts(), updated: 1 } }
}
function deleteFeatures(featureIds): MutationResult {
  const present = featureIds.filter((id) => editor.getFeature(id) !== undefined)
  const { intent } = runInterceptors({ intent: 'delete', featureIds: present })
  editor.deleteFeatures(present)
  return { ok: true, intent, featureIds: present, counts: { ...emptyCounts(), deleted: present.length } }
}
```
- Add both to the `Authoring` interface (177-255) AND the returned object.
- `setDatasetMetadata` (241-252) stays UNGATED and is the precedent for "benign non-geometry op" — do NOT route it through any gate (Anti-pattern, RESEARCH 243).
- Decision (A5): only add to `REPLAYABLE_AUTHORING_OPS` (runCode.ts:80-86) + worker `AUTHORING_METHODS` if the UAT drives modify/delete through `run_code`; otherwise keep host-tool-only.

---

### `src/features/geo-editor/api/interceptor.ts` (middleware, extend) — classification hook only

**Analog:** itself — the `runInterceptors` fold (47-59).

**Critical (Pitfall 1):** the interceptor is the SYNCHRONOUS classification/intent-tag point ONLY. The async confirm gate does NOT live here. Keep `runInterceptors` returning `InterceptorContext` synchronously; populate the (currently empty) chain with an intent-tag interceptor that returns `{ intent }`. The fold already supports replacement (interceptor.ts:53-55). Do not make `MutationResult` a `Promise`.

---

### `src/features/chat/safeEditing/AuthoringGate.ts` (service orchestrator, async) — SAFE-03 / SAFE-04

**Analog:** host-side wrapper over `authoring.ts`; gating timing precedent is `runCode.ts`'s replay loop (handler is `async` at runCode.ts:192; sync replay at 258-278).

**Why here, not the facade:** the chat loop (`store.ts:1710-1722`) already `await`s `executeToolCall`; the facade is sync (authoring.ts:278 calls `runInterceptors` then immediately `editor.addFeature`). The gate sits ABOVE the sync facade on the async path.

**Orchestration to implement** (RESEARCH Pattern 2 / diagram lines 138-149):
```typescript
const gate = createAuthoringGate(editor, { safetyLevel, emitDiffBlock })
const decision = await gate.review(result.recordedCalls)  // snapshot → classify → maybe await Apply/Cancel
if (decision === 'cancelled') return { ok: true, counts: emptyCounts(), cancelled: true }
// else apply for real through createAuthoring as today
```
Steps: (1) snapshot via `DatasetSnapshotManager`; (2) dry-run proposed mutation against a clone → proposed `EditorFeature[]`; (3) `classifyMutation(editor.getAllFeatures(), proposed, intent)`; (4) read `safetyLevel`; (5) pure-add OR Level 3 → apply immediately (still emit diff block, D-12); modify/delete & Level 1-2 → buffer, render `DatasetDiffDisclosure`, `await` Apply/Cancel. "Destructive" = modify+delete (D-07).

---

### `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` (component) — SAFE-03 / D-04 / D-05 / D-08

**Analog:** `src/features/chat/CodeRunDisclosure.tsx` (clone the entire collapse idiom).

**Collapse idiom to mirror** (CodeRunDisclosure.tsx:94-115): `const [isOpen, setIsOpen] = useState(defaultOpen)`; ghost `Button` with `aria-expanded={isOpen}` and the `{isOpen ? '▾' : '▸'}` glyph; a `useMemo` summary line; `{isOpen && (...)}` body with `max-h-* overflow-y-auto` panels. Reuse the exact `rounded-lg border … bg-violet-50 dark:bg-violet-950` container shell and `text-[10px] uppercase tracking-wide` section labels for visual consistency (D-04).

**Summary headline (D-05):** mirror `buildRunCodeSummary` (CodeRunDisclosure.tsx:52-59) but emit the counts headline `+3 added · ~2 changed · −1 deleted`; expandable body lists the per-feature `added`/`modified`/`deleted` from `DatasetDiff`.

**Apply/Cancel (D-08):** unlike `CodeRunDisclosure` (read-only, "intentionally NO edit affordance" — lines 83-92), this block has two `Button`s wired to resolve the gate's awaited promise. Keep everything inline in the transcript — no modal.

`defaultOpen` prop (CodeRunDisclosure.tsx:80) — keep it for render-proof tests.

---

### `src/features/chat/safeEditing/fixAll.ts` (host-side rule runner) — SAFE-05

**Analog:** `editor.getAllFeatures()` iteration (GeoEditor.ts:1155-1157). New seam, no direct clone.

**The guarantee (Pitfall 2 / A3):** iterate `editor.getAllFeatures()` (the full, un-compacted id-keyed set), NOT the model's compacted view (`summarizeFeaturesForPrompt` at helpers.ts:1235 sends only `sampleIds`/counts). The model supplies a RULE (predicate/transform), the host supplies the feature list. Land the rule-runner seam + one proof test (a predicate-driven "set property on all matching" exercised over the full set).

---

### `src/features/chat/safeEditing/binding.ts` + `BindingChip.tsx` (SAFE-01 / D-01..D-03)

**Analog:** binding-chip data source (metadataSlice.ts:9-17 + store/types.ts); chip render reuses transcript-chip styling + Radix badge primitives.

**Identity read (RESEARCH lines 349-355, verified):**
```typescript
const { collectionMeta, features, activeGeoEditDraftId, isDirty } = useEditorStore()
const chip = {
  name: collectionMeta.name || 'Untitled draft',
  unsaved: activeGeoEditDraftId !== null || isDirty,
  featureCount: features.length,  // mirror kept fresh by Editor.tsx:72-77
}
```
- `collectionMeta` = `{ name, description, color, customProperties }` (metadataSlice.ts:9-14). `isDirty` at metadataSlice.ts:16. `features` is the read-mirror updated on every create/update/delete/features.replace (Editor.tsx:72-77).
- Auto-bind (D-01) = read whatever is open; auto-create-and-bind (D-02) = create untitled draft + bind before mutating. Chip is read-only reflection.

---

### `src/features/chat/settingsStorage.ts` + `store.ts` (config extend) — SAFE-04 / D-09 / D-12

**Analog:** itself — `migrateV1ToV2` (settingsStorage.ts:61-118).

**Migration idiom to mirror** (settingsStorage.ts:80-84): membership/type-check each field against `DEFAULT_CHAT_SETTINGS`, never trust the decrypted shape, never throw on garbage (T-01-04). Add:
```typescript
// store.ts ChatSettingsSnapshot + DEFAULT_CHAT_SETTINGS:
safetyLevel: 1 | 2 | 3   // default 2 (D-09)
// migrateV1ToV2: default missing/invalid to 2
const safetyLevel = parsed.safetyLevel === 1 || parsed.safetyLevel === 3 ? parsed.safetyLevel : 2
```
- Also add `safetyLevel` to `buildSnapshot` in `useChatSettingsSync.ts:13-26` and a `setSafetyLevel` store action. The D-12 "Just accept" toggle sets `safetyLevel = 3` (off → restores `2`) — same persisted state, no parallel concept.
- Existing encrypted envelopes hydrate to default via migration (A4) — no ciphertext migration needed.

---

### `src/features/geo-editor/api/boundary.test.ts` (tighten A3) + WR-04 cap

**Analog:** itself — the A3 scan (90-110) and surface assertion (125-150).

**A3 scan to extend** (boundary.test.ts:103): currently `/\.addFeature\s*\(/`. Tighten to all four verbs outside the allowed homes (`features/geo-editor/api/` + `core/GeoEditor.ts`, lines 96-97): `addFeature`, `setFeatures`, `updateFeature`, `deleteFeatures`/`deleteFeature`. Update the deferred-note comment (59-70).

**Surface assertion to extend** (boundary.test.ts:135-143): add `modifyFeature` + `deleteFeatures` to the expected `Object.keys(authoring).sort()` array; keep the `forbidden` list (145) intact (no signer/wallet/store leak — V4).

**WR-04 cap (runCode.ts + transport/sandbox.worker.ts):** the `REPLAYABLE_AUTHORING_OPS` allow-list (runCode.ts:80-86) is the precedent for a host-side defence-in-depth bound. Cap recorded-call count + total serialized arg bytes at the worker (mirror the existing console cap), reject over-budget batches before replay in `runCode.ts`. Extend `runCode.test.ts`.

## Shared Patterns

### Pure-module boundary (A3 / D-07)
**Source:** `interceptor.ts` (no chat/Nostr imports) enforced by `boundary.test.ts:17-26`.
**Apply to:** `diff.ts` and everything under `api/` — import nothing from `@/features/chat`, NDK, Nostr, applesauce, MCP. `MutationIntent`/`EditorFeature`/`CANONICAL_STYLE_KEYS` are the allowed cross-imports (all under geo-editor).

### Headless test harness
**Source:** `src/features/geo-editor/core/test-harness.ts` (`createHeadlessEditor`), used at `boundary.test.ts:5,127`.
**Apply to:** `diff.test.ts`, `DatasetSnapshotManager.test.ts`, `AuthoringGate.test.ts`, `fixAll.test.ts`. TEST-ONLY — never import from production. `getStyle()` returns undefined so rendering is a no-op; feature storage/events/history work as production.

### Loud-not-silent input validation (V5)
**Source:** `authoring.ts:268-275` (`throw` on non-geometry via `describeUnusableFeature`); `coerceToFeature` reuse.
**Apply to:** `modifyFeature` (throw on bad feature, no-op on unknown id), `deleteFeatures` (filter unknown ids, never crash).

### Encrypt-to-self persistence
**Source:** `settingsStorage.ts` `migrateV1ToV2` + `loadEncryptedChatSettings` (120+).
**Apply to:** `safetyLevel` — never hand-roll crypto/localStorage; ride the existing envelope (V6).

### MutationResult contract (stays synchronous)
**Source:** `authoring.ts` returns `MutationResult` (never `Promise`); `emptyCounts()`.
**Apply to:** all new facade verbs. The async/await lives ONLY at the chat `AuthoringGate` layer.

## No Analog Found

None. Every file maps to a verified in-repo analog. `fixAll.ts` and `AuthoringGate.ts` are the most novel (new orchestration seams) but compose entirely from existing primitives (`getAllFeatures`, `DatasetSnapshotManager`, `classifyMutation`, the async chat loop).

## Metadata

**Analog search scope:** `src/features/geo-editor/api/`, `src/features/geo-editor/core/managers/`, `src/features/chat/`, `src/features/chat/sandbox/`
**Files read this session:** CodeRunDisclosure.tsx, HistoryManager.ts, authoring.ts (230-360), interceptor.ts, settingsStorage.ts (55-124), boundary.test.ts, runCode.ts (75-94), test-harness.ts (1-40)
**Pattern extraction date:** 2026-06-20
