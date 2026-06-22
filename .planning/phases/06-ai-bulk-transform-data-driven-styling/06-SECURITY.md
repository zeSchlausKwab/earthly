---
phase: 06
slug: ai-bulk-transform-data-driven-styling
status: open_threats
threats_found: 19
threats_closed: 17
threats_open: 2
asvs_level: 2
block_on: high
created: 2026-06-22
---

# Phase 06 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> AI-write trust boundary for the bulk-transform toolset. Untrusted AI tool-call
> arguments (predicates, declarative ops, id→value maps, style bags) enter at the
> five `bulk-tools.ts` handlers. The core properties are: (1) targeting/edits run
> host-side over `editor.getAllFeatures()` (the full id-keyed set), never the model's
> compacted sample (SAFE-05); (2) every destructive op routes through the Authoring
> facade (`runInterceptors`) and the Phase-5 safe-editing gate (snapshot → classify →
> confirm → cancel-rolls-back); (3) the pure `api/` primitives (predicate, dedup,
> geometryValidation) stay AI-free and import nothing from chat/registry/Nostr.
>
> AUDIT RESULT: 17/19 threats CLOSED. TWO threats are OPEN because the code review
> (CR-01, CR-02) proved their declared mitigations are bypassable on reachable paths.
> One of them (T-06-05e, via CR-01) is HIGH severity and meets `block_on: high`.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| AI model → chat tool args | Untrusted predicates/ops/id-maps/style bags validated at the `bulk-tools.ts` handlers (parsePredicate / parseDeclarativeOps / parseStyleBuckets / normalizeStyleOptions / id existence / cap) | tool-call JSON |
| chat tool → editor geometry | All mutations route through `createAuthoring` (`runFixAllRule` → `modifyFeature`; dedup → `deleteFeaturesById` → `deleteFeatures`) → `runInterceptors`; no raw `editor.*` write verb in `chat/**` | EditorFeature geometry/properties |
| model's compacted view → full dataset | "fix all"/"recolor all"/select/validate operate over `editor.getAllFeatures()`, never the ~15-id sample (SAFE-05); rule-mode schemas expose NO feature-list param | full id-keyed feature set |
| `api/` module graph → rest of app | predicate.ts / dedup.ts / geometryValidation.ts stay free of chat/registry/Nostr imports (confinable Phase-4 sandbox boundary, D-07) | type/code imports only |
| registry ↔ bulk-tools module | bulk-tools imports ONLY `type ToolEntry` from `./registry` (one-way edge); a value import of `register` reintroduces the Phase-2 circular-init dev-bundler crash | type import only |
| AI bulk op → snapshot → visible diff → user decision | Each destructive batch snapshots once, emits a classified diff, and (L1 / L2-destructive) awaits Apply/Cancel; cancel restores the snapshot | DatasetDiff |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Evidence | Status |
|-----------|----------|-----------|-------------|------------|----------|--------|
| T-06-01a | Tampering | Wave-0 tests as contract | mitigate | Tests assert host-over-all-ids (SAFE-05) out-of-sample modify + gate cancel-to-zero, so a later bypass cannot stay green | `bulk-tools.test.ts` (15 pass/0 fail) — out-of-sample `f-119` modify + gate cancel-to-zero assertions | closed |
| T-06-01b | DoS | Intelligence-batch cap | mitigate | bulk-tools.test pins `BULK_EDIT_MAX_FEATURES` + skip-and-report (`N of M … rerun`) from inception | `bulk-tools.ts:65,376-377,407-410`; cap test green | closed |
| T-06-02a | EoP | predicate.ts imports | mitigate | Type-only `EditorFeature` import; nothing from chat/registry/Nostr | `predicate.ts:25`; `boundary.test.ts:43-56` auto-scan GREEN (15 pass) | closed |
| T-06-02b | Tampering | predicate field/op/value | mitigate (PARTIAL) | Engine only compares, no eval; op/field shape validated at the tool boundary | `predicate.ts:59-91`; `bulk-tools.ts:104-130` — **but `value` is NOT validated (CR-02)** | OPEN (see Open Findings) |
| T-06-02c | DoS | malicious clause causing throw | mitigate (PARTIAL) | Non-string `contains` / non-numeric comparisons return false, never throw | `predicate.ts:71-87` — **but `in` with a non-array `value` throws `undefined is not an object` (CR-02), so "never-throw" is false for `in`** | OPEN (folded into CR-02 finding) |
| T-06-03a | EoP | new api/ module imports | mitigate | Type-only `EditorFeature` + turf (+optional predicate) only; auto-enforced | `dedup.ts:23`, `geometryValidation.ts:30-32`; `boundary.test.ts` GREEN | closed |
| T-06-03b | Tampering | validation accidentally mutating | mitigate | geometryValidation holds NO editor ref, returns a report only (read-only) | `geometryValidation.ts:115-164` — no editor import, returns `GeometryValidationReport`; purity grep `PURE` | closed |
| T-06-03c | Tampering (data integrity) | dedup wrong survivor / drop uniques | mitigate | Pure keep-first grouping, unit-tested; actual delete is the Wave-4 gated tool | `dedup.ts:113-146` (keep-first, consumed-set, returns groups only); `dedup.test.ts` GREEN | closed |
| T-06-04a | Tampering | Style/predicate key injection | mitigate (PARTIAL) | parsePredicate rejects unknown ops + malformed clauses with a catchable error | `bulk-tools.ts:104-130` — **rejects bad field/op but NOT bad `value` (CR-02); `in` raw-throws** | OPEN (folded into CR-02 finding) |
| T-06-04b | Tampering (SAFE-05) | "select all" over compacted view | mitigate | Handlers read `editor.getAllFeatures()` full set; schemas expose NO feature-list param | `bulk-tools.ts:287,310`; schemas grep `NO feature-list param`; `fixAll.ts:59-83` | closed |
| T-06-04c | DoS | validation over huge dataset | accept | Bounded by in-memory dataset size; no network/amplification | Accepted Risks log below; `geometryValidation.ts` per-feature in-memory only | closed (accepted) |
| T-06-04d | EoP (architecture) | bulk-tools breaching api/ boundary / registry cycle | mitigate | Type-only import back to registry; one-way edge proven by build:production | `bulk-tools.ts:55` (`import type { ToolEntry }`); `registry.ts:29,1089`; build:production green | closed |
| T-06-04e | Tampering | validate_geometry mutating under guise of report | mitigate | Handler calls only read-only `validateGeometryFeatures`; no mutation symbols | `bulk-tools.ts:304-311`; `READONLY-SO-FAR`/`PURE` greps | closed |
| T-06-05a | Tampering (data integrity) | host-over-all-ids ("fix all" skips out-of-context) | mitigate | Declarative batch + style via `runFixAllRule` (getAllFeatures, no features array); schemas omit feature-list | `bulk-tools.ts:333-350,489-520`; `fixAll.ts:59-83`; out-of-sample `f-119` test GREEN | closed |
| T-06-05b | DoS | unbounded intelligence edit | mitigate | `BULK_EDIT_MAX_FEATURES = 100` cap + skip-and-report (`skippedOverCap` counted) | `bulk-tools.ts:65,376-377,400-411` | closed |
| T-06-05c | Tampering/Repudiation | destructive dedup delete without confirm | mitigate | dedup routes through `gateBulkApply(...,'delete',...)` → Level-2 confirm + snapshot/undo; delete via facade → runInterceptors | `bulk-tools.ts:440-449`; `authoring.ts:454-465,524-525` (`deleteFeaturesById` → `deleteFeatures` → `runInterceptors`); cancel-to-both-present test GREEN | closed |
| T-06-05d | Tampering | style/predicate arbitrary key injection | mitigate | `normalizeStyleOptions` rejects unknown style keys; declarative ops write only the named field | `bulk-tools.ts:499` (`normalizeStyleOptions(chosen)`), `225-236` (ops write only `op.field`); InvalidStyleOptionError test GREEN | closed |
| T-06-05e | Tampering | bulk op bypassing gate (cancel doesn't roll back) | mitigate (PARTIAL) | gateBulkApply snapshots BEFORE apply + `undoLastDatasetSnapshot()` on cancel → zero net mutation | `gateBulkEdit.ts:76-108` — **holds for explicit cancel ONLY; a throw inside `apply()` leaves partial mutation + a dangling snapshot (CR-01)** | OPEN (see Open Findings) |
| T-06-05f | EoP (architecture) | bulk-tools breaching api/ boundary / registry cycle | mitigate | Type-only on `./registry` (Pitfall 4); proven by build:production | `bulk-tools.ts:55`; build:production green | closed |
| T-06-SC | Tampering | npm/pip/cargo installs | accept | Zero packages installed this phase | Accepted Risks log; all nine Phase-6 commits clean of package.json/lockfile changes | closed (accepted) |

Closed: 17/19. Open: 2 (T-06-05e HIGH; the CR-02 cluster T-06-02b/T-06-02c/T-06-04a, treated as one MEDIUM finding).

---

## Open Findings (declared mitigation bypassable on a reachable path)

### OPEN-06-01 — T-06-05e — gateBulkApply has no exception safety (BLOCKER, HIGH)

**Category:** Tampering / data integrity (gate contract)
**Disposition declared:** mitigate ("snapshot BEFORE apply + undoLastDatasetSnapshot() on cancel → zero net mutation")
**Status:** OPEN — the declared guarantee does not hold on the throw path.
**Source:** code review CR-01; confirmed directly against the implementation.

**Evidence:** `src/features/chat/safeEditing/gateBulkEdit.ts:76-108`. The helper does:

```
const before = editor.getAllFeatures()
editor.pushDatasetSnapshot(deps.label)   // line 79 — unconditionally pushed
apply()                                    // line 82 — can throw mid-batch, NO try/catch
const after = editor.getAllFeatures()
const diff = classifyMutation(before, after, intent)
```

There is no `try`/`catch` around `apply()` (grep for `try`/`catch` in the file returns
only doc-comment hits). If `apply()` throws partway through a real, interceptor-routed
batch:
- Every feature already iterated has been committed (writes are not buffered —
  `runFixAllRule` calls `authoring.modifyFeature` per feature: `fixAll.ts:68-80`).
- The snapshot pushed on line 79 is never popped → a phantom undo step on the bounded
  `DatasetSnapshotManager` stack.
- The "cancel rolls back to zero net mutation" guarantee (the cancel path at
  `gateBulkEdit.ts:103-106`) covers only the explicit-cancel decision, NOT the throw.

**Reachable today:** `style_by_attribute`'s transform calls `normalizeStyleOptions(chosen)`
(`bulk-tools.ts:499`) inside `runFixAllRule` inside `apply()`. `normalizeStyleOptions`
throws `InvalidStyleOptionError` on an unknown style key. With ≥2 matching features and a
bad key, the first feature(s) get restyled, then the throw aborts mid-batch — a
partially-restyled dataset plus a dangling snapshot. The existing test seeds ONE feature
(`bulk-tools.test.ts`), so it cannot observe the partial-apply / dangling-snapshot state.
The throw is caught by `dispatch()` (`registry.ts:127-135`) into a `handler_error`
ToolError (no process crash), but the editor state and undo stack are left corrupted.

**Severity HIGH rationale:** This is precisely the data-integrity class the safe-editing
gate exists to prevent on a DESTRUCTIVE, gated bulk operation. The mitigation the threat
register cites ("zero net mutation … cancel rolls back") is the protective property, and
it is violated on a model-reachable input. Meets `block_on: high`.

**Remediation (do not patch implementation here — escalated):** wrap `apply()` in
try/catch and `editor.undoLastDatasetSnapshot()` + re-throw on error so the net-zero
invariant holds for the error path; additionally validate all bucket/fallback style keys
(`normalizeStyleOptions`) up front in `parseStyleBuckets` so an unknown key is rejected
before any feature is touched.

### OPEN-06-02 — T-06-02b / T-06-02c / T-06-04a — parsePredicate never validates clause `value` (MEDIUM)

**Category:** Tampering (input validation) / DoS (matcher throw)
**Disposition declared:** mitigate ("parsePredicate rejects unknown ops + malformed
clauses with a catchable error (V5)"; "matchers are never-throw on bad values")
**Status:** OPEN — the value half of the validation is absent; the "never-throw" claim
is false for `in`.
**Source:** code review CR-02; confirmed directly against the implementation.

**Evidence:**
- `bulk-tools.ts:104-130` (`parsePredicate`) validates `field` and `op` only; it never
  validates `value`. Its own line 128 comment ("the engine's matchers are themselves
  never-throw on bad values") is false.
- The schema marks only `['field','op']` required (`schemas.ts:950,1003,1066,1165,1228`)
  and `value` has no type constraint (`schemas.ts:945-948`). So a model can legitimately
  emit `{ field:'category', op:'in' }` with no `value`.
- `predicate.ts:75` (`case 'in': return clause.value.includes(...)`) then throws
  `undefined is not an object (evaluating 'clause.value.includes')` on undefined/non-array
  `value`. The module docstring (`predicate.ts:13-14`) claims hostile clauses can never
  crash a bulk run — false for `in`.

**Impact:** The throw is caught by `dispatch()` into a structured `handler_error`
ToolError (`registry.ts:127-135`) — no crash, no data tampering, no privilege escalation.
The damage is a non-self-correctable raw error message, defeating the V5 "model
self-corrects in one shot" intent. The core anti-tampering properties of T-06-04a hold:
the engine only compares (no eval), and no arbitrary property key can be injected.

**Severity MEDIUM rationale:** Degraded model self-correction and a never-throw contract
violation, but contained by dispatch and non-destructive. Below the `block_on: high`
threshold — does not by itself block the phase.

**Remediation (escalated):** validate `value` per-op in `parsePredicate` (`in` requires
an array; `lt/lte/gt/gte` require a number; `eq/neq/contains` require a defined value)
and/or harden `matchesClause` `in` to `Array.isArray(clause.value) && clause.value.includes(...)`.

---

## Accepted Risks

| Risk ID | Threat | Rationale | Still valid? |
|---------|--------|-----------|--------------|
| T-06-04c | DoS — geometry validation over a huge dataset | Read-only per-feature turf checks (`kinks`/`area`/ring-validity) run over the dataset already held in memory; no network call, no amplification, no write. Bounded by the in-memory dataset size the user already loaded. | YES — confirmed: `geometryValidation.ts:115-164` is in-memory per-feature with no I/O; no new unbounded surface. |
| T-06-SC | Tampering — package installs (supply chain) | Phase declares zero packages installed. | YES — confirmed: none of the nine Phase-6 implementation commits (`8be3cc3`, `13acd10`, `8b0f825`, `a7a7d11`, `da29b94`, `bee00d6`, `3811477`, `f39b9f5`, `4c4b563`) touch `package.json` or any lockfile. The package.json diff vs `master` is entirely from earlier phases/migrations (NDK→applesauce, Phase-3 papaparse/exceljs, Phase-4 quickjs), not Phase 6. No Package Legitimacy Gate required. |

---

## Unregistered Flags

The `## Threat Flags` section of all five Phase-6 SUMMARY files reports "None": no new
network endpoint, auth path, file access, or unmapped schema surface appeared during
implementation. The three new tool-arg schema surfaces (`batch_edit_features`,
`dedup_features`, `style_by_attribute`) all map to registered threats
(T-06-05a/b/c/d/e). No unregistered attack surface to log.

---

## Audit Trail

- ASVS level: 2. `block_on: high`. Register authored at plan time; verified against
  implementation, not documentation.
- Verification method per disposition: `mitigate` → grep/read the cited file for the
  declared pattern AND confirm it covers all reachable entry points + ran the asserting
  test suites; `accept` → confirmed the acceptance rationale still holds against code.
- Suites run during audit: `boundary.test.ts` 15/0 (V4 access-control + A3 + D-07);
  `predicate.test.ts` 21/0; `bulk-tools.test.ts` 15/0. All green — but the green suites
  do NOT cover the two open paths (no test seeds ≥2 features for the style-throw, and no
  test sends `op:'in'` without an array `value`), which is exactly why the happy-path
  suites pass while the mitigations remain bypassable.
- Code review cross-check honored: CR-01 → OPEN-06-01 (HIGH, blocker); CR-02 →
  OPEN-06-02 (MEDIUM). CR-03 (empty-diff phantom snapshot) is an undo-stack correctness
  nit not mapped to a register threat — noted, not a security blocker.
- Implementation files were NOT modified by this audit. Only this file
  (`06-SECURITY.md`) was created.

**VERDICT:** OPEN_THREATS — 1 HIGH blocker (T-06-05e via CR-01) meets `block_on: high`.
The phase must not ship until gateBulkApply gets exception safety (and, recommended,
up-front style-key validation). OPEN-06-02 (MEDIUM) should be fixed in the same pass.
