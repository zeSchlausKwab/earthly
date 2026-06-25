---
phase: 9
slug: group-topic-37518-slimmed
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-25
updated: 2026-06-25
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test map derived from 09-RESEARCH.md §"Validation Architecture" and the six PLAN.md files.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun's built-in test runner (`bun test`) — no config file; tests colocated `*.test.ts` |
| **Config file** | none |
| **Quick run command** | `bun test src/lib/nostr/group src/lib/group src/lib/mute` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | full suite ~a few seconds (Phase-8 baseline 615 pass) |

Gates per MEMORY (`project_tsc_baseline`): `bun test` + `bun run build` + `biome check` are the authoritative gates. `tsc --noEmit` has a ~305-error pre-existing baseline and is NOT a gate.

---

## Sampling Rate

- **After every task commit:** `bun test src/lib/nostr/group src/lib/group src/lib/mute` (quick)
- **After every plan wave:** `bun test` + `bun run build` + `biome check .`
- **Before `/gsd-verify-work`:** full suite green + build green + biome clean
- **Max feedback latency:** < 30s (quick run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | GROUP-01/03/04/05/08 (RED) | T-09-01-FALSEGREEN | RED baseline asserts behavior not just imports | unit | `bun test src/lib/nostr/group/group.test.ts src/lib/group/schemaHash.test.ts src/lib/validation/schemaErrors.test.ts src/lib/mute/useMuteStore.test.ts` | ❌ W0 creates | ⬜ pending |
| 09-01-02 | 01 | 1 | GROUP-02/04/05/08/03 (RED) | T-09-01-DOS-PIN | off-thread-only gating pinned by stubs | unit | `bun test src/lib/group/attach.test.ts src/lib/group/warnNotBlock.test.ts src/lib/group/filterModes.test.ts src/lib/group/noModMinimum.test.ts src/features/groups/schemaBuilder.test.ts` | ❌ W0 creates | ⬜ pending |
| 09-02-01 | 02 | 2 | GROUP-01 | T-09-02-LEGACY / T-09-02-LINEAGE | isGroup modelVersion gate; modify preserves d; tags delegation | unit | `bun test src/lib/nostr/group/group.test.ts src/lib/nostr/tags.test.ts` | ✅ (W0) | ⬜ pending |
| 09-02-02 | 02 | 2 | GROUP-01 | T-09-02-PARSE-CRASH | barrel + useGroups; no circular-import startup crash | build | `bun test src/lib/nostr/group && bun run build` | ✅ | ⬜ pending |
| 09-03-01 | 03 | 3 | GROUP-04/05 | T-09-03-DOS-SCHEMA / T-09-03-HASH-DIVERGE / T-09-03-ERR-DOS | off-thread errors[] bounded; canonical hash verify-before-validate | unit | `bun test src/lib/validation/schemaErrors.test.ts src/lib/validation/schemaWorker.test.ts src/lib/group/schemaHash.test.ts` | ✅ (W0 + Phase-8) | ⬜ pending |
| 09-03-02 | 03 | 3 | GROUP-02/04/05 | T-09-03-BLOCK-BYPASS | off/warn/strict default-strict; warn-not-block invariant; mute local+global | unit | `bun test src/lib/group/filterModes.test.ts src/lib/group/attach.test.ts src/lib/group/warnNotBlock.test.ts src/lib/mute/useMuteStore.test.ts` | ✅ (W0) | ⬜ pending |
| 09-04-01 | 04 | 4 | GROUP-03 | T-09-04-BAD-DIALECT | builder → draft-2020-12, no $ref/$data, worker-accepted | unit | `bun test src/features/groups/schemaBuilder.test.ts` | ✅ (W0) | ⬜ pending |
| 09-04-02 | 04 | 4 | GROUP-01/03 | T-09-04-HASH-OMIT / T-09-04-A11Y | governance ladder; canonical schema-hash on save; labeled checkboxes | build | `bun run build && bun test src/features/groups` | ✅ | ⬜ pending |
| 09-04-03 | 04 | 4 | GROUP-01/03 | T-09-04-XSS-DESC | authoring flow human-verify (governance/builder/advanced/a11y/create+edit) | human | manual (checkpoint) | n/a | ⬜ pending |
| 09-05-01 | 05 | 4 | GROUP-02/04 | T-09-05-DOS-PUBLISH / T-09-05-BLOCK | c-tag write; off-thread warn replaces blocking gate | build | `bun run build && grep -c "validateDatasetForContext" src/features/geo-editor/hooks/usePublishing.ts` (==0) | ✅ | ⬜ pending |
| 09-05-02 | 05 | 4 | GROUP-02/04 | T-09-05-BLOCK | per-rule inline warnings; Publish anyway always enabled | unit+build | `bun run build && bun test src/lib/group/warnNotBlock.test.ts` | ✅ (W0) | ⬜ pending |
| 09-05-03 | 05 | 4 | GROUP-02/04 | T-09-05-WORKER-FAIL-OPEN | attach + warn + Publish anyway human-verify | human | manual (checkpoint) | n/a | ⬜ pending |
| 09-06-01 | 06 | 5 | GROUP-05/08 | T-09-06-FORGED-COORD / T-09-06-DOS-SCHEMA / T-09-06-SPAM-FLOOD | kind+sig+mute gate before render; cap/sort/filter+reason | unit+build | `bun test src/lib/group/noModMinimum.test.ts && bun run build` | ✅ (W0) | ⬜ pending |
| 09-06-02 | 06 | 5 | GROUP-06/07/08 | T-09-06-HASH-DIVERGE / T-09-06-XSS-NARRATIVE / T-09-06-LINEAGE | escape hatch (modify preserves d); sanitized narrative; comment/react | unit+build | `bun run build && bun test src/lib/nostr/group src/lib/group` | ✅ | ⬜ pending |
| 09-06-03 | 06 | 5 | GROUP-05/06/07/08 | T-09-06-* | full NO-MOD trust posture human-verify | human | manual (checkpoint) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (created by Plan 01)

- [ ] `src/lib/nostr/group/group.test.ts` — GROUP-01 governance serialization + isGroup modelVersion gate (legacy 37518 drops)
- [ ] `src/lib/group/schemaHash.test.ts` — O-03 canonical (key-order-independent) hash + verify-mismatch
- [ ] `src/lib/validation/schemaErrors.test.ts` — D-06 worker verdict carries structured errors[]
- [ ] `src/lib/mute/useMuteStore.test.ts` — device-local global mute persist (Set-dedup, key `earthly-muted-contributors`)
- [ ] `src/lib/group/attach.test.ts` — GROUP-02 `c`-discovery filter + governance!=closed lane
- [ ] `src/lib/group/warnNotBlock.test.ts` — GROUP-04 never-block invariant
- [ ] `src/lib/group/filterModes.test.ts` — GROUP-05 off/warn/strict default-strict-for-schema
- [ ] `src/lib/group/noModMinimum.test.ts` — GROUP-08 kind→sig→mute gate order, cap 50, newest-first, flip-to-closed
- [ ] `src/features/groups/schemaBuilder.test.ts` — GROUP-03 builder→draft-2020-12 compile worker-accepted
- Framework install: none needed (Bun runner present).
- DoS proof reuses the existing `src/lib/validation/schemaWorker.test.ts` (Phase 8) — no new file.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Governance ladder copy/accent + builder/advanced authoring + create/edit-in-place | GROUP-01/03 | Visual + interaction + live publish/edit | Plan 04 checkpoint (09-04-03) |
| Attach picker + per-rule amber warnings + Publish-anyway never blocks | GROUP-02/04 | Visual + interactive publish flow against a live relay | Plan 05 checkpoint (09-05-03) |
| Two-lane hierarchy, pre-render coordinate validation, off/warn/strict + reasons, mute scope, escape hatch, pin/bless, narrative, comment/react | GROUP-05/06/07/08 | Visual trust posture + cross-device mute scope + live relay | Plan 06 checkpoint (09-06-03) |

The automated layer (unit + build) covers all governance/validation/lane LOGIC; the manual checkpoints confirm the rendered UX and live publish/subscribe behavior the unit layer cannot assert.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency (checkpoint tasks are the only non-automated, each paired with automated tasks in the same plan)
- [x] Sampling continuity: no 3 consecutive code tasks without automated verify (every code task carries an automated command)
- [x] Wave 0 covers all MISSING test references (9 stub files in Plan 01)
- [x] No watch-mode flags (Bun runner runs once)
- [x] Feedback latency < 30s (quick run)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-25 (planner)
