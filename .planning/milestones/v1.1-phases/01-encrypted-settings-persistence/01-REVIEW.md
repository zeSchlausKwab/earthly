---
phase: 01-encrypted-settings-persistence
reviewed: 2026-06-16T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/features/chat/store.ts
  - src/features/chat/settingsStorage.ts
  - src/features/chat/useChatSettingsSync.ts
  - src/features/chat/ChatSettingsSection.tsx
  - src/features/chat/ChatPanel.tsx
  - src/features/chat/settingsExport.ts
  - src/features/chat/settingsExport.test.ts
  - src/features/chat/settingsStorage.test.ts
  - src/features/chat/store.test.ts
  - package.json
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

This phase implements an encrypted-to-self settings envelope, a v1→v2 per-provider-type
snapshot migration, a visible NIP-46 async load lifecycle, and a plaintext export/import
recovery hatch. Secret-exclusion from the unencrypted `chat-store` persist blob is correct
and well-tested (`chatStorePartialize`, the legacy-scrub effect). Input validation in
`validateImportedSnapshot` is solid (rejects null/array/primitive/unknown-provider/oversized),
and the plaintext-export warning banner exists per D-10.

However, the load/save lifecycle in `useChatSettingsSync` contains a **data-loss race**: after a
decrypt *failure*, the debounced save effect is still armed for the same pubkey and will
silently overwrite the undecryptable-but-recoverable ciphertext the moment any setting changes —
defeating the very recovery hatch this phase added. A second blocker concerns the load guard
when the active account changes while a decrypt is in flight against a *different* pubkey. There
are also several robustness gaps around unguarded `JSON.parse`, an unvalidated `envelope.version`
field that is never honored, and a `provider` field that bypasses validation in
`migrateV1ToV2`.

## Critical Issues

### CR-01: Decrypt failure leaves the save effect armed — silent overwrite of recoverable ciphertext

**File:** `src/features/chat/useChatSettingsSync.ts:129` (and `:153-184`)
**Issue:**
On the load **failure** path, the effect sets `loadedPubkeyRef.current = currentUser.pubkey`
(line 129) but does NOT re-hydrate the store and does NOT raise any guard that blocks saving.
The debounced save effect (line 153) gates only on
`loadedPubkeyRef.current === currentUser.pubkey` and `serializedSnapshot !== lastSavedSnapshotRef.current`.

Therefore, after a decrypt failure (e.g. signer temporarily returns a different key, NIP-46
remote rejects, scheme mismatch), the in-memory store still holds whatever it had (defaults on
fresh mount, or the prior account's values). As soon as the user edits any field — or the store
already differs from `lastSavedSnapshotRef` — the save effect fires and calls
`saveEncryptedChatSettings`, **overwriting the existing, still-recoverable ciphertext** with new
plaintext-derived state. The user's original encrypted settings are destroyed precisely in the
scenario (signer drift) where the export/import recovery hatch was supposed to let them recover.
This contradicts the D-11 intent ("do NOT masquerade a decrypt failure … silent DEFAULT
hydration") by instead allowing a silent *destructive write*.

**Fix:** Track a "load failed / not safe to save" flag and short-circuit the save effect on it.
Reset the flag only on a successful load or an explicit user import.
```ts
const loadFailedRef = useRef(false)
// in catch:
loadFailedRef.current = true
loadedPubkeyRef.current = currentUser.pubkey
// on success:
loadFailedRef.current = false
// in the save effect, before scheduling the timeout:
if (loadFailedRef.current) return
```
(An explicit user-initiated import should clear `loadFailedRef` so the recovery write is allowed.)

### CR-02: Load generation guard does not key on pubkey — cross-account hydrate clobber

**File:** `src/features/chat/useChatSettingsSync.ts:104-121`
**Issue:**
The in-flight load is guarded only by a monotonically increasing `hydrateGenerationRef`
(`if (hydrateGenerationRef.current !== generation) return`). The async closure captures
`currentUser` and `userPubkey` from the render that started it, but writes results into the
*global* store via `chatActions.hydrateSettings` and sets `loadedPubkeyRef.current = currentUser.pubkey`
using the **captured** user.

Because the effect depends on `[currentUser, signer, settingsLoadNonce, userPubkey]`, switching
accounts increments `generation`, so a stale resolve correctly bails. That part is fine. However,
`loadEncryptedChatSettings` is called with the captured `userPubkey`, while the *save* effect
later saves with `userPubkey ?? currentUser.pubkey` from a possibly newer render — and the
success branch sets `lastSavedSnapshotRef.current` to the **loaded-for-account-A** snapshot while
the store may already be reconciling to account B. If account A's load resolves slightly after
the account-B effect has run its synchronous `no-signer`/`loading` reset but the generation
check passes due to ordering, account A's settings can be hydrated into account B's session.
The guard is a single global counter and does not assert `currentUser.pubkey === userPubkey` at
resolve time, so it cannot distinguish "newer generation for the same user" from "different user".

**Fix:** After awaiting, re-read the live active account and assert identity before mutating
store/refs:
```ts
const settings = await loadEncryptedChatSettings(signer, userPubkey)
if (hydrateGenerationRef.current !== generation) return
// guard against account swap that did not bump generation in time
if (useActiveAccountPubkeyAtResolveTime() !== userPubkey) return
```
Capture `userPubkey` into a const at effect entry and compare the live store/account pubkey
before `hydrateSettings` and before assigning `loadedPubkeyRef.current`.

## Warnings

### WR-01: Unguarded `JSON.parse` on stored envelope and decrypted payload

**File:** `src/features/chat/settingsStorage.ts:120,128`
**Issue:** `JSON.parse(raw)` (line 120) and `JSON.parse(decrypted)` (line 128) are not wrapped.
A corrupted localStorage envelope (truncated write, manual tampering, quota-aborted write) throws
a `SyntaxError` that propagates out of `loadEncryptedChatSettings`, surfacing as a generic
`failed` decrypt state with a misleading message. `migrateV1ToV2` is explicitly documented as
"never throws on garbage," but it is never reached because the `JSON.parse` throws first.
**Fix:** Wrap both parses; treat a malformed envelope as "no usable settings" (return `null`) or
route the decrypted-but-unparseable payload through `migrateV1ToV2(undefined)` for safe defaults,
rather than letting a raw `SyntaxError` masquerade as a decryption failure.

### WR-02: `envelope.version` is read into the type but never validated or honored

**File:** `src/features/chat/settingsStorage.ts:12-17,120-129`
**Issue:** `StoredChatSettingsEnvelope.version: 1 | 2` is declared and written, but on load the
code only checks `envelope.ciphertext` and `envelope.scheme`. A future/garbage `version` (e.g.
`3`, `0`, a string) is silently accepted and decrypted, and a `version: 1` envelope is decrypted
then passed to `migrateV1ToV2` regardless. The version field gives a false impression of forward-
compat gating. If a future schema change writes `version: 3` with an incompatible inner shape,
old clients will happily decrypt and mis-migrate it.
**Fix:** Either validate `envelope.version` against a known-supported set and bail to `null`
(or a visible "unsupported settings version" status) for unknown versions, or drop the field from
the read path and document that the inner payload self-describes.

### WR-03: `migrateV1ToV2` accepts an arbitrary `provider` string without validation

**File:** `src/features/chat/settingsStorage.ts:71`
**Issue:** `const provider = (parsed.provider as ChatSettingsSnapshot['provider']) ?? defaults.provider`
casts whatever is in the decrypted payload to `ProviderType` with no membership check, unlike
`settingsExport.ts` which uses `isProviderType`. A tampered/corrupt envelope (or a future-version
payload) containing `provider: "openai"` flows into the store, and `resolveProvider` (store.ts:600)
falls through its `else` branch treating an unknown provider as lmstudio/ollama —
`BUILTIN_PROVIDERS[type]` is then `undefined`, and the spread `{ ...builtin, ... }` produces a
malformed `ProviderConfig` (no `name`, `requiresPayment`). This can crash downstream model loading.
**Fix:** Reuse a shared `isProviderType` guard in `migrateV1ToV2` and fall back to
`defaults.provider` when the value is not a known provider type.

### WR-04: `resolveProvider` indexes `BUILTIN_PROVIDERS` with an unvalidated type → possible `undefined` spread

**File:** `src/features/chat/store.ts:617-624`
**Issue:** For any `type` that is not `custom` or `routstr`, the function does
`const builtin = BUILTIN_PROVIDERS[type]` then `{ ...builtin, baseUrl: override.baseUrl || builtin.baseUrl }`.
If `type` is an unexpected value (see WR-03) or `providerOverrides[type]` is undefined, this
throws (`Cannot read properties of undefined (reading 'baseUrl')`) or returns a partial config.
`providerOverrides[type]` is also unchecked — a v1 payload migrated with a missing override map
key would be `undefined`.
**Fix:** Guard `builtin` and `override` existence; throw an explicit, user-meaningful error or
fall back to a known provider when either is missing.

### WR-05: Save effect lists the unstable `snapshot` object in its dependency array

**File:** `src/features/chat/useChatSettingsSync.ts:184`
**Issue:** `snapshot` (built fresh every render at line 45 via `buildSnapshot`) is a new object
identity on every render and is in the dependency array `[currentUser, serializedSnapshot, signer, snapshot]`.
The effect is saved from redundant re-runs only by the `serializedSnapshot === lastSavedSnapshotRef.current`
early return, so behavior is currently correct — but the `snapshot` dep is dead weight that makes
the effect re-evaluate on every render and obscures the real trigger (`serializedSnapshot`). It is
also a latent footgun: if someone later removes the string guard, this becomes an infinite
save/timeout churn.
**Fix:** Drop `snapshot` from the deps (it is derivable from the already-listed `serializedSnapshot`)
and read the latest snapshot inside the timeout via `buildSnapshot(...)` or a ref, or memoize
`snapshot` on `serializedSnapshot`.

### WR-06: `saveEncryptedChatSettings` always writes `version: 2` but accepts v1 inner payloads silently

**File:** `src/features/chat/settingsStorage.ts:132-151`
**Issue:** `saveEncryptedChatSettings` serializes whatever `ChatSettingsSnapshot` it is given and
stamps `version: 2`. There is no assertion that `settings` is actually v2-shaped. Combined with
WR-03 (provider not validated on the way in), a malformed in-memory snapshot can be re-encrypted
and persisted as a "v2" envelope, laundering corrupt state into storage with a trustworthy-looking
version stamp.
**Fix:** Normalize/validate `settings` through `migrateV1ToV2` (or a dedicated assert) immediately
before `JSON.stringify` so the persisted envelope's `version: 2` claim is always truthful.

## Info

### IN-01: Export handler shows the plaintext-secret warning even when no API keys exist

**File:** `src/features/chat/ChatSettingsSection.tsx:89-106,539-549`
**Issue:** `handleExport` sets `exported = true` unconditionally on success, and the banner states
"The clipboard now holds your plaintext API keys" even when all `providerOverrides[*].apiKey` are
empty (the default). The warning is correct in spirit (D-10) but can be misleadingly alarming when
there is nothing secret to leak.
**Fix:** Gate the wording on whether any `apiKey` is non-empty, or soften the copy to "may include
plaintext API keys."

### IN-02: `loadEncryptedChatSettings` returns `null` for SSR but callers cannot distinguish from "no settings"

**File:** `src/features/chat/settingsStorage.ts:115,118,121`
**Issue:** Three distinct conditions all return `null`: `window` undefined (SSR), no stored value,
and a structurally-empty envelope. The sync hook treats `null` as "loaded / no settings saved yet"
(`settings ?? DEFAULT_CHAT_SETTINGS`, `setSettingsStatus('loaded')`). The structurally-empty-envelope
case (line 121: ciphertext/scheme missing) is arguably a corruption that should surface as `failed`,
not silently loaded-as-default. Low impact because such envelopes are not normally produced.
**Fix:** Consider distinguishing "absent" (`null` → loaded/default) from "present but malformed"
(throw or a distinct signal → failed).

### IN-03: Duplicate `isRecord` / override-normalization helpers across two modules

**File:** `src/features/chat/settingsStorage.ts:38-47` and `src/features/chat/settingsExport.ts:16-29`
**Issue:** `isRecord` and the override-coercion logic (`normalizeOverride` vs `coerceOverride`) are
near-duplicated with subtly different fallback semantics (`normalizeOverride` falls back to the
*provided fallback*'s fields; `coerceOverride` falls back to `''`). The divergence is intentional
but undocumented at the call site and invites drift.
**Fix:** Extract a shared `isRecord` and a single parameterized override normalizer; document the
two fallback modes explicitly.

### IN-04: `DEFAULT_MINT_KEY` const declared mid-import-block

**File:** `src/features/chat/store.ts:24`
**Issue:** `const DEFAULT_MINT_KEY = 'nip60_default_mint'` is declared on line 24, interleaved
between import statements (line 23 import, line 25 import). It works but is stylistically out of
place and easy to miss. Minor; not in this phase's core scope.
**Fix:** Move the const below the import block with the other module constants.

---

_Reviewed: 2026-06-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
