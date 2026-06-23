---
phase: 01-encrypted-settings-persistence
plan: 03
subsystem: ui
tags: [export, import, clipboard, plaintext-backup, validation, type-guard, bun-test, chat-settings, recovery]

# Dependency graph
requires:
  - v2 ChatSettingsSnapshot + providerOverrides + migrateV1ToV2 (01-01)
  - chatActions.hydrateSettings + existing debounced save re-encrypt path (01-01)
  - ProviderType union allow-list (routstr.ts)
  - settingsStatus 'failed' banner that surfaces the lost-signer recovery trigger (01-02)
provides:
  - Pure DOM-free serializeSnapshot(snapshot) → pretty plaintext JSON (incl. API keys)
  - Pure DOM-free validateImportedSnapshot(unknown) → normalized v2 snapshot (throws on invalid)
  - MAX_IMPORT_BYTES sanity cap constant for oversized-payload rejection
  - Export-to-clipboard button + persistent plaintext-secrets warning in ChatSettingsSection
  - Import paste textarea → JSON.parse → validate → hydrateSettings (REPLACE) UI
  - Wave-0 bun:test suite for validation + serialize/import round-trip
affects: [chat-settings-persistence, SET-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plaintext export as the recovery hatch for a lost/rotated signer (decrypt is impossible, so the backup must be plaintext)"
    - "Untrusted pasted JSON crosses the trust boundary via JSON.parse(try/catch) → hand-written type-guard validation → store, never raw into hydrateSettings"
    - "Import REPLACES via hydrateSettings; re-encryption is delegated to the existing debounced save effect (no new crypto path)"
    - "Reuse migrateV1ToV2 so the import path accepts in-the-wild v1 payloads with zero duplicated migration logic"

key-files:
  created:
    - src/features/chat/settingsExport.ts
    - src/features/chat/settingsExport.test.ts
  modified:
    - src/features/chat/ChatSettingsSection.tsx

key-decisions:
  - "Export reads the LIVE store snapshot (not the encrypted envelope) and is never gated on settingsStatus, so it works even when load/save is failing — the whole point of the SET-03 recovery hatch (D-08)"
  - "Import delegates re-encryption to the existing debounced save (D-07/D-09); no explicit re-encrypt call and no new crypto path"
  - "Import accepts both v1 and v2 by routing flat v1 payloads through the shared migrateV1ToV2 rather than duplicating migration"
  - "MAX_IMPORT_BYTES = 65536 sanity cap rejects oversized/hostile payloads before they reach the store (T-01-10/V5)"

patterns-established:
  - "Pattern 4 (RESEARCH): export plaintext + import validate-then-replace escape hatch"

requirements-completed: [SET-03]

# Metrics
duration: 4min
completed: 2026-06-16
---

# Phase 01 Plan 03: SET-03 Export/Import Escape Hatch Summary

**Added the SET-03 recovery hatch: a pure DOM-free `settingsExport.ts` (`serializeSnapshot` → plaintext JSON incl. API keys, `validateImportedSnapshot` → hand-written type-guard validation accepting v1+v2 and rejecting malformed/unknown-provider/oversized input), plus Export-to-clipboard (with a persistent plaintext-secrets warning) and an Import paste-textarea UI in `ChatSettingsSection.tsx` that validates then REPLACES settings via `hydrateSettings`, letting the existing debounced save re-encrypt to the current signer.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-16T14:38:39Z
- **Completed:** 2026-06-16T14:42:16Z
- **Tasks:** 2 (Task 1 via TDD RED→GREEN)
- **Files modified:** 1 modified, 2 created

## Accomplishments
- `serializeSnapshot(snapshot)` returns `JSON.stringify(snapshot, null, 2)` — the deliberate plaintext backup that survives a lost/rotated signer (D-08); DOM-free (grep for `window`/`document`/`navigator` returns 0).
- `validateImportedSnapshot(parsed)` implements the RESEARCH Pattern 4 validation list with hand-written type guards (Zod is env-only per CONVENTIONS): rejects null/array/non-object, an unknown `provider` (validated against the `ProviderType` allow-list), and oversized payloads (`MAX_IMPORT_BYTES = 65536`); accepts v1 (routed through `migrateV1ToV2`, custom override populated) and v2 (each override coerced to `{ baseUrl, apiKey }` with missing → `''`); coerces `selectedModel` to `string|null` and `toolsEnabled` to boolean (default `true`).
- Export UI: an "Export settings" button builds the live snapshot from store selectors, `serializeSnapshot`s it, `await navigator.clipboard.writeText(...)` in try/catch (toast success/error), and renders a PERSISTENT orange `AlertTriangle` warning that the clipboard holds plaintext API keys (D-10). Not gated on `settingsStatus`, so it works in the failed state.
- Import UI: a controlled `<textarea>` (no `clipboard.readText` — Pattern 4 / Assumption A2; grep returns 0) → `JSON.parse` in try/catch → `validateImportedSnapshot` → `chatActions.hydrateSettings(validated)` (REPLACE) → clears the textarea → toast. The existing debounced save effect re-encrypts to the current signer automatically (D-07/D-09).
- Wave-0 `bun:test` suite (12 tests) covering reject-malformed / reject-unknown-provider / reject-oversized, accept-v1 / accept-v2, field coercion, and serialize→parse→validate round-trip (incl. `DEFAULT_CHAT_SETTINGS`). Full `bun test src/features/chat/` = 24 pass / 0 fail.

## Task Commits

Each task was committed atomically (Task 1 followed TDD RED→GREEN):

1. **Task 1 (RED): failing tests for settingsExport helpers** - `be38e5d` (test)
2. **Task 1 (GREEN): implement serializeSnapshot + validateImportedSnapshot** - `8aacf68` (feat)
3. **Task 2: export-to-clipboard + import-paste UI** - `69b3716` (feat)

**Plan metadata:** committed separately with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `src/features/chat/settingsExport.ts` (created) - Pure, DOM-free `serializeSnapshot` + `validateImportedSnapshot` + `MAX_IMPORT_BYTES`; hand-written `isRecord`/`isProviderType`/`coerceOverride` guards; reuses `migrateV1ToV2` for v1 payloads.
- `src/features/chat/settingsExport.test.ts` (created) - 12 Wave-0 tests: rejection (null/array/primitive/unknown-provider/oversized), acceptance (v1 via migrate, v2 normalize, field coercion), round-trip (custom snapshot + DEFAULT_CHAT_SETTINGS).
- `src/features/chat/ChatSettingsSection.tsx` (modified) - Added `exported`/`importText` state, `handleExport` (`void (async)`)/`handleImport` handlers, and a "Backup & restore" section with the Export button + persistent plaintext-secrets warning and the Import textarea + button; new imports (`toast`, `serializeSnapshot`/`validateImportedSnapshot`, `chatActions`, `Textarea`, `ClipboardCopy`/`Download`/`Upload` icons).

## Decisions Made
- Export reads the **live store snapshot**, not the encrypted envelope, and is **never gated on `settingsStatus`** — it must work precisely when load/save is failing, which is the SET-03 scenario (D-08).
- Import **delegates re-encryption** to the existing debounced save effect (no explicit re-encrypt, no new crypto path) — `hydrateSettings` REPLACES state and the save effect picks it up and encrypts to whatever signer is now active (D-07/D-09).
- The import path **reuses `migrateV1ToV2`** for flat v1 payloads instead of duplicating migration, so v1 and v2 backups both import cleanly.

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed per spec; no Rule 1-4 deviations were required.

## Issues Encountered
- `bunx biome check src/features/chat/ChatSettingsSection.tsx` reports **1 formatter diff** — but it is on the **pre-existing, untouched** "Changes are saved for the active Nostr account…" loaded-status banner paragraph (Biome wants the line-wrap re-flowed). Confirmed pre-existing via `git stash` + `biome check` at HEAD (`8aacf68`) before any Plan 01-03 edit. The Export/Import code added by this plan lints clean. Out of scope per the executor scope boundary; logged in `deferred-items.md`.
- Importing the chat store in `bun:test` triggers benign Nostr-client relay-connection log lines and zustand "storage unavailable" warnings in the headless env (carried over from 01-01/01-02). The 24 chat tests pass regardless.

## Deferred Issues
See `.planning/phases/01-encrypted-settings-persistence/deferred-items.md` — one pre-existing Biome formatter nit on an untouched paragraph in `ChatSettingsSection.tsx` (the loaded-status banner copy), to be cleared in a future maintenance pass.

## User Setup Required
None - no external service configuration required.

## Manual UAT (deferred to phase end, SC-3)
Configure providers (incl. API keys) → click **Export settings** → confirm the persistent plaintext-secrets warning appears and the clipboard holds the plaintext JSON incl. keys → switch/rotate account (or simulate the decrypt-failed banner) → paste into the Import textarea → **Import** → verify provider config + keys restored and the debounced save re-encrypts to the current signer. Paste malformed JSON → `toast.error`, no state change.

## Self-Check: PASSED
All 3 tracked files verified present on disk; all 3 task commits (`be38e5d`, `8aacf68`, `69b3716`) verified in git history. Gates: `bun run build` exits 0; `bun test src/features/chat/` = 24 pass / 0 fail; the two Plan-01-03 files (`settingsExport.ts`, `settingsExport.test.ts`) lint clean and `ChatSettingsSection.tsx`'s added code lints clean (one pre-existing, out-of-scope formatter nit remains, see Deferred Issues).

---
*Phase: 01-encrypted-settings-persistence*
*Completed: 2026-06-16*
