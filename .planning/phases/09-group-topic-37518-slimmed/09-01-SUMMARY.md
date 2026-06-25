---
phase: 09-group-topic-37518-slimmed
plan: 01
subsystem: nostr-group
tags: [test, red-baseline, nyquist, group, governance, schema-validation, mute]
requires:
  - "Phase 8 tags.ts / modelVersion.ts / schema.worker.ts seams"
  - "EntityFactory bare-sign contract"
provides:
  - "Nine colocated RED test files pinning every Phase-9 seam's export + behavior contract"
  - "GROUP-01..08 + O-03 + D-06 behavioral contracts frozen before implementation"
affects:
  - "Plans 02–06 must implement against these fixed contracts (no drift)"
tech-stack:
  added: []
  patterns:
    - "Wave-0 Nyquist RED baseline (mirrors 08-01)"
    - "localStorage polyfill to surface zustand persist.getOptions() under bun test"
    - "real nostr-tools finalizeEvent/verifyEvent for sig-gate proof"
key-files:
  created:
    - src/lib/nostr/group/group.test.ts
    - src/lib/group/schemaHash.test.ts
    - src/lib/validation/schemaErrors.test.ts
    - src/lib/mute/useMuteStore.test.ts
    - src/lib/group/attach.test.ts
    - src/lib/group/warnNotBlock.test.ts
    - src/lib/group/filterModes.test.ts
    - src/lib/group/noModMinimum.test.ts
    - src/features/groups/schemaBuilder.test.ts
  modified: []
decisions:
  - "D-06 pinned to option (a): EXTEND the off-thread worker verdict with structured errors[] (no in-thread re-validate)"
  - "schemaBuilder contract adds enum field type + geometry arg + $schema draft-2020-12 declaration the existing MapContextEditorPanel builder lacked"
  - "useMuteStore persist contract asserted via persist.getOptions().name behind a memory-backed localStorage polyfill (bun has no localStorage)"
metrics:
  duration: ~12m
  completed: 2026-06-25
  tasks: 2
  files: 9
---

# Phase 9 Plan 01: Nyquist Wave-0 RED Baseline Summary

Nine colocated `*.test.ts` files that pin every Phase-9 seam's exact export contract and behavioral expectation BEFORE any implementation exists — running `bun test` surfaces exactly these nine files RED while the Phase-8 615-pass baseline holds intact.

## What Was Built

Two atomic commits, nine RED test files:

**Task 1 (commit 10bfa02)** — nostr/group + validation + mute:
- `src/lib/nostr/group/group.test.ts` (GROUP-01): governance serialization, modelVersion re-assert (caller cannot spoof), `d`-tag lineage (create generates / modify preserves), and the `isGroup` clean-break gate that REJECTS a legacy kind-37518 event carrying `contextUse`/`validationMode` content with NO modelVersion (SPEC-03 silent drop).
- `src/lib/group/schemaHash.test.ts` (O-03): key-order-independent canonicalization (two reordered-equal schemas hash identically), `sha256:` prefix, verify-mismatch rejected (Pitfall 3/9).
- `src/lib/validation/schemaErrors.test.ts` (D-06): pins the EXTEND-worker decision — the off-thread verdict carries a non-empty `errors: SchemaRuleError[]` on failure (each with `message`/`instancePath`/`keyword`), absent/empty on pass.
- `src/lib/mute/useMuteStore.test.ts`: Set-dedup, unmute, and the `earthly-muted-contributors` persist key (asserted via `persist.getOptions().name` behind a memory-backed `localStorage` polyfill installed before import).

**Task 2 (commit 66a2120)** — lib/group lane + features/groups builder:
- `src/lib/group/attach.test.ts` (GROUP-02): `{ '#c':[coord], kinds:[37515] }` discovery filter + `governance !== 'closed'` foreign-lane gate (closed suppresses, open/schema present).
- `src/lib/group/warnNotBlock.test.ts` (GROUP-04 invariant): a non-conforming attachment yields a non-blocking warning verdict; `canPublishStandalone` returns true regardless of the verdict.
- `src/lib/group/filterModes.test.ts` (GROUP-05): default-strict-for-schema / default-off-for-open / no-lane-for-closed, and off/warn/strict outcomes each carrying a legible reason.
- `src/lib/group/noModMinimum.test.ts` (GROUP-08): kind-gate → sig-gate (real `finalizeEvent`/corrupted-sig) → mute-gate order, 50-cap + `hasMore`, newest-first sort, and flip-to-closed preserving the same `d`.
- `src/features/groups/schemaBuilder.test.ts` (GROUP-03): builder rows + geometry compile to draft-2020-12 (`$schema`, `properties`, `required`), enum row → `enum:[...]`, accepted by the Phase-8 worker.

## Deviations from Plan

None — plan executed exactly as written. All nine files match the prescribed contracts. Biome auto-formatted long lines (whitespace only, no logic change) before each commit.

## Verification

- `bun test src/lib/nostr/group/group.test.ts src/lib/group/schemaHash.test.ts src/lib/validation/schemaErrors.test.ts src/lib/mute/useMuteStore.test.ts` → RED-OK (expected import failures).
- `bun test <five Task-2 files>` → RED-OK.
- Full `bun test`: **616 pass / 11 fail / 7 errors across 627 tests** — every failure/error maps to one of the nine new files (missing modules `@/lib/nostr/group`, `@/lib/group/*`, `@/lib/mute/useMuteStore`, `@/features/groups/schemaBuilder`, and the not-yet-exported `SchemaRuleError`). The Phase-8 615-pass baseline is fully intact (no pre-existing test regressed).
- `biome check` clean on all nine files.

## Notes for Plans 02–06

- The `schema.worker.ts` verdict must be extended with `SchemaRuleError` + `errors?: SchemaRuleError[]` (D-06 option a) — `schemaErrors.test.ts` is the contract.
- `@/lib/group` barrel must re-export `validateAttachment` + `canPublishStandalone` (warnNotBlock imports from the barrel root).
- `filterForeignAttachment` returns `{ show: boolean; reason?: string }` (filterModes contract), distinct from the worker's `{ ok }` verdict.
- `gateForeignLane(events, { mutedPubkeys })` returns `{ visible, hasMore }`; `flipToClosed(event)` returns an event template (async) with `governance:'closed'` and preserved `d`.
- `compileBuilderSchema(rows, allowedGeometryTypes)` — `SchemaBuilderRow` adds `enum` type + `allowedValues`; output declares draft-2020-12 `$schema`.

## Self-Check: PASSED

- All nine created files exist on disk (verified below).
- Both task commits exist (10bfa02, 66a2120).
