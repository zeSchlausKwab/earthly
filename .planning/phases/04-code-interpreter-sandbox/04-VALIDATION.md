---
phase: 4
slug: code-interpreter-sandbox
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derive per-task rows from RESEARCH.md `## Validation Architecture` (each CODE-0x → deterministic `bun test` proof).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` |
| **Config file** | none — Bun's built-in test runner |
| **Quick run command** | `bun test src/features/chat/sandbox` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~TBD seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test <touched sandbox test file>`
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** TBD seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | CODE-01 | T-04-xx / — | sandbox provably cannot reach DOM/`fetch`/`localStorage`/signer/wallet | unit | `bun test <confinement test>` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Planner: expand this map so every CODE-0x requirement has at least one automated row (see RESEARCH.md `## Validation Architecture`). No 3 consecutive tasks without an automated verify.*

---

## Wave 0 Requirements

- [ ] Sandbox confinement test — extends `src/features/geo-editor/api/boundary.test.ts` for CODE-01
- [ ] Timeout-kill test — deterministic `while(true){}` termination proof for CODE-04
- [ ] Headline-script harness — 15 fibonacci circles (CODE-05) + Austria→Bosnia overfly path (CODE-06)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| QuickJS `.wasm` asset emits + serves under prod `Bun.serve()` | CODE-01/CODE-02 | prod static-serving behavior not exercisable in `bun test` (spike criterion c) | `bun run build:production` then `bun start`; load chat, run a `run_code` call, confirm sandbox executes (fallback: inlined singlefile variant) |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < TBD s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
