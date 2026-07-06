---
phase: 05-dataset-aware-safe-editing
plan: 03
subsystem: chat-safe-editing
tags: [safe-editing, settings, encrypted-persistence, binding, chat]
requires:
  - "ChatSettingsSnapshot encrypt-to-self envelope (Phase 01) — migrateV1ToV2, save/load lifecycle"
  - "editor-store identity fields (collectionMeta, features, activeGeoEditDraftId, isDirty)"
provides:
  - "ChatSettingsSnapshot.safetyLevel (1|2|3, default 2) persisted through the encrypted envelope (SAFE-04)"
  - "setSafetyLevel store action (drives the existing debounced encrypted save)"
  - "resolveBinding(state) — pure binding resolver: identity + auto-create-and-bind signal (SAFE-01)"
affects:
  - "src/features/chat/store.ts"
  - "src/features/chat/settingsStorage.ts"
  - "src/features/chat/useChatSettingsSync.ts"
  - "src/features/chat/settingsExport.ts"
tech-stack:
  added: []
  patterns:
    - "Membership-check on decrypt/import (never trust the shape) extended to safetyLevel (T-05-11)"
    - "Pure, store-free resolver fed by the React layer — headlessly testable (binding.ts)"
key-files:
  created:
    - "src/features/chat/safeEditing/binding.ts"
    - "src/features/chat/safeEditing/binding.test.ts"
  modified:
    - "src/features/chat/store.ts"
    - "src/features/chat/settingsStorage.ts"
    - "src/features/chat/settingsStorage.test.ts"
    - "src/features/chat/useChatSettingsSync.ts"
    - "src/features/chat/settingsExport.ts"
    - "src/features/chat/settingsExport.test.ts"
decisions:
  - "safetyLevel rides the same encrypt-to-self envelope (D-09); no bespoke localStorage key — partialize already keeps it out of the plaintext chat-store blob."
  - "Carried safetyLevel through settingsExport.validateImportedSnapshot (with the same 1|3-else-2 tamper guard) so the SET-03 export/import round-trip stays clean (Rule 3 blocking fix)."
  - "needsAutoCreate is true only when there is no open draft AND no features — a clean empty *open* draft is a bound target, not auto-create (D-02)."
metrics:
  duration: ~9min
  completed: 2026-06-21
---

# Phase 5 Plan 3: Safety-Level Persistence + Binding Resolver Summary

SAFE-04 persists a configurable `safetyLevel` (1|2|3, default 2) through the Phase-1 encrypted settings envelope with a non-breaking migration default + encrypt→decrypt round-trip, and SAFE-01 adds a pure `resolveBinding` resolver that reports the bound dataset identity or signals auto-create-and-bind — the two state mechanisms the gate and binding chip consume.

## What Was Built

### Task 1 — safetyLevel on ChatSettingsSnapshot (SAFE-04 / D-09 / D-12)
- Added `safetyLevel: 1 | 2 | 3` to `ChatSettingsSnapshot` and the store state; `DEFAULT_CHAT_SETTINGS.safetyLevel === 2`.
- `migrateV1ToV2` now normalizes/defaults `safetyLevel` via a `normalizeSafetyLevel` helper (`=== 1 || === 3 ? value : 2`) and includes it in all three returned branches (not-a-record, already-v2, flat-v1) — never throws on garbage (T-05-12), never lets an out-of-range value through (T-05-11).
- `setSafetyLevel(level)` store action + action-registry entry; it sets the value and lets the existing debounced sync persist it (no direct localStorage write). The D-12 "just accept" toggle is this same field set to 3.
- `useChatSettingsSync.buildSnapshot` carries `safetyLevel`, read from the store; because `serializedSnapshot` (already a save-effect dep) now includes it, a change triggers the debounced encrypted save automatically.
- `settingsExport.validateImportedSnapshot` carries + membership-checks `safetyLevel` so the SET-03 export/import round-trip is clean (see Deviations).

### Task 2 — pure binding resolver (SAFE-01 / D-01/D-02/D-03)
- New `src/features/chat/safeEditing/binding.ts`: `resolveBinding({ collectionMeta, featureCount, activeGeoEditDraftId, isDirty })` returns `{ name, unsaved, featureCount, needsAutoCreate }`.
- Pure — no `useEditorStore` subscription/hook call inside (grep-confirmed); the React `BindingChip` (Plan 05) reads the store and feeds it.
- `name = collectionMeta.name.trim() || 'Untitled draft'`; `unsaved = activeGeoEditDraftId !== null || isDirty`; `needsAutoCreate = true` only when no open draft and no features (D-02 auto-create-and-bind signal, never a refusal).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] settingsExport round-trip broke on the new field**
- **Found during:** Task 1 (full-suite run after the store/storage edits)
- **Issue:** `settingsExport.validateImportedSnapshot` did not carry `safetyLevel`, so `validate(serialize(DEFAULT_CHAT_SETTINGS))` no longer deep-equaled the input and the D-08 round-trip test failed; the `ChatSettingsSnapshot` type change also broke the `makeV2()` fixture.
- **Fix:** Added `safetyLevel` to `validateImportedSnapshot` with the same `1|3-else-2` tamper guard (T-05-11 consistency); added `safetyLevel` to the `makeV2()` test fixture and a new test asserting valid-preserve / invalid-normalize on import.
- **Files modified:** `src/features/chat/settingsExport.ts`, `src/features/chat/settingsExport.test.ts`
- **Commit:** f0542ca

## Authentication Gates

None.

## Verification

- `bun test src/features/chat/settingsStorage.test.ts src/features/chat/safeEditing/binding.test.ts` — green (10 + 8).
- `bun test` full suite — 449 pass / 0 fail (one flaky `mcp-sync listTools` network timeout cleared on re-run; unrelated to this plan).
- `bun run build` — succeeds.
- `bunx biome check` on all changed files — clean.
- Greps: `safetyLevel` present in `ChatSettingsSnapshot`, `DEFAULT_CHAT_SETTINGS`, all three `migrateV1ToV2` branches, and `buildSnapshot`; `setSafetyLevel` action present; `resolveBinding` has zero `useEditorStore(` hook calls.

## Threat Model Disposition

- **T-05-11 (tamper → out-of-range safetyLevel):** mitigated — `normalizeSafetyLevel` / import guard fall back to 2 on any invalid value.
- **T-05-12 (garbage envelope DoS-as-data-loss):** mitigated — migration still never throws on garbage; safetyLevel default added without breaking the invariant.
- **T-05-13 (info disclosure):** accept — safetyLevel is a non-secret integer; partialize is unchanged, no apiKey added to the plaintext blob.
- **T-05-14 (gate on unbound target):** mitigated at this layer — `resolveBinding` always yields a shown identity or `needsAutoCreate`, never a refuse/throw; end-to-end enforcement lands in Plan 04/05.

## Known Stubs

None. The auto-create itself (creating the untitled draft) is intentionally deferred to the gate/UI layer (Plan 04/05); this resolver only reports `needsAutoCreate`, as scoped by the plan.

## Self-Check: PASSED

- All 8 created/modified files present on disk.
- Commits f0542ca and f62b160 present in git log.
