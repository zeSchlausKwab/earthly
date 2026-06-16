---
status: testing
phase: 01-encrypted-settings-persistence
source: [01-VERIFICATION.md]
started: 2026-06-16T15:04:55Z
updated: 2026-06-16T15:04:55Z
---

## Current Test

number: 1
name: CR-01 save guard — decrypt failure must not overwrite recoverable ciphertext
expected: |
  After a decrypt failure, editing any setting (e.g. toggle toolsEnabled) and waiting ~350ms does NOT
  overwrite localStorage[earthly.chat-settings.v1.<pubkey>] — the original ciphertext stays intact and
  the failed-state banner remains visible. The save effect is short-circuited by loadFailedRef.
awaiting: user response

## Tests

### 1. CR-01 save guard — decrypt failure must not overwrite recoverable ciphertext
expected: After a decrypt failure, edit any setting and wait ~350ms; the encrypted blob in localStorage[earthly.chat-settings.v1.<pubkey>] is NOT replaced and the "Decryption failed" banner is still shown. (Requires a signer that deliberately fails decryption.)
result: [pending]

### 2. CR-02 cross-account guard — stale NIP-46 decrypt must not clobber another account
expected: Log in as account A; while A's NIP-46 decrypt is in flight (throttle the relay), switch to account B. Account A's settings (or A's "failed" status) are NOT hydrated into account B's session — the pubkey identity check catches the stale resolve and returns without mutating state.
result: [pending]

### 3. Full NIP-46 reload lifecycle (SET-02 / SC-2)
expected: With a NIP-46 bunker signer, on page load the Loader2 spinner appears, then settingsStatus transitions idle → loading → loaded; saved provider config and API keys (LM Studio baseUrl, Ollama baseUrl, custom baseUrl + apiKey) are restored and visible; the Lock banner reads "Changes are saved for the active Nostr account...".
result: [pending]

### 4. Export settings — plaintext warning + clipboard contents (SET-03 / D-08 / D-10)
expected: Configure at least one API key, click "Export settings"; the persistent orange AlertTriangle warning with "plaintext API keys" text appears immediately and persists; pasting the clipboard shows full JSON including providerOverrides with the configured apiKey.
result: [pending]

### 5. Import settings escape hatch — re-encrypt to current signer (SET-03 / SC-3)
expected: Paste a valid v2 JSON into the import textarea and click "Import"; the UI updates to match the imported provider/overrides and the debounced save re-encrypts to the current signer (localStorage[earthly.chat-settings.v1.<pubkey>] is updated within ~350ms).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
