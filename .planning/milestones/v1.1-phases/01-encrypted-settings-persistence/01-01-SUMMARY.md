---
phase: 01-encrypted-settings-persistence
plan: 01
subsystem: ui
tags: [zustand, persist, nip44, nip04, encryption, chat, providers, bun-test, migration]

# Dependency graph
requires: []
provides:
  - v2 ChatSettingsSnapshot with per-type providerOverrides ({ lmstudio, ollama, custom })
  - Exported pure resolveProvider(type, overrides) with BUILTIN localhost fallback
  - setProviderOverride store action (+ chatActions bridge) replacing setCustomEndpoint/setCustomApiKey
  - Exported chatStorePartialize allow-list helper (chatSessions + activeChatId only)
  - Envelope version 2 + pure headless migrateV1ToV2 with stable .v1 key prefix
  - Per-type LM Studio / Ollama / custom endpoint+API-key UI fields
  - Repo's first bun:test suites (settingsStorage.test.ts, store.test.ts) + test script
affects: [01-02 settings-load-state, 01-03, chat-settings-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "bun:test pure-function suites (import { describe, expect, test } from 'bun:test'); no DOM harness"
    - "In-envelope version field tracks schema; localStorage key prefix stays stable to avoid orphaning"
    - "Pure defensive field-by-field migration (?? default) that never trusts the decrypted shape"
    - "persist partialize as an exported named helper for direct secret-exclusion unit testing"

key-files:
  created:
    - src/features/chat/settingsStorage.test.ts
    - src/features/chat/store.test.ts
  modified:
    - src/features/chat/store.ts
    - src/features/chat/settingsStorage.ts
    - src/features/chat/useChatSettingsSync.ts
    - src/features/chat/ChatSettingsSection.tsx
    - src/features/chat/ChatPanel.tsx
    - package.json

key-decisions:
  - "Kept storage key prefix earthly.chat-settings.v1 stable; only the in-envelope version bumped to 2 (D-07/Pitfall 1)"
  - "Exported resolveProvider, chatStorePartialize, migrateV1ToV2 as pure functions for headless unit testing"
  - "Per-type override fields shown contextually by active provider; empty baseUrl visibly means 'use localhost default'"

patterns-established:
  - "Pattern 1: bun:test pure-function suite convention (Wave 0)"
  - "Pattern 2: schema-versioned encrypted envelope migrated on read, key prefix stable"
  - "Pattern 3: secret-bearing state excluded from persist via exported, test-asserted partialize allow-list"

requirements-completed: [SET-01]

# Metrics
duration: 8min
completed: 2026-06-16
---

# Phase 01 Plan 01: Encrypted Settings Persistence — v2 providerOverrides Data Model Summary

**Replaced the flat customEndpoint/customApiKey chat-settings snapshot with a per-provider-type providerOverrides map, bumped the encrypted envelope to version 2 with a pure migrateV1ToV2 migration, rewired resolveProvider to fall back to BUILTIN localhost defaults, and stood up the repo's first bun:test suites.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-16T14:19:37Z
- **Completed:** 2026-06-16T14:27:00Z
- **Tasks:** 3
- **Files modified:** 6 modified, 2 created

## Accomplishments
- v2 `ChatSettingsSnapshot` with `providerOverrides: { lmstudio, ollama, custom }` (each `{ baseUrl, apiKey }`); LM Studio and Ollama addresses now persist independently and survive provider switches (D-02).
- Exported pure `resolveProvider(type, overrides)` falling back to `BUILTIN_PROVIDERS` localhost defaults when an override `baseUrl` is empty (D-03).
- Envelope `version: 2` written on save; stable `earthly.chat-settings.v1` key prefix preserved; pure headless `migrateV1ToV2` folds in-the-wild v1 flat payloads into `providerOverrides.custom` with no data loss (D-05), is idempotent on v2, and returns safe defaults on garbage payloads (T-01-04).
- Settings UI exposes contextual per-type Endpoint + API-Key inputs for LM Studio, Ollama, and Custom, bound to `setProviderOverride`, with placeholder URLs signalling the localhost default.
- Repo's first three `bun:test` suites (12 tests, all green) covering migration, resolveProvider fallback, per-type preservation, and the SC-1 partialize secret-exclusion invariant; `"test": "bun test"` script wired.

## Task Commits

Each task was committed atomically:

1. **Task 1: v2 snapshot shape, providerOverrides actions, resolveProvider fallback (store.ts)** - `0ddc942` (feat)
2. **Task 2: Envelope v2 + migrateV1ToV2; rewire snapshot consumers** - `03124ef` (feat)
3. **Task 3: Wave-0 bun:test files + test script** - `0ea76fd` (test)

**Plan metadata:** committed separately with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `src/features/chat/store.ts` - v2 ChatSettingsSnapshot + ProviderOverride(Map) types; exported pure resolveProvider with BUILTIN fallback; setProviderOverride action + chatActions bridge; exported chatStorePartialize; rewired loadModels/sendMessage/hydrateSettings.
- `src/features/chat/settingsStorage.ts` - Envelope version widened to 1|2 and written as 2; exported pure headless migrateV1ToV2; load path routed through it; stable .v1 key prefix.
- `src/features/chat/useChatSettingsSync.ts` - buildSnapshot + selectors switched to providerOverrides; legacy scrub list extended with providerOverrides (old flat keys retained defensively).
- `src/features/chat/ChatSettingsSection.tsx` - Per-type LM Studio / Ollama / custom endpoint+key inputs via setProviderOverride; loadModels guard reads providerOverrides.custom.baseUrl.
- `src/features/chat/ChatPanel.tsx` - loadModels effect guard reads providerOverrides.custom.baseUrl.
- `src/features/chat/settingsStorage.test.ts` - migrateV1ToV2 v1-fold / idempotency / garbage-safe / malformed-field tests.
- `src/features/chat/store.test.ts` - resolveProvider fallback, per-type preservation, partialize secret-exclusion (SC-1) tests.
- `package.json` - Added "test": "bun test".

## Decisions Made
- Kept the localStorage key prefix `earthly.chat-settings.v1` stable and bumped only the in-envelope `version` to 2, migrating on read — avoids orphaning in-the-wild v1 envelopes (silent data loss the phase forbids).
- Exported `resolveProvider`, `chatStorePartialize`, and `migrateV1ToV2` as pure functions so the SC-1 secret-exclusion invariant and the migration are directly headless-testable (no DOM harness).
- `setProviderOverride('routstr', …)` is a no-op guard since routstr has no override slot.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed per spec; no Rule 1-4 deviations were required.

## Issues Encountered
- `bun run lint` (whole-repo Biome) does not exit 0 due to ~106 pre-existing baseline errors unrelated to this plan. Per-file linting confirmed all eight touched files introduce **zero** new lint errors. The only Biome errors on a touched file (`useChatSettingsSync.ts`: two `useExhaustiveDependencies` warnings about `userPubkey` in effect deps) are **pre-existing** (confirmed present at HEAD before any edit) and the plan explicitly forbids changing the sync hook's effect deps in this task ("Plan 02 owns the load-state amendments"). Logged in `deferred-items.md`.
- Importing the chat store/settings modules in `bun:test` triggers transitive Nostr-client relay-connection side effects and benign zustand "storage unavailable" warnings (no localStorage in headless env). Tests assert in-memory state and the partialize selector, so they pass cleanly regardless (12 pass / 0 fail).

## Deferred Issues
See `.planning/phases/01-encrypted-settings-persistence/deferred-items.md` — two pre-existing `useExhaustiveDependencies` lint errors in `useChatSettingsSync.ts`, deferred to Plan 01-02 which owns this hook's load-state amendments.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01-02 (settings load-state) builds directly on this: the v2 envelope, `migrateV1ToV2`, and the `throw`-on-unsupported-scheme path are in place as the failed-state trigger Plan 02 amends.
- Manual UAT deferred to phase end: after changing settings in a running app, confirm `JSON.parse(localStorage['chat-store'])` contains no `apiKey`/`baseUrl` (SC-1) — already asserted by unit test against the partialize selector.

## Self-Check: PASSED
All 8 tracked files verified present on disk; all 3 task commits (`0ddc942`, `03124ef`, `0ea76fd`) verified in git history. Gates: `bun run build` exits 0; `bun test src/features/chat/` = 12 pass / 0 fail.

---
*Phase: 01-encrypted-settings-persistence*
*Completed: 2026-06-16*
