# Phase 5: Dataset-Aware Safe Editing - Research

**Researched:** 2026-06-20
**Domain:** Client-side safety gating of an AI-driven map mutation seam (React 19 + Zustand + MapLibre + Bun). No new external libraries.
**Confidence:** HIGH (every recommendation is grounded in the actual current code, read this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Binding model (SAFE-01)**
- **D-01:** Auto-bind to the open draft/dataset. The chat is bound to whatever dataset/draft is currently open in the editor; opening a different dataset re-binds; the binding chip reflects the current target (no separate picker).
- **D-02:** Auto-create-and-bind when nothing is bound. If asked to mutate with nothing bound, create a new untitled draft, bind to it, show the chip, and proceed. "No mutating tool fires unless a target is bound and shown" is satisfied because binding is *created and shown* before the mutation — not by refusing.
- **D-03:** The binding chip shows the bound dataset's identity (name / unsaved-draft state / feature count).

**Diff / preview (SAFE-02 / SAFE-03)**
- **D-04:** Inline chat block only for the preview — a collapsible diff block in the transcript, reusing the `CodeRunDisclosure` collapse language. No map ghost/overlay this phase.
- **D-05:** Granularity = counts headline + expandable per-feature list. Headline like `+3 added · ~2 changed · −1 deleted`, expandable to per-feature detail.
- **D-06:** Classification: `add` = new feature id, `modify` = existing id whose geometry/properties/style change, `delete` = existing id removed — diffed against the bound dataset's current features by id.

**Safety levels (SAFE-04)**
- **D-07:** "Destructive" = modify + delete of existing features. Pure adds proceed freely; anything that CHANGES/REMOVES existing features is gated. Level 2 (default) confirms those; Level 1 confirms everything (incl. adds); Level 3 = trust + undo (no confirm, snapshot taken).
- **D-08:** Confirm UX = inline Apply / Cancel buttons in the chat diff block. No modal.
- **D-09:** Safety level persists via the Phase 1 encrypted settings store. Shipped default = Level 2.
- **D-12:** "Just accept" auto-accept toggle — prominent one-click toggle (near the binding chip / in chat, not buried in settings) that puts the user in Level 3 (trust + undo). Same persisted safety-level state as D-09. Opt-in; shipped default stays Level 2. When auto-accept is on, the diff still renders (so the user sees what happened) — it just applies without gating, and remains undoable per D-10/D-11.

**Undo / snapshot (SAFE-06)**
- **D-10:** Dataset snapshot before each apply, as a SEPARATE stack from the geometry-only `HistoryManager`. Covers geometry AND property/style/translation/metadata. Hook the existing undo trigger (Cmd+Z / editor undo) so it feels native.
- **D-11:** Undo granularity = per confirmed apply. Each approved diff = one snapshot / one undo step.

### Claude's Discretion
- Undo trigger surface: integrate with the existing editor undo (Cmd+Z) AND expose a chat-accessible undo ("Undo last AI edit" near the applied diff). Exact placement is Claude's discretion.
- Snapshot storage strategy for large bound datasets (full copy vs structural sharing vs bounded depth) — must not reintroduce the OOM-class memory pressure seen in Phase 4.
- Binding-chip visual treatment (reuse existing chip/badge primitives) — within brand.

### Deferred Ideas (OUT OF SCOPE)
- **Map-overlay (ghost/highlight) diff** — visualizing add/modify/delete on the map itself. Inline-chat-only was chosen (D-04). Natural later enhancement, NOT this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | Chat explicitly bound to a target dataset/context; binding always visible (chip) | Binding identity source confirmed = `collectionMeta` + `activeGeoEditDraftId` + the mirrored `features.length` in the editor store (see Binding Chip Data Source). Auto-bind/create per D-01/D-02. |
| SAFE-02 | Each AI map op classified add/modify/delete, surfaced to user | Classification keys off `editor.getAllFeatures()` ids (the `features` Map keyed by `feature.id`). Diff function compares proposed vs current by id (see Diff Classification). |
| SAFE-03 | Preview add/changed/deleted before applying to existing dataset | Inline `DatasetDiffDisclosure` (clone of `CodeRunDisclosure`) rendered in the transcript with Apply/Cancel (D-04/D-08). |
| SAFE-04 | Configurable safety level (1/2/3), persists | New `safetyLevel: 1\|2\|3` field on `ChatSettingsSnapshot` → encrypted settings store (Phase 1 pattern). Default 2. |
| SAFE-05 | Bulk transforms operate host-side over full bound dataset by id (never compacted view) | The full set lives in the editor's `features: Map<string, EditorFeature>` (`GeoEditor.getAllFeatures()`). A host-side rule iterates that, NOT the model's `data.features` snapshot. (see SAFE-05 section). |
| SAFE-06 | Dataset-level snapshot/undo covering property/style/translation, not just geometry | New `DatasetSnapshotManager` separate from `HistoryManager`; snapshot = full `EditorFeature[]` + `CollectionMeta` before each apply (see Snapshot Strategy). |
</phase_requirements>

## Summary

This phase is an **integration phase, not a greenfield one**. Every AI-driven geometry mutation already funnels through exactly one chokepoint — `createAuthoring(editor)` → `runInterceptors()` inside `src/features/geo-editor/api/authoring.ts`. Phase 2/4 deliberately built that seam as a *synchronous, empty-chain pass-through* and explicitly deferred the gate to this phase. The central architectural problem is therefore a **timing mismatch**: the interceptor fires *synchronously inside the mutation method* (`runInterceptors(...)` is a plain function call immediately before `editor.addFeature(...)`), but SAFE-03/SAFE-04 require an **async confirm** before the geometry touches the editor. You cannot block on a user click inside a synchronous facade method without making the entire Authoring API async — which would ripple through `run_code`'s synchronous replay loop, the primitives tools, and the A3 boundary test.

**The recommended design resolves this by gating at the *chat apply path*, not inside the synchronous facade.** Three callers reach `createAuthoring`: (1) `runCode.ts` replays recorded calls synchronously on the host main thread; (2) the registry tool handlers (`add_feature_to_editor`, `write_geojson_to_editor`, `draw_circle`, `buffer_feature`, `import_osm_to_editor`) call `importFeaturesToEditor`/`createAuthoring` synchronously inside their handler; (3) direct UI editing (not AI, not gated). All AI paths converge at `executeToolCall` (`src/features/chat/tools/execute.ts`) and the loop in `src/features/chat/store.ts:1710`. The gate belongs at a **buffer-then-apply seam wrapping the authoring construction for AI calls**: compute the proposed mutation against a snapshot of the current bound dataset, classify it (add/modify/delete by id), render the inline diff, and — gated by the safety level — `await` the user's Apply/Cancel before letting the recorded/handler mutation actually run. The interceptor seam stays as the *classification* hook (it can still tag intent), but the *gate* (the async confirm + snapshot) lives at the chat layer where `await` is already available (the loop is `async`).

**Primary recommendation:** Introduce a host-side `AuthoringGate` that wraps the *AI* authoring entrypoints. It (a) takes a dataset snapshot via a new `DatasetSnapshotManager`, (b) diffs proposed-vs-current by feature id to classify add/modify/delete, (c) decides — from the persisted `safetyLevel` — whether to apply immediately (Level 3 / pure-add) or buffer and await an inline `DatasetDiffDisclosure` Apply/Cancel (Levels 1–2), and (d) records the snapshot for per-apply undo wired into both `editor.undo()` (Cmd+Z) and a chat "Undo last AI edit" affordance. Extend `authoring.ts` with `modifyFeature`/`deleteFeatures` (Phase-2-deferred), route them through `runInterceptors`, and tighten the A3 boundary test to all verbs. Cap recorded-call batch size at the worker (WR-04).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Binding identity (which dataset is bound) | Editor store (Zustand) | Chat panel (read) | `collectionMeta` + `activeGeoEditDraftId` + mirrored `features` already live in `useEditorStore`; the chip is a read-only reflection. |
| Binding chip render | Chat panel (`src/features/chat/`) | — | D-04 keeps everything in the transcript/chat surface; chip reads editor store. |
| Add/modify/delete classification | Authoring layer (`api/`) host-side | — | Must diff against the canonical `editor.getAllFeatures()` by id — the editor core owns truth. |
| Async confirm gate + buffer-then-apply | Chat apply path (`features/chat/`) | Authoring gate wrapper | Only the chat loop is `async`; the facade is sync and must stay sync (A3 / run_code replay). |
| Dataset snapshot / undo | Editor core (new `DatasetSnapshotManager`) | Chat ("Undo last AI edit") | Snapshot must cover geometry + meta the editor owns; Cmd+Z is an editor-core trigger. |
| Safety-level persistence | Chat settings (encrypted, Phase 1) | — | Reuses the exact `ChatSettingsSnapshot` encrypt-to-self pattern. |
| Recorded-call cap (WR-04) | Sandbox worker (`transport/sandbox.worker.ts`) + `runCode.ts` | — | The DoS surface is the recorded-call channel; cap at the worker before RPC, reject over-budget before replay. |

## Standard Stack

No new external dependencies. This phase is built entirely from in-repo seams and the existing toolchain.

### Core (existing, reused)
| Library / Module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| Zustand | (in package.json) | Editor + chat state, settings | Already the project's state layer; binding chip + safety level + snapshot stack hang off existing stores. `[VERIFIED: package.json + store/index.ts]` |
| React 19 | 19.x | Inline diff disclosure UI | CodeRunDisclosure is React 19 already. `[VERIFIED: CodeRunDisclosure.tsx]` |
| MapLibre GL | (in package.json) | Underlying editor; untouched by this phase | Snapshot operates on `EditorFeature[]`, not map internals. `[ASSUMED]` |
| Bun test | bundled | Test runner (`bun test`) | Project gate per CLAUDE.md; all `api/*.test.ts` use `bun:test`. `[VERIFIED: package.json scripts.test + *.test.ts]` |
| Biome | (in package.json) | Lint/format (`bun run lint`) | Project standard, not ESLint/Prettier. `[VERIFIED: CLAUDE.md + package.json]` |

### Supporting (existing seams this phase extends)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/features/geo-editor/api/interceptor.ts` | `runInterceptors({intent, featureIds})` + `Interceptor` type | The classification hook; extend chain with a classify/intent-tag interceptor. The *gate* does NOT live here (sync). `[VERIFIED: interceptor.ts]` |
| `src/features/geo-editor/api/authoring.ts` | `createAuthoring(editor)` facade | Add `modifyFeature`/`deleteFeatures`; route through `runInterceptors`. `[VERIFIED: authoring.ts]` |
| `src/features/chat/CodeRunDisclosure.tsx` | Collapsible transcript block idiom | Clone into `DatasetDiffDisclosure` for the diff + Apply/Cancel. `[VERIFIED: CodeRunDisclosure.tsx]` |
| `src/features/chat/settingsStorage.ts` + `useChatSettingsSync.ts` + `store.ts` (`ChatSettingsSnapshot`) | Encrypted settings persistence | Add `safetyLevel` field; migrate in `migrateV1ToV2`. `[VERIFIED: settingsStorage.ts]` |
| `src/features/geo-editor/store/metadataSlice.ts` (`collectionMeta`) | Dataset identity | Binding chip name/description/color/customProperties. `[VERIFIED: metadataSlice.ts]` |
| `src/features/geo-editor/core/managers/HistoryManager.ts` | Geometry-only undo | Reference pattern for the new snapshot stack; do NOT overload it. `[VERIFIED: HistoryManager.ts]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Gate at chat apply path (async) | Make the whole Authoring facade async + await inside `runInterceptors` | Rejected: ripples through `run_code`'s sync replay loop, primitives tools, A3 boundary test, and `MutationResult` return contract. Massive blast radius for the same outcome. |
| New `DatasetSnapshotManager` (separate stack) | Extend `HistoryManager` to cover meta/style | Rejected by D-10 (separate stack). HistoryManager is geometry-`HistoryAction`-shaped (`create/update/delete` + `EditorFeature[]`), does not carry `CollectionMeta`, and its `maxHistorySize=100` full-copy approach is exactly the memory pattern to avoid for whole-dataset snapshots. |
| `safetyLevel` in encrypted settings | A separate localStorage key | Rejected by D-09 (reuse Phase 1 encrypted store). Keeps one persistence lifecycle, one signer dependency, one migration path. |

**Installation:** None. `bun install` unchanged.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero external packages**. All work is in-repo against existing seams. No registry verification needed.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram — the AI mutation flow with the Phase 5 gate inserted

```
                          AI model emits tool call
                                   │
                                   ▼
                   ┌───────────────────────────────────┐
                   │ chat store loop (store.ts:1710)     │  async ✓  ← gate can await here
                   │   for (toolCall of result.toolCalls)│
                   │     await executeToolCall(toolCall) │
                   └───────────────┬─────────────────────┘
                                   ▼
                        executeToolCall (execute.ts)
                                   │ dispatch(name,args)
                                   ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  registry.dispatch  (registry.ts)                              │
        │   ├─ run_code        → replays recorded authoring.* calls      │
        │   ├─ add_feature_… / write_geojson_… → importFeaturesToEditor  │
        │   ├─ draw_circle / buffer_feature    → createAuthoring(editor) │
        │   └─ import_osm_to_editor            → importFeaturesToEditor  │
        └───────────────┬──────────────────────────────────────────────┘
                        ▼
        ┌──────────────────────────────────────────────┐
        │  NEW: AuthoringGate (host-side, async-aware)   │
        │   1. snapshot bound dataset (DatasetSnapshot)  │
        │   2. compute proposed mutation                 │
        │   3. classify add/modify/delete by feature id  │
        │      (diff proposed vs editor.getAllFeatures())│
        │   4. read persisted safetyLevel (1/2/3)        │
        │   5. pure-add OR level 3 → apply now           │
        │      modify/delete & level 1-2 → BUFFER,       │
        │        render DatasetDiffDisclosure, await     │
        │        Apply/Cancel                            │
        └───────────────┬──────────────────────────────┘
                 apply  │  (Apply confirmed / not gated)
                        ▼
        ┌──────────────────────────────────────────────┐
        │ createAuthoring(editor)  (authoring.ts)        │
        │   addFeature / writeGeoJSON / modifyFeature /  │
        │   deleteFeatures → runInterceptors({intent})   │ ← intent classify hook (sync)
        │                  → editor.addFeature/update/…  │
        └───────────────┬──────────────────────────────┘
                        ▼
        GeoEditor.features: Map<id, EditorFeature>  (canonical truth, SAFE-05 source)
                        │  emits 'create'/'update'/'delete'/'features.replace'
                        ▼
        Editor.tsx mirror → useEditorStore.setFeatures(editor.getAllFeatures())
                        │
                        ▼
        Binding chip (reads collectionMeta + features.length)
```

Key fact establishing the gate location: the chat loop is already `async` and `await`s `executeToolCall` (`store.ts:1712`), but `runInterceptors` and the facade methods are synchronous (`authoring.ts:278` calls `runInterceptors(...)` then immediately `editor.addFeature(...)`). The buffer-then-apply gate must therefore sit *above* the synchronous facade, on the async chat path. `[VERIFIED: store.ts:1710-1722, execute.ts:35, authoring.ts:276-287]`

### Recommended Project Structure
```
src/features/geo-editor/
├── api/
│   ├── authoring.ts          # ADD modifyFeature/deleteFeatures (route through runInterceptors)
│   ├── interceptor.ts        # classification interceptor lives here (intent tagging only)
│   └── diff.ts               # NEW: pure classifyMutation(current, proposed) → DatasetDiff by id
├── core/managers/
│   └── DatasetSnapshotManager.ts  # NEW: separate snapshot stack (geometry + meta), per-apply
└── store/
    └── (snapshot state surfaced via a slice or the manager on the editor instance)

src/features/chat/
├── safeEditing/
│   ├── AuthoringGate.ts      # NEW: host-side buffer-then-apply + classify + snapshot orchestration
│   └── DatasetDiffDisclosure.tsx  # NEW: clone of CodeRunDisclosure + Apply/Cancel (D-04/D-05/D-08)
├── BindingChip.tsx           # NEW: reads editor store identity (D-03)
├── store.ts                  # ADD safetyLevel to ChatSettingsSnapshot + DEFAULT_CHAT_SETTINGS
└── settingsStorage.ts        # migrate safetyLevel in migrateV1ToV2
```

### Pattern 1: Diff classification by feature id (D-06, SAFE-02)
**What:** Pure function comparing the proposed feature set to the current bound set, keyed by `feature.id`.
**When to use:** Before every gated apply, to produce the headline counts + per-feature list.
**Example:**
```typescript
// Source: derived from authoring.ts (id keying) + GeoEditor.features Map semantics
// Features are keyed by `feature.id` (string) — GeoEditor.features is Map<string, EditorFeature>
// (GeoEditor.ts:1113 `this.features.set(normalized.id, normalized)`).
export interface DatasetDiff {
  added: EditorFeature[]      // ids not in current
  modified: { before: EditorFeature; after: EditorFeature }[]  // same id, geometry/props/style changed
  deleted: EditorFeature[]    // current ids absent from proposed (delete intent only)
}

export function classifyMutation(
  current: EditorFeature[],
  proposed: EditorFeature[],
  intent: MutationIntent,
): DatasetDiff {
  const currentById = new Map(current.map((f) => [f.id, f]))
  // ... add = proposed id ∉ currentById
  // ... modify = same id, deep-unequal geometry OR canonical style props OR properties
  // ... delete = current id ∉ proposed (only when intent === 'delete')
}
```
Note: a single tool call carries ONE `MutationIntent` today (`add`/`modify`/`delete`), so a `writeGeoJSON` append is intent:'add' even if some ids collide — the dedup-by-id path already skips collisions (`authoring.ts:329-337`). The diff must treat a same-id write under a `modify` verb as modify; under the current `add` append path a colliding id is a *skippedDuplicate*, not a modify. `[VERIFIED: authoring.ts:324-345, GeoEditor.ts:1111-1126]`

### Pattern 2: Buffer-then-apply async gate (the central design)
**What:** For AI calls, intercept *before* the synchronous facade runs. Build the proposed result, classify, and either apply now or await user confirmation.
**When to use:** All AI authoring entrypoints (run_code replay, the editor-writer tools, the primitive tools, OSM import).
**Example (run_code replay — the trickiest, currently sync at `runCode.ts:258-278`):**
```typescript
// Today (runCode.ts): replays recorded calls SYNCHRONOUSLY in a for-loop.
// The handler is already `async`, so it CAN await a gate.
// Proposed: before replaying, dry-run the recorded batch against a clone to compute the
// proposed feature set, classify, and gate. On Apply, replay for real.
const gate = createAuthoringGate(editor, { safetyLevel, emitDiffBlock })
const decision = await gate.review(result.recordedCalls)   // classify + (maybe) await Apply/Cancel
if (decision === 'cancelled') return { ok: true, counts: emptyCounts(), cancelled: true, ... }
// apply for real through createAuthoring as today
```
`[VERIFIED: runCode.ts:192 (handler is async), runCode.ts:258-278 (sync replay loop)]`

### Pattern 3: Separate dataset snapshot stack (D-10, SAFE-06)
**What:** A `DatasetSnapshotManager` holding `{ features: EditorFeature[]; collectionMeta: CollectionMeta; label: string; timestamp }` entries — one per confirmed apply (D-11).
**When to use:** Push a snapshot just before each gated apply; pop on undo.
**Hooking Cmd+Z:** `GeoEditor.undo()` (`GeoEditor.ts:1510`) currently delegates to `HistoryManager` and replays geometry `HistoryAction`s. To make "Undo last AI edit" feel native, the snapshot manager must be consulted *first* on undo: if the top of the dataset-snapshot stack corresponds to the most recent AI apply, restore it (call `editor.setFeatures(snapshot.features)` + `setCollectionMeta(snapshot.collectionMeta)`) instead of/in addition to the geometry undo. The keyboard handler is wired at `GeoEditor.ts:623-625` (`redo()`/`undo()` on Cmd+Z / Cmd+Shift+Z). `[VERIFIED: GeoEditor.ts:623-625, 1510-1525, 1493-1508; metadataSlice.ts setCollectionMeta]`

### Anti-Patterns to Avoid
- **Making the Authoring facade async to await the gate.** Breaks the synchronous `MutationResult` contract, `run_code`'s replay loop, and the primitives tools. The async boundary already exists at the chat loop — use it.
- **Snapshotting via full deep clone of the whole dataset on every apply with no bound.** This is the Phase-4 OOM class. See Snapshot Strategy below — use a bounded stack depth and shallow-by-reference where features are immutable.
- **Classifying against the model's compacted `data.features` view.** SAFE-05's whole point: the model sees a compacted/sampled snapshot (`run_code` `buildReadSnapshot`, and the prompt-path summarization in `helpers.ts:1235` only sends `sampleIds`/counts). The host must classify and "fix all" against `editor.getAllFeatures()`. `[VERIFIED: helpers.ts:1235-1270 summarizeFeaturesForPrompt sends sampleNames/sampleIds only]`
- **Gating `setDatasetMetadata`.** It is intentionally a non-geometry, non-gated benign op (`authoring.ts:241-252`, `runCode.ts:80-86`). Keep it ungated — but DO include metadata in the snapshot so undo restores a renamed dataset (D-10 covers metadata edits).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Collapsible transcript block + summary headline | A new disclosure component from scratch | Clone `CodeRunDisclosure.tsx` structure (useState open toggle, ▸/▾, summary line, max-h scroll panels) | D-04 explicitly wants visual consistency; the idiom is proven and styled. `[VERIFIED: CodeRunDisclosure.tsx]` |
| Encrypted persistence of safety level | A bespoke localStorage writer | Add a field to `ChatSettingsSnapshot` + `migrateV1ToV2` | Inherits encrypt-to-self, NIP-46 async signer handling, version migration, account-swap guards — all already hardened in Phase 1. `[VERIFIED: settingsStorage.ts, useChatSettingsSync.ts]` |
| "Which feature changed" detection | A custom geometry-equality walker | Compare by id first; deep-equal only the matched pairs (geometry + the canonical style keys already enumerated in `CANONICAL_STYLE_KEYS` + `properties`) | The canonical style key set is already a single source (`api/styleOptions.ts`); reuse it so the diff and the styling code agree. `[VERIFIED: index.ts exports CANONICAL_STYLE_KEYS]` |
| Iterating "the full dataset" | Reading the model's context array | `editor.getAllFeatures()` (returns `Array.from(this.features.values())`) | This is the canonical, un-compacted set keyed by id. `[VERIFIED: GeoEditor.ts:1155-1157]` |

**Key insight:** The seam is already built and proven. The dominant risk is *re-architecting* something that should be a thin wrapper. The gate is an orchestration layer over existing primitives, not new infrastructure.

## Runtime State Inventory

> This is a feature phase, not a rename/refactor/migration. A full runtime-state inventory (stored data keys, OS registrations, secret renames) does not apply. The one persistence touch-point:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `safetyLevel` field added to the encrypted `earthly.chat-settings.v1` envelope (localStorage, per-pubkey). Existing envelopes lack it. | Code edit: default `safetyLevel` to `2` in `migrateV1ToV2` so existing envelopes hydrate to the default (D-09) without a decrypt failure. No data migration of existing ciphertext needed — `loadEncryptedChatSettings` already routes missing fields through migration defaults. `[VERIFIED: settingsStorage.ts:61-118]` |
| Live service config | None — nothing leaves the client. | None — verified: this phase is client-only; no relay/Nostr writes (the boundary test forbids Nostr imports under `api/`). |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. | None — verified: no new env vars; `env.schema.ts` untouched. |
| Build artifacts | None. | None — no new packages, no build graph change. |

## Common Pitfalls

### Pitfall 1: Async gate vs synchronous facade contract
**What goes wrong:** Attempting to `await` user confirmation inside `authoring.addFeature` / `runInterceptors`, forcing the whole facade async.
**Why it happens:** The interceptor scaffold *looks* like the natural gate point (its doc comment even says "Phase 5 will use this for the safety gate").
**How to avoid:** Use the interceptor for *classification/intent tagging only* (it returns `{ intent }` synchronously). Put the *async confirm + buffer* at the chat apply path (`AuthoringGate`), which is already `async`.
**Warning signs:** `MutationResult` becoming `Promise<MutationResult>`; `run_code` replay loop needing `await` per call; A3 boundary test or `authoring.test.ts` breaking en masse.

### Pitfall 2: Classifying/"fix all" against the model's compacted view (SAFE-05 regression)
**What goes wrong:** "Fix all descriptions" silently skips features the model never saw because the model's context only had `sampleIds` (≤6) + counts.
**Why it happens:** `summarizeFeaturesForPrompt` (`helpers.ts:1235`) and `run_code`'s read snapshot send a *sampled/compacted* view to the model on purpose (privacy + token budget).
**How to avoid:** A "fix all" must be a **host-side rule** that iterates `editor.getAllFeatures()` by id; the model supplies the *rule* (e.g. a predicate / transform), not the *feature list*. Tools shipping in Phase 6 (TOOLS-02 batch attribute edit) will rely on this seam — SAFE-05 is the guarantee that lands here first.
**Warning signs:** A bulk tool that accepts a `features` array argument from the model rather than computing over the editor's full set.

### Pitfall 3: Snapshot memory pressure (the Phase-4 OOM class)
**What goes wrong:** Pushing a full deep-clone of a large `EditorFeature[]` on every apply, unbounded, OOMs the tab.
**Why it happens:** `HistoryManager` already does `features.map(f => ({...f}))` shallow copies and keeps up to 100 entries — a whole-dataset snapshot multiplies that.
**How to avoid:** See Snapshot Strategy. Bound the stack depth (small, e.g. 10–20 apply-snapshots), and since `EditorFeature` objects are replaced (not mutated in place) by `setFeatures`/`updateFeature` — they `set(id, normalized)` a fresh object — a snapshot can hold *references* to the feature objects at snapshot time plus a structural copy of the id→feature map, not a deep clone of every coordinate array.
**Warning signs:** Snapshot size scaling with coordinate count × apply count; no cap on stack depth.

### Pitfall 4: WR-04 — uncapped recorded-call write channel
**What goes wrong:** Untrusted sandbox code pushes a huge number of `addFeature` calls (or one giant `writeGeoJSON`); the worker accumulates them all and the host replays synchronously — a DoS on the write path the console cap doesn't cover.
**Why it happens:** `recordedCalls` is `args: argHandles.map((h) => vm.dump(h))` with no bound (sandbox.worker.ts:130-133, per 04-REVIEW WR-04).
**How to avoid:** Cap the number of recorded calls and/or total serialized arg bytes in the worker (append truncation marker / fail the run), mirroring the console cap; reject over-budget batches before replay in `runCode.ts`. This phase OWNS the interceptor seam and the gate, so the cap is in-scope here.
**Warning signs:** A run that records thousands of calls completing without a bound; replay loop time scaling unboundedly.

### Pitfall 5: A3 boundary test only covers `addFeature`
**What goes wrong:** New `modifyFeature`/`deleteFeatures` create new bypass holes (`editor.updateFeature(`/`editor.deleteFeatures(` called directly outside `api/`).
**Why it happens:** The A3 test (`boundary.test.ts:90-110`) currently only forbids direct `.addFeature(` outside `api/` + `GeoEditor.ts`; modify/delete were explicitly deferred (test comment lines 59-70).
**How to avoid:** When adding the verbs, tighten the A3 scan to all four verbs (`addFeature`, `setFeatures`, `updateFeature`, `deleteFeatures`/`deleteFeature`) outside the allowed homes, and update the geometry-only surface assertion (`boundary.test.ts:135-143`) to include the new method names.
**Warning signs:** New facade methods landing without the A3 test updated; direct `editor.updateFeature(` calls in chat/UI code passing the build.

## Code Examples

### Adding `modifyFeature` / `deleteFeatures` to the facade (Phase-2-deferred surface)
```typescript
// Source: pattern mirrored from authoring.ts addFeature (lines 262-287) + GeoEditor.ts:1119-1149
// In createAuthoring(editor):
function modifyFeature(featureId: string, feature: Feature, source = DEFAULT_SOURCE): MutationResult {
  const existing = editor.getFeature(featureId)
  if (!existing) return { ok: false, intent: 'modify', featureIds: [], counts: emptyCounts() }
  const usable = coerceToFeature(feature)
  if (!usable) throw new Error(`authoring.modifyFeature: ${describeUnusableFeature(feature)}.`)
  const normalized = toEditorFeature(usable, source)
  const { intent } = runInterceptors({ intent: 'modify', featureIds: [featureId] })
  editor.updateFeature(featureId, { ...normalized, id: featureId })  // preserve id
  return { ok: true, intent, featureIds: [featureId], counts: { ...emptyCounts(), updated: 1 } }
}

function deleteFeatures(featureIds: string[]): MutationResult {
  const present = featureIds.filter((id) => editor.getFeature(id) !== undefined)
  const { intent } = runInterceptors({ intent: 'delete', featureIds: present })
  editor.deleteFeatures(present)   // GeoEditor records history + emits 'delete'
  return { ok: true, intent, featureIds: present, counts: { ...emptyCounts(), deleted: present.length } }
}
```
Both must be added to the `Authoring` interface (`authoring.ts:177-255`) and the returned object (`authoring.ts:434-442`), and to `REPLAYABLE_AUTHORING_OPS` in `runCode.ts:80-86` AND the worker's `AUTHORING_METHODS` so the sandbox can call them (only if Phase 6 needs sandbox-driven modify/delete; otherwise keep them host-tool-only). `[VERIFIED: authoring.ts:177-255, 434-442; runCode.ts:80-86]`

### Adding the safety level to encrypted settings
```typescript
// Source: store.ts:158-183 (ChatSettingsSnapshot/DEFAULT) + settingsStorage.ts:61 (migrateV1ToV2)
export interface ChatSettingsSnapshot {
  // ...existing fields...
  safetyLevel: 1 | 2 | 3   // SAFE-04 / D-09
  version?: 2
}
export const DEFAULT_CHAT_SETTINGS: ChatSettingsSnapshot = {
  // ...existing...
  safetyLevel: 2,           // shipped default (D-09)
  version: 2,
}
// In migrateV1ToV2: default a missing/invalid safetyLevel to 2.
const safetyLevel =
  parsed.safetyLevel === 1 || parsed.safetyLevel === 3 ? parsed.safetyLevel : 2
```
The sync hook (`useChatSettingsSync.ts:13-26 buildSnapshot`) must add `safetyLevel` to the snapshot it reconstructs, and the store must expose a `setSafetyLevel` action. The "Just accept" toggle (D-12) sets `safetyLevel = 3` (and toggling off restores `2`). `[VERIFIED: store.ts:158-183, settingsStorage.ts:61-118, useChatSettingsSync.ts:13-26]`

### Binding chip data source (D-01..D-03)
```typescript
// Source: metadataSlice.ts:9-17 + store/types.ts:130-140,156-176
// Identity = collectionMeta.name (or "Untitled draft"), unsaved-draft state, feature count.
const { collectionMeta, features, activeGeoEditDraftId, isDirty } = useEditorStore()
const isUnsavedDraft = activeGeoEditDraftId !== null   // an open draft, not a published dataset
const chip = {
  name: collectionMeta.name || 'Untitled draft',
  unsaved: isUnsavedDraft || isDirty,
  featureCount: features.length,   // mirror of editor.getAllFeatures(), kept fresh by Editor.tsx
}
```
Confirmed available fields: `collectionMeta` = `{ name, description, color, customProperties }` (metadataSlice.ts:9-14). `features` is the read-mirror updated on every `create`/`update`/`delete`/`features.replace` event (Editor.tsx:72-77). `activeGeoEditDraftId` + `geoEditDrafts` track draft identity (store/types.ts:178-203). `isDirty` tracks unsaved changes (metadataSlice.ts:16). `[VERIFIED: metadataSlice.ts, store/types.ts, Editor.tsx:51,72-77]`

## State of the Art

| Old Approach (pre-Phase-5) | Current Approach (this phase) | When Changed | Impact |
|----------------------------|-------------------------------|--------------|--------|
| `runInterceptors` is an empty-chain no-op pass-through | Interceptor chain carries a classify/intent-tag interceptor; async gate lives at chat layer | Phase 5 | The seam was *designed* for this (interceptor.ts doc comment); no restructuring of the facade. |
| Facade exposes only add/write/circle/buffer (all intent:'add') | Facade also exposes modify/delete (intent:'modify'/'delete'), A3 tightened | Phase 5 | Completes the Phase-2-deferred surface; enables real classification + Phase 6 bulk tools. |
| Geometry-only undo (`HistoryManager`) | + dataset-level snapshot stack covering meta/style/translation | Phase 5 | Undo now reverts an AI apply as a whole, including property/style/rename edits. |
| Recorded-call channel uncapped (WR-04) | Capped at the worker + rejected pre-replay | Phase 5 | Closes the asymmetric write-path DoS. |

**Deprecated/outdated:** Nothing removed. The interceptor scaffold and the deferred A3 note (`boundary.test.ts:59-70`) are *completed*, not replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `EditorFeature` objects are replaced wholesale (not mutated in place) by `setFeatures`/`updateFeature`, so a snapshot can hold references rather than deep clones for most fields | Snapshot Strategy / Pitfall 3 | If some manager mutates a feature object in place, a reference snapshot would be corrupted; mitigate by structural-copying the id→feature map and treating geometry as immutable (it is replaced via `set(id, normalized)` at GeoEditor.ts:1113/1123). Verify during planning by grepping for in-place `feature.geometry =` / `feature.properties.x =` mutations. |
| A2 | MapLibre internals are untouched by snapshot/undo (operate on `EditorFeature[]` only) | Standard Stack | Low — `setFeatures` already re-renders the map from the feature set (GeoEditor.ts:1493-1508). |
| A3 | The model supplies a *rule* for "fix all", not a feature list, for SAFE-05 | SAFE-05 / Pitfall 2 | If Phase 6's batch tool is designed to take a feature array from the model, SAFE-05 is violated; this phase should land the host-side-iteration seam so Phase 6 can only express rules. |
| A4 | Adding `safetyLevel` to `ChatSettingsSnapshot` with a migration default is non-breaking for existing encrypted envelopes | Code Examples / Runtime State | Low — `migrateV1ToV2` already tolerates missing fields and never throws on garbage (settingsStorage.ts:61). |
| A5 | `modifyFeature`/`deleteFeatures` need NOT be exposed to the sandbox worker in this phase (host-tool-only is sufficient for SAFE-01..06) | Code Examples | If a Phase-5 acceptance test drives modify/delete through `run_code`, the worker `AUTHORING_METHODS` + `REPLAYABLE_AUTHORING_OPS` must also be extended. Decide during planning based on the UAT script. |

## Open Questions

1. **Does "fix all" (SAFE-05) ship a concrete tool this phase, or only the host-side seam?**
   - What we know: SAFE-05 requires host-side iteration by id; TOOLS-02 (the actual batch attribute-edit tool) is Phase 6.
   - What's unclear: whether Phase 5 must demonstrate a working "fix all" end-to-end or just prove the seam (a host-side rule runner over `getAllFeatures()`).
   - Recommendation: Land the host-side rule-runner seam + one proof (e.g. a host-side "set property X on all features matching predicate" exercised in a test) so the SAFE-05 guarantee is verifiable; defer the model-facing batch tool to Phase 6.

2. **Undo precedence between the dataset-snapshot stack and `HistoryManager` on Cmd+Z.**
   - What we know: `GeoEditor.undo()` currently replays geometry `HistoryAction`s; the new stack must take precedence for AI applies (D-10/D-11).
   - What's unclear: behavior when a user makes manual geometry edits *between* AI applies (interleaving the two stacks).
   - Recommendation: Define a single ordered timeline — push a dataset snapshot only for *gated AI applies*; on undo, if the most recent action is an AI apply, restore its snapshot; otherwise fall through to geometry undo. Make this explicit in the plan and cover with a test interleaving a manual edit and an AI apply.

3. **Should the gate buffer at the *batch* level (whole tool call) or *per recorded call* for run_code?**
   - What we know: `run_code` can record many calls; D-11 says one undo step per confirmed apply.
   - Recommendation: Treat the whole tool call (the full recorded batch / the single handler invocation) as ONE apply unit → one diff block → one snapshot → one undo step. This matches D-11 ("the unit the user confirmed") and bounds the diff to one transcript block.

## Environment Availability

> Skipped — this phase has no external runtime dependencies. It is client-only TypeScript/React against existing in-repo seams, built and tested with the already-installed Bun toolchain. No CLI tools, services, runtimes, or network endpoints are introduced.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (`bun:test`) `[VERIFIED: package.json scripts.test, *.test.ts]` |
| Config file | none — Bun discovers `*.test.ts(x)` automatically |
| Quick run command | `bun test src/features/geo-editor/api src/features/chat/safeEditing` |
| Full suite command | `bun test` |

Additional gates per CLAUDE.md / tsc baseline memory: `bun run build` (must pass) and `bun run lint` (Biome). `tsc --noEmit` has a ~305-error pre-existing baseline — do NOT treat it as a gate; the gates are `bun test` + `bun run build` + Biome.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-01 | Auto-bind to open draft; auto-create-and-bind when none; chip reflects identity | unit | `bun test src/features/chat/safeEditing/binding.test.ts` | ❌ Wave 0 |
| SAFE-02 | classifyMutation buckets add/modify/delete by id (incl. geometry/style/prop change) | unit | `bun test src/features/geo-editor/api/diff.test.ts` | ❌ Wave 0 |
| SAFE-03 | Gated apply buffers + renders diff; Apply commits, Cancel discards | unit (gate logic) + render-proof | `bun test src/features/chat/safeEditing/AuthoringGate.test.ts` | ❌ Wave 0 |
| SAFE-04 | safetyLevel persists through encrypt→decrypt round-trip; Level 1/2/3 gate correctly | unit | `bun test src/features/chat/settingsStorage.test.ts` (extend) | ⚠️ extend existing |
| SAFE-05 | "fix all" rule iterates editor.getAllFeatures() — proves out-of-context features are included | unit | `bun test src/features/chat/safeEditing/fixAll.test.ts` | ❌ Wave 0 |
| SAFE-06 | Dataset snapshot/undo restores geometry AND metadata/style; one undo per apply | unit | `bun test src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts` | ❌ Wave 0 |
| A3 (regression) | No direct editor.updateFeature/deleteFeatures outside api/ + GeoEditor core | unit | `bun test src/features/geo-editor/api/boundary.test.ts` (tighten) | ⚠️ extend existing |
| WR-04 (regression) | Recorded-call batch over budget is capped/rejected before replay | unit | `bun test src/features/chat/sandbox/runCode.test.ts` (extend) | ⚠️ extend existing |

### Sampling Rate
- **Per task commit:** `bun test <touched test dir>` + `bun run lint` on changed files.
- **Per wave merge:** `bun test` (full) + `bun run build`.
- **Phase gate:** Full `bun test` green + `bun run build` green + Biome clean before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/features/geo-editor/api/diff.test.ts` — covers SAFE-02 (classification by id)
- [ ] `src/features/chat/safeEditing/AuthoringGate.test.ts` — covers SAFE-03 (buffer/apply/cancel) + Level 1/2/3 gating (SAFE-04 behavior)
- [ ] `src/features/chat/safeEditing/binding.test.ts` — covers SAFE-01 (auto-bind/auto-create)
- [ ] `src/features/chat/safeEditing/fixAll.test.ts` — covers SAFE-05 (host-side full-set iteration)
- [ ] `src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts` — covers SAFE-06 (snapshot/undo incl. metadata)
- [ ] Extend `boundary.test.ts` — tighten A3 to all verbs + new geometry-only surface assertion
- [ ] Extend `settingsStorage.test.ts` — safetyLevel migration + round-trip
- [ ] Extend `runCode.test.ts` — recorded-call cap (WR-04)
- [ ] Headless editor harness already exists: `src/features/geo-editor/core/test-harness.ts` (`createHeadlessEditor`) — reuse for diff/snapshot/gate tests. `[VERIFIED: boundary.test.ts:5 imports createHeadlessEditor]`

## Security Domain

> `security_enforcement` not disabled in config (treated as enabled). This phase is itself a security control (the safety gate), so the security analysis is central, not incidental.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | The whole phase: a single trust boundary (the gate) between "AI proposes" and "editor applies". Defense-in-depth: the host-side `REPLAYABLE_AUTHORING_OPS` allow-list (runCode.ts:80) stays the last line even if the worker surface drifts. |
| V5 Input Validation | yes | Facade already throws-not-silently on non-geometry (`describeUnusableFeature`); new modify/delete verbs must validate ids (no-op on unknown id, not crash) and reuse `coerceToFeature`. |
| V11 Business Logic / Anti-automation | yes | WR-04 recorded-call cap is an anti-automation/DoS control on the write path. Safety levels are a business-logic gate on destructive ops (D-07). |
| V2 Authentication | no | No auth surface introduced. |
| V3 Session Management | no | No session surface. |
| V4 Access Control | partial | The Authoring facade boundary (V4 control from Phase 2 — no signer/wallet/store leak) MUST be preserved; new methods may not add forbidden surface (boundary.test.ts:125-149 enforces). |
| V6 Cryptography | reuse | safetyLevel rides the existing encrypt-to-self (nip44/nip04) envelope; never hand-roll crypto — reuse `settingsStorage.ts`. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted sandbox code floods the write channel (WR-04) | Denial of Service | Cap recorded calls + serialized arg bytes at the worker; reject over-budget batch before host replay. |
| Sandbox code dispatches a non-intercepted op to bypass the gate (CR-01 precedent) | Elevation of Privilege / Tampering | Keep the host-side `REPLAYABLE_AUTHORING_OPS` allow-list; `editorCommand` stays absent; any new verb added to the allow-list MUST route through `runInterceptors`. |
| Destructive AI edit applied without user awareness | Tampering / Repudiation | Safety levels gate modify/delete (D-07); even Level 3 takes a snapshot and renders the diff so the action is visible and reversible (D-12). |
| Memory exhaustion via unbounded snapshot stack | Denial of Service | Bounded snapshot stack depth + reference-not-deep-clone strategy (Pitfall 3). |
| "Fix all" silently skips out-of-context features (data-integrity surprise) | Tampering (silent partial apply) | Host-side iteration over `getAllFeatures()`; model supplies the rule, not the list (SAFE-05). |

## Sources

### Primary (HIGH confidence — read this session)
- `src/features/geo-editor/api/interceptor.ts` — the gate seam scaffold, intent enum, sync fold
- `src/features/geo-editor/api/authoring.ts` — the single mutation facade, add/write/circle/buffer, setDatasetMetadata, deferred modify/delete
- `src/features/geo-editor/api/results.ts`, `index.ts` — MutationResult/MutationCounts contract, public surface
- `src/features/geo-editor/api/boundary.test.ts` — A3 boundary + geometry-only surface assertions (deferred note)
- `src/features/geo-editor/api/interceptor.test.ts` — proves an interceptor can adjust intent
- `src/features/geo-editor/core/GeoEditor.ts` — addFeature/updateFeature/deleteFeatures/getAllFeatures/setFeatures/undo/redo, Cmd+Z wiring, features Map keyed by id
- `src/features/geo-editor/core/managers/HistoryManager.ts` — geometry-only undo stack (the pattern NOT to overload)
- `src/features/geo-editor/core/types/index.ts` — EditorFeature (incl. style props), HistoryAction
- `src/features/geo-editor/store/metadataSlice.ts`, `store/types.ts` — collectionMeta, drafts, features mirror
- `src/features/geo-editor/components/Editor.tsx` — editor→store event mirror (create/update/delete/features.replace → setFeatures)
- `src/features/chat/CodeRunDisclosure.tsx` — the collapsible transcript block idiom to clone
- `src/features/chat/tools/registry.ts`, `execute.ts`, `primitives-tools.ts`, `helpers.ts` — the AI dispatch + apply path, compaction (sampleIds), importFeaturesToEditor
- `src/features/chat/sandbox/runCode.ts` — synchronous recorded-call replay loop, REPLAYABLE_AUTHORING_OPS allow-list, async handler
- `src/features/chat/store.ts` — async tool loop (1710-1722), ChatSettingsSnapshot/DEFAULT_CHAT_SETTINGS
- `src/features/chat/settingsStorage.ts`, `useChatSettingsSync.ts` — encrypted settings persistence + migration
- `.planning/phases/04-code-interpreter-sandbox/04-REVIEW.md` — WR-04 (uncapped write channel), CR-01 (allow-list)
- `.planning/REQUIREMENTS.md`, `05-CONTEXT.md` — SAFE-01..06, locked decisions

### Secondary (MEDIUM confidence)
- `.planning/config.json` — nyquist_validation enabled; gates

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all seams read directly from current source.
- Architecture (gate location): HIGH — grounded in the actual sync/async boundary (facade sync, chat loop async, verified line-by-line).
- Pitfalls: HIGH — WR-04 from the Phase 4 review, OOM class from project memory, A3 from the live boundary test.
- SAFE-05 mechanism: MEDIUM — the host-side iteration source (`getAllFeatures()`) is verified; whether a model-facing tool ships this phase is an Open Question.

**Discrepancies found vs CONTEXT.md:** None material. CONTEXT.md describes the seams accurately. One clarification: CONTEXT.md says the interceptor is "THE gate point" — in practice the interceptor is the *classification* point (synchronous); the *async confirm gate* must live one layer up at the chat apply path. The interceptor stays the intent-tagging hook. This is the central architecture finding (Open Question / Pitfall 1), not a contradiction of the decisions.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable — in-repo seams, no fast-moving external deps)
