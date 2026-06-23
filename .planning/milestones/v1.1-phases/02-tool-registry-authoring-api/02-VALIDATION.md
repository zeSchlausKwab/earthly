---
phase: 2
slug: tool-registry-authoring-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Binding gate: Success Criterion #2 — existing write paths produce **identical map results** after migration.
> Derived from `02-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun built-in test runner (`bun:test`), Jest-compatible `expect` |
| **Config file** | none — Bun auto-discovers `*.test.ts` |
| **Quick run command** | `bun test src/features/geo-editor/api` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~10–30 seconds (first suite in repo — currently zero tests) |

> ⚠ The repo currently has **zero test files** (`.planning/codebase/TESTING.md`). This phase establishes the first test suite. Co-locate `*.test.ts` next to source. Project gates are `bun test` + `bun run build` + `biome` — `tsc` is **not** a gate (~305 pre-existing errors per MEMORY).

---

## Sampling Rate

- **After every task commit:** Run `bun test src/features/geo-editor/api` (+ the touched tool-registry tests)
- **After every plan wave:** Run `bun test` (full) + `bun run build` + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite green **and** one live-chat UAT pass confirming criterion #2 (identical map results) visually
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs assigned at planning (`NN-PP-TT`). Rows below are the requirement-level contract the planner must allocate to tasks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | — | — | Headless GeoEditor harness (mock MapLibre `map`) + shared geo fixtures | infra | `bun test src/lib/test-fixtures` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-01 | T-unknown-tool | Unknown tool name → structured hard error, not silent no-op | unit | `bun test src/features/chat/tools/registry.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-01 | — | Every advertised tool resolves to a handler (no orphan schemas) | unit | `bun test src/features/chat/tools/registry.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-02 | T-api-leak | No `editor.addFeature/setFeatures/updateFeature/deleteFeatures` calls outside `api/` + GeoEditor core | static/grep | `bun test src/features/geo-editor/api/boundary.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-02 | T-api-leak | `geo-editor/api/` imports nothing from chat / registry / Nostr (D-07) | static/grep | `bun test src/features/geo-editor/api/boundary.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-03 | — | `add_feature_to_editor` → identical editor feature set (id, source, props) before/after | golden | `bun test src/features/geo-editor/api/authoring.golden.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-03 | — | `write_geojson_to_editor` (replace + append) → identical features + dedup counts | golden | `bun test src/features/geo-editor/api/authoring.golden.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-03 | — | editor commands (delete/duplicate/merge/simplify) → identical results | characterization | `bun test src/features/geo-editor/commands.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-03 | — | Store read-mirror reflects exactly the editor's features after each op (no divergence, D-09) | integration | `bun test src/features/geo-editor/api/mirror.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | TOOLS-01 | T-radius-bound | `circle(center,radius,units)` returns Polygon with expected ring; draws + returns ids | unit | `bun test src/features/geo-editor/api/primitives.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | TOOLS-01 | T-radius-bound | `buffer(featureId,distance,units)` and `buffer(geojson,…)` both draw + return ids; `undefined`-buffer handled | unit | `bun test src/features/geo-editor/api/primitives.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | TOOLS-01 | — | circle/buffer registered as AI tools, dispatch reaches Authoring API | integration | `bun test src/features/chat/tools/registry.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | INFRA-01 (D-16) | T-unknown-tool | Handler runtime failure → typed `ToolError` fed back to model loop AND surfaced in chat UI | unit | `bun test src/features/chat/tools/errors.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All phase tests are MISSING (zero-test baseline). Wave 0 must build the harness + fixtures + stubs before behavior-preservation work begins:

- [ ] **Headless GeoEditor harness** (mock MapLibre `map`) — required for golden/mirror tests; **first-of-its-kind, allow spike time**
- [ ] `src/lib/test-fixtures/geo.ts` — shared fixtures (empty FC, single-point FC, dup-id FC)
- [ ] `src/features/geo-editor/api/authoring.golden.test.ts` — INFRA-03 before/after feature-set equality (**the binding test**)
- [ ] `src/features/geo-editor/api/primitives.test.ts` — TOOLS-01 circle/buffer
- [ ] `src/features/geo-editor/api/mirror.test.ts` — D-09 read-mirror integrity
- [ ] `src/features/geo-editor/api/boundary.test.ts` — INFRA-02 + D-07 import-boundary assertions
- [ ] `src/features/chat/tools/registry.test.ts` — INFRA-01 dispatch + unknown-tool hard error + advertise/handler coverage
- [ ] `src/features/chat/tools/errors.test.ts` — D-16 contract
- [ ] `src/features/geo-editor/commands.test.ts` — editor-command characterization

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end author-by-chat flow produces visually identical map output to pre-migration | INFRA-03 / Criterion #2 | Final "identical map results" confidence needs a human eye on the live chat + rendered map; golden tests prove the feature-set, UAT proves the render | In a dev session, run the same 3–4 representative chat prompts (add feature, write GeoJSON, draw circle, buffer a feature) used before migration; confirm map renders identically and the left sidebar/feature list updates as today |
| Live ContextVM geo server responds to `tools/list` (D-05 / A1) | INFRA-01 (hot-reload wave) | Network-dependent; cannot be unit-tested offline | At the start of the D-05 hot-reload wave, spike a real `listTools()` call against the live server. If unsupported, fall back to the existing hardcoded list and defer the wave (`checkpoint:human-verify`) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (entire suite is W0 — zero-test baseline)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
