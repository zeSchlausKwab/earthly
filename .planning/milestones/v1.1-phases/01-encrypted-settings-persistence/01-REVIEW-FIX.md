---
phase: 01-encrypted-settings-persistence
fixed_at: 2026-06-16T15:00:00Z
review_path: .planning/phases/01-encrypted-settings-persistence/01-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-06-16T15:00:00Z
**Source review:** .planning/phases/01-encrypted-settings-persistence/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 Critical + 6 Warning; Info findings out of scope)
- Fixed: 8
- Skipped: 0

All fixes verified against the project gates inside an isolated git worktree:
`bun test src/features/chat/` (24 pass / 0 fail), `bun run build` (green), and
`biome check` on every changed non-tsx file (clean). `tsc --noEmit` is not a gate
(~305 pre-existing errors) and was not run. The secret-handling invariants were
preserved: API keys still never enter the unencrypted `chat-store` persist blob,
the `partialize` allow-list and legacy-scrub effect are untouched, and the
nonce-driven Retry path is intact.

## Fixed Issues

### CR-01: Decrypt failure leaves the save effect armed — silent overwrite of recoverable ciphertext

**Files modified:** `src/features/chat/useChatSettingsSync.ts`, `src/features/chat/store.ts`, `src/features/chat/ChatSettingsSection.tsx`
**Commit:** d6bfe0e
**Applied fix:** Added a `loadFailedRef` that is armed on the decrypt-failure path and
short-circuits the debounced save effect (`if (loadFailedRef.current) return`), so a
subsequent edit can no longer overwrite the still-recoverable ciphertext. The flag is
cleared on a successful (re)load, on the no-signer reset, and on an explicit user import.
The import path is wired through a new `settingsImportNonce` store counter
(`notifySettingsImported()` called from `handleImport`); the sync hook watches the nonce
and clears `loadFailedRef`, so the deliberate-overwrite recovery write is still permitted
while accidental destructive writes are blocked.
**Note:** This fix changes save/recovery lifecycle logic — recommend human verification
that the failure→edit→blocked and failure→import→saved flows behave as intended in a live
signer-drift scenario.

### CR-02: Load generation guard does not key on pubkey — cross-account hydrate clobber

**Files modified:** `src/features/chat/useChatSettingsSync.ts`
**Commit:** d6bfe0e
**Applied fix:** After the awaited `loadEncryptedChatSettings`, in addition to the existing
generation check, the closure now re-reads the LIVE active account
(`accounts.active?.pubkey` from `@/lib/nostr`) and bails if it no longer equals the
`userPubkey` the load was issued for. Applied to both the success and the catch paths so
account A's settings — or its failed status — can never be hydrated into account B's
session when the global generation counter has not yet bumped.
**Note:** Identity/race logic — recommend human verification under rapid account switching.

### WR-01: Unguarded `JSON.parse` on stored envelope and decrypted payload

**Files modified:** `src/features/chat/settingsStorage.ts`
**Commit:** dbede7f
**Applied fix:** Wrapped both `JSON.parse(raw)` and `JSON.parse(decrypted)` in try/catch.
A corrupted envelope returns `null` ("no usable settings"); an unparseable decrypted
payload routes through `migrateV1ToV2(undefined)` for safe defaults, instead of letting a
`SyntaxError` masquerade as a decryption failure.

### WR-02: `envelope.version` read but never validated or honored

**Files modified:** `src/features/chat/settingsStorage.ts`
**Commit:** dbede7f
**Applied fix:** Added a `SUPPORTED_ENVELOPE_VERSIONS` set (`{1, 2}`) and a guard that bails
to `null` for any unknown/garbage `version`, so a forward-incompatible envelope is never
decrypted-and-mis-migrated.

### WR-03: `migrateV1ToV2` accepts an arbitrary `provider` string without validation

**Files modified:** `src/features/chat/routstr.ts`, `src/features/chat/settingsStorage.ts`, `src/features/chat/settingsExport.ts`
**Commit:** dbede7f
**Applied fix:** Introduced a shared `isProviderType` guard and `PROVIDER_TYPES` constant in
`routstr.ts` (the canonical home of `ProviderType`). `migrateV1ToV2` now membership-checks
`parsed.provider` and falls back to `defaults.provider` for unknown values.
`settingsExport.ts` was refactored to import the shared guard, removing its near-duplicate
local `isProviderType`/`PROVIDER_TYPES` (also addresses the spirit of IN-03 for the provider
guard, though IN-03's `isRecord`/override-normalizer dedup was out of scope).

### WR-04: `resolveProvider` indexes `BUILTIN_PROVIDERS` with an unvalidated type

**Files modified:** `src/features/chat/store.ts`
**Commit:** 51e0fb1
**Applied fix:** Guarded `BUILTIN_PROVIDERS[type]` existence (falling back to the `lmstudio`
builtin for an unknown type rather than throwing) and optional-chained the
`providerOverrides[type]` access (`override?.baseUrl`, `override?.apiKey`), eliminating the
`Cannot read properties of undefined (reading 'baseUrl')` crash and the malformed-config
return path.

### WR-05: Save effect lists the unstable `snapshot` object in its dependency array

**Files modified:** `src/features/chat/useChatSettingsSync.ts`
**Commit:** 66446e6
**Applied fix:** Dropped the per-render `snapshot` object from the save effect's dependency
array and reconstructed it inside the debounced timeout via
`JSON.parse(serializedSnapshot)` (identical by construction to the original `snapshot`).
Replaced the dead `snapshot` dep with `userPubkey`, which is actually read in the closure.
Removes the latent infinite-save footgun.

### WR-06: `saveEncryptedChatSettings` always writes `version: 2` but accepts v1 inner payloads silently

**Files modified:** `src/features/chat/settingsStorage.ts`
**Commit:** dbede7f
**Applied fix:** Normalize the incoming `settings` through `migrateV1ToV2(settings)` immediately
before serialization so the persisted envelope's `version: 2` claim is always truthful; a
malformed in-memory snapshot can no longer be laundered into storage as "v2".

## Notes on commit grouping

CR-01 and CR-02 both modify `useChatSettingsSync.ts` and are inseparable in that shared file,
so they were committed together (d6bfe0e) with both IDs referenced. Likewise WR-01/WR-02/WR-03/WR-06
all touch `settingsStorage.ts` (WR-03 additionally spans `routstr.ts` and `settingsExport.ts`)
and were committed together (dbede7f). WR-04 (store.ts) and WR-05 (useChatSettingsSync.ts) were
committed independently (51e0fb1, 66446e6). The `gsd-tools` CLI was unavailable in this
environment, so commits were made with plain `git commit` listing explicit file paths.

## Info findings (out of scope — not fixed)

IN-01 through IN-04 were Info-tier and outside the `critical_warning` fix scope. Note that
WR-03's shared-guard refactor incidentally addresses part of IN-03 (the duplicated
`isProviderType`), but the broader `isRecord`/override-normalizer dedup remains open.

---

_Fixed: 2026-06-16T15:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
