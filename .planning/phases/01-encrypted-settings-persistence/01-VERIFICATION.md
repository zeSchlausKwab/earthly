---
phase: 01-encrypted-settings-persistence
verified: 2026-06-16T15:15:00Z
status: human_needed
score: 15/15
overrides_applied: 0
human_verification:
  - test: "Verify CR-01 lifecycle: after a decrypt failure, edit any setting (e.g. toggle toolsEnabled), wait 350ms; confirm that localStorage[earthly.chat-settings.v1.<pubkey>] is NOT overwritten — the original ciphertext is still intact."
    expected: "The save effect is short-circuited by loadFailedRef and the encrypted blob is NOT replaced. The failed-state banner is still visible."
    why_human: "loadFailedRef is a useRef that cannot be inspected by grep or static analysis. Verifying the timing interaction between the load catch branch, loadFailedRef.current = true, and the debounced save effect's early-return guard requires a running app with a signer that deliberately fails decryption."
  - test: "Verify CR-02 lifecycle: log in with account A; while the NIP-46 decrypt is in flight (throttle the relay), switch to account B; confirm that account A's settings (or A's 'failed' status) are NOT hydrated into account B's session."
    expected: "The pubkey identity check (accounts.active?.pubkey !== userPubkey) catches the stale resolve and returns without mutating state or setting status for account B."
    why_human: "The guard is a runtime race-condition check. Static analysis can confirm the code exists (line 126 and 141 of useChatSettingsSync.ts) but cannot verify it fires correctly under timing pressure with two real accounts."
  - test: "Verify the full settings reload cycle with a NIP-46 bunker signer: on page load, confirm the Loader2 spinner appears; when decryption completes, the saved provider config and API keys are restored; the Lock banner reads 'Changes are saved for the active Nostr account...'"
    expected: "Settings status transitions through 'idle' → 'loading' → 'loaded'; configured overrides (LM Studio baseUrl, Ollama baseUrl, custom baseUrl + apiKey) are visible in the UI after load."
    why_human: "Async NIP-46 signer path requires a live bunker; the loading→loaded transition and data restoration cannot be confirmed by static analysis."
  - test: "Export settings: configure at least one API key, click 'Export settings'; confirm the persistent orange AlertTriangle warning appears with 'plaintext API keys' text; paste clipboard into editor and confirm the full JSON including the API key is present."
    expected: "Warning is visible immediately after export. The clipboard JSON contains providerOverrides with the configured apiKey. The warning persists (does not disappear on its own)."
    why_human: "Clipboard content and the 'exported' state rendering are UI behaviors requiring a browser context."
  - test: "Import settings escape hatch: paste a valid v2 JSON into the import textarea, click 'Import'; confirm settings update in the UI and the debounced save re-encrypts to the current signer (localStorage blob is updated within ~350ms)."
    expected: "Provider and overrides shown in the UI match the imported JSON. The encrypted blob in localStorage[earthly.chat-settings.v1.<pubkey>] is updated."
    why_human: "The re-encrypt-via-save path delegates to the existing debounced save effect. Confirming the timing and the resulting localStorage blob requires a running app."
---

# Phase 01: Encrypted Settings Persistence — Verification Report

**Phase Goal:** A user's chat provider config and keys survive reloads encrypted to their own key, work even with a remote signer, and can be exported so a signer change never silently loses them.
**Verified:** 2026-06-16T15:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Each of lmstudio/ollama/custom keeps its own `{ baseUrl, apiKey }`; switching provider away and back preserves each override (D-02). | VERIFIED | `setProviderOverride` immutably merges into `providerOverrides[type]`; `setProvider` does not touch overrides; `store.test.ts` line 58 asserts both overrides intact after switch. |
| 2 | An empty/unset override baseUrl falls back to BUILTIN_PROVIDERS localhost defaults (D-03). | VERIFIED | `resolveProvider` in `store.ts:621-631` reads `BUILTIN_PROVIDERS[type]`; `store.test.ts:15-23` asserts `http://localhost:1234/v1` and `http://localhost:11434/v1` returned when override is empty. |
| 3 | An in-the-wild v1 envelope (flat `customEndpoint`/`customApiKey`) loads and migrates into `providerOverrides.custom` without data loss (D-05). | VERIFIED | `migrateV1ToV2` in `settingsStorage.ts:61-118` handles the flat v1 shape; `settingsStorage.test.ts:5-23` asserts the full round-trip. |
| 4 | The persisted `chat-store` localStorage blob contains no `apiKey`/`baseUrl`/`providerOverrides` secret after a settings change (SC-1). | VERIFIED | `chatStorePartialize` (exported, `store.ts:753-759`) allow-lists only `chatSessions` + `activeChatId`; `store.test.ts:78-93` asserts partialized serialized output contains none of the secret keys. |
| 5 | The snapshot stays a single active configuration (flat model) — no named-profile list is introduced (D-01). | VERIFIED | `ChatSettingsSnapshot` interface has no profile list; `DEFAULT_CHAT_SETTINGS` is a flat object with one set of overrides. |
| 6 | Bumping the envelope to version 2 preserves the existing NIP-44-preferred / NIP-04-fallback encrypt-to-self scheme negotiation; NIP-44-only is never forced (D-06). | VERIFIED | `resolveEncryptionScheme` in `settingsStorage.ts:39-41` uses `signer.nip44 ?? nip04`; `loadEncryptedChatSettings:144-147` chooses scheme from stored envelope. Preferred-with-fallback is preserved. |
| 7 | Settings load is VISIBLE: loading state shown during async NIP-46 decrypt. | VERIFIED (static) | `useChatSettingsSync.ts:114` calls `chatActions.setSettingsStatus('loading')` before the await; `ChatSettingsSection.tsx:471-477` renders `Loader2` spinner on `settingsStatus === 'loading'`. Runtime behavior needs human verification. |
| 8 | A decrypt failure shows a distinguishable 'decryption failed — your saved settings could not be loaded' state with a Retry affordance, never silent defaults (D-11). | VERIFIED (static) | Catch branch at `useChatSettingsSync.ts:149-153` sets `'failed'` + error message and does NOT hydrate `DEFAULT_CHAT_SETTINGS`; `ChatSettingsSection.tsx:478-499` renders AlertTriangle + "Decryption failed — your saved settings could not be loaded." + Retry button calling `requestSettingsReload()`. Runtime behavior needs human verification. |
| 9 | A null envelope ('no settings saved yet') is visibly distinct from a decrypt failure (D-11). | VERIFIED | `loadEncryptedChatSettings:127` returns `null` when key absent; `useChatSettingsSync.ts:130-135` calls `hydrateSettings(settings ?? DEFAULT)` and sets `'loaded'` (not `'failed'`) for a null result; `ChatSettingsSection.tsx:509-517` renders the Lock reassurance for `'loaded'`. |
| 10 | With no signer/account the surface shows a no-signer state and settings remain in-memory only (D-12). | VERIFIED | `useChatSettingsSync.ts:100-108` calls `setSettingsStatus('no-signer')` in the no-signer branch; `ChatSettingsSection.tsx:501-507` renders the KeyRound sign-in hint. |
| 11 | Retry re-enters the generation-counter guard via a store nonce so an in-flight stale load cannot clobber the retry result (Pitfall 2). | VERIFIED | `requestSettingsReload` only increments `settingsLoadNonce`; load effect dependency at `useChatSettingsSync.ts:172` includes `settingsLoadNonce`; `requestSettingsReload` body (`store.ts:848-850`) does not call any loader. |
| 12 | The user can export current settings as plaintext JSON (including API keys) to the clipboard (D-08). | VERIFIED (static) | `ChatSettingsSection.tsx:89-109` calls `serializeSnapshot({...providerOverrides...})` + `navigator.clipboard.writeText`; export is not gated on `settingsStatus`. Runtime clipboard behavior needs human verification. |
| 13 | Export shows a persistent warning that the clipboard now holds plaintext secrets (D-10). | VERIFIED (static) | `ChatSettingsSection.tsx:542-549` renders AlertTriangle + "The clipboard now holds your plaintext API keys..." gated on `exported` state set after successful clipboard write. Runtime behavior needs human verification. |
| 14 | The user can paste settings JSON into a textarea and import it; the pasted JSON is validated before applying (V5). | VERIFIED | `ChatSettingsSection.tsx:111-122` parses textarea JSON in try/catch, calls `validateImportedSnapshot(parsed)` before `chatActions.hydrateSettings(validated)`; no `clipboard.readText` in file (confirmed by grep). |
| 15 | Import accepts both v1 and v2 payloads (v1 via `migrateV1ToV2`) and rejects malformed/unknown-provider/oversized payloads. | VERIFIED | `validateImportedSnapshot` in `settingsExport.ts:37-91` rejects null/array/non-object, unknown provider, oversized (>64KB); routes v1 flat payloads through `migrateV1ToV2`; `settingsExport.test.ts` has 12 tests covering all rejection + acceptance cases, all passing. |

**Score:** 15/15 truths verified (5 require human runtime confirmation for full assurance — see Human Verification section)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/features/chat/store.ts` | v2 ChatSettingsSnapshot with `providerOverrides`; `setProviderOverride` action; exported `resolveProvider`; exported `chatStorePartialize`; `settingsStatus` slice | VERIFIED | All symbols confirmed at lines 124-148, 600-633, 753-759, 778-857. No `customEndpoint`/`customApiKey` identifiers remain. |
| `src/features/chat/settingsStorage.ts` | Envelope version 2; exported pure `migrateV1ToV2`; stable `earthly.chat-settings.v1` key prefix; `SUPPORTED_ENVELOPE_VERSIONS` guard; `migrateV1ToV2` in load path | VERIFIED | Key prefix at line 9; `migrateV1ToV2` exported at line 61; load path calls it at line 159; `SUPPORTED_ENVELOPE_VERSIONS = new Set([1, 2])` at line 23; WR-02 guard at line 142. Both JSON.parse calls wrapped in try/catch (WR-01). |
| `src/features/chat/useChatSettingsSync.ts` | Load lifecycle publishes status; retry via nonce; `loadFailedRef` blocks save after failure; pubkey identity guard | VERIFIED | `loadFailedRef` at line 48; save guard at line 187; pubkey check at lines 126 and 141; `settingsLoadNonce` in dep array at line 172; `settingsImportNonce` clears `loadFailedRef` at line 179. |
| `src/features/chat/ChatSettingsSection.tsx` | Loading/failed(+Retry)/loaded/no-signer banner; per-type endpoint inputs; Export button with secrets warning; Import paste textarea | VERIFIED | `settingsStatus` branching at lines 471-517; per-type inputs confirmed at lines 230-298; Export at lines 89-110; Import at lines 111-122; Backup & restore section at lines 520+. No `customEndpoint`/`customApiKey`. |
| `src/features/chat/ChatPanel.tsx` | loadModels guard reads `providerOverrides.custom.baseUrl` | VERIFIED | Lines 152, 157 use `providerOverrides.custom.baseUrl`. No `customEndpoint`. |
| `src/features/chat/settingsStorage.test.ts` | Wave-0 tests for `migrateV1ToV2` | VERIFIED | 4 tests: v1-fold, idempotency, garbage-safe, malformed-field tolerance. All pass. |
| `src/features/chat/store.test.ts` | Wave-0 tests for `resolveProvider`, per-type preservation, `chatStorePartialize` | VERIFIED | 8 tests covering all behaviors. All pass. |
| `src/features/chat/settingsExport.ts` | Pure DOM-free `serializeSnapshot` + `validateImportedSnapshot`; imports `migrateV1ToV2` from `settingsStorage` | VERIFIED | Both functions exported; no `window`/`document`/`navigator` references (grep returns 0); `migrateV1ToV2` imported and called at line 67. |
| `src/features/chat/settingsExport.test.ts` | Wave-0 tests for export/import validation | VERIFIED | 12 tests: 5 rejection + 4 acceptance + 3 round-trip. All pass. |
| `package.json` | `"test": "bun test"` script | VERIFIED | Line 22 confirmed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `store.ts resolveProvider` | `routstr.ts BUILTIN_PROVIDERS` | `BUILTIN_PROVIDERS[type]` when override baseUrl is empty | VERIFIED | `store.ts:621` indexes `BUILTIN_PROVIDERS[type]`; used as fallback at line 630. |
| `settingsStorage.ts loadEncryptedChatSettings` | `migrateV1ToV2` | Called after decrypt+JSON.parse on every load | VERIFIED | `settingsStorage.ts:159`: `return migrateV1ToV2(parsed)`. |
| `useChatSettingsSync.ts load effect` | `store.ts setSettingsStatus` | `chatActions.setSettingsStatus` at each lifecycle transition | VERIFIED | Lines 107, 114, 135, 151 call `chatActions.setSettingsStatus` with `'no-signer'`/`'loading'`/`'loaded'`/`'failed'`. |
| `ChatSettingsSection.tsx Retry button` | `store.ts settingsLoadNonce` | `requestSettingsReload` increments nonce → load effect re-enters guard | VERIFIED | `ChatSettingsSection.tsx:493` onClick calls `requestSettingsReload()`; `store.ts:848-850` only increments nonce; nonce in effect dep array at `useChatSettingsSync.ts:172`. |
| `ChatSettingsSection.tsx Import` | `settingsExport.ts validateImportedSnapshot` | JSON.parse in try/catch → validate → `chatActions.hydrateSettings` | VERIFIED | `ChatSettingsSection.tsx:113-115`: JSON.parse → `validateImportedSnapshot(parsed)` → `chatActions.hydrateSettings(validated)`. |
| `ChatSettingsSection.tsx Export` | `navigator.clipboard.writeText` | `serializeSnapshot(snapshot)` → clipboard + warning | VERIFIED | `ChatSettingsSection.tsx:99`: `await navigator.clipboard.writeText(json)` where `json = serializeSnapshot({...})`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 24 chat tests pass | `bun test src/features/chat/` | 24 pass / 0 fail in 521ms | PASS |
| Build succeeds | `bun run build` | Build completed in 816.70ms | PASS |
| Per-file lint clean (phase files) | `bunx biome check store.ts settingsStorage.ts useChatSettingsSync.ts settingsExport.ts` | No errors | PASS |
| Per-file lint (UI + test files) | `bunx biome check ChatSettingsSection.tsx ChatPanel.tsx *.test.ts` | 1 pre-existing formatter error on untouched paragraph (lines 513-514 of ChatSettingsSection.tsx); no errors in phase-added code | PASS (pre-existing) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SET-01 | 01-01-PLAN.md | Chat provider config, API keys, LM Studio/Ollama addresses persist across reloads, encrypted with Nostr key | SATISFIED | `providerOverrides` in v2 snapshot; `migrateV1ToV2`; `saveEncryptedChatSettings`/`loadEncryptedChatSettings`; all unit tests green. |
| SET-02 | 01-02-PLAN.md | Encrypted settings load works with NIP-46 remote signers (async/fallible), failing visibly not silently | SATISFIED (static) | Load lifecycle publishes `'loading'`/`'loaded'`/`'failed'`/`'no-signer'`; failure does not hydrate DEFAULT; Retry via nonce. Runtime behavior needs human verification. |
| SET-03 | 01-03-PLAN.md | User can export and re-import settings as escape hatch against signer rotation/loss | SATISFIED (static) | `serializeSnapshot` + clipboard; `validateImportedSnapshot` with v1/v2 acceptance; import via `hydrateSettings`; 12 unit tests green. Runtime clipboard behavior needs human verification. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/features/chat/ChatSettingsSection.tsx` | 513-514 | Biome formatter diff on pre-existing "Changes are saved for the active Nostr account..." paragraph | INFO | Pre-existing, out-of-scope, no behavior impact. Documented in `deferred-items.md`. |

No TBD/FIXME/XXX/TODO markers found in phase-modified files. No stub implementations. No hardcoded empty data returns masquerading as real implementations.

### Human Verification Required

The two code-review blockers (CR-01, CR-02) were fixed in commit d6bfe0e. Static analysis confirms the guards exist in the code, but their runtime correctness under signer-drift and rapid-account-switch conditions requires human testing.

#### 1. CR-01: Decrypt failure blocks subsequent save (save guard)

**Test:** Sign in with a Nostr account that has a saved encrypted settings envelope. Temporarily break decryption (e.g. use a NIP-46 bunker that returns an error, or manually corrupt the localStorage ciphertext). Observe the "Decryption failed" banner. Then edit any setting (e.g. toggle the toolsEnabled switch). Wait 350ms. Open DevTools → Application → Local Storage and inspect the `earthly.chat-settings.v1.<pubkey>` entry.
**Expected:** The localStorage value is UNCHANGED — the original ciphertext is still intact, not overwritten with new defaults. The save effect was blocked by `loadFailedRef.current = true`. The failed banner remains visible.
**Why human:** `loadFailedRef` is a `useRef` — its value cannot be observed by static analysis. The timing between the async catch branch setting the ref and the debounced save firing requires a live browser session.

#### 2. CR-02: Account-swap identity guard prevents cross-account hydration

**Test:** In a browser with two Nostr accounts configured, log in as account A. Open DevTools Network and throttle to Slow 3G so NIP-46 decryption takes several seconds. While the loading spinner is showing, switch to account B in the account picker. Wait for the initial load to resolve.
**Expected:** Account A's settings — or account A's `'failed'` status — do NOT appear in account B's session. Account B starts its own load lifecycle fresh.
**Why human:** The pubkey identity guard (`accounts.active?.pubkey !== userPubkey`) is a runtime check on a race condition. Static analysis confirms the code exists at `useChatSettingsSync.ts` lines 126 and 141, but correctness depends on the relative timing of the effect cleanup vs. the async resolve.

#### 3. Full NIP-46 load lifecycle (SC-2)

**Test:** With a NIP-46 bunker signer (not a local nsec), load the app on a fresh tab. Open the Chat Settings section.
**Expected:** A spinner labeled "Loading your saved settings…" appears during decrypt. When decrypt succeeds, the saved provider config, LM Studio baseUrl, Ollama baseUrl, and any API keys are restored in the UI. The Lock reassurance banner replaces the spinner.
**Why human:** Requires a live NIP-46 bunker; the loading→loaded transition and data restoration cannot be confirmed statically.

#### 4. Export/Import escape hatch end-to-end (SC-3)

**Test:** Configure LM Studio baseUrl and an API key. Click "Export settings". Confirm the persistent orange warning appears. Paste the clipboard into a text editor and confirm the JSON contains `providerOverrides.lmstudio.apiKey`. Then rotate accounts or simulate a decrypt failure (corrupt the envelope). Paste the exported JSON into the Import textarea. Click "Import". Verify the UI shows the restored config. Wait 350ms and inspect localStorage to confirm the encrypted blob is updated.
**Expected:** Provider config and API keys are restored. The debounced save re-encrypts to the current signer. The `earthly.chat-settings.v1.<pubkey>` entry is updated.
**Why human:** Clipboard I/O, the `exported` state banner, and the re-encrypt-via-save timing all require a running browser.

### Gaps Summary

No gaps were found. All 15 must-haves are verified by static analysis and the test gate (24/24 pass, build clean). Five of the truths touch runtime behavior that is only safely confirmable in a live browser with a real signer — those are surfaced as human verification items, not blockers.

The two review-fix commits (CR-01 `loadFailedRef` save guard, CR-02 pubkey identity check) are confirmed present in the code at the expected locations and are structurally correct by inspection. They are escalated to human verification per the `<recent_changes_note>` instruction because their lifecycle timing depends on async NIP-46 signer behavior that cannot be falsified statically.

---

_Verified: 2026-06-16T15:15:00Z_
_Verifier: Claude (gsd-verifier)_
