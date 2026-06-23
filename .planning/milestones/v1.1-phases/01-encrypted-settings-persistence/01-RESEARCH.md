# Phase 1: Encrypted Settings Persistence - Research

**Researched:** 2026-06-16
**Domain:** Encrypted localStorage persistence of chat provider config, encrypt-to-self via applesauce `ISigner` (NIP-44/NIP-04), async/fallible NIP-46 load lifecycle, clipboard export/import — amending existing `src/features/chat/` code.
**Confidence:** HIGH (grounded in the exact files this phase amends; no external dependencies introduced)

## Summary

This phase amends a working, partially-built persistence layer. The crypto envelope (`settingsStorage.ts`), the async-load + debounced-save lifecycle with a generation-counter stale-load guard (`useChatSettingsSync.ts`), and the legacy `chat-store` plaintext scrub all already work. Three concrete gaps remain, each mapping to one requirement: SET-01 needs the flat `customEndpoint`/`customApiKey` snapshot replaced by **per-provider-type address overrides** (`{ lmstudio, ollama, custom }`, each `{ baseUrl, apiKey }`); SET-02 needs the silent "load failed → defaults" path replaced by a **visible loading/failed state surfaced in the settings UI**; SET-03 needs **clipboard export (decrypt → plaintext JSON) and paste import (validate → re-encrypt → replace)**.

The single most important structural fact: `useChatSettingsSync()` is invoked exactly once, as a side-effect-only hook in `App.tsx:8` (`useChatSettingsSync()` returns `void`). Its load/error state lives entirely in `useRef` cells inside the hook and is **never exposed to React**. `ChatSettingsSection.tsx` reads provider/model/etc. straight from the Zustand store and derives a static "signed in / not signed in" hint from `useActiveAccount()` — it has no idea whether a load is in flight, succeeded, or failed. Closing SET-02 therefore requires promoting load state from refs into observable state (a Zustand slice on the chat store is the lowest-friction option, since the hook already imports `chatActions`) so the settings surface can render loading / failed / loaded distinctly.

The secret-leak invariant (success criterion 1) is **already correctly upheld and must not be broken**: the chat store's `persist` middleware uses `partialize` to persist only `chatSessions` + `activeChatId` (`store.ts:1553-1556`) — `customApiKey` and friends are deliberately excluded from `chat-store` localStorage and from any devtools-serialized persisted snapshot. The new per-type `apiKey` overrides live in the same non-persisted region of state and flow only through the encrypted envelope in `settingsStorage.ts`. The plan must keep new secret fields out of `partialize`.

**Primary recommendation:** Bump the envelope to `version: 2` with a per-type `providerOverrides` shape; add a `migrateSnapshot(v1)→v2` pure function in `settingsStorage.ts` (mirroring the existing legacy-scrub pattern); promote the sync hook's ref-based load state into a small observable settings-status slice on the chat store; render loading/failed/loaded/no-signer in `ChatSettingsSection.tsx`; add export/import that reuse the existing decrypt/encrypt helpers and `hydrateSettings`. No new npm packages. Add a `bun:test` Wave-0 harness for the migration + validation pure functions (currently zero test files exist).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Encrypt/decrypt envelope (encrypt-to-self) | Crypto helper module (`settingsStorage.ts`) | applesauce `ISigner` (browser ext / NIP-46 remote) | Single crypto seam; signer provides nip44/nip04 |
| Snapshot shape + v1→v2 migration | Crypto helper module (`settingsStorage.ts`) + store types (`store.ts`) | — | Shape is defined in store, migrated on load in storage |
| Per-type override fallback to localhost defaults | Store selector / `resolveProvider` (`store.ts` + `routstr.ts`) | `BUILTIN_PROVIDERS` | Defaults are domain data in `routstr.ts` |
| Async load lifecycle + stale-load guard | Sync hook (`useChatSettingsSync.ts`) | Zustand store (status slice) | Hook owns generation counter; store owns observable status |
| Visible load/failed/retry state | Settings UI (`ChatSettingsSection.tsx`) | Zustand status slice | UI tier renders; state must be observable, not ref-bound |
| Clipboard export/import | Settings UI (`ChatSettingsSection.tsx`) | crypto helpers + `hydrateSettings` | UI triggers; reuses existing decrypt/encrypt + hydrate |
| No-signer in-memory-only behavior | Sync hook (`useChatSettingsSync.ts`) | — | Already resets to defaults when no signer |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-signers` | `0.0.0-next-20260610164519` (pinned) | `ISigner` with optional `nip44`/`nip04` `{encrypt,decrypt}` providers | Already the app's signer abstraction; `settingsStorage.ts` already consumes it `[VERIFIED: node_modules/applesauce-signers/dist/interop.d.ts:4-15]` |
| `applesauce-react` | `^6.0.0` | `useActiveAccount()` → `{ signer, pubkey }` | Already the source of the active account in `useChatSettingsSync.ts:1,29` and `ChatSettingsSection.tsx:15,51` `[VERIFIED: package.json:68]` |
| `zustand` | `^5.0.12` | Chat store + `persist` middleware (`partialize`/`merge`) | Already the store; partialize already enforces secret exclusion `[VERIFIED: package.json:97, store.ts:1551-1580]` |
| `sonner` | (installed) | Toasts for transient notices | Already the convention; used throughout `useChatSettingsSync.ts` + store `[VERIFIED: store.ts:29, useChatSettingsSync.ts:3]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | (installed) | Icons for load/failed/retry states | Settings UI already imports many (`Lock`, `KeyRound`, `AlertTriangle`) `[VERIFIED: ChatSettingsSection.tsx:2-14]` |
| `@/components/ui/*` (Radix) | (installed) | `Button`, `Input`, `Label`, `Tooltip` | Reuse for export/import buttons + warning UI `[VERIFIED: ChatSettingsSection.tsx:16-21]` |
| `navigator.clipboard.writeText` | Web API | Export plaintext JSON to clipboard | Established pattern across 14 call sites `[VERIFIED: grep src/]` |
| `bun:test` | Bun 1.3.11 builtin | Unit tests for migration + validation pure functions | Wave 0 — no test files exist today `[VERIFIED: bun --version; CONCERNS.md "Zero Test Files"]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zustand status slice for load state | Return state object from `useChatSettingsSync()` + lift to a context/prop | Hook is currently called once in `App.tsx` as `void`; switching to a returned value forces a provider/prop chain to reach `ChatSettingsSection`. A store slice is lower-friction and matches existing `chatActions.hydrateSettings` flow. `[ASSUMED]` (planner's discretion per D-11) |
| `navigator.clipboard.readText()` for import | Controlled `<textarea>` paste field | `readText()` needs an extra clipboard-read permission prompt and fails in some browsers/contexts; a paste-into-textarea field is more reliable and is the safer default for import. `[CITED: MDN Clipboard API]` |
| Hand-rolled JSON validation | Zod schema | Codebase uses Zod for env only (`CONVENTIONS.md` line ~268-270); a small hand-written type guard matches the existing runtime-validation style. Either is acceptable. `[ASSUMED]` |

**Installation:** None. No new packages required. (Optional Wave-0 dev dep for DOM-level tests — see Validation Architecture; the migration/validation logic is pure and needs no DOM.)

## Package Legitimacy Audit

> This phase installs **no new external packages**. All work reuses already-installed dependencies.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No installs in this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Keep the **flat model** — single active configuration, not a list of named profiles. (Named profiles explicitly deferred.)
- **D-02:** Persist **per-provider-type address overrides**: each of `lmstudio`, `ollama`, `custom` keeps its own remembered `{ baseUrl, apiKey }`. Switching provider away and back must preserve each provider's address (satisfies SET-01's "LM Studio *and* Ollama addresses persist").
- **D-03:** Empty/unset overrides fall back to hardcoded `BUILTIN_PROVIDERS` defaults (`http://localhost:1234/v1` LM Studio, `http://localhost:11434/v1` Ollama). A fresh user still gets localhost.
- **D-04:** The **active provider type** is persisted, alongside `selectedModel` and `toolsEnabled` (already persisted today).
- **D-05:** This changes the `ChatSettingsSnapshot` shape. The envelope is versioned (`version: 1` today) — bump the version and handle migration of existing v1 envelopes on load.
- **D-06:** Keep the **current scheme: NIP-44 preferred, NIP-04 fallback**, encrypt-to-self (peer = user's own pubkey), chosen scheme recorded in the envelope. No NIP-44-only hard requirement.
- **D-07:** Natural scheme upgrade is acceptable: load reads whatever scheme the envelope records; save writes the preferred scheme on the current signer. **No explicit re-encrypt-on-load step required.**
- **D-08:** Export = **copy plaintext JSON to clipboard** (decrypted, **including API keys** — recovery hatch must work even when the old signer is gone). File download deferred.
- **D-09:** Import = **paste plaintext JSON**, validate, re-encrypt to the *current* signer's key, and **replace** current settings (flat model → replace, not merge).
- **D-10:** Surface a clear warning at export time that the clipboard now holds **plaintext secrets** (API keys).
- **D-11:** (Claude's Discretion) NIP-46 async decrypt path must show a **real loading state** and a **visible failed state** — never silently appear as data loss. Design a loading indicator + a distinguishable "decryption failed — your saved settings could not be loaded" state (vs. "no settings saved yet"), ideally with retry, rather than silently falling back to defaults.
- **D-12:** With no signer/account there is no key to encrypt-to → settings live **in-memory only**, not persisted. Already current behavior. Keep it; do **not** invent a plaintext anonymous-persistence path.

### Claude's Discretion
- **D-11** (SET-02 UX shape): loading indicator design, failed-vs-empty distinction, retry mechanism.
- JSON validation approach for import (Zod vs. hand-written type guard).
- Whether load status lives in a Zustand slice vs. a returned hook value (recommendation: store slice).

### Deferred Ideas (OUT OF SCOPE)
- **Multiple named provider profiles** — list of saved configs with name + management UI + quick-switch.
- **Plaintext-file export (download/upload)** in addition to clipboard.
- **Password-encrypted export** — wrapping the backup with a user passphrase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SET-01 | Chat provider config, API keys, and LM Studio/Ollama addresses persist across reloads, encrypted-to-self with the user's Nostr key | New `providerOverrides` per-type shape (Pattern 1) flowing through the existing `settingsStorage.ts` envelope + `hydrateSettings`. Fallback to `BUILTIN_PROVIDERS` (D-03). Secret-leak invariant preserved via `partialize`. |
| SET-02 | Encrypted settings load works with NIP-46 remote signers (async/fallible), failing **visibly** rather than silently appearing as data loss | Promote ref-based load state (`loadErrorRef`, generation counter at `useChatSettingsSync.ts:38,104-128`) into an observable status slice; render loading/failed/loaded/no-signer in `ChatSettingsSection.tsx`; retry re-runs the load through the generation guard (Pattern 3). |
| SET-03 | Export and re-import settings as an escape hatch against signer rotation/loss | Export: decrypt current state → plaintext JSON → clipboard + warning (D-08/D-10). Import: paste → validate → re-encrypt to current signer → `hydrateSettings` replace (D-09). Reuses existing `loadEncryptedChatSettings`/`saveEncryptedChatSettings` helpers (Pattern 4). |

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
  signer change          │  useActiveAccount()  → { signer, pubkey }│
  (login / NIP-46) ──────▶  (applesauce-react)                       │
                         └───────────────┬─────────────────────────┘
                                         │ triggers effect
                                         ▼
        ┌────────────────────────────────────────────────────────────┐
        │  useChatSettingsSync()  (App.tsx, runs once)                 │
        │  ─ generation counter guards stale async loads               │
        │  ─ 350ms debounced save                                      │
        │  ─ legacy chat-store plaintext scrub (one-time)              │
        │                                                              │
        │   LOAD path:                       SAVE path (debounced):    │
        │   loadEncryptedChatSettings()      saveEncryptedChatSettings()│
        └──────┬──────────────────────────────────────┬───────────────┘
               │ (async, fallible — NIP-46 latency)    │
               ▼                                        ▼
   ┌───────────────────────────┐         ┌──────────────────────────────┐
   │ settingsStorage.ts         │         │ localStorage                  │
   │ ─ read envelope            │◀───────▶│  earthly.chat-settings.v2.<pk>│
   │ ─ pick scheme from envelope│ decrypt │  { version, scheme,           │
   │ ─ signer.nip44/nip04 decrypt         │    ciphertext, updatedAt }     │
   │ ─ migrateSnapshot(v1→v2)   │ encrypt │                               │
   └───────────┬───────────────┘         └──────────────────────────────┘
               │ ChatSettingsSnapshot (v2: providerOverrides)
               ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ chatActions.hydrateSettings(snapshot)  → Zustand chat store      │
   │   provider, providerOverrides, selectedModel, toolsEnabled       │
   │   (secrets NOT in persist partialize — never serialized)         │
   │   + NEW: settingsStatus slice { phase, error }                   │
   └───────────────────────────┬─────────────────────────────────────┘
                               │ selectors
                               ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ ChatSettingsSection.tsx                                          │
   │   renders provider/model UI from store                          │
   │   NEW: loading / failed(+retry) / loaded / no-signer banner     │
   │   NEW: Export → decrypt-to-clipboard + warning                  │
   │   NEW: Import → paste textarea → validate → re-encrypt → replace │
   │   resolveProvider(type, providerOverrides) → BUILTIN fallback   │
   └───────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/features/chat/
├── settingsStorage.ts        # envelope: bump to v2, add migrateSnapshot(); reuse for export/import crypto
├── useChatSettingsSync.ts     # publish load status into store; retry action; keep generation guard
├── store.ts                   # ChatSettingsSnapshot v2 shape; providerOverrides actions; settingsStatus slice; hydrateSettings; resolveProvider
├── routstr.ts                 # BUILTIN_PROVIDERS defaults unchanged (D-03 fallback source)
├── ChatSettingsSection.tsx    # load-state banner, export/import buttons, per-type address fields
└── settingsExport.ts          # (optional new) pure export-serialize + import-validate helpers (testable)
```

### Pattern 1: Per-provider-type override snapshot (v2 shape) — SET-01, D-02/D-05
**What:** Replace flat `customEndpoint`/`customApiKey` with a per-type override map. Active provider type, model, and tools flag remain top-level.
**When to use:** This is the SET-01 data-model change.
**Current v1 shape** `[VERIFIED: store.ts:128-142]`:
```typescript
export interface ChatSettingsSnapshot {
  provider: ProviderType
  customEndpoint: string
  customApiKey: string
  selectedModel: string | null
  toolsEnabled: boolean
}
```
**Proposed v2 shape:**
```typescript
// Per-type override; routstr uses fixed BUILTIN baseUrl, so overrides cover the local/custom set
export interface ProviderOverride {
  baseUrl: string      // '' → fall back to BUILTIN_PROVIDERS[type].baseUrl (D-03)
  apiKey: string       // '' → no Authorization header
}

export interface ChatSettingsSnapshot {
  version?: 2                                  // snapshot-level version mirrors envelope (optional, for in-payload checks)
  provider: ProviderType                       // active type (D-04)
  providerOverrides: {
    lmstudio: ProviderOverride
    ollama: ProviderOverride
    custom: ProviderOverride
  }
  selectedModel: string | null
  toolsEnabled: boolean
}
```
`resolveProvider` (currently `store.ts:582-597`, reads flat `customEndpoint`/`customApiKey`) becomes: look up `providerOverrides[type]`, use its `baseUrl` if non-empty else `BUILTIN_PROVIDERS[type].baseUrl`, attach `apiKey` if non-empty. For `routstr`, baseUrl stays the BUILTIN fixed URL (override.baseUrl typically empty).

### Pattern 2: v1→v2 migration mirroring the legacy-scrub pattern — D-05
**What:** A pure `migrateSnapshot(parsed: unknown): ChatSettingsSnapshot` that detects a v1 payload (has `customEndpoint`/`customApiKey`, no `providerOverrides`) and folds it into v2.
**When to use:** Inside `loadEncryptedChatSettings`, after decrypt + `JSON.parse`, before returning.
**Why this pattern:** The codebase already migrates storage shapes in two places — the legacy `chat-store` plaintext scrub (`useChatSettingsSync.ts:55-89`, deletes old settings keys from the persisted store) and the zustand `merge` reconciler (`store.ts:1557-1579`, defensively rebuilds session state from possibly-stale persisted shape). v1→v2 should follow the same defensive, field-by-field reconstruction style.
**Mapping rule (in-the-wild v1 envelope migration — see Pitfall 4):**
```typescript
// v1 had a single customEndpoint/customApiKey that only mattered when provider==='custom'.
// Migrate it into the 'custom' override; lmstudio/ollama overrides start empty (→ localhost fallback).
function migrateV1ToV2(v1: V1Snapshot): ChatSettingsSnapshot {
  return {
    version: 2,
    provider: v1.provider ?? 'routstr',
    providerOverrides: {
      lmstudio: { baseUrl: '', apiKey: '' },
      ollama:   { baseUrl: '', apiKey: '' },
      custom:   { baseUrl: v1.customEndpoint ?? '', apiKey: v1.customApiKey ?? '' },
    },
    selectedModel: v1.selectedModel ?? null,
    toolsEnabled: v1.toolsEnabled ?? true,
  }
}
```
Note: the envelope's `version` field (`settingsStorage.ts:9`) is the authoritative version signal; key the migration off the **envelope** version, falling back to shape-sniffing the decrypted payload. The storage key prefix is `earthly.chat-settings.v1` (`settingsStorage.ts:4`) — **decide explicitly** whether to bump the key prefix to `.v2` or keep `.v1` and rely on the in-envelope `version` field. Recommendation: keep the localStorage **key prefix stable** and bump the in-envelope `version` to 2, so existing users' envelopes are found and migrated on load rather than orphaned (changing the prefix would strand v1 data and surface as silent data loss — the exact failure SET-02 forbids).

### Pattern 3: Promote ref-based load state to observable status — SET-02, D-11
**What:** The sync hook currently tracks load outcome only in refs: `hydrateGenerationRef` (stale-load guard, `useChatSettingsSync.ts:38,104-128`), `loadErrorRef` (`:43,116,123-126`), `loadedPubkeyRef` (`:39`). None reach React. Add a `settingsStatus: 'idle' | 'loading' | 'loaded' | 'failed' | 'no-signer'` plus `settingsError: string | null` to the chat store, set via new actions the hook already has access to (it imports `chatActions`).
**Load lifecycle (current → amended):**
1. Signer changes → effect at `useChatSettingsSync.ts:91`.
2. No signer/`currentUser` → reset to defaults (`:97-102`). **Amend:** set status `'no-signer'`.
3. Bump generation counter (`:104-105`). **Amend:** set status `'loading'`.
4. `await loadEncryptedChatSettings(signer, userPubkey)` (`:110`) — this is the async/fallible NIP-46 path (remote signer round-trips over relays).
5. Stale-load guard: if `hydrateGenerationRef.current !== generation` → bail (`:111,119`). Keep verbatim.
6. Success → `hydrateSettings(settings ?? DEFAULT)` (`:113`). **Amend:** status `'loaded'`. Distinguish `settings === null` (no envelope saved → "no settings saved yet") from a decrypted-and-applied envelope.
7. Failure (`catch`, `:117-127`) currently: applies defaults + single toast + sets `loadErrorRef`. **Amend:** status `'failed'`, store the error message, and do **not** silently overwrite with defaults in a way that looks like data — the UI must show "decryption failed — your saved settings could not be loaded" and offer **Retry**.
**Retry without re-introducing stale-load races:** A retry must run through the **same generation-counter guard**. Implement retry as "re-trigger the load effect": e.g., a `settingsLoadNonce` counter in the store that the load `useEffect` lists in its dependency array (alongside `currentUser, signer`). Incrementing the nonce re-enters the effect, which bumps `hydrateGenerationRef` again — so an in-flight stale load from a previous attempt still loses the generation check and cannot clobber the retry result. **Do not** call the async loader directly from a button handler outside the effect; that bypasses the guard and is the race the current architecture exists to prevent.

### Pattern 4: Export / import reusing existing crypto helpers — SET-03, D-08/D-09/D-10
**What:** Export decrypts current settings to plaintext JSON for the clipboard; import validates pasted JSON, re-encrypts to the current signer, and replaces.
**Export (D-08/D-10):** The decrypted plaintext is already in the store (the live snapshot), so export can serialize the current snapshot directly — no decrypt round-trip needed for the happy path. (If exporting from a *stale* envelope when the store hasn't loaded is desired, reuse `loadEncryptedChatSettings`.) Serialize → `navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))` (established pattern, 14 call sites incl. `ChatPanel.tsx:1725`) → `toast.success` + a **persistent warning** in the UI that the clipboard now holds plaintext API keys (D-10). Because export includes secrets, gate it so it works even if save is failing.
**Import (D-09):** Paste into a controlled `<textarea>` (avoids `clipboard.readText` permission friction) → `JSON.parse` in try/catch → **validate** (see below) → `chatActions.hydrateSettings(validated)` to **replace** (hydrateSettings already replaces, not merges, `store.ts:758-769`) → the debounced save effect then re-encrypts to the **current** signer automatically (no explicit re-encrypt call needed — saving on the new signer naturally writes the current preferred scheme, satisfying D-07). Show `toast.success` on success, `toast.error('Invalid settings JSON')` on parse/validation failure.
**Import validation requirements:**
- Top-level object, not null/array.
- `provider` ∈ `'routstr' | 'lmstudio' | 'ollama' | 'custom'` (reject unknown).
- `providerOverrides` object with `lmstudio`/`ollama`/`custom` each `{ baseUrl: string, apiKey: string }` (coerce missing → `''`). Accept a v1 payload too: run it through `migrateV1ToV2` so a backup taken from an older build still imports.
- `selectedModel`: `string | null`.
- `toolsEnabled`: `boolean` (default `true`).
- Reject overly large payloads (sanity cap) to avoid pasting an unrelated blob.

### Anti-Patterns to Avoid
- **Putting secret fields into `persist` `partialize`** (`store.ts:1553`). The whole encrypt-to-self design depends on `customApiKey`/per-type `apiKey` being excluded from the `chat-store` localStorage and from devtools-serialized persisted state. New `providerOverrides` (which contain `apiKey`) must stay out of `partialize`.
- **Calling the async loader from a retry button outside the load effect** — bypasses the generation-counter guard and re-introduces the stale-load race (Pattern 3).
- **Bumping the localStorage key prefix to `.v2`** — orphans in-the-wild v1 envelopes and presents as silent data loss (the exact SET-02 anti-goal). Keep the key prefix, bump the in-envelope `version`.
- **`clipboard.readText()` for import** — extra permission prompt, browser inconsistency. Use a paste-into-textarea field.
- **Silent fallback-to-defaults on decrypt failure** (current `useChatSettingsSync.ts:120`) presented as if it were the user's data — this is precisely what SET-02 forbids. Failure must be visible and distinguishable from "no settings yet".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Encrypt-to-self | A new crypto path | Existing `settingsStorage.ts` envelope (`signer.nip44 ?? signer.nip04`, peer = own pubkey) | Already implements scheme negotiation + per-pubkey keys; a parallel path risks divergent behavior `[VERIFIED: settingsStorage.ts:19-64]` |
| NIP-44/NIP-04 primitives | Calling `nostr-tools` nip44 directly | `signer.nip44.encrypt/decrypt` via `ISigner` | Works transparently across NIP-07 + NIP-46 remote signers; the signer routes to the right place `[VERIFIED: interop.d.ts:4-15]` |
| Stale-async-load protection | New mutex/flag logic | Existing generation-counter pattern (`hydrateGenerationRef`) | Battle-tested in the hook; retry must reuse it (Pattern 3) `[VERIFIED: useChatSettingsSync.ts:38,104-128]` |
| Storage-shape migration scaffolding | A migration framework | Pure `migrateV1ToV2` function + envelope `version` check, mirroring the legacy scrub | Matches existing defensive-reconstruction style `[VERIFIED: useChatSettingsSync.ts:55-89, store.ts:1557-1579]` |
| Clipboard write | Custom copy logic | `navigator.clipboard.writeText` (+ try/catch + toast) | 14 existing call sites with the same pattern `[VERIFIED: grep src/]` |
| Secret exclusion from persisted state | Manual stripping before persist | Existing zustand `partialize` allow-list | Already excludes secrets; just keep new secret fields out of it `[VERIFIED: store.ts:1553-1556]` |

**Key insight:** Every primitive this phase needs already exists in the codebase. The work is *shape change + state visibility + two UI affordances*, not new infrastructure. Resist adding libraries or parallel crypto/migration mechanisms.

## Runtime State Inventory

> This phase is a **storage-shape migration** (flat → per-type, envelope v1→v2). The Runtime State Inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | In-the-wild **v1 envelopes** at `earthly.chat-settings.v1.<pubkey>` (`settingsStorage.ts:4,15-17`), `{ version:1, scheme, ciphertext, updatedAt }` with v1 flat payload. Per-pubkey, one per account that ever saved chat settings. | **Data migration on load:** decrypt v1 → `migrateV1ToV2` → use; on next save the v2 envelope is written. Keep the **key prefix stable** so envelopes are found, not orphaned. |
| Stored data (legacy plaintext) | Legacy `chat-store` localStorage may still contain `provider`/`customEndpoint`/`customApiKey`/`selectedModel`/`toolsEnabled` from before encryption was added. | Already scrubbed one-time by `useChatSettingsSync.ts:55-89`. **Verify the scrub key list** still matches (it lists `customEndpoint`/`customApiKey` — after v2, also consider scrubbing any new persisted leakage, though partialize prevents new writes). |
| Live service config | None — settings are local-only (PROJECT.md: localStorage, no Nostr replaceable event, no cross-device sync). | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | API keys (`customApiKey`, new per-type `apiKey`) are runtime secrets held **only** in non-persisted store state + encrypted envelope. No env var or secret-manager key references this. | None — but the partialize invariant must be preserved (see Pitfall 3). |
| Build artifacts | None — TypeScript/React, no compiled-name coupling. | None. |

**The canonical question — after every file is updated, what still holds the old shape?** Only **in-the-wild v1 envelopes in users' browsers**. They are handled by the load-time `migrateV1ToV2`. There is no server-side or cross-device copy to migrate (local-only by design).

## Common Pitfalls

### Pitfall 1: Orphaning v1 envelopes by changing the storage key prefix
**What goes wrong:** Bumping the localStorage key from `earthly.chat-settings.v1.<pk>` to `.v2.<pk>` makes the loader look at a key that doesn't exist for returning users → `loadEncryptedChatSettings` returns `null` → defaults applied → user's saved provider/keys "vanish."
**Why it happens:** Conflating the *envelope version field* with the *storage key version*.
**How to avoid:** Keep the key prefix stable; bump only the in-envelope `version` to 2 and migrate on read.
**Warning signs:** Returning user reports "my settings reset after the update."

### Pitfall 2: Retry re-introducing the stale-load race
**What goes wrong:** A "Retry" button calls `loadEncryptedChatSettings` directly; a slow earlier NIP-46 load resolves afterward and clobbers the retry result with stale data.
**Why it happens:** Bypassing the generation-counter guard that the effect provides.
**How to avoid:** Drive retry by incrementing a store nonce that's in the load effect's dependency array; the effect bumps `hydrateGenerationRef`, invalidating any in-flight prior load (Pattern 3).
**Warning signs:** Intermittent "settings flicker back to old values after retry."

### Pitfall 3: Devtools / persist serialization leaking secrets
**What goes wrong:** Adding `providerOverrides` (containing `apiKey`) to `persist`'s `partialize`, or logging the snapshot, writes plaintext API keys into `chat-store` localStorage or devtools — violating success criterion 1 and the Out-of-Scope ban.
**Why it happens:** `partialize` is an allow-list; forgetting to keep secrets out is the default failure.
**How to avoid:** Confirm `partialize` (`store.ts:1553-1556`) still lists **only** `chatSessions` + `activeChatId`. Add a test/assertion that the persisted `chat-store` blob contains no `apiKey`/`baseUrl` after settings change.
**Warning signs:** `localStorage['chat-store']` contains an API key string.

### Pitfall 4: NIP-46 latency / timeout surfacing as "no settings"
**What goes wrong:** A remote signer is slow or temporarily offline; the decrypt promise hangs or rejects; current code applies defaults + one toast, indistinguishable from a fresh user.
**Why it happens:** No loading state, no failed-vs-empty distinction (the SET-02 gap).
**How to avoid:** Pattern 3 — show `'loading'` while awaiting, `'failed'` (with retry) on reject, and distinguish `settings===null` ("no settings saved yet") from a decrypt error. Consider a soft timeout that flips to `'failed'` rather than spinning forever.
**Warning signs:** Users on bunkers report "it forgot my keys" intermittently.

### Pitfall 5: NIP-04-only signer can't decrypt a NIP-44 envelope (and vice versa)
**What goes wrong:** Envelope records `scheme: 'nip44'` but the *current* signer only exposes `nip04` (or the reverse) → `loadEncryptedChatSettings` throws (`settingsStorage.ts:38-40`).
**Why it happens:** Scheme is chosen at save time from whatever the then-current signer supported; a later signer for the same pubkey may differ.
**How to avoid:** This is correctly an *error* (caught → `'failed'` state in Pattern 3), and the **export/import escape hatch (SET-03) is the recovery path** for it. Keep D-06's "preferred-with-fallback" save logic; do not force NIP-44-only.
**Warning signs:** "decryption failed" specifically after switching signer type for the same account.

### Pitfall 6: Biome/style violations (tabs, single quotes, `import type`, no-default-export)
**What goes wrong:** `bun run lint` fails the gate.
**How to avoid:** Tabs for indent, single quotes, semicolons as-needed, `import type` for type-only imports (`verbatimModuleSyntax`), named exports only, `void` for floating promises in effects/handlers. `[VERIFIED: CONVENTIONS.md]`
**Warning signs:** Biome check errors in CI.

## Code Examples

### Reading/writing the envelope (existing, to be extended) — `settingsStorage.ts`
```typescript
// Source: src/features/chat/settingsStorage.ts:25-64 (VERIFIED current code)
// LOAD: pick scheme from the stored envelope, decrypt with that scheme's provider.
const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
if (!provider) throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
return JSON.parse(decrypted) as ChatSettingsSnapshot   // ← insert migrateV1ToV2 here

// SAVE: pick the *preferred* scheme the current signer supports (nip44 else nip04).
const scheme = resolveEncryptionScheme(signer)          // nip44 if signer.nip44 else nip04
const provider = scheme === 'nip44' ? signer.nip44 : signer.nip04
const ciphertext = await provider.encrypt(pubkey, JSON.stringify(settings))
// envelope.version: bump 1 → 2; keep key prefix 'earthly.chat-settings.v1' (D-07 natural upgrade)
```

### Stale-load guard (existing, retry must reuse) — `useChatSettingsSync.ts`
```typescript
// Source: src/features/chat/useChatSettingsSync.ts:104-119 (VERIFIED current code)
const generation = hydrateGenerationRef.current + 1
hydrateGenerationRef.current = generation
void (async () => {
  const settings = await loadEncryptedChatSettings(signer, userPubkey)
  if (hydrateGenerationRef.current !== generation) return   // stale load: bail
  chatActions.hydrateSettings(settings ?? DEFAULT_CHAT_SETTINGS)
  // AMEND: set status 'loaded' (or 'no-signer'); distinguish settings===null = "no settings yet"
})()
// RETRY: add `settingsLoadNonce` to this effect's deps; incrementing it re-enters the effect,
// bumping `generation` again so any in-flight prior load fails the guard above.
```

### Secret-exclusion invariant (existing, must preserve) — `store.ts`
```typescript
// Source: src/features/chat/store.ts:1551-1556 (VERIFIED current code)
{
  name: 'chat-store',
  partialize: (state) => ({
    chatSessions: state.chatSessions,
    activeChatId: state.activeChatId,
  }),   // ← provider/providerOverrides/apiKey deliberately EXCLUDED. Keep it this way.
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plaintext settings in `chat-store` persist | Encrypt-to-self envelope in dedicated per-pubkey key + scrub | (already done, pre-phase) | This phase extends it, doesn't introduce it |
| Flat `customEndpoint`/`customApiKey` (single config) | Per-type `providerOverrides` (D-02) | This phase | LM Studio + Ollama addresses both persist across provider switches |
| Silent load-fail → defaults + one toast | Visible loading/failed/retry state (D-11) | This phase | NIP-46 failures no longer masquerade as data loss |

**Deprecated/outdated:**
- `Nip07Interface` is `@deprecated`; use `ISigner` (`interop.d.ts:16-17`). The codebase already uses `ISigner`.
- The applesauce-signers SKILL.md shows method-style `nip04Encrypt(...)` on the signer; the **installed** `ISigner` uses **property-object** form `signer.nip04?.encrypt(...)` / `signer.nip44?.encrypt(...)` `[VERIFIED: interop.d.ts:4-15]`. Trust the installed type, not the skill's illustrative signature.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Load status is best published via a Zustand store slice (vs. a returned hook value) | Standard Stack / Pattern 3 | If planner prefers a returned-value/context approach, refactor of `App.tsx`/prop chain needed; both satisfy D-11. Low risk — discretion area. |
| A2 | Import via controlled `<textarea>` paste rather than `clipboard.readText()` | Pattern 4 / Alternatives | If product wants one-click paste, `readText()` adds a permission prompt; textarea is the safer default. Low risk. |
| A3 | `routstr` provider does not need a user-editable baseUrl override (fixed BUILTIN URL) | Pattern 1 | If users want a custom Routstr endpoint, `providerOverrides` could include `routstr`. D-02 names only lmstudio/ollama/custom; including routstr is a harmless superset. Low risk. |
| A4 | Hand-written type guard for import validation is acceptable (vs. Zod) | Pattern 4 | Codebase uses Zod for env only; either matches. Low risk. |
| A5 | Keep localStorage key prefix at `.v1`, bump only in-envelope `version` | Pattern 2 / Pitfall 1 | If planner bumps the prefix, returning users lose settings. This recommendation is load-bearing — flag for confirmation. Medium risk if ignored. |

## Open Questions

1. **Should the localStorage key prefix change to `.v2`?**
   - What we know: prefix is `earthly.chat-settings.v1` (`settingsStorage.ts:4`); envelope carries its own `version` field.
   - What's unclear: whether the planner intends a prefix bump.
   - Recommendation: **Keep the prefix**, bump the envelope `version`, migrate on read (Pitfall 1). Confirm with user if they expected a prefix change.

2. **Does `routstr` need a per-type override entry?**
   - What we know: D-02 names lmstudio/ollama/custom; `routstr` uses a fixed BUILTIN URL.
   - Recommendation: omit `routstr` from overrides for now (A3); trivially added later if needed.

3. **Soft timeout for the NIP-46 load before flipping to `'failed'`?**
   - What we know: remote-signer decrypt can hang. No timeout exists today.
   - Recommendation: planner's discretion under D-11 — a bounded timeout that transitions to `'failed'` (with retry) avoids an indefinite spinner.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | dev/build/test | ✓ | 1.3.11 | — |
| `bun:test` | Wave-0 unit tests | ✓ (builtin) | Bun 1.3.11 | — |
| `applesauce-signers` `ISigner` | encrypt/decrypt | ✓ | 0.0.0-next-20260610164519 | — |
| `zustand` persist | store | ✓ | 5.0.12 | — |
| `navigator.clipboard` | export | ✓ (browser; HTTPS/localhost) | Web API | textarea-select fallback if blocked |
| DOM test environment (happy-dom/jsdom) | UI behavior tests | ✗ | — | Test the pure functions (migration, validation, resolveProvider) under `bun:test` with no DOM; cover UI via manual UAT |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** DOM test env absent — the load-state transitions and export/import UI are validated by manual UAT; the pure logic (migration, import validation, `resolveProvider` fallback, partialize-exclusion assertion) is unit-tested headless under `bun:test`.

## Validation Architecture

> `workflow.nyquist_validation` is enabled (config.json). This section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun 1.3.11 builtin) — `import { test, expect, describe } from 'bun:test'` |
| Config file | none — `bun test` auto-discovers `*.test.ts` (Wave 0: none exist) |
| Quick run command | `bun test src/features/chat/` |
| Full suite command | `bun test` (also gate: `bun run lint` + `bun run build`) |

The project gate is **`bun test` + `bun run build` + `biome`** (see MEMORY: tsc baseline has ~305 pre-existing errors, so `tsc --noEmit` is NOT a gate). Do not introduce a `tsc` gate.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SET-01 | v1→v2 migration maps `customEndpoint`/`customApiKey` into `providerOverrides.custom`; lmstudio/ollama default empty | unit | `bun test src/features/chat/settingsStorage.test.ts` | ❌ Wave 0 |
| SET-01 | `resolveProvider` returns override `baseUrl` when set, else `BUILTIN_PROVIDERS` localhost default (D-03) | unit | `bun test src/features/chat/store.test.ts` (or extract `resolveProvider` to a testable module) | ❌ Wave 0 |
| SET-01 | Switching provider lmstudio→ollama→lmstudio preserves each override (no clobber) | unit (store action) | `bun test src/features/chat/store.test.ts` | ❌ Wave 0 |
| SET-01 / SC-1 | Persisted `chat-store` blob contains no `apiKey`/override secret after a settings change (partialize invariant) | unit (assert serialized partialize output) | `bun test src/features/chat/store.test.ts` | ❌ Wave 0 |
| SET-02 | Load state transitions: loading → loaded; failure → failed (not silent defaults); `null` envelope → "no settings yet" distinct from failed | behavior (mock `ISigner`) | `bun test src/features/chat/useChatSettingsSync.test.ts` (logic extracted) OR manual UAT | ❌ Wave 0 / UAT |
| SET-02 | Retry re-enters generation guard; a resolved stale prior load does not clobber retry result | behavior (fake timers + mock async signer) | `bun test` (extract load reducer) OR manual UAT | ❌ Wave 0 / UAT |
| SET-02 | NIP-04-only signer against a `scheme:'nip44'` envelope → visible failed state, not crash | behavior / manual UAT | manual UAT with a NIP-04-only signer | UAT |
| SET-03 | Import validation: rejects malformed JSON, unknown `provider`, missing fields; accepts v1 + v2 payloads | unit | `bun test src/features/chat/settingsExport.test.ts` | ❌ Wave 0 |
| SET-03 | Export→import round-trip reproduces the same effective config | unit (serialize→validate→hydrate equivalence) + manual UAT for clipboard | `bun test src/features/chat/settingsExport.test.ts` | ❌ Wave 0 |
| SC-1 | Secrets absent from devtools-serialized state | manual | devtools/localStorage inspection: `JSON.parse(localStorage['chat-store'])` has no key/baseUrl | manual |
| SC-2 | NIP-46 visible loading + visible failed | manual UAT | bunker signer, throttle/offline relay, observe banner | manual |
| SC-3 | Export after signer rotation recovers config | manual UAT | export → switch account → import → verify | manual |

### Sampling Rate
- **Per task commit:** `bun test src/features/chat/` (fast, pure-function suites)
- **Per wave merge:** `bun test` + `bun run lint` + `bun run build`
- **Phase gate:** Full suite green + manual UAT of the three success criteria (NIP-46 load/fail, secret-leak inspection, export/import round-trip) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/features/chat/settingsStorage.test.ts` — covers SET-01 migration (v1→v2)
- [ ] `src/features/chat/store.test.ts` — covers SET-01 `resolveProvider` fallback, per-type preservation, partialize secret-exclusion (SC-1)
- [ ] `src/features/chat/settingsExport.test.ts` — covers SET-03 import validation + round-trip
- [ ] (Recommended) Extract pure logic into testable units: `migrateV1ToV2`, import `validateSnapshot`, `resolveProvider` — so they're unit-testable without DOM
- [ ] Framework: none to install (`bun test` builtin). If DOM-level hook tests are desired, add `happy-dom` as a dev dep — otherwise cover hook behavior via manual UAT (recommended given zero existing test infra).

*Note: the repo currently has **zero test files** (CONCERNS.md "Zero Test Files"). This phase introduces the first ones; keep them scoped to pure functions to avoid pulling in a DOM harness.*

## Security Domain

> `security_enforcement` enabled, ASVS level 1, block-on: high (config.json).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth introduced; relies on existing Nostr account/signer |
| V3 Session Management | no | No sessions beyond existing account |
| V4 Access Control | no | Local-only, single-user data |
| V5 Input Validation | **yes** | Import path: validate pasted JSON (type guard / Zod) before applying; reject unknown `provider`, malformed shape, oversized payloads (Pattern 4) |
| V6 Cryptography | **yes** | Encrypt-to-self via signer's NIP-44 (preferred) / NIP-04 — **never hand-roll**; reuse `settingsStorage.ts`. Secrets never in plaintext at rest (SC-1, Out-of-Scope ban). |
| V8 Data Protection | **yes** | Export deliberately emits plaintext secrets to clipboard (D-08) — must carry an explicit user-facing warning (D-10). Keep secrets out of `persist` partialize and logs. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Plaintext API key persisted to localStorage | Information Disclosure | partialize allow-list excludes secrets; only encrypted envelope persists (SC-1) `[VERIFIED: store.ts:1553]` |
| Secret leak via devtools/console serialization | Information Disclosure | Never log the snapshot; assert persisted blob has no secret (test) |
| Malicious/garbage pasted JSON on import | Tampering | Strict validation + try/catch + size cap before `hydrateSettings` (Pattern 4) |
| Clipboard holds plaintext secrets after export | Information Disclosure | Explicit warning at export (D-10); document that user should clear clipboard |
| Stale async load clobbers current data | Tampering (integrity) | Generation-counter guard; retry re-enters guard (Pattern 3) |
| Forcing NIP-44-only and stranding NIP-04 signers | Denial of Service (lockout) | Keep preferred-with-fallback (D-06); export/import is the recovery path (Pitfall 5) |

## Sources

### Primary (HIGH confidence)
- `src/features/chat/settingsStorage.ts` (full) — envelope, scheme negotiation, per-pubkey key
- `src/features/chat/useChatSettingsSync.ts` (full) — load/save lifecycle, generation guard, legacy scrub
- `src/features/chat/store.ts` — `ChatSettingsSnapshot`, `DEFAULT_CHAT_SETTINGS`, `hydrateSettings`, `resolveProvider`, persist `partialize`
- `src/features/chat/routstr.ts` — `ProviderType`, `ProviderConfig`, `BUILTIN_PROVIDERS` localhost defaults
- `src/features/chat/ChatSettingsSection.tsx` (full) — current settings UI, no load-state surface
- `node_modules/applesauce-signers/dist/interop.d.ts` — installed `ISigner` shape (`nip04`/`nip44` property providers)
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/CONCERNS.md` — style + zero-test-files + secret-in-localStorage notes
- `.planning/config.json` — nyquist_validation + security_enforcement on
- `src/App.tsx`, `package.json`, `bunfig.toml` — hook wiring, deps, build config

### Secondary (MEDIUM confidence)
- `.claude/skills/applesauce-signers/SKILL.md` — signer patterns (note: illustrative method-form signatures differ from installed property-form `ISigner`; trust the `.d.ts`)
- MDN Clipboard API (general guidance on `writeText` vs `readText` permissions)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency already installed and in use; verified against `package.json` and `.d.ts`
- Architecture / extension points: HIGH — read full source of all five amended files with line citations
- Pitfalls: HIGH — derived directly from current code behavior (silent fallback, key prefix, partialize, generation guard)
- SET-02 UX shape: MEDIUM — D-11 is explicitly Claude's discretion; recommendation is grounded but not user-locked

**Research date:** 2026-06-16
**Valid until:** ~2026-07-16 (stable; only risk is an applesauce-signers `next`-pin bump changing the `ISigner` surface — re-verify `interop.d.ts` if that pin moves)
