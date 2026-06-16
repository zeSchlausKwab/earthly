# Phase 1: Encrypted Settings Persistence - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Persist the chat provider configuration — active provider type, per-provider base URLs (LM Studio / Ollama / custom addresses), API keys, selected model, and tools-enabled flag — across reloads, **encrypted at rest to the user's own Nostr key** (encrypt-to-self). The load path must work with async/fallible remote signers (NIP-46) and fail visibly, and an export/import escape hatch must let the user recover settings after a signer rotation or loss.

This phase amends the **existing, partially-built** implementation in `src/features/chat/` (encryption + localStorage persistence + legacy scrub already work) — it does not rebuild from scratch. The remaining gaps are: per-provider address persistence (SET-01), a visible load/failed state for remote signers (SET-02), and export/import (SET-03).

**Locked storage decisions (from PROJECT.md / REQUIREMENTS.md — not re-litigated):**
- Persistence is **localStorage**, not a Nostr replaceable event. No cross-device sync this milestone.
- **Encrypt-to-self** with the user's Nostr key. Plaintext API keys in localStorage are explicitly out of scope.
- Decrypted secrets must **never** appear in any persisted or devtools-serialized state.

</domain>

<decisions>
## Implementation Decisions

### Config data model
- **D-01:** Keep the **flat model** — a single active configuration, not a list of named profiles. "Multiple saved profiles / named configs" was raised and explicitly deferred (see Deferred Ideas).
- **D-02:** Persist **per-provider-type address overrides**: each of `lmstudio`, `ollama`, and `custom` keeps its own remembered `{ baseUrl, apiKey }`. Switching provider away and back must preserve each provider's address — this is what satisfies SET-01's literal "LM Studio *and* Ollama addresses persist" requirement.
- **D-03:** Empty/unset overrides fall back to the current hardcoded defaults in `BUILTIN_PROVIDERS` (`http://localhost:1234/v1` for LM Studio, `http://localhost:11434/v1` for Ollama). A fresh user with no saved override still gets localhost.
- **D-04:** The **active provider type** is itself persisted, alongside `selectedModel` and `toolsEnabled` (already persisted today).
- **D-05:** This changes the `ChatSettingsSnapshot` shape (currently a single flat `customEndpoint`/`customApiKey`). The envelope is versioned (`version: 1` today) — bump the version and handle migration of any existing v1 envelopes on load.

### Encryption scheme
- **D-06:** Keep the **current scheme: NIP-44 preferred, NIP-04 fallback**, encrypt-to-self (peer = user's own pubkey), with the chosen scheme recorded in the stored envelope. Maximizes signer compatibility; NIP-04-only signers still work. No NIP-44-only hard requirement.
- **D-07:** Natural scheme upgrade is acceptable: load reads whatever scheme the envelope records; save writes the preferred scheme available on the current signer. No explicit re-encrypt-on-load step required.

### Export / import escape hatch (SET-03)
- **D-08:** Export = **copy plaintext JSON to the clipboard** (decrypted, **including API keys** — it's the recovery hatch, so it must work even when the old signer is gone). File download is deferred.
- **D-09:** Import = **paste plaintext JSON**, validate, re-encrypt to the *current* signer's key, and **replace** the current settings (flat model → replace, not merge).
- **D-10:** Surface a clear warning at export time that the clipboard now holds **plaintext secrets** (API keys).

### Remote-signer load/failed UX (SET-02) — Claude's Discretion
- **D-11:** Not discussed in detail by the user, left to planning. The success criterion is binding: the NIP-46 async decrypt path must show a **real loading state** and a **visible failed state** — never silently appear as data loss. The current behavior (silent load + single error toast, defaults applied on failure) is the gap to close. Planner should design a visible loading indicator on the settings surface and a distinguishable "decryption failed — your saved settings could not be loaded" state (vs. "no settings saved yet"), ideally with a retry, rather than silently falling back to defaults.

### Anonymous / no-signer behavior (derived constraint)
- **D-12:** With no signer/account there is no key to encrypt-to, so settings live **in-memory only** and are not persisted. This is inherent to encrypt-to-self and is already the current behavior (the sync hook resets to defaults when there is no signer). Keep it; do not invent a plaintext anonymous-persistence path.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — SET-01, SET-02, SET-03 (the three requirements for this phase) and the "Out of Scope" row banning plaintext API-key storage.
- `.planning/ROADMAP.md` — Phase 1 goal + three success criteria (verbatim acceptance conditions).
- `.planning/PROJECT.md` — Key Decisions table (encrypt-to-self, localStorage) and the milestone goal.

### Existing implementation to amend (NOT rebuild)
- `src/features/chat/settingsStorage.ts` — current encrypt-to-self envelope (NIP-44/NIP-04, per-pubkey localStorage key `earthly.chat-settings.v1.<pubkey>`). Extend the snapshot shape + version here.
- `src/features/chat/useChatSettingsSync.ts` — async load on signer change, debounced save, legacy plaintext scrub of `chat-store`, error toasts. The load/failed-state UX (SET-02) and migration live here.
- `src/features/chat/store.ts` — `ChatSettingsSnapshot`, `DEFAULT_CHAT_SETTINGS`, `hydrateSettings`, provider/customEndpoint/customApiKey actions (lines ~128-141, ~636-762). The flat→per-type model change lands here.
- `src/features/chat/routstr.ts` — `ProviderType`, `ProviderConfig`, `BUILTIN_PROVIDERS` with the localhost defaults (lines ~118-152). Source of the fallback addresses.
- `src/features/chat/ChatSettingsSection.tsx` — settings UI; export/import buttons and the load/failed state surface go here.

### Codebase maps (context)
- `.planning/codebase/CONCERNS.md` — pre-existing concerns; check before assuming a clean slate.
- `.planning/codebase/CONVENTIONS.md` — Biome/style conventions to match.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`settingsStorage.ts` encrypt/decrypt envelope** — already implements encrypt-to-self with scheme negotiation and per-pubkey keys. Reuse and extend the envelope; do not write a parallel crypto path.
- **`useChatSettingsSync.ts` hydration + debounced-save lifecycle** — generation-counter guard against stale async loads, 350ms debounced save, legacy-storage scrub. Build the new load-state UX and migration on top of this hook.
- **`BUILTIN_PROVIDERS`** — provides the localhost defaults for the per-type fallback (D-03).
- **`hydrateSettings` action** — the single entry point the sync hook uses to push loaded settings into the store; the new shape flows through here.

### Established Patterns
- **Versioned envelope + legacy scrub** — the codebase already migrates/cleans old storage shapes (the `chat-store` plaintext scrub). Follow the same pattern for the v1→v2 snapshot migration (D-05).
- **applesauce signers** — `ISigner` with optional `nip44` / `nip04` providers; `useActiveAccount()` from `applesauce-react/hooks` is the source of the active signer + pubkey.
- **`sonner` toasts** — current error surface; the new visible failed state should be richer than a toast (D-11) but toasts remain the convention for transient notices.

### Integration Points
- Active account/signer comes from `useActiveAccount()`; settings load is keyed to signer changes.
- Settings UI lives in `ChatSettingsSection.tsx`, rendered within the chat/settings panel.

</code_context>

<specifics>
## Specific Ideas

- The user's original phrasing — "Custom endpoint has to be persisted too. Maybe we can have multiple?" — drove the per-type override decision (D-02) and seeded the deferred "named profiles" idea.
- The export/import hatch is framed around the concrete failure mode it must survive: **the old signer is gone**. That is why export emits plaintext (the user can no longer decrypt the old envelope) rather than re-using encrypt-to-self for the backup.

</specifics>

<deferred>
## Deferred Ideas

- **Multiple named provider profiles** — a list of saved configs (e.g. "LM Studio — desktop", "Ollama — NAS", "Routstr") with a name + management UI and quick-switch. Raised by the user, deferred to keep this phase to persistence. Candidate for a later settings/UX phase or backlog.
- **Plaintext-file export (download/upload)** in addition to clipboard — a more durable backup artifact than the clipboard. Deferred; clipboard chosen for v1.1.
- **Password-encrypted export** — wrapping the backup with a user passphrase instead of plaintext. Deferred (adds a second secret to manage); revisit if plaintext-clipboard proves too risky in practice.

</deferred>

---

*Phase: 1-Encrypted Settings Persistence*
*Context gathered: 2026-06-16*
