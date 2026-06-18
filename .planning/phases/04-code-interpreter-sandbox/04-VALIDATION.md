---
phase: 4
slug: code-interpreter-sandbox
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-18
updated: 2026-06-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from RESEARCH.md `## Validation Architecture` (each CODE-0x → deterministic `bun test` proof).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` |
| **Config file** | none — Bun's built-in test runner |
| **Quick run command** | `bun test src/features/chat/sandbox` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~few seconds (timeout test uses an injectable ~200ms deadline) |

---

## Sampling Rate

- **After every task commit:** Run `bun test <touched sandbox test file>` + `bun run lint`
- **After every plan wave:** Run `bun test` (full suite) + `bun run build` (proves the worker/WASM chunk emits)
- **Before `/gsd-verify-work`:** Full suite green + the manual prod `.wasm`-serving smoke (Plan 01 Task 5)
- **Max feedback latency:** < 10 seconds (sandbox suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-02 | 01 | 1 | CODE-02 (D-02) | T-04-04/05 | curated turf surface frozen + output byte/line cap with truncation marker | unit | `bun test src/features/chat/sandbox/curatedTurf.test.ts src/features/chat/sandbox/outputCapture.test.ts` | ❌ W0 | ⬜ pending |
| 4-01-03 | 01 | 1 | CODE-01/CODE-04 | T-04-01/02/03/06 | QuickJS empty-global engine + in-VM interrupt + host watchdog + fresh-per-run teardown | build | `bun run build` (worker chunk emits) | ❌ W0 | ⬜ pending |
| 4-01-04 | 01 | 1 | CODE-01, CODE-02, CODE-04 | T-04-01/02/04/07 | confinement (fetch/DOM/localStorage/signer/wallet `undefined`) + surface enumeration + `while(true)` timeout-kill + output cap + import-boundary scan | unit | `bun test src/features/chat/sandbox/sandboxHost.test.ts` | ❌ W0 | ⬜ pending |
| 4-01-05 | 01 | 1 | CODE-01/CODE-02 | T-04-SC | QuickJS `.wasm` emits + serves under prod `Bun.serve()` (spike criterion c) | manual | `bun run build:production && bun start` smoke | n/a | ⬜ pending |
| 4-02-01 | 02 | 2 | CODE-01 (D-01) | T-04-08/10 | rows-by-handle + current features as frozen `structuredClone` view; fail-closed; model never reads rows | unit | `bun test src/features/chat/sandbox/readSnapshot.test.ts` | ❌ W0 | ⬜ pending |
| 4-02-02 | 02 | 2 | CODE-02, CODE-03, CODE-04 | T-04-09/11/12 | replay through `createAuthoring`→`runInterceptors` (no gate); full error→model; retry counter; timeouts count | unit | `bun test src/features/chat/sandbox/runCode.test.ts -t "error feedback"` | ❌ W0 | ⬜ pending |
| 4-02-03a | 02 | 2 | CODE-05 | T-04-09 | fibonacci-15-circles → `counts.created === 15` via headless editor | integration | `bun test src/features/chat/sandbox/runCode.test.ts -t fibonacci` | ❌ W0 | ⬜ pending |
| 4-02-03b | 02 | 2 | CODE-06 `[C]` | T-04-10 | Austria→Bosnia overfly: reads handle rows, returns chosen route, draws 1 feature; model-privacy seam intact | integration | `bun test src/features/chat/sandbox/runCode.test.ts -t overfly` | ❌ W0 | ⬜ pending |
| 4-03-01 | 03 | 3 | CODE-03 (D-09/10/11/12/07) | T-04-13 | collapsible read-only code+output block: collapsed summary, expand shows source/console/counts/return, truncation marker, concise error | unit (render) | `bun test src/features/chat/CodeRunDisclosure.test.tsx` | ❌ W0 | ⬜ pending |
| 4-03-02 | 03 | 3 | CODE-03 | T-04-13 | `run_code` routed through `CodeRunDisclosure` in `MessageBubble`; other tools unchanged | integration (render) | `bun test src/features/chat/` | ◐ extend | ⬜ pending |
| 4-03-03 | 03 | 3 | CODE-03/05/06 (all 4 SC) | — | live autonomous demo: fibonacci + overfly run end-to-end, transcript-clean, no freeze, read-only | manual (UAT) | live `bun dev` drive | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** No 3 consecutive code-producing tasks lack an automated `bun test` row — every CODE-0x has at least one automated proof; the two manual rows (prod `.wasm` serving, end-of-phase UAT) are the only non-automated checks and each sits adjacent to automated coverage of the same requirement.

---

## Wave 0 Requirements

- [ ] `src/features/chat/sandbox/sandboxHost.test.ts` — confinement (CODE-01), surface (CODE-02), timeout + output cap (CODE-04), import-boundary scan (CODE-01 static) (Plan 01)
- [ ] `src/features/chat/sandbox/curatedTurf.test.ts` + `outputCapture.test.ts` — curated surface + bounded output (Plan 01)
- [ ] `src/features/chat/sandbox/readSnapshot.test.ts` — D-01 frozen rows-by-handle + features, fail-closed (Plan 02)
- [ ] `src/features/chat/sandbox/runCode.test.ts` — error feedback (CODE-03) + fibonacci (CODE-05) + overfly (CODE-06) + privacy regression (Plan 02)
- [ ] `src/features/chat/CodeRunDisclosure.test.tsx` — collapsible read-only block render proof (Plan 03)
- [ ] Test fixture: an "overfly fees" dataset put into the ingest store by handle (CODE-06 input, Plan 02 Task 3)
- [ ] Framework install: `bun add quickjs-emscripten` (Plan 01 Task 1, legitimacy-gated)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| QuickJS `.wasm` asset emits + serves under prod `Bun.serve()` | CODE-01/CODE-02 | prod static-serving not exercisable in `bun test` (spike criterion c, RESEARCH Pitfall 1) | `bun run build:production` then `bun start`; drive `runSandbox("typeof fetch")`, confirm no `*.wasm` 404 and `'undefined'` returned (fallback: inlined singlefile variant) — Plan 01 Task 5 |
| Autonomous fibonacci + overfly demo, transcript-clean | CODE-03/05/06 + all 4 SC | the live agentic auto-run experience + collapsible UX are human-judged | `bun dev`; drive both headline prompts; confirm auto-run (no confirm), collapsed blocks, concise errors, self-correction, no freeze, read-only code — Plan 03 Task 3 |

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify or a justified manual + Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive code tasks without an automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10 s (sandbox suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-06-18 (pending execution)
