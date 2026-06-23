---
phase: 1
slug: encrypted-settings-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-16
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` § Validation Architecture. Per-task rows are filled once plans exist (planner / nyquist-auditor).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun:test` (Bun 1.3.11 builtin) — `import { test, expect, describe } from 'bun:test'` |
| **Config file** | none — `bun test` auto-discovers `*.test.ts` (Wave 0: zero test files exist today) |
| **Quick run command** | `bun test src/features/chat/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5 seconds (pure-function suites) |

**Project gate is `bun test` + `bun run build` + `biome` — NOT `tsc --noEmit`** (tsc has ~305 pre-existing errors per project baseline). Do not introduce a tsc gate.

---

## Sampling Rate

- **After every task commit:** Run `bun test src/features/chat/`
- **After every plan wave:** Run `bun test` + `bun run lint` + `bun run build`
- **Before `/gsd-verify-work`:** Full suite green + manual UAT of the three success criteria
- **Max feedback latency:** ~10 seconds (automated); manual UAT for UI/NIP-46 paths

---

## Per-Task Verification Map

> Task IDs are assigned during planning. The planner (or gsd-nyquist-auditor) maps each task to the requirement-level behaviors below. Reference behaviors seeded from research:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | SET-01 | — | v1→v2 migration maps `customEndpoint`/`customApiKey` into `providerOverrides.custom`; lmstudio/ollama default empty | unit | `bun test src/features/chat/settingsStorage.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | SET-01 | — | `resolveProvider` returns override `baseUrl` when set, else `BUILTIN_PROVIDERS` localhost default (D-03) | unit | `bun test src/features/chat/store.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | SET-01 | — | Switching provider lmstudio→ollama→lmstudio preserves each override (no clobber) | unit | `bun test src/features/chat/store.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | SET-01 / SC-1 | T-info-disclosure | Persisted `chat-store` blob contains no `apiKey`/`baseUrl` after a settings change (partialize invariant) | unit | `bun test src/features/chat/store.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | SET-02 | — | Load transitions loading→loaded; failure→failed (not silent defaults); `null` envelope → "no settings yet" distinct from failed | behavior / UAT | `bun test` (extracted load reducer) or manual UAT | ❌ W0 / UAT | ⬜ pending |
| TBD | TBD | — | SET-02 | T-integrity | Retry re-enters generation guard; resolved stale prior load does not clobber retry result | behavior / UAT | `bun test` or manual UAT | ❌ W0 / UAT | ⬜ pending |
| TBD | TBD | — | SET-02 | T-lockout | NIP-04-only signer against `scheme:'nip44'` envelope → visible failed state, not crash | UAT | manual UAT (NIP-04-only signer) | UAT | ⬜ pending |
| TBD | TBD | — | SET-03 | T-tampering | Import validation rejects malformed JSON, unknown `provider`, missing fields; accepts v1 + v2 payloads | unit | `bun test src/features/chat/settingsExport.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | — | SET-03 | — | Export→import round-trip reproduces the same effective config | unit + UAT | `bun test src/features/chat/settingsExport.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/features/chat/settingsStorage.test.ts` — SET-01 v1→v2 migration (`migrateV1ToV2`)
- [ ] `src/features/chat/store.test.ts` — SET-01 `resolveProvider` fallback, per-type preservation, partialize secret-exclusion (SC-1)
- [ ] `src/features/chat/settingsExport.test.ts` — SET-03 import validation + export/import round-trip
- [ ] Extract pure logic into testable units: `migrateV1ToV2`, import `validateSnapshot`, `resolveProvider` (so they are unit-testable without a DOM harness)
- [ ] Framework install: **none** — `bun test` is builtin. (DOM-level hook tests would need `happy-dom` as a dev dep; otherwise cover hook/UI behavior via manual UAT — recommended given zero existing test infra.)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| NIP-46 visible loading + visible failed state | SET-02 / SC-2 | Requires a real remote (bunker) signer with relay latency/offline conditions | Connect a NIP-46 bunker signer, throttle/offline the relay, reload, observe a real loading indicator then a distinguishable "decryption failed — could not load saved settings" banner with Retry (never silent defaults) |
| Secrets absent from devtools-serialized state | SET-01 / SC-1 | Requires inspecting localStorage / devtools after live use | After changing settings, run `JSON.parse(localStorage['chat-store'])` in devtools — assert no `apiKey` / override `baseUrl` strings appear |
| Export-after-signer-rotation recovers config | SET-03 / SC-3 | Requires switching accounts/signers across a real session | Configure providers → Export (verify plaintext-secrets warning shown) → switch/rotate account → Import pasted JSON → verify provider config + keys restored |
| Clipboard export contents | SET-03 / D-10 | Clipboard read is environment-dependent | After Export, paste clipboard into an editor — confirm it is the plaintext JSON snapshot incl. API keys, and that the UI warned the clipboard holds plaintext secrets |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
