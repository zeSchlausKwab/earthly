---
phase: 06-ai-bulk-transform-data-driven-styling
verified: 2026-06-22T08:00:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Restyled attribute buckets render visually distinct on the map"
    expected: "After style_by_attribute on a category attribute (e.g. ports/airports/waterways), features paint with distinct colors on the MapLibre canvas — each bucket's fillColor/strokeColor is visible"
    why_human: "LayerManager paint is exercised by MapLibre GL at runtime; no unit assertion covers the visual restyle render path (06-VALIDATION.md Manual-Only #1)"
  - test: "Style props preserved after a live Nostr publish → reload round-trip"
    expected: "After restyling a dataset, publishing the kind 37515 event to the relay, and reloading the dataset from the relay, the materialized style properties (fillColor etc.) are present on the loaded features"
    why_human: "End-to-end round-trip through the live relay cannot be unit-tested; the unit STYLE-02 test covers JSON.stringify round-trip only (06-VALIDATION.md Manual-Only #2)"
---

# Phase 6: AI Bulk Transform & Data-Driven Styling Verification Report

**Phase Goal:** Gated batch attribute edit, select-by-attribute/dedup, geometry validation, and attribute-rule styling that round-trips through the Nostr event.
**Verified:** 2026-06-22T08:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Predicate engine can match features by every operator (eq/neq/exists/missing/contains/in/lt/lte/gt/gte) including A4 "missing" semantics | VERIFIED | `predicate.ts` 111 lines; `predicate.test.ts` 42 expects, 34/0 green via `bun test` |
| 2 | selectByPredicate returns the FULL matching set — never capped/sampled | VERIFIED | `selectByPredicate` is `features.filter(matchesPredicate)`; test seeds 250 features and asserts all returned |
| 3 | Duplicate features can be grouped (geometry/attributes/both) with keep-first survivor and non-survivor ids — pure, no editor reference | VERIFIED | `dedup.ts` 146 lines; `dedup.test.ts` 15 expects, all green; purity grep confirms no `editor.`/`deleteFeatures`/`GeoEditor` |
| 4 | Geometry problems (self-intersection, zero-area sliver, invalid ring) are REPORTED read-only over a feature set — no mutation, no gate | VERIFIED | `geometryValidation.ts` 164 lines; `geometryValidation.test.ts` 14 expects, all green; report shape `{ checked, withSelfIntersections, withZeroArea, invalidRings, issues }` confirmed |
| 5 | A style-only modify is distinguishable from geometry/properties modify (classifyModifyKind) and the diff headline reads "~N restyled" | VERIFIED | `diff.ts` exports `classifyModifyKind` + `ModifyKind`; `DatasetDiffDisclosure.tsx` contains `restyled` branch; `diff.test.ts` 11/0 green including classifyModifyKind block |
| 6 | The AI can set/modify properties across the FULL bound dataset by rule (declarative) or by capped id→value map (intelligence), both gated | VERIFIED | `batch_edit_features` in `bulk-tools.ts`; out-of-sample f-119 test asserts 120 features modified; intelligence cap test asserts BULK_EDIT_MAX_FEATURES=100 + skip-and-report; gate cancel-to-zero test green; 15/0 bulk-tools.test.ts |
| 7 | The AI can dedup features (delete non-survivors) through the gate as a delete intent (Level-2 confirms) | VERIFIED | `dedup_features` routes via `gateBulkApply(..., 'delete', ...)` + `deleteFeaturesById`; test asserts dedup delete-intent + cancel-to-both-present |
| 8 | The AI can apply data-driven styling by attribute buckets as ONE rule call; unmatched untouched; fallback only when supplied; unknown key rejected | VERIFIED | `style_by_attribute` uses a single `runFixAllRule` call; unmatched-untouched and fallback-only-when-supplied tests green; `normalizeStyleOptions` rejects unknown key as `InvalidStyleOptionError` |
| 9 | Materialized style props are plain `properties.*` and round-trip through `JSON.stringify` / re-parse | VERIFIED | STYLE-02 test at `bulk-tools.test.ts:437` seeds a feature, applies fillColor/fillOpacity via style_by_attribute, serializes, re-parses, asserts `p.properties.fillColor === '#0000ff'` |
| 10 | All five tools register into the typed registry via `registerBulkTools(register)` and dispatch correctly; dev and production builds succeed | VERIFIED | `registerBulkTools(register)` called in `bootstrapRegistry()` (registry.ts:1089); `bun run build` and `bun run build:production` both pass; full suite 538/0 |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---------|---------|--------|---------|
| `src/features/geo-editor/api/predicate.ts` | matchesPredicate + selectByPredicate + Predicate/PredicateOp types; min 60 lines | VERIFIED | 111 lines; all 4 exports present; boundary-clean |
| `src/features/geo-editor/api/dedup.ts` | findDuplicateGroups; min 50 lines | VERIFIED | 146 lines; exports DedupBy, DuplicateGroup, findDuplicateGroups |
| `src/features/geo-editor/api/geometryValidation.ts` | validateGeometryFeatures; min 50 lines | VERIFIED | 164 lines; exports GeometryValidationReport, validateGeometryFeatures, ZERO_AREA_THRESHOLD_M2 |
| `src/features/geo-editor/api/diff.ts` | classifyModifyKind + ModifyKind (additive) | VERIFIED | grep confirms both exports; classifyMutation untouched |
| `src/features/chat/safeEditing/DatasetDiffDisclosure.tsx` | buildDatasetDiffSummary contains `restyled` | VERIFIED | line 51: `~${changed} restyled`; fallthrough to `added · ~` preserved |
| `src/features/chat/tools/bulk-tools.ts` | registerBulkTools + BULK_EDIT_MAX_FEATURES=100; all 5 tools | VERIFIED | 530 lines; BULK_EDIT_MAX_FEATURES=100 confirmed; all 5 tool names present; type-only import from ./registry (Pitfall 4) |
| `src/features/chat/tools/schemas.ts` | Schemas for all 5 tools; no feature-list params on declarative | VERIFIED | All 5 schema names present at lines 905/964/1016/1114/1178; `NO-LIST-PARAM` grep confirms absence of featureIds/features array params |
| `src/features/chat/tools/registry.ts` | bootstrapRegistry() calls registerBulkTools(register) | VERIFIED | Line 1089: `registerBulkTools(register)` (1 occurrence) |
| `src/features/chat/safeEditing/gateBulkEdit.ts` | gateBulkApply; min 50 lines | VERIFIED | 109 lines; exported `gateBulkApply`; intent-threaded classifyMutation; undoLastDatasetSnapshot on cancel |
| `src/features/geo-editor/api/authoring.ts` | deleteFeaturesById (A3 boundary helper) | VERIFIED | Line 524 export; called by dedup tool to keep `.deleteFeatures(` literal out of chat/** |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `predicate.ts` | `boundary.test.ts` | auto-scanned api/*.ts forbidden-import enforcement | WIRED | boundary.test.ts 15/0 green; predicate.ts imports only `type EditorFeature` |
| `bulk-tools.ts` | `predicate.ts` + `geometryValidation.ts` | selectByPredicate + validateGeometryFeatures over getAllFeatures() | WIRED | imports at lines 41-47; both called in handlers |
| `bulk-tools.ts` | `runFixAllRule` (fixAll.ts) | host-over-all-ids — no features/featureIds param | WIRED | `runFixAllRule` called at lines 348, 518 for declarative batch + style |
| `dedup_features` | `authoring.deleteFeatures` via gateBulkEdit + `intent:'delete'` | `findDuplicateGroups` → `duplicateIds` → gated delete | WIRED | `gateBulkApply(editor, deps, 'delete', () => deleteFeaturesById(editor, duplicateIds))` at line 440-448 |
| `style_by_attribute` | `normalizeStyleOptions` | materialize canonical style keys per bucket | WIRED | `normalizeStyleOptions(chosen)` at line 499 |
| `registry.ts bootstrapRegistry` | `registerBulkTools(register)` | injected-register idiom | WIRED | registry.ts line 29 imports, line 1089 calls |
| `DatasetDiffDisclosure.tsx` | `classifyModifyKind` (diff.ts) | import for style-only headline special-case | WIRED | `buildDatasetDiffSummary` uses classifyModifyKind for `~N restyled` path |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|--------------|--------|-------------------|--------|
| `bulk-tools.ts` style_by_attribute | `styleProps` from `normalizeStyleOptions` | `normalizeStyleOptions(chosen)` → `properties.*` merge | Yes — materializes to `f.properties` copy via `{ ...f.properties, ...styleProps }` | FLOWING |
| `bulk-tools.ts` batch_edit_features declarative | feature properties via `runFixAllRule` | `editor.getAllFeatures()` → per-feature transform over ALL ids | Yes — writes to `f.properties` copy returned by transform | FLOWING |
| `bulk-tools.ts` select_features | `matched`, `matchedIds` from `selectByPredicate` | `editor.getAllFeatures()` full set | Yes — real editor feature list | FLOWING |
| `bulk-tools.ts` validate_geometry | `GeometryValidationReport` from `validateGeometryFeatures` | `editor.getAllFeatures()` + turf kinks/area | Yes — real geometry checks via turf | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| Full test suite green | `bun test` | 538 pass / 0 fail / 2920 expect() | PASS |
| predicate + dedup + validation unit tests | `bun test src/.../predicate.test.ts src/.../dedup.test.ts src/.../geometryValidation.test.ts` | 34/0 | PASS |
| All five bulk tools green | `bun test src/features/chat/tools/bulk-tools.test.ts` | 15/0 / 58 expect() | PASS |
| diff.test.ts classifyModifyKind + original classifyMutation | `bun test src/features/geo-editor/api/diff.test.ts` | 11/0 | PASS |
| A3 boundary scan | `bun test src/features/geo-editor/api/boundary.test.ts` | 15/0 | PASS |
| Dev build | `bun run build` | Build completed 900ms | PASS |
| Production build | `bun run build:production` | Frontend build complete | PASS |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` files declared or found for Phase 6. Step 7c: SKIPPED — no probes defined for this phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| TOOLS-02 | 06-01, 06-02, 06-04, 06-05 | Batch attribute-edit tool (set/modify by rule) | SATISFIED | batch_edit_features both modes green; out-of-sample modify asserts ALL 120 features; gate cancel-to-zero green |
| TOOLS-03 | 06-01, 06-02, 06-03, 06-04, 06-05 | Select-by-attribute + dedup tools | SATISFIED | select_features returns full set; dedup_features groups + gated delete-intent; all tests green |
| TOOLS-04 | 06-01, 06-03, 06-04 | Geometry-validation tool (read-only topology report) | SATISFIED | validate_geometry read-only; kinks/zero-area/ring-validity; no editor mutation confirmed by grep |
| STYLE-01 | 06-01, 06-03, 06-04, 06-05 | Data-driven styling as attribute rule (not per-feature) | SATISFIED | style_by_attribute one-rule-call; unmatched untouched; fallback optional; `~N restyled` headline wired; unknown key rejected |
| STYLE-02 | 06-01, 06-04, 06-05 | Applied styles persist + round-trip through kind 37515 | PARTIALLY SATISFIED | Unit round-trip (`JSON.stringify` → re-parse) proven green; live Nostr publish→reload round-trip is MANUAL (human_verification item #2) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| `gateBulkEdit.ts` | 79-84 | No try/catch around `apply()`: a throwing apply() leaves partial mutation + dangling snapshot (CR-01 from 06-REVIEW.md) | WARNING | Error path only — happy-path must-haves are green; the "cancel rolls back to zero" truth holds for explicit cancel but NOT for exceptions mid-batch |
| `bulk-tools.ts` | 104-130 | `parsePredicate` validates `field` + `op` but not `value`: `in` with missing/non-array value throws `undefined is not an object` not a self-correctable error (CR-02 from 06-REVIEW.md) | WARNING | Degrades model self-correction quality for malformed `in` clauses; does not block the happy-path must-haves |
| `gateBulkEdit.ts` | 88-98 | Empty-diff (no-op apply) pushes a snapshot, reports `applied`, accrues a phantom undo step (CR-03 from 06-REVIEW.md) | WARNING | Undo stack pollution; reported count `edited: 0` confuses model without explanation |

No TBD/FIXME/XXX debt markers found in any Phase 6 production file. The anti-patterns above are code-quality findings surfaced by the 06-REVIEW.md and are in the codebase; they are not goal-blocking for the primary must-haves.

**CR-01 impact assessment:** The must-have truth "Every destructive bulk op snapshots ONCE and Cancel rolls back to zero net mutation" is about the Cancel path, which IS implemented and tested. CR-01 affects the THROW path (unhandled exception inside `apply()`). The specific scenario — `normalizeStyleOptions` throwing on an unknown key with ≥2 matching features already processed — is partially masked by the existing test seeding only one feature. The must-have truth as written is VERIFIED for the nominal cancel path; the exception-safety gap is a code quality finding.

### Human Verification Required

#### 1. Restyled attribute buckets render visually distinct on the map

**Test:** Bind a dataset to the AI chat, run `style_by_attribute` on a category attribute (e.g. ports/airports/waterways with distinct fillColor values per bucket), accept the gate, and observe the map canvas.
**Expected:** Each attribute bucket renders with its assigned color — features in bucket "port" show one fill color, features in bucket "airport" show another; the visual distinction is visible on the MapLibre map.
**Why human:** LayerManager paint is driven by MapLibre GL at runtime; the unit tests assert that style props are materialized into `properties.*` but cannot verify that MapLibre actually reads those props and paints them visually. No headless map renderer is available in the test environment.

#### 2. Styles preserved after a live Nostr publish → reload round-trip

**Test:** Restyle a dataset with `style_by_attribute` (accept gate), then publish the dataset as a kind 37515 event to the Nostr relay. Reload the application, find the published dataset in the sidebar, load it into the editor. Inspect the loaded features.
**Expected:** The loaded features retain the materialized style properties (fillColor, fillOpacity, etc.) that were applied before publish. The `properties.*` style keys are present after the publish/reload cycle.
**Why human:** This requires a live relay (port 3334), a running Nostr signer, and a real publish→fetch→parse cycle. The unit STYLE-02 test only covers `JSON.stringify` → `JSON.parse` round-trip within the same process.

### Gaps Summary

No must-have truths are FAILED. All 10 truths verified. Two items require human verification before status can be elevated to `passed`:
- Visual rendering on the map (always requires human per 06-VALIDATION.md Manual-Only #1)
- Live Nostr round-trip (always requires human per 06-VALIDATION.md Manual-Only #2)

The three code review findings (CR-01 exception safety, CR-02 predicate value validation, CR-03 phantom snapshot) are code-quality issues that should be addressed in a follow-up. They are not goal-blocking for the phase goal as stated, but CR-01 in particular represents a correctness gap in the error path of the gate contract.

---

_Verified: 2026-06-22T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
