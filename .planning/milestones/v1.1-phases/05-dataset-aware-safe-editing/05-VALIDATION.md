---
phase: 5
slug: dataset-aware-safe-editing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (`bun:test`) |
| **Config file** | none — Bun discovers `*.test.ts(x)` automatically |
| **Quick run command** | `bun test src/features/geo-editor/api src/features/chat/safeEditing` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~30 seconds (full suite) |

**Additional gates (per CLAUDE.md + tsc-baseline memory):** `bun run build` must pass and `bun run lint` (Biome) must be clean. `tsc --noEmit` has a ~305-error pre-existing baseline — it is NOT a gate. The gates are `bun test` + `bun run build` + Biome.

---

## Sampling Rate

- **After every task commit:** Run `bun test <touched test dir>` + `bun run lint` on changed files
- **After every plan wave:** Run `bun test` (full) + `bun run build`
- **Before `/gsd-verify-work`:** Full suite green + `bun run build` green + Biome clean
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; rows below map each phase requirement to its automated proof. The Nyquist auditor / planner refines task-ID columns once PLAN.md tasks exist.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| SAFE-01 | Auto-bind to open draft; auto-create-and-bind when none; chip reflects identity (name / unsaved-draft / feature count) | unit | `bun test src/features/chat/safeEditing/binding.test.ts` | ❌ W0 | ⬜ pending |
| SAFE-02 | `classifyMutation` buckets add/modify/delete by feature id (incl. geometry/style/property change) | unit | `bun test src/features/geo-editor/api/diff.test.ts` | ❌ W0 | ⬜ pending |
| SAFE-03 | Gated apply buffers + renders diff; Apply commits, Cancel discards | unit + render-proof | `bun test src/features/chat/safeEditing/AuthoringGate.test.ts` | ❌ W0 | ⬜ pending |
| SAFE-04 | `safetyLevel` persists through encrypt→decrypt round-trip; Level 1/2/3 gate correctly | unit | `bun test src/features/chat/settingsStorage.test.ts` (extend) | ⚠️ extend | ⬜ pending |
| SAFE-05 | "fix all" rule iterates `editor.getAllFeatures()` — proves out-of-context features are included | unit | `bun test src/features/chat/safeEditing/fixAll.test.ts` | ❌ W0 | ⬜ pending |
| SAFE-06 | Dataset snapshot/undo restores geometry AND metadata/style/translation; one undo per apply | unit | `bun test src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts` | ❌ W0 | ⬜ pending |
| A3 (regression) | No direct `editor.updateFeature`/`deleteFeatures` outside `api/` + `GeoEditor` core | unit | `bun test src/features/geo-editor/api/boundary.test.ts` (tighten) | ⚠️ extend | ⬜ pending |
| WR-04 (regression) | Recorded-call batch over budget is capped/rejected before synchronous host replay | unit | `bun test src/features/chat/sandbox/runCode.test.ts` (extend) | ⚠️ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/features/geo-editor/api/diff.test.ts` — classification by id (SAFE-02)
- [ ] `src/features/chat/safeEditing/AuthoringGate.test.ts` — buffer/apply/cancel + Level 1/2/3 gating (SAFE-03 + SAFE-04 behavior)
- [ ] `src/features/chat/safeEditing/binding.test.ts` — auto-bind/auto-create (SAFE-01)
- [ ] `src/features/chat/safeEditing/fixAll.test.ts` — host-side full-set iteration (SAFE-05)
- [ ] `src/features/geo-editor/core/managers/DatasetSnapshotManager.test.ts` — snapshot/undo incl. metadata (SAFE-06)
- [ ] Extend `src/features/geo-editor/api/boundary.test.ts` — tighten A3 to all verbs + geometry-only surface assertion
- [ ] Extend `src/features/chat/settingsStorage.test.ts` — `safetyLevel` migration + round-trip
- [ ] Extend `src/features/chat/sandbox/runCode.test.ts` — recorded-call cap (WR-04)

**Existing harness to reuse:** `src/features/geo-editor/core/test-harness.ts` (`createHeadlessEditor`) — already imported by `boundary.test.ts:5`. Reuse for diff/snapshot/gate tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Binding chip renders + updates on dataset switch | SAFE-01 | Visual/React render in live chat panel | Open chat, open dataset A → chip shows A; open dataset B → chip re-binds to B; with nothing open, ask AI to add a feature → chip shows new untitled draft |
| Inline diff block (collapsible) + Apply/Cancel buttons | SAFE-03 | Visual transcript interaction (CodeRunDisclosure idiom) | Trigger a modify; confirm headline `+N · ~N · −N`, expand per-feature list, click Cancel (no change) then re-run and Apply (change lands) |
| Cmd+Z / "Undo last AI edit" reverts applied AI change incl. style/metadata | SAFE-06 | Native editor + keyboard interaction | Apply an AI style/property edit, press Cmd+Z (and the chat undo affordance) → dataset reverts as one step |
| "Just accept" auto-accept toggle puts user in Level 3 | SAFE-04/D-12 | Visual toggle near binding chip | Flip toggle → subsequent destructive edits apply without confirm but still render diff and remain undoable |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
