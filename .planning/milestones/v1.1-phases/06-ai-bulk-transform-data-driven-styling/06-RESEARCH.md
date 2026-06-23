# Phase 6: AI Bulk Transform & Data-Driven Styling - Research

**Researched:** 2026-06-21
**Domain:** AI-driven bulk feature transforms (predicate engine, batch attribute edit, data-driven styling, dedup, geometry validation) layered on the existing Authoring API + Phase 5 safe-editing gate.
**Confidence:** HIGH — every integration seam was read in source; the only genuinely-new code paths (style-aware diff headline, predicate engine surface) are small and isolated.

## Summary

Phase 6 is overwhelmingly an **integration and composition** phase, not a greenfield one. The two load-bearing primitives this phase needs already exist and were proven in Phase 5:

1. **`runFixAllRule(editor, { predicate, transform })`** (`src/features/chat/safeEditing/fixAll.ts`) is *exactly* the host-side, over-ALL-ids engine the declarative batch-edit mode (D-04a) requires. Its own docstring says: *"the model-facing bulk attribute-edit TOOL is Phase 6 (TOOLS-02) — this plan ships the host-side runner the bulk tool builds on."* This phase wires a tool on top of it.
2. **`classifyMutation`** (`src/features/geo-editor/api/diff.ts`) already buckets add/modify/delete by id AND already detects style-key changes (it iterates `CANONICAL_STYLE_KEYS`). So a materialized restyle is *already* classified `modify` (D-02) with zero classifier change. STYLE-02 round-trip is free: style props live flat in `properties.*` (`EditorFeature` interface, lines 64-83), `LayerManager` paints from `['coalesce', ['get','fillColor'], ['get','color'], …]`, and the kind-37515 `content` IS the FeatureCollection (`getFeatureCollection`/`factory.ts`). Publish → reload preserves any property, including style keys.

The genuinely new work is: (a) a small **shared predicate engine** in the AI-free Authoring API layer (D-06), consumed by three callers; (b) the **batch-edit tool** with its two modes (D-04a declarative over `runFixAllRule`, D-04b id→value map capped à la `BATCH_GEOCODE_MAX_ROWS`); (c) a **style tool** that resolves attribute buckets → materializes `normalizeStyleOptions` output per matched feature; (d) a **STYLE-AWARE diff headline** (the ONE place the existing diff falls short — `buildDatasetDiffSummary` only knows counts, not that a modify is style-only); (e) **dedup** (`select`+`delete` through the gate) and (f) read-only **geometry validation** (turf `kinks`, no gate).

**Primary recommendation:** Build a `predicate.ts` module in `src/features/geo-editor/api/` (AI-free, pure), refactor `runFixAllRule`'s `transform` to compose with declarative ops, register five tools (`batch_edit_features`, `select_features`, `dedup_features`, `validate_geometry`, `style_by_attribute`) in `src/features/chat/tools/`, route every destructive one through the SAME gate helper pattern the existing tools use, and add a `headline`/`kind` field to the diff so restyle reads `~500 restyled`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Predicate engine (D-06) | Authoring API (AI-free, `api/`) | — | Pure `properties.*` filtering; no AI/Nostr/editor-mutation. Belongs with `diff.ts`/`interceptor.ts` (D-07 boundary). |
| Declarative batch edit (D-04a) | Authoring API (`fixAll.ts` runner) | Chat tool (schema + dispatch) | Host owns the full id list (SAFE-05); tool only carries the rule. |
| Intelligence batch edit (D-04b) | Chat tool | Authoring API (`modifyFeature`) | Model computes values; host applies per id through the facade + gate. |
| Style materialization (D-01) | Authoring API (`styleOptions.ts` validate) | Chat tool (bucket resolution) | Materialize = write canonical style keys onto matched features → existing render path. |
| Dedup (TOOLS-03) | Authoring API (equality/grouping primitive) | Chat tool + gate | Pure feature comparison; deletes route through `deleteFeatures` facade. |
| Geometry validation (TOOLS-04) | Authoring API (turf wrappers) OR chat tool | — | Read-only; NO gate. Reports only (fixing is Phase 7). |
| Diff headline (style-aware) | Chat (`DatasetDiffDisclosure`) | Authoring API (`diff.ts` annotates kind) | Headline is presentation; the *classification* of "this modify is style-only" can be derived in the pure classifier and rendered by the disclosure. |

## Standard Stack

### Core (all already installed — this phase adds NO new dependency)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@turf/turf` | 7.3.5 `[VERIFIED: node -e require check]` | `kinks` (self-intersection), `booleanEqual` (geometry equality for dedup), `area` (sliver detection) | Already the curated sandbox geometry lib; `kinks`/`booleanEqual`/`area` all confirmed exported. |
| `geojson` (types) | (installed) | Feature/Geometry types | Already the type backbone of the Authoring API. |
| `bun:test` | (Bun runtime) | Unit + behavior tests | Project gate is `bun test` (CLAUDE.md). |

**Verification:** `node -e "const t=require('@turf/turf'); console.log(typeof t.kinks, typeof t.booleanEqual, typeof t.area)"` → `function function function`. `@turf/turf` package.json version `7.3.5`. `[VERIFIED: local node require]`

### Supporting (existing modules to reuse / extend)
| Module | Purpose | Disposition |
|--------|---------|-------------|
| `src/features/chat/safeEditing/fixAll.ts` (`runFixAllRule`) | Host-side over-ALL-ids rule runner (predicate+transform → `modifyFeature`) | **REUSE / lightly extend** — this is the D-04a engine. |
| `src/features/geo-editor/api/styleOptions.ts` (`normalizeStyleOptions`, `InvalidStyleOptionError`, `CANONICAL_STYLE_KEYS`) | Validate + normalize style props into canonical keys | **REUSE AS-IS** — style tool materializes through this. |
| `src/features/geo-editor/api/diff.ts` (`classifyMutation`, `isModified`) | add/modify/delete classification (already style-aware) | **EXTEND** — add style-only-modify discrimination for the headline. |
| `src/features/geo-editor/api/authoring.ts` (`modifyFeature`, `deleteFeatures`) | The single mutation seam → `runInterceptors` | **REUSE AS-IS** — bulk ops compose these. |
| `src/features/chat/safeEditing/AuthoringGate.ts` + `gateRunCode.ts` + `pendingDiffStore.ts` | Snapshot → classify → confirm → apply per safety level | **REUSE pattern** — destructive bulk tools front their apply with a gate helper. |
| `src/features/chat/tools/ingest-tools.ts` (`batch_geocode`, `BATCH_GEOCODE_MAX_ROWS=50`) | Bounded/skip-and-report batch precedent | **MIRROR** — D-04b cap + report format. |
| `src/features/geo-editor/core/test-harness.ts` (`createHeadlessEditor`) | Headless editor for unit/behavior tests | **REUSE** — already the test backbone for fixAll/authoring. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Materialize-per-feature styling (D-01, LOCKED) | Stored data-driven rule → MapLibre `match`/`case` in LayerManager | LOCKED against in CONTEXT.md Deferred; would need new 37515 slot + expression generation + precedence rules. Do NOT pursue. |
| Tiny in-house predicate engine (D-06) | A query DSL lib (jsonpath, json-logic) | CONTEXT.md says keep it minimal, NOT a full query DSL. New dependency is unjustified and a legitimacy/supply-chain risk for ~80 lines of pure code. |
| turf `kinks` for self-intersection | Hand-rolled segment-intersection sweep | Don't hand-roll — turf is installed and curated. |

**Installation:** None. `bun install` unchanged. No `## Package Legitimacy Audit` table needed — **this phase installs zero external packages.**

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────────────┐
   AI model (chat loop)   │  registry.dispatch(toolName, args)            │
        │                 │  (src/features/chat/tools/registry.ts)        │
        │ tool call       └───────────────┬──────────────────────────────┘
        ▼                                 │
 ┌──────────────────────────────┐        │  one entry per new tool, mandatory `kind`
 │ NEW chat tools (Phase 6)      │◄───────┘
 │ src/features/chat/tools/      │
 │  bulk-tools.ts:               │
 │   • batch_edit_features (D-04)│
 │   • select_features (TOOLS-03)│ ──read-only──► returns matched ids/summary (NO gate)
 │   • dedup_features (TOOLS-03) │
 │   • validate_geometry(TOOLS-04)──read-only──► turf kinks/area report (NO gate)
 │   • style_by_attribute(STYLE) │
 └───────┬──────────────────────┘
         │ destructive (modify/delete): front the apply with the gate
         ▼
 ┌──────────────────────────────────────────────┐
 │ Safe-editing gate (Phase 5, REUSE)            │
 │ AuthoringGate / gateRunCode pattern:          │
 │  snapshot → classifyMutation → safety level   │
 │  → emitDiffBlock (STYLE-AWARE headline) →     │
 │     confirm? → commit                         │
 └───────┬──────────────────────────────────────┘
         │ commit ALWAYS via facade (no bypass)
         ▼
 ┌──────────────────────────────────────────────┐        ┌───────────────────────────┐
 │ Authoring API (AI-free, api/)                 │        │ predicate.ts (NEW, D-06)  │
 │  • runFixAllRule (host over ALL ids, SAFE-05) │◄──uses─┤ matchesPredicate(feat, p) │
 │  • modifyFeature / deleteFeatures             │        │ eq/neq/exists/missing/    │
 │       → runInterceptors → editor.*            │        │ contains/in/lt/lte/gt/gte │
 │  • normalizeStyleOptions (materialize style)  │        └─────────────┬─────────────┘
 │  • classifyMutation (+ styleOnly flag, NEW)   │                      │ also consumed by
 └───────┬──────────────────────────────────────┘   ◄──────────────────┘ style buckets + dedup/select
         ▼
 ┌──────────────────────────────────────────────┐
 │ GeoEditor (full id-keyed feature Map)         │
 │  getAllFeatures() = SOURCE OF TRUTH (SAFE-05) │
 └───────┬──────────────────────────────────────┘
         ▼  feature.properties.{fillColor,strokeColor,strokeWidth,…}
 ┌──────────────────────────────────────────────┐     ┌──────────────────────────────┐
 │ LayerManager paint expressions                │     │ kind 37515 event content      │
 │  ['coalesce',['get','fillColor'],['get',…]]   │     │  = JSON.stringify(FeatureColl)│
 │  → renders materialized style, NO CHANGE      │     │  → STYLE-02 round-trip FREE   │
 └──────────────────────────────────────────────┘     └──────────────────────────────┘
```

### Recommended Project Structure
```
src/features/geo-editor/api/
├── predicate.ts            # NEW (D-06) — AI-free predicate engine; pure properties.* filtering
├── predicate.test.ts       # NEW — unit tests for every operator + edge cases
├── diff.ts                 # EXTEND — add styleOnly discrimination for the headline
├── dedup.ts                # NEW — pure duplicate-grouping + survivor selection (AI-free)
├── dedup.test.ts           # NEW
├── geometryValidation.ts   # NEW — turf kinks/area wrappers, pure report producers
├── geometryValidation.test.ts
├── styleOptions.ts         # REUSE — materialize target
└── authoring.ts            # REUSE — modifyFeature/deleteFeatures seam

src/features/chat/tools/
├── bulk-tools.ts           # NEW — registers batch_edit_features, select_features,
│                           #        dedup_features, validate_geometry, style_by_attribute
├── bulk-tools.test.ts      # NEW — behavior tests (gate flow, host-over-all-ids, cap+report)
├── schemas.ts              # EXTEND — add the 5 new OpenAI function schemas
└── registry.ts             # EXTEND — call registerBulkTools(register) in bootstrapRegistry()

src/features/chat/safeEditing/
└── fixAll.ts               # REUSE/extend — declarative batch-edit runs on runFixAllRule
```

### Pattern 1: Shared predicate engine (D-06) — AI-free, in the Authoring API layer
**What:** A pure `matchesPredicate(feature, predicate): boolean` plus a `selectByPredicate(features, predicate): EditorFeature[]`. Minimal operator set, NOT a DSL.
**When to use:** All three consumers — `runFixAllRule` predicate, style buckets, dedup/select.
**Recommended surface (minimal):**
```typescript
// Source: NEW src/features/geo-editor/api/predicate.ts (designed against EditorFeature
// properties shape in core/types/index.ts and the operators CONTEXT.md D-06 names)
export type PredicateOp =
  | { field: string; op: 'eq' | 'neq'; value: string | number | boolean }
  | { field: string; op: 'exists' | 'missing' }
  | { field: string; op: 'contains'; value: string }          // substring on string props
  | { field: string; op: 'in'; value: (string | number | boolean)[] }
  | { field: string; op: 'lt' | 'lte' | 'gt' | 'gte'; value: number }

export interface Predicate {
  /** AND of all clauses (keep it flat — no nested AND/OR DSL for v1). */
  all: PredicateOp[]
}

// `field` reads ONLY from feature.properties (dot path "a.b" optional but keep flat first).
export function matchesPredicate(feature: EditorFeature, predicate: Predicate): boolean
export function selectByPredicate(features: EditorFeature[], predicate: Predicate): EditorFeature[]
```
- `exists` = key present AND value not null/undefined; `missing` = inverse. This is the place to define **"missing" semantics for fill-if-missing** (CONTEXT.md: planner's discretion — recommend the inclusive default: absent key OR null OR `''` OR whitespace-only string counts as missing).
- Keep boolean combination to a flat AND list for v1. If the model needs OR, it can call `select_features` twice or submit multiple buckets (style tool). Do NOT build nested `and`/`or`/`not` trees in this phase — that is the "full query DSL" CONTEXT.md warns against.

### Pattern 2: Declarative batch edit (D-04a) composes the predicate engine into `runFixAllRule`
**What:** The declarative mode converts `{ predicate, set/copy/template/fillIfMissing }` into a `FixAllRule { predicate, transform }` and calls `runFixAllRule`. Host owns the list (SAFE-05). Unbounded.
**Example:**
```typescript
// Source: composition of existing runFixAllRule (fixAll.ts) + NEW predicate.ts
function declarativeRule(spec: DeclarativeSpec): FixAllRule {
  return {
    predicate: (f) => matchesPredicate(f, spec.predicate),
    transform: (f) => {
      const props = { ...(f.properties ?? {}) }
      for (const op of spec.ops) {
        if (op.kind === 'set')          props[op.field] = op.value
        if (op.kind === 'copy')         props[op.field] = props[op.source]
        if (op.kind === 'template')     props[op.field] = renderTemplate(op.template, props) // "{name} ({country})"
        if (op.kind === 'fillIfMissing' && isMissing(props[op.field])) props[op.field] = op.value
      }
      return { ...f, properties: props }
    },
  }
}
```
- **Template syntax (planner's discretion):** recommend `{propKey}` interpolation against `properties.*` only (e.g. `"{name} — {category}"`). No expressions, no function calls. A missing referenced key renders empty or is skipped — document the choice.
- Each per-feature change already routes through `modifyFeature` → `runInterceptors` inside `runFixAllRule`. **When invoked under the gate, the gate snapshots once and classifies the whole batch (D-11).** The tool must run `runFixAllRule` *inside* the gate's commit, not before it.

### Pattern 3: Intelligence batch edit (D-04b) — id→value map, bounded, mirror batch_geocode
**What:** Model submits `{ field, valuesById: { "<id>": "<newValue>", … } }`. Host validates each id exists, caps at a per-call max, applies through `modifyFeature` inside the gate, and reports skipped remainder.
**Recommended cap:** `BULK_EDIT_MAX_FEATURES = 100`. Rationale: `batch_geocode` caps at 50 because each row is a throttled ~1 req/s network lookup (≥50s/call). Intelligence edits have NO network cost per item — the bound is the model's context/output budget, not rate limiting. 100 ids of `{id: "...", value: "..."}` is a few KB of tool args, well within model output, and matches PROJECT.md user-story #4's "convoluted context" scale (hundreds, not thousands). Document the cap in the schema description and the skip-and-report message exactly like batch_geocode (`"Edited 100 of 312; rerun with the remaining ids to continue."`).
**Validation:** ids not present in `editor.getAllFeatures()` are skipped-and-counted (never a crash, mirroring `deleteFeatures` filtering). Non-string/over-cap entries beyond the limit are reported as `skippedOverCap`.

### Pattern 4: Style by attribute (D-01/D-02/D-03) — materialize buckets, free round-trip
**What:** `style_by_attribute({ buckets: [{ predicate, style }], fallback?: { style } })`. For each feature, find the first matching bucket, `normalizeStyleOptions(bucket.style)` → merge canonical style keys onto `properties`, route through `modifyFeature` (intent `modify`) under the gate. Unmatched features untouched unless `fallback` is given (D-03).
**Example:**
```typescript
// Source: composition of NEW predicate.ts + EXISTING normalizeStyleOptions (styleOptions.ts)
const transform = (f: EditorFeature): EditorFeature => {
  const bucket = buckets.find((b) => matchesPredicate(f, b.predicate))
  const chosen = bucket ?? fallback   // fallback only when caller supplied it (D-03)
  if (!chosen) return f               // unmatched + no fallback → untouched (smallest diff)
  const patch = normalizeStyleOptions(chosen.style)   // validates, throws InvalidStyleOptionError
  return { ...f, properties: { ...(f.properties ?? {}), ...patch } }
}
// run via runFixAllRule(editor, { predicate: matchesAnyBucketOrFallback, transform })
```
- **CONFIRMED no LayerManager change:** paint reads `['coalesce',['get','fillColor'],['get','color'],…]` (LayerManager.ts:199, 251, 308) — materialized props render immediately.
- **CONFIRMED STYLE-02 round-trip free:** style keys are plain `properties.*` (EditorFeature lines 64-83); 37515 `content = JSON.stringify(featureCollection)` (factory.ts:50,82; `getFeatureCollection` in cast.ts) — publish/reload preserves them. No new tag, no schema change.
- **Restyle classifies `modify` for free:** `classifyMutation`'s `isModified` already compares every `CANONICAL_STYLE_KEYS` entry (diff.ts:77) — a style-only change IS a modify today.

### Pattern 5: STYLE-AWARE diff headline (the ONE real gap)
**What:** `buildDatasetDiffSummary` (DatasetDiffDisclosure.tsx:33) only outputs `+N added · ~N changed · −N deleted`. D-02 mandates the headline read e.g. `~500 restyled` for a style-only bulk modify instead of a wall of geometry. Today nothing distinguishes a style-only modify from a geometry modify.
**Recommended approach:** Add a pure helper in `diff.ts` that, given a `{before, after}` modified pair, reports *what changed* (`'style' | 'properties' | 'geometry'`). Surface it on the `DatasetDiff.modified[]` entries OR as an aggregate `summary` field, and have `buildDatasetDiffSummary` special-case "all modifies are style-only" → `~N restyled`.
```typescript
// Source: NEW pure helper alongside isModified in api/diff.ts
export type ModifyKind = 'style' | 'properties' | 'geometry'
export function classifyModifyKind(before: EditorFeature, after: EditorFeature): ModifyKind {
  if (!deepEqual(before.geometry, after.geometry)) return 'geometry'
  // style-only iff the ONLY differing keys are in CANONICAL_STYLE_KEYS
  const changed = changedPropertyKeys(before.properties, after.properties)
  return changed.every((k) => (CANONICAL_STYLE_KEYS as readonly string[]).includes(k))
    ? 'style' : 'properties'
}
```
Then in the disclosure: if `diff.modified.length > 0 && diff.added.length===0 && diff.deleted.length===0 && every modify is 'style'` → headline `~${n} restyled`. Otherwise keep the existing counts headline. This is additive and backward-compatible with the Phase 5 tests.

### Anti-Patterns to Avoid
- **Iterating the model's compacted view.** The model sees only `summarizeFeaturesForPrompt` (capped `sampleIds`/`sampleNames`, ~6 ids). Declarative batch + style + dedup-select MUST read `editor.getAllFeatures()` (SAFE-05). `runFixAllRule` takes NO features array precisely to make this impossible — preserve that guard for the new ops.
- **O(N) per-feature recolor tool-call loop.** Explicitly forbidden (REQUIREMENTS anti-patterns table; STYLE-01). One `style_by_attribute` call with buckets, not N `modifyFeature` calls.
- **Bypassing the gate / facade.** Every modify/delete commits through `createAuthoring` → `runInterceptors`. The new tools front their apply with the gate helper exactly like `gateEditorImport`/`gateRunCodeBatch`. No `editor.updateFeature`/`editor.deleteFeatures` directly.
- **Silent truncation on the intelligence path.** D-04b/D-05 require a skip-and-report message naming the remainder (mirror `batch_geocode`'s `message`).
- **Running validation through the destructive gate.** TOOLS-04 is read-only (reports, doesn't fix — fixing is Phase 7). No snapshot, no confirm, no `modify`.
- **Adding a new intent class for restyle.** D-02 LOCKED: restyle stays `modify`. Do not thread a new MutationIntent through interceptor/diff/undo.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Self-intersection detection | Segment-sweep intersection algorithm | `turf.kinks(feature)` → `.features.length > 0` | Installed, curated, correct. |
| Geometry equality (dedup) | Coordinate-array deep compare with tolerance handling | `turf.booleanEqual(a, b)` (exact) — or the existing `deepEqual` in diff.ts for structural | turf handles geometry semantics; reuse `deepEqual` for cheap structural identity. |
| Sliver/zero-area detection | Shoelace area implementation | `turf.area(feature)` (m²) with a threshold | Installed; consistent with turf elsewhere. |
| Host-over-all-ids rule application | New iteration + facade plumbing | `runFixAllRule(editor, rule)` | Already exists, proven, SAFE-05-safe, interceptor-routed. |
| Style validation/normalization | Re-checking colors/opacities/widths | `normalizeStyleOptions()` + `InvalidStyleOptionError` | Already validates V5 ranges and rejects unknown keys for model self-correction. |
| add/modify/delete classification + style-key diff | New diff walker | `classifyMutation` (extend with `classifyModifyKind`) | Already style-aware; only the *headline* needs the new discriminator. |
| Gate snapshot/confirm/undo | New confirm flow | `createAuthoringGate` / `gateRunCodeBatch` pattern + `pendingDiffStore` | One apply unit = one snapshot = one diff block = one undo (D-11), already wired. |

**Key insight:** ~70% of this phase is composition of Phase 2 + Phase 5 primitives. The net-new pure code is the predicate engine (~80 lines), dedup grouping (~60), geometry-validation wrappers (~50), and the diff `classifyModifyKind` helper (~20). Everything else is tool registration + gate wiring + schemas.

## TOOLS-03 Dedup — Options (UNDISCUSSED; recommendation below)

**What is a duplicate?**
| Option | Definition | Pros | Cons |
|--------|------------|------|------|
| A. Identical geometry | `turf.booleanEqual` (or structural `deepEqual` on geometry) | Catches "same place imported twice" — the common OSM/import case | Two genuinely different POIs at the same point (e.g. a café above a shop) collapse |
| B. Identical attributes | predicate/key-tuple equality on chosen `properties` keys | Catches "same record, different geometry precision" | Misses geometry dupes with differing names |
| C. Both (configurable `by: 'geometry' \| 'attributes' \| 'both'`) | Model picks the equivalence | Flexible, fits the demo's "clean a convoluted context" | Slightly larger schema surface |

**Which survivor wins?**
| Option | Behavior | Note |
|--------|----------|------|
| keep-first | First in `getAllFeatures()` order survives | Deterministic, simplest |
| keep-last | Last survives | Symmetric to keep-first |
| merge-properties | Survivor gets union of group's properties (first-wins on conflict) | Most data-preserving; more complex; defer if it complicates the diff |

**Recommendation:** Implement **Option C** with `by` defaulting to `'geometry'` (the dominant real-world dupe from repeated imports), and survivor strategy `keep-first` for v1, with `merge-properties` as a documented near-term follow-up. Dedup is `select` (predicate-scoped, optional) + group + `deleteFeatures` of the non-survivors — routed through the gate as a `delete` (Level-2 confirms). Pure grouping lives in `api/dedup.ts` (`findDuplicateGroups(features, { by, keys? })`), unit-tested headless; the tool wires it to the gate. **Re-engage the user only if** they want merge-properties as the default or need cross-feature geometry tolerance (snapping near-equal coords) — both are scope-expanding and not required by the user stories.

## TOOLS-04 Geometry Validation — Options (UNDISCUSSED; recommendation below)

Roadmap says *reports* — fixing is Phase 7. Read-only, NO gate.

| Check | Cost | turf | Recommendation |
|-------|------|------|----------------|
| Self-intersection | Cheap, per-feature | `kinks()` → intersection points | **Include** — the headline check, exactly what CONTEXT.md flags as cheap. |
| Zero-area / degenerate polygon (sliver by area) | Cheap, per-feature | `area()` < threshold | **Include** — trivial add, high value for "slivers". |
| Unclosed ring / too-few-points | Cheap, per-feature | structural check (mirror `closeRing` logic in ingest-tools) | **Include** — cheap structural validity. |
| Cross-feature gaps/slivers (topology between features) | Expensive, O(N²)-ish, needs shared-edge analysis | no single turf call | **DEFER** — CONTEXT.md notes it's "materially harder"; out of proportion for the demo. State explicitly as deferred. |

**How problems surface:**
| Option | Behavior | Recommendation |
|--------|----------|----------------|
| Chat report only | Tool returns `{ featureId, issues: [...] }[]` + counts | **v1 default** — fits the read-only "report" contract; the model summarizes in chat. |
| Chat report + map highlight | Also push problem features to a transient highlight layer | Nice-to-have; the existing selection/active-style machinery could highlight, but it's extra UI surface. Defer unless cheap. |

**Recommendation:** `validate_geometry({ predicate? })` runs `kinks` + zero-area + ring-validity over `getAllFeatures()` (predicate-scoped optional), returns a structured per-feature report + aggregate counts (`{ checked, withSelfIntersections, withZeroArea, invalidRings, issues: [...] }`). **Report-only, no suggest-fix** (Phase 7 owns fixing). Chat-report surfacing for v1; map-highlight deferred. **Re-engage the user only if** they expect cross-feature gap/sliver detection in this phase (it's the expensive one explicitly flagged as harder).

## Common Pitfalls

### Pitfall 1: Bulk op runs over the model's view, not the full dataset
**What goes wrong:** "Recolor all airports" only recolors the ~6 features in the model's sample.
**Why:** The model is given `summarizeFeaturesForPrompt` (capped sampleIds), not the full list.
**How to avoid:** Build every bulk op on `runFixAllRule` (reads `getAllFeatures()`, takes no features array). For the intelligence path (D-04b) the model DOES supply ids — validate each against the full set and report skips.
**Warning sign:** A tool schema with a `features` or `featureIds` array parameter for a "rule" operation (declarative/style). That parameter should not exist for declarative modes.

### Pitfall 2: Restyle diff shows a geometry wall instead of `~N restyled`
**What goes wrong:** A 500-feature recolor emits a 500-row "Changed" list with no indication it's just color.
**Why:** `buildDatasetDiffSummary` only counts; it doesn't know the modify is style-only.
**How to avoid:** Add `classifyModifyKind` (Pattern 5) and special-case the headline. Keep the existing per-row list for the expanded view but make the collapsed headline say `~N restyled`.

### Pitfall 3: Style tool drops unknown keys silently
**What goes wrong:** Model passes `{ colour: 'red' }` (British spelling) and gets no error, no color.
**Why happens:** Without `normalizeStyleOptions`, unknown keys are dropped.
**How to avoid:** Route every style value through `normalizeStyleOptions` (it throws `InvalidStyleOptionError` listing accepted names → model self-corrects via the ToolError loop).

### Pitfall 4: New tool module imports `./registry`, crashing the dev bundler
**What goes wrong:** Bun HMR circular-init crash: "Cannot read properties of null (reading 'register')".
**Why:** `registry.ts` imports the tool module; the module importing `register` back forms a cycle.
**How to avoid:** Follow the **injected-`register` idiom** (primitives-tools.ts:117, ingest-tools.ts:486). Export `registerBulkTools(register)`; `registry.ts` calls it in `bootstrapRegistry()`. Only a *type* import of `ToolEntry` is allowed.

### Pitfall 5: Declarative batch runs before the gate, so cancel doesn't roll back
**What goes wrong:** Features mutate on disk; the "Cancel" button does nothing.
**Why:** `runFixAllRule` applies through `modifyFeature` immediately when called.
**How to avoid:** Mirror `gateRunCodeBatch` (snapshot BEFORE replay, restore via `undoLastDatasetSnapshot()` on cancel), OR run `runFixAllRule` inside the gate's `commit` for the buffer-then-apply path. Because `runFixAllRule` applies for real (not a pure dry-run), the snapshot+restore pattern (gateRunCode style) is the cleaner fit — one snapshot per bulk op = one undo step (D-11).

### Pitfall 6: dedup classified as `add`, so deletes never confirm
**What goes wrong:** Dedup deletes features at Level 2 without a confirm.
**Why:** `classifyMutation` only populates `deleted` when `intent === 'delete'` (diff.ts:122).
**How to avoid:** Pass `intent: 'delete'` to the gate for dedup so the dropped ids classify as deletions and Level-2 confirms.

## Code Examples

### Registering the bulk tools (injected-register idiom)
```typescript
// Source: pattern from src/features/chat/tools/primitives-tools.ts:117 + ingest-tools.ts:486
export function registerBulkTools(register: (entry: ToolEntry) => void): void {
  register({ name: 'style_by_attribute', kind: 'authoring-primitive',
    schema: schemaFor('style_by_attribute'), handler: async (args) => { /* gate + runFixAllRule */ } })
  register({ name: 'batch_edit_features', kind: 'authoring-primitive',
    schema: schemaFor('batch_edit_features'), handler: async (args) => { /* declarative | intelligence */ } })
  register({ name: 'select_features', kind: 'host-builtin',
    schema: schemaFor('select_features'), handler: (args) => { /* selectByPredicate, read-only */ } })
  register({ name: 'dedup_features', kind: 'authoring-primitive',
    schema: schemaFor('dedup_features'), handler: async (args) => { /* gate delete */ } })
  register({ name: 'validate_geometry', kind: 'host-builtin',
    schema: schemaFor('validate_geometry'), handler: (args) => { /* turf report, read-only */ } })
}
// In registry.ts bootstrapRegistry(): registerBulkTools(register)
```

### Gating a bulk modify (snapshot+restore, mirrors gateRunCodeBatch)
```typescript
// Source: src/features/chat/safeEditing/gateRunCode.ts:60 (adapted for a fixAll batch)
const before = editor.getAllFeatures()
editor.pushDatasetSnapshot('AI bulk edit')
const res = runFixAllRule(editor, rule)           // real, interceptor-routed
const diff = classifyMutation(before, editor.getAllFeatures(), 'modify')
emitDiffBlock(diff /* + style-aware headline */)
if (mustConfirm(getSafetyLevel(), diff)) {
  if ((await requestConfirm(handle.id)) === 'cancel') editor.undoLastDatasetSnapshot()
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-feature style via `circle`/`buffer` options only | Bulk attribute-rule styling materialized per feature | Phase 6 | One rule call, not O(N); satisfies STYLE-01 anti-pattern ban |
| Style validation inline in primitives | Shared `normalizeStyleOptions` seam | Phase 5 (UAT gap-closure) | Bulk style reuses it verbatim |
| Diff headline = raw counts | Style-aware headline (`~N restyled`) | Phase 6 (this) | D-02 mitigation for sweeping restyle previews |

**Deprecated/outdated:** None relevant. `EditorStyles` uses `any` (types/index.ts:35-49) but that's the MapLibre layer-style config, NOT per-feature style — unrelated to this phase.

## Project Constraints (from CLAUDE.md)
- **Bun, not Node:** use `bun test`, `bun <file>`, Bun APIs. Tests via `bun:test`.
- **applesauce, not NDK** for the app (geo-event cast/factory already on applesauce). Seed scripts remain on NDK — out of scope here.
- **Biome** for lint/format (not ESLint/Prettier). Run `bun run lint:fix` on touched files.
- **Gates:** `bun test` + `bun run build` + `biome` must be green (per MEMORY tsc-baseline note: `tsc --noEmit` has ~305 pre-existing errors and is NOT a gate).
- **File references** as `file_path:line_number`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `BULK_EDIT_MAX_FEATURES = 100` is a sensible intelligence-path cap | Pattern 3 | Too low → user reruns more; too high → model output bloat. Low risk — it's a tunable constant; planner/user can adjust. |
| A2 | Dedup default `by: 'geometry'`, survivor `keep-first` | TOOLS-03 | If user expects attribute-based dedup by default, results surprise them. Surfaced as an option to confirm at plan review. |
| A3 | Validation scope = self-intersection + zero-area + ring-validity; cross-feature gaps deferred | TOOLS-04 | If user wants cross-feature topology now, scope grows materially. Flagged for plan-review confirmation. |
| A4 | "missing" (fill-if-missing) = absent OR null OR empty/whitespace string | Pattern 1 | If user wants strict absent-only, some fills won't fire. Documented as the inclusive default; cheap to change. |
| A5 | Template syntax = `{propKey}` interpolation over properties only | Pattern 2 | If richer templating expected, scope grows. Kept deliberately minimal per D-06 "not a DSL". |

**These are the items the planner/discuss-phase should confirm.** A2 and A3 are the two genuinely-undiscussed requirements (TOOLS-03 dedup half, TOOLS-04) — recommend a brief user check at plan review per CONTEXT.md guidance ("re-engage the user only if real ambiguity blocks planning"). A1/A4/A5 are planner's-discretion defaults that are safe to proceed on.

## Open Questions

1. **Dedup survivor default (keep-first vs merge-properties)** — Recommendation: keep-first for v1, merge-properties documented as follow-up. Confirm at plan review if data-preservation matters for the demo dataset.
2. **Validation surfacing (chat-only vs map-highlight)** — Recommendation: chat-only v1. Map-highlight is a UI add; confirm if the user wants visual problem markers now.
3. **Whether the diff headline change risks Phase 5 test regressions** — Low: `buildDatasetDiffSummary` is additive (style headline only triggers when ALL modifies are style-only and no add/delete). Existing tests assert the counts string for mixed/geometry diffs, which is unchanged. Verify by running the Phase 5 `DatasetDiffDisclosure.test.tsx` after the change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@turf/turf` | TOOLS-04 validation, dedup geometry equality | ✓ | 7.3.5 | — (no fallback needed) |
| Bun test runner | All unit/behavior tests | ✓ | (project runtime) | — |
| `createHeadlessEditor` harness | Unit/behavior tests without MapLibre | ✓ | in-repo | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — this phase adds no external dependency.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun built-in) |
| Config file | none — Bun auto-discovers `*.test.ts` |
| Quick run command | `bun test src/features/geo-editor/api/predicate.test.ts` (per-module) |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOOLS-02 (D-06) | Predicate engine: every operator + missing/exists edge cases | unit | `bun test src/features/geo-editor/api/predicate.test.ts` | ❌ Wave 0 |
| TOOLS-02 (D-04a) | Declarative batch applies over ALL ids incl. out-of-sample (SAFE-05); set/copy/template/fillIfMissing | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ Wave 0 |
| TOOLS-02 (D-04b/D-05) | Intelligence id→value map caps at BULK_EDIT_MAX_FEATURES + skip-and-report; unknown ids skipped | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ Wave 0 |
| TOOLS-02 (gate) | Bulk modify snapshots once, classifies `modify`, Cancel rolls back to zero net mutation | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ Wave 0 |
| TOOLS-03 (select) | `selectByPredicate` returns full-set matches | unit | `bun test src/features/geo-editor/api/predicate.test.ts` | ❌ Wave 0 |
| TOOLS-03 (dedup) | Duplicate grouping by geometry/attributes/both; survivor keep-first; deletes via `delete` intent | unit + behavior | `bun test src/features/geo-editor/api/dedup.test.ts` | ❌ Wave 0 |
| TOOLS-04 | `kinks` self-intersection + zero-area + ring-validity report; read-only (no editor mutation) | unit | `bun test src/features/geo-editor/api/geometryValidation.test.ts` | ❌ Wave 0 |
| STYLE-01 | `style_by_attribute` materializes canonical keys per matched bucket; unmatched untouched; fallback only when supplied; unknown key → InvalidStyleOptionError | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ Wave 0 |
| STYLE-01 (diff) | `classifyModifyKind` → style-only modify → headline `~N restyled` | unit | `bun test src/features/geo-editor/api/diff.test.ts` (extend existing) | ✅ extend |
| STYLE-02 | Style props survive `JSON.stringify(featureCollection)` → re-parse → editor (round-trip) | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` (or geo-event round-trip test) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the touched module's `bun test src/...<module>.test.ts`.
- **Per wave merge:** `bun test` (full suite) — Phase 5 left it green (290+).
- **Phase gate:** `bun test` + `bun run build` + `biome` all green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/features/geo-editor/api/predicate.test.ts` — covers TOOLS-02 (D-06) + TOOLS-03 select
- [ ] `src/features/geo-editor/api/dedup.test.ts` — covers TOOLS-03 dedup
- [ ] `src/features/geo-editor/api/geometryValidation.test.ts` — covers TOOLS-04
- [ ] `src/features/chat/tools/bulk-tools.test.ts` — covers TOOLS-02 modes + STYLE-01 + STYLE-02 + gate flow
- [ ] extend `src/features/geo-editor/api/diff.test.ts` — covers `classifyModifyKind` / style headline
- [ ] Framework install: none — `bun:test` + `createHeadlessEditor` already present

## Security Domain

> `security_enforcement` not explicitly false in config → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in this phase (no signer/wallet reach — Authoring API boundary, T-02-03). |
| V3 Session Management | no | — |
| V4 Access Control | yes | Authoring API is the ONLY mutation path; new tools never touch `editor.*` or the Zustand store directly (A3 boundary, enforced by `boundary.test.ts`). Predicate/dedup/validation modules in `api/` import nothing from chat/registry/Nostr (D-07). |
| V5 Input Validation | yes | `normalizeStyleOptions` (V5 ranges, unknown-key rejection); predicate field/op/value validation; id existence checks; per-call caps (DoS bound, mirrors batch_geocode). |
| V6 Cryptography | no | No crypto in this phase. |

### Known Threat Patterns for AI-driven bulk transforms
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Model "fix all" silently skips out-of-context features | Tampering (data integrity) | Host-over-all-ids via `runFixAllRule` reading `getAllFeatures()`; SAFE-05. |
| Unbounded intelligence edit floods tool args / output | Denial of Service | `BULK_EDIT_MAX_FEATURES` cap + skip-and-report (mirror BATCH_GEOCODE_MAX_ROWS). |
| Destructive bulk delete (dedup) without confirm | Tampering / repudiation | Route as `intent:'delete'` through the gate → Level-2 confirm + snapshot/undo (SAFE-04/06). |
| Style/predicate injection of arbitrary property keys | Tampering | `normalizeStyleOptions` rejects unknown keys; predicate writes only the named fields via declarative ops (no arbitrary code). |
| New tool module breaching the `api/` boundary | Elevation (architecture) | `boundary.test.ts` (D-07) — predicate/dedup/validation modules import only geojson + geo-editor types. |

## Sources

### Primary (HIGH confidence — read in source this session)
- `src/features/geo-editor/api/authoring.ts` — facade verbs (modifyFeature/deleteFeatures/circle/buffer), interceptor routing.
- `src/features/geo-editor/api/interceptor.ts` / `results.ts` / `diff.ts` — gate seam, MutationResult, classifier (style-aware already).
- `src/features/geo-editor/api/styleOptions.ts` — `normalizeStyleOptions`, `CANONICAL_STYLE_KEYS`, `InvalidStyleOptionError`.
- `src/features/geo-editor/types/styleProperties.ts` + `core/types/index.ts` — canonical style keys + flat `properties.*` shape.
- `src/features/geo-editor/core/managers/LayerManager.ts` — `['coalesce',['get','fillColor'],…]` paint (confirms no LayerManager change).
- `src/lib/nostr/geo-event/cast.ts` + `factory.ts` — 37515 `content = JSON.stringify(FeatureCollection)` (confirms STYLE-02 free).
- `src/features/chat/safeEditing/{AuthoringGate,gateRunCode,gateEditorImport,pendingDiffStore,DatasetDiffDisclosure,fixAll}.ts` — gate flow + the host-over-all-ids runner this phase builds on.
- `src/features/chat/tools/{registry,schemas,ingest-tools,primitives-tools}.ts` — tool registration idioms + batch_geocode precedent.
- `src/features/geo-editor/core/test-harness.ts` + `fixAll.test.ts` — test backbone + SAFE-05 proof pattern.
- `@turf/turf@7.3.5` — `kinks`/`booleanEqual`/`area` exports verified via `node -e require`.

### Secondary (MEDIUM)
- CONTEXT.md / REQUIREMENTS.md / ROADMAP.md / Phase 02 & 05 CONTEXT — decision provenance.

### Tertiary (LOW)
- None — no WebSearch needed; all findings grounded in repo source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; turf functions verified present.
- Architecture: HIGH — every seam read in source; the host-over-all-ids runner already exists and names Phase 6 as its consumer.
- Pitfalls: HIGH — derived from explicit guards in the existing code (injected-register, host-side list, intent-gated deletes, style-aware modify).
- TOOLS-03/04 (undiscussed): MEDIUM — concrete options given with recommendations; A2/A3 flagged for user confirmation.

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable — internal codebase, no fast-moving external deps).
