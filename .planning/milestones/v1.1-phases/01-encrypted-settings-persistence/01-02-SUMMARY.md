---
phase: 01-encrypted-settings-persistence
plan: 02
subsystem: ui
tags: [zustand, nip46, nip44, encryption, chat, settings-load-state, retry, react-effects]

# Dependency graph
requires:
  - v2 ChatSettingsSnapshot with per-type providerOverrides (01-01)
  - Envelope version 2 + migrateV1ToV2 + throw-on-unsupported-scheme load path (01-01)
  - chatActions bridge + hydrateSettings (01-01)
provides:
  - Observable SettingsStatus type ('idle'|'loading'|'loaded'|'failed'|'no-signer')
  - settingsStatus/settingsError/settingsLoadNonce slice on ChatState (kept out of persist partialize)
  - setSettingsStatus + requestSettingsReload actions (+ chatActions bridge)
  - Load lifecycle in useChatSettingsSync publishes status; nonce-driven Retry re-enters the generation guard
  - Status-aware settings banner (loading / failed+Retry / loaded / no-signer) in ChatSettingsSection
affects: [01-03, chat-settings-persistence, SET-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Promote sync-hook ref state to an observable Zustand status slice for the UI to render"
    - "Nonce-in-deps Retry: a store counter in the effect's dep array re-enters the generation guard instead of calling the loader directly (stale-load race protection)"
    - "Distinguish null-envelope ('loaded, nothing saved') from decrypt failure ('failed') so failure never masquerades as fresh-user defaults"

key-files:
  created: []
  modified:
    - src/features/chat/store.ts
    - src/features/chat/useChatSettingsSync.ts
    - src/features/chat/ChatSettingsSection.tsx

key-decisions:
  - "Catch branch no longer hydrates DEFAULT_CHAT_SETTINGS on failure (D-11) — it sets 'failed' + message so the failed banner, not silent defaults, is the user-visible surface"
  - "settingsLoadNonce is an intentional Retry re-run trigger in the load-effect deps; suppressed Biome's over-specified-dependency warning with a documented biome-ignore"
  - "Resolved the pre-existing LOAD-effect useExhaustiveDependencies warning (added userPubkey); left the SAVE effect untouched per the plan's explicit 'do NOT touch the debounced save effect' instruction"

patterns-established:
  - "Pattern 3 (RESEARCH): observable settingsStatus slice modeled on modelsLoading/modelsError"

requirements-completed: [SET-02]

# Metrics
duration: 5min
completed: 2026-06-16
---

# Phase 01 Plan 02: Settings Load-State (Visible Loading / Failed / No-Signer) Summary

**Promoted the NIP-46 async/fallible settings load from internal sync-hook refs into an observable `settingsStatus`/`settingsError`/`settingsLoadNonce` store slice, rewired the load lifecycle to publish loading/loaded/failed/no-signer (no more silent DEFAULT masquerade on decrypt failure), and rendered a distinguishable loading / failed(+Retry) / loaded / no-signer banner driven by a nonce-based Retry that re-enters the stale-load generation guard.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-16T14:30:30Z
- **Completed:** 2026-06-16T14:35:04Z
- **Tasks:** 3
- **Files modified:** 3 modified, 0 created

## Accomplishments
- `SettingsStatus = 'idle'|'loading'|'loaded'|'failed'|'no-signer'` + `settingsStatus`/`settingsError`/`settingsLoadNonce` added to `ChatState`, seeded in `createInitialState`, and kept OUT of the persist `partialize` allow-list (still `chatSessions` + `activeChatId` only — T-01-08).
- `setSettingsStatus(status, error?)` and `requestSettingsReload()` implemented and bridged into `chatActions`; `requestSettingsReload` only bumps the nonce and references no loader (Pitfall 2 / T-01-06).
- Load lifecycle in `useChatSettingsSync.ts` now publishes `'no-signer'` (D-12, in-memory only), `'loading'` (before the await), `'loaded'` (success — a null envelope is reported as loaded with no error, distinct from failure), and `'failed'` + the error message in the catch branch instead of silently hydrating DEFAULT as if it were the user's data (D-11 / T-01-09).
- `settingsLoadNonce` added to the load effect's dependency array so Retry re-enters the effect, bumps `generation`, and forces any in-flight prior load to fail its `hydrateGenerationRef` guard — the stale-load race protection is preserved verbatim in both success and catch branches.
- `ChatSettingsSection.tsx` renders distinctly per status: a spinner (`Loader2`) "Loading your saved settings…", an `AlertTriangle` "Decryption failed — your saved settings could not be loaded" + error text + a working Retry button (`requestSettingsReload`, never a direct loader call), the existing `Lock` reassurance when loaded, and the `KeyRound` sign-in hint for no-signer — visibly distinct failure vs no-settings vs no-signer.

## Task Commits

Each task was committed atomically:

1. **Task 1: settingsStatus / settingsError / settingsLoadNonce slice + actions (store.ts)** - `dd59814` (feat)
2. **Task 2: Publish load status from the sync hook; nonce-driven Retry (useChatSettingsSync.ts)** - `32da25f` (feat)
3. **Task 3: Render loading / failed(+Retry) / loaded / no-signer banner (ChatSettingsSection.tsx)** - `ce6c9e6` (feat)

**Plan metadata:** committed separately with this SUMMARY (docs: complete plan)

## Files Created/Modified
- `src/features/chat/store.ts` - Added `SettingsStatus` type; `settingsStatus`/`settingsError`/`settingsLoadNonce` fields (ChatState + createInitialState); `setSettingsStatus`/`requestSettingsReload` actions + chatActions bridge; partialize allow-list unchanged.
- `src/features/chat/useChatSettingsSync.ts` - Load effect amended: select `settingsLoadNonce`; set `'no-signer'`/`'loading'`/`'loaded'`/`'failed'` across the lifecycle; catch no longer hydrates DEFAULT as user data; `settingsLoadNonce` + `userPubkey` added to the load-effect deps (load-effect lint warning resolved; nonce suppressed with a documented `biome-ignore`); generation guard preserved. Save effect untouched.
- `src/features/chat/ChatSettingsSection.tsx` - Imported `Loader2`; selected `settingsStatus`/`settingsError`/`requestSettingsReload`; replaced the dashed-border hint with a status-aware banner (loading / failed+Retry / loaded / no-signer).

## Decisions Made
- On decrypt failure the catch branch sets `'failed'` + message and does NOT hydrate `DEFAULT_CHAT_SETTINGS` — silent defaults were exactly the data-loss masquerade D-11/SET-02 forbid. The visible banner is now the primary surface; the one-time toast stays as a secondary signal.
- `settingsLoadNonce` lives in the load-effect deps purely as a re-run trigger (not read in the body), so Biome's "more dependencies than necessary" warning is suppressed with a single documented `biome-ignore` referencing Pitfall 2.
- The pre-existing LOAD-effect `useExhaustiveDependencies` warning (missing `userPubkey`) was resolved as part of owning the load lifecycle. The pre-existing SAVE-effect warning was left in place because the plan's Task 2 explicitly forbids touching the debounced save effect.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed per spec; no Rule 1-4 deviations were required.

## Issues Encountered
- Biome's `useExhaustiveDependencies` initially flagged the intentional `settingsLoadNonce` trigger as over-specified; resolved with a documented `biome-ignore` directly above the load `useEffect`. All three touched files lint clean except the one pre-existing save-effect warning below.
- `bun test` emits benign zustand "storage unavailable" warnings in the headless env (no localStorage); the 12 chat suites pass regardless (carried over from 01-01).

## Deferred Issues
- `src/features/chat/useChatSettingsSync.ts` save effect (now ~line 153): one pre-existing Biome `useExhaustiveDependencies` warning (missing `userPubkey`, which is already read as `userPubkey ?? currentUser.pubkey`). Predates this phase. The plan's Task 2 explicitly scoped this task to the LOAD effect only ("do NOT touch the debounced save effect"), so it is intentionally left. `userPubkey` is read inside the save effect, so the warning is cosmetic — adding it to the deps would be behavior-neutral and can be cleared by a future maintenance pass. `deferred-items.md` updated to reflect the load-effect half is now resolved.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01-03 (SET-03 export/import escape hatch) is the documented recovery path for the `'failed'` state this plan surfaces (T-01-07): a NIP-04-only signer against a `scheme:'nip44'` envelope now shows the failed banner instead of crashing, and export/import is how the user recovers.
- Manual phase UAT (SC-2): with a NIP-46 bunker signer + throttled/offline relay, reload shows the spinner then the distinguishable "decryption failed — could not load saved settings" banner with Retry, never silent defaults.

## Self-Check: PASSED
All 3 modified files verified present on disk; all 3 task commits (`dd59814`, `32da25f`, `ce6c9e6`) verified in git history. Gates: `bun run build` exits 0; `bun test src/features/chat/` = 12 pass / 0 fail; all three touched files lint clean (one pre-existing, out-of-scope save-effect warning remains, see Deferred Issues).

---
*Phase: 01-encrypted-settings-persistence*
*Completed: 2026-06-16*
