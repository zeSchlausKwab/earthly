# Phase 1: Encrypted Settings Persistence - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 7 (5 modified, 2 created)
**Analogs found:** 6 / 7 (test files have no in-repo analog — see "No Analog Found")

This phase AMENDS existing `src/features/chat/` code. Most "analogs" are the very files
being modified — the planner should mirror each file's **own current** idiom (envelope
read/write, generation guard, partialize allow-list, action+selector shape) when extending
it. Cross-file analogs are called out where a new capability has no in-file precedent
(observable status slice, clipboard export, test files).

## File Classification

| Target File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------|---------|------|-----------|----------------|---------------|
| `src/features/chat/settingsStorage.ts` | modified | crypto helper (encrypt-to-self envelope) | transform (decrypt→parse→migrate / serialize→encrypt) | itself (v1 envelope read/write) | exact (self) |
| `src/features/chat/store.ts` | modified | zustand store (types + actions + selector + persist) | CRUD / transform | itself (`hydrateSettings`, `resolveProvider`, persist `merge`/`partialize`) | exact (self) |
| `src/features/chat/useChatSettingsSync.ts` | modified | hook (async load lifecycle + debounced save) | event-driven (signer change → load/save) | itself (generation guard, legacy scrub) | exact (self) |
| `src/features/chat/routstr.ts` | read-only ref | config/domain data (`BUILTIN_PROVIDERS`) | — (lookup source) | itself | exact (self) |
| `src/features/chat/ChatSettingsSection.tsx` | modified | UI component (settings surface) | request-response (store selectors → render; user action → store) | itself (provider/model UI) + `ChatPanel.tsx:1718-1731` (clipboard) | role-match |
| `src/features/chat/settingsExport.ts` | created | pure util (serialize + validate) | transform (snapshot↔JSON) | `settingsStorage.ts` migrate helper + `store.ts` defensive `merge` | role-match |
| `src/features/chat/*.test.ts` | created | test | — | NONE in repo | no analog |

## Pattern Assignments

### `src/features/chat/settingsStorage.ts` (crypto helper, transform)

**Analog:** itself — the existing v1 envelope (full file read, 64 lines). Extend in place; do not fork a parallel crypto path.

**Envelope type + key prefix** (`settingsStorage.ts:4-17`) — mirror this exactly, bump only the `version` literal:
```typescript
const CHAT_SETTINGS_STORAGE_PREFIX = 'earthly.chat-settings.v1'   // KEEP prefix .v1 (Pitfall 1) — do NOT bump to .v2
type Scheme = 'nip04' | 'nip44'
interface StoredChatSettingsEnvelope {
	version: 1                  // ← bump to 2 on write; accept 1|2 on read for migration
	scheme: Scheme
	ciphertext: string
	updatedAt: number
}
function getChatSettingsStorageKey(pubkey: string): string {
	return `${CHAT_SETTINGS_STORAGE_PREFIX}.${pubkey}`
}
```

**Scheme negotiation** (`settingsStorage.ts:19-23`) — D-06/D-07 "preferred nip44, fallback nip04"; reuse verbatim for save, keep for export re-encrypt:
```typescript
function resolveEncryptionScheme(signer: ISigner): Scheme {
	if (signer.nip44) return 'nip44'
	return 'nip04'
}
```

**LOAD path — insertion point for `migrateV1ToV2`** (`settingsStorage.ts:25-43`):
```typescript
const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
if (!provider) throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
return JSON.parse(decrypted) as ChatSettingsSnapshot   // ← migrate here: key off envelope.version, fallback shape-sniff
```
Note: line 38-40 already throws when the current signer lacks the recorded scheme — this is the correct "failed" trigger for Pattern 3 (Pitfall 5). Keep the throw; do not swallow it.

**SAVE path** (`settingsStorage.ts:45-64`) — mirror, write `version: 2`:
```typescript
const scheme = resolveEncryptionScheme(signer)
const provider = scheme === 'nip44' ? signer.nip44 : signer.nip04
if (!provider) throw new Error(`Active signer does not support ${scheme} encryption`)
const ciphertext = await provider.encrypt(pubkey, JSON.stringify(settings))
const envelope: StoredChatSettingsEnvelope = { version: 1, scheme, ciphertext, updatedAt: Date.now() }  // ← version: 2
window.localStorage.setItem(getChatSettingsStorageKey(pubkey), JSON.stringify(envelope))
```

**`typeof window === 'undefined'` guard** (`:29`, `:50`) — keep it; this is what lets the pure path run under `bun:test` (no DOM). Migration/validation logic must live in functions that don't touch `window`.

---

### `src/features/chat/store.ts` (zustand store, CRUD/transform)

**Analog:** itself. Three in-file patterns to mirror:

**Snapshot type + defaults** (`store.ts:128-142`) — the v1 shape to replace with v2 `providerOverrides` (RESEARCH Pattern 1). `DEFAULT_CHAT_SETTINGS` is the single defaults source; the v2 default must seed all three overrides as `{ baseUrl: '', apiKey: '' }`:
```typescript
export interface ChatSettingsSnapshot {
	provider: ProviderType
	customEndpoint: string      // ← remove; replaced by providerOverrides.custom
	customApiKey: string        // ← remove
	selectedModel: string | null
	toolsEnabled: boolean
}
export const DEFAULT_CHAT_SETTINGS: ChatSettingsSnapshot = { provider: 'routstr', customEndpoint: '', customApiKey: '', selectedModel: null, toolsEnabled: true }
```

**`resolveProvider` selector — D-03 fallback lands here** (`store.ts:582-597`). Current reads flat fields; rewrite to read `providerOverrides[type]` with `BUILTIN_PROVIDERS[type].baseUrl` fallback when override `baseUrl` empty:
```typescript
function resolveProvider(type: ProviderType, customEndpoint: string, customApiKey: string): ProviderConfig {
	if (type === 'custom') {
		return { type: 'custom', baseUrl: customEndpoint, apiKey: customApiKey || undefined, name: 'Custom', requiresPayment: false }
	}
	return BUILTIN_PROVIDERS[type]
}
```
Keep this **pure and exported-or-extractable** so it is unit-testable headless (Wave-0 test SET-01/D-03).

**Action + `chatActions` helper + `hydrateSettings` reconciler** (`store.ts:710-769`, `1585-1599`) — the defensive `?? DEFAULT_CHAT_SETTINGS.x` field-by-field reconstruction in `hydrateSettings` is the **exact migration/replace idiom** to follow for the v2 shape, and the model SET-03 import reuses to "replace, not merge":
```typescript
hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => {
	set({
		provider: settings.provider ?? DEFAULT_CHAT_SETTINGS.provider,
		customEndpoint: settings.customEndpoint ?? DEFAULT_CHAT_SETTINGS.customEndpoint,  // ← becomes providerOverrides reconstruction
		// ...
		models: [], modelsLoading: false, modelsError: null,
	})
},
```
New per-type override actions (e.g. `setProviderOverride(type, patch)`) follow the existing setter style (`setCustomEndpoint`/`setCustomApiKey` at `:715-721`) and MUST be mirrored into the `chatActions` helper object (`:1585-1599`) since the sync hook calls actions through that non-hook bridge.

**Observable `settingsStatus` slice (SET-02, Pattern 3) — NEW, in-file analog:** the existing `modelsLoading`/`modelsError` pair in `ChatState` (`store.ts:612-613`) + its setter usage in `loadModels` (`:732`, `:744-746`) is the closest in-repo analog for an async-status-in-the-store pattern. Mirror it: add `settingsStatus: 'idle'|'loading'|'loaded'|'failed'|'no-signer'` + `settingsError: string | null` to `ChatState`, with a `setSettingsStatus` action exposed through `chatActions`. Selectors are read granularly per CONVENTIONS.md ("each store value selected independently").

**`persist` partialize/merge — secret-exclusion invariant, MUST PRESERVE** (`store.ts:1551-1580`). This is the SC-1 guard. New `providerOverrides` (contains `apiKey`) must stay OUT of the allow-list:
```typescript
{
	name: 'chat-store',
	partialize: (state) => ({ chatSessions: state.chatSessions, activeChatId: state.activeChatId }),  // ← NEVER add provider/overrides/apiKey
	merge: (persistedState, currentState) => { /* defensive field-by-field rebuild — analog for migration style */ },
}
```
The `merge` reconciler (`:1557-1579`) is the second in-repo "defensive reconstruction from possibly-stale persisted shape" precedent for the v1→v2 migration style.

---

### `src/features/chat/useChatSettingsSync.ts` (hook, event-driven)

**Analog:** itself (full file, 170 lines). Three in-file patterns:

**Legacy plaintext scrub — the established migration/cleanup precedent** (`useChatSettingsSync.ts:55-89`). v1→v2 should follow this defensive `JSON.parse` → field-loop → re-write style. Note its scrub key list (`'customEndpoint'`, `'customApiKey'`, etc.) — verify it still matches after the shape change (RESEARCH Runtime State Inventory):
```typescript
for (const key of ['provider','customEndpoint','customApiKey','selectedModel','toolsEnabled'] as const) {
	if (key in parsed.state) { delete parsed.state[key]; changed = true }
}
```

**Stale-load generation guard — retry MUST reuse this (Pattern 3, Pitfall 2)** (`:104-128`):
```typescript
const generation = hydrateGenerationRef.current + 1
hydrateGenerationRef.current = generation
void (async () => {
	try {
		const settings = await loadEncryptedChatSettings(signer, userPubkey)
		if (hydrateGenerationRef.current !== generation) return   // stale: bail — keep verbatim
		chatActions.hydrateSettings(settings ?? DEFAULT_CHAT_SETTINGS)
		// AMEND: setSettingsStatus(settings === null ? 'loaded'/'empty' : 'loaded')
	} catch (error) {
		// :117-127 currently applies DEFAULTS + single toast → AMEND: setSettingsStatus('failed', message), do NOT mask as data
	}
})()
```
**No-signer branch** (`:97-102`) → amend to `setSettingsStatus('no-signer')` (D-12). **Loading** → set before `await` at `:107`. **Retry:** add a `settingsLoadNonce` store value to this effect's dep array (`:136` currently `[currentUser, signer]`); incrementing the nonce re-enters the effect and bumps `generation`, invalidating in-flight stale loads. Do NOT call the loader from a button handler (anti-pattern).

**Debounced save (350ms) + error-once toast** (`:138-169`) — reuse unchanged; it naturally re-encrypts to the current signer after an import `hydrateSettings` (satisfies D-07/D-09 with no explicit re-encrypt call). The `saveErrorRef` "toast only once" idiom (`:152-158`) is the convention for transient save errors.

---

### `src/features/chat/routstr.ts` (config data — read-only reference)

**Analog:** itself. `BUILTIN_PROVIDERS` (`routstr.ts:137-156`) is the D-03 fallback source — `lmstudio` → `http://localhost:1234/v1`, `ollama` → `http://localhost:11434/v1`. `ProviderType` (`:127`) is the union to validate against on import. **Unchanged this phase** (read-only); `resolveProvider` reads from it. Note the type is `Record<Exclude<ProviderType,'custom'>, ProviderConfig>` — `custom` has no builtin entry, consistent with overrides covering custom's baseUrl.

---

### `src/features/chat/ChatSettingsSection.tsx` (UI, request-response)

**Analog:** itself (full file, 373 lines) for the store-selector + Radix-control idiom; `ChatPanel.tsx:1718-1731` for the clipboard pattern.

**Store consumption + control idiom** (`ChatSettingsSection.tsx:50-68`, `166-198`) — the destructured `useChatStore()` selector and the `provider === 'custom'` endpoint/apiKey `<Input>` block are the template for the new per-type address fields and for selecting `settingsStatus`/`settingsError`:
```typescript
const { provider, customEndpoint, customApiKey, /* ... */ setCustomEndpoint, setCustomApiKey } = useChatStore()
// :166-198 — <Input value={customEndpoint} onChange={(e)=>setCustomEndpoint(e.target.value)} disabled={isStreaming} />
```

**Existing status-banner idiom for the load-state surface** (`:357-370`) — the dashed-border `Lock`/`KeyRound` signed-in hint is the closest in-file analog for the SET-02 loading/failed/loaded/no-signer banner. Extend this region; use `lucide-react` icons already imported (`AlertTriangle` for failed, `Lock`/`KeyRound` present) per RESEARCH Standard Stack.

**Error text idiom** (`:325`): `{modelsError ? <p className="text-xs text-destructive">{modelsError}</p> : null}` — mirror for `settingsError`.

**Clipboard export (D-08/D-10) — analog `ChatPanel.tsx:1718-1731`:**
```typescript
const onCopy = async () => {
	try {
		await navigator.clipboard.writeText(text)
		setCopied(true); window.setTimeout(() => setCopied(false), 1500)
	} catch (error) { console.error('Failed to copy bubble content', error) }
}
```
For export: `navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))` in try/catch → `toast.success` + a **persistent** plaintext-secrets warning (D-10), using the same `AlertTriangle`/`DangerIndicator` (`:35-48`) treatment already in this file.

**Import (D-09):** controlled `<textarea>` paste (not `clipboard.readText`) → `JSON.parse` in try/catch → `validateImportedSnapshot` (from `settingsExport.ts`) → `chatActions.hydrateSettings(validated)` (replaces) → debounced save re-encrypts. `toast.error('Invalid settings JSON')` on failure (CONVENTIONS error idiom: `error instanceof Error ? error.message : 'fallback'`).

---

### `src/features/chat/settingsExport.ts` (pure util, transform — NEW)

**Analog:** the pure-function shape of `migrateV1ToV2` (lives in `settingsStorage.ts`) + the defensive `?? default` field reconstruction in `store.ts` `hydrateSettings` (`:758-769`) and `merge` (`:1557-1579`). No DOM, no `window` — so it is `bun:test`-able headless.

Contents (per RESEARCH Pattern 4 validation list): `serializeSnapshot(snapshot): string`, `validateImportedSnapshot(parsed: unknown): ChatSettingsSnapshot` (top-level object guard; `provider ∈ ProviderType`; per-type `{baseUrl,apiKey}` coerce-missing-to-`''`; accept v1 via `migrateV1ToV2`; `selectedModel: string|null`; `toolsEnabled: boolean` default true; size cap). Hand-written type guards match the repo style (Zod is env-only per CONVENTIONS.md:268-270). Named exports only; `import type` for type-only imports (`verbatimModuleSyntax`).

---

## Shared Patterns

### Encrypt-to-self (NIP-44 preferred, NIP-04 fallback)
**Source:** `settingsStorage.ts:19-23, 37-41, 52-55`
**Apply to:** settingsStorage load/save AND export/import re-encrypt. Single crypto seam via `signer.nip44 ?? signer.nip04` (property-object form, NOT method form — trust installed `ISigner`, see RESEARCH State of the Art). Never hand-roll crypto.

### Secret exclusion from persisted state (SC-1)
**Source:** `store.ts:1551-1556`
**Apply to:** store changes. `partialize` is an allow-list of `chatSessions` + `activeChatId` only. Any new secret-bearing field (`providerOverrides[*].apiKey`) stays out. Add a Wave-0 assertion that `JSON.parse(localStorage['chat-store'])` contains no `apiKey`/`baseUrl`.

### Defensive shape reconstruction (migration idiom)
**Source:** `useChatSettingsSync.ts:55-89` (legacy scrub) + `store.ts:1557-1579` (merge) + `store.ts:758-769` (hydrateSettings)
**Apply to:** `migrateV1ToV2`, import validation. Field-by-field `?? default`, try/catch around `JSON.parse`, never trust the persisted/pasted shape.

### Error handling + toasts
**Source:** CONVENTIONS.md:108-137; `useChatSettingsSync.ts:117-127, 152-158`
**Apply to:** all new error paths. `console.warn`/`console.error` with bracketed prefix for devs; `toast.error(error instanceof Error ? error.message : 'fallback')` for users; `void (async()=>{})()` IIFE in effects/handlers; "toast only once" ref guard for repeating async failures.

### Biome/style
**Source:** CONVENTIONS.md:44-105
**Apply to:** all files. Tabs, single quotes, semicolons-as-needed, `import type`, named exports only (default export reserved for `App`), 100-col width, `@/` for cross-feature imports / relative within `chat/`.

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `src/features/chat/*.test.ts` | test | Repo has **zero** test files; no `bun:test` import/structure precedent exists in-repo. |

**Test convention to ESTABLISH (no in-repo analog):**
- Framework: `bun:test` builtin (Bun 1.3.11). Import: `import { describe, expect, test } from 'bun:test'`.
- **No test wiring exists yet:** `package.json` `scripts` has **no `test` entry**; `bunfig.toml` exists (`[serve.static]` + plugins only) with **no `[test]` section**. `bun test` auto-discovers `*.test.ts` — no config needed, but a `"test": "bun test"` script should be added for the gate.
- Co-locate tests next to source: `settingsStorage.test.ts`, `store.test.ts`, `settingsExport.test.ts`.
- Scope to **pure functions only** (`migrateV1ToV2`, `validateImportedSnapshot`, `resolveProvider`, partialize-output assertion) — no DOM harness (happy-dom/jsdom NOT installed); cover hook/UI behavior via manual UAT.
- Gate is `bun test` + `bun run build` + `biome` (NOT `tsc --noEmit` — ~305 pre-existing baseline errors per MEMORY).

## Metadata

**Analog search scope:** `src/features/chat/` (target dir), `src/features/chat/ChatPanel.tsx` (clipboard), `package.json` + `bunfig.toml` (test wiring)
**Files scanned:** settingsStorage.ts (full), useChatSettingsSync.ts (full), routstr.ts (1-160), store.ts (120-180, 575-775, 1540-1600), ChatSettingsSection.tsx (full), ChatPanel.tsx (clipboard site), package.json, bunfig.toml
**Pattern extraction date:** 2026-06-16
