---
phase: 6
slug: ai-bulk-transform-data-driven-styling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 06-RESEARCH.md → "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (Bun built-in) |
| **Config file** | none — Bun auto-discovers `*.test.ts` |
| **Quick run command** | `bun test src/features/geo-editor/api/<module>.test.ts` (per-module) |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~full suite was green at 290+ tests after Phase 5 |

Headless editor harness `createHeadlessEditor` already exists (used by Phase 5 gate tests) — reuse for behavior tests; no framework install required.

---

## Sampling Rate

- **After every task commit:** Run the touched module's `bun test src/...<module>.test.ts`
- **After every plan wave:** Run `bun test` (full suite)
- **Before `/gsd-verify-work`:** `bun test` + `bun run build` + `biome` all green
- **Max feedback latency:** per-module run is sub-second; full suite seconds

---

## Per-Task Verification Map

> Filled during planning once task IDs exist (gsd-planner / gsd-nyquist-auditor). Requirement→test mapping below is the contract each task must satisfy.

| Req ID | Behavior to verify | Test Type | Automated Command | File |
|--------|--------------------|-----------|-------------------|------|
| TOOLS-02 (D-06) | Predicate engine: every operator + missing/exists edge cases | unit | `bun test src/features/geo-editor/api/predicate.test.ts` | ❌ W0 |
| TOOLS-02 (D-04a) | Declarative batch applies over ALL ids incl. out-of-sample (SAFE-05); set/copy/template/fillIfMissing | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ W0 |
| TOOLS-02 (D-04b/D-05) | Intelligence id→value map caps at BULK_EDIT_MAX_FEATURES + skip-and-report; unknown ids skipped | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ W0 |
| TOOLS-02 (gate) | Bulk modify snapshots once, classifies `modify`, Cancel rolls back to zero net mutation | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ W0 |
| TOOLS-03 (select) | `selectByPredicate` returns full-set matches | unit | `bun test src/features/geo-editor/api/predicate.test.ts` | ❌ W0 |
| TOOLS-03 (dedup) | Duplicate grouping (geometry/attributes/both); survivor keep-first; deletes via `delete` intent | unit + behavior | `bun test src/features/geo-editor/api/dedup.test.ts` | ❌ W0 |
| TOOLS-04 | `kinks` self-intersection + zero-area + ring-validity report; read-only (no editor mutation) | unit | `bun test src/features/geo-editor/api/geometryValidation.test.ts` | ❌ W0 |
| STYLE-01 | `style_by_attribute` materializes canonical keys per bucket; unmatched untouched; fallback only when supplied; unknown key → InvalidStyleOptionError | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ W0 |
| STYLE-01 (diff) | `classifyModifyKind` → style-only modify → headline `~N restyled` | unit | `bun test src/features/geo-editor/api/diff.test.ts` | ✅ extend |
| STYLE-02 | Style props survive `JSON.stringify(featureCollection)` → re-parse → editor (round-trip) | behavior | `bun test src/features/chat/tools/bulk-tools.test.ts` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/features/geo-editor/api/predicate.test.ts` — TOOLS-02 (D-06) + TOOLS-03 select
- [ ] `src/features/geo-editor/api/dedup.test.ts` — TOOLS-03 dedup
- [ ] `src/features/geo-editor/api/geometryValidation.test.ts` — TOOLS-04
- [ ] `src/features/chat/tools/bulk-tools.test.ts` — TOOLS-02 modes + STYLE-01 + STYLE-02 + gate flow
- [ ] extend `src/features/geo-editor/api/diff.test.ts` — `classifyModifyKind` / style headline
- [ ] Framework install: none — `bun:test` + `createHeadlessEditor` already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Restyled buckets render with the new colors on the map | STYLE-01 (success criterion #3) | Visual map render; LayerManager paint is exercised by MapLibre, not unit-asserted | Bind a dataset, run `style_by_attribute` on a category attribute, accept the gate, confirm ports/airports/waterways paint distinctly on the map |
| Styles preserved after publish→reload | STYLE-02 (success criterion #4) | End-to-end Nostr publish/reload involves a live relay | Restyle, publish the kind 37515 event, reload the dataset, confirm styles persist (round-trip is also asserted in unit form above) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < full-suite seconds
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
