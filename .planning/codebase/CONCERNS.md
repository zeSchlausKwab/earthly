# Codebase Concerns

**Analysis Date:** 2026-05-24

---

## Tech Debt

### NDK Compatibility Shim Still Required

- Issue: `src/lib/seed-relay/index.ts` is a full NDK API surface emulation built on applesauce, required because seed scripts (`scripts/seed.ts`, `scripts/seed_canonical_data.ts`, `scripts/gen_geo_events.ts`) still import `NDK`, `NDKEvent`, and `NDKPrivateKeySigner`.
- Files: `src/lib/seed-relay/index.ts`, `scripts/seed.ts`, `scripts/seed_canonical_data.ts`, `scripts/gen_geo_events.ts`
- Impact: The compat shim adds ~200 lines of code to maintain forever until scripts are rewritten. Any new NDK-like API needed in a seed script requires manual addition to the shim.
- Fix approach: Rewrite seed scripts to use applesauce primitives (`RelayPool`, `finalizeEvent`, `getPublicKey`) directly. Then delete `src/lib/seed-relay/` entirely.

### Legacy UX State Model Not Yet Replaced

- Issue: The UX rewrite (documented in `UX_REWRITE.md`) introduces three explicit stances (Browse / Focus / Author), a Map Shelf, and removes implicit mode promotion. The current store still contains the multi-mode system (`mode`, `viewMode`, `sidebarViewMode`, `editIsolationEnabled`, `activeContextScopeNaddr`, `activeContextScopeCoordinate`) that the rewrite explicitly targets.
- Files: `src/features/geo-editor/store/types.ts:121,246,253,314`, `src/features/geo-editor/store/viewModeSlice.ts`, `src/features/geo-editor/store/uiSlice.ts`
- Impact: The legacy mode graph produces state transition bugs described in `UX_REWRITE.md` — modes auto-promote on dataset load, route changes, and proposal acceptance. The user cannot navigate the state graph.
- Fix approach: Implement the stance model per `UX_REWRITE.md`. Replace `viewMode`, `sidebarViewMode`, and `editIsolationEnabled` with a single `stance: 'browse' | 'focus' | 'author'` plus explicit transition actions. Remove `activeContextScopeNaddr` implicit binding in favor of Map Shelf.

### GeoEditorView.tsx — Orchestrator Complexity

- Issue: `src/features/geo-editor/GeoEditorView.tsx` is 2,088 lines with 19 `useEffect` calls, 25+ `useMemo`/`useCallback` hooks, and ~15 `useState` declarations. It still contains legacy state variables `isDrawingMode` (hardcoded `false`, setter never defined) and `_setMapError` (underscore-prefixed setter that is never called, but `mapError` is rendered at line 1540).
- Files: `src/features/geo-editor/GeoEditorView.tsx:80,89-90`
- Impact: `isDrawingMode` is always `false` so the pan-lock logic at lines 905 and 1299 is inert dead code. `_setMapError` being prefixed with underscore means map errors can never actually be displayed — the display exists but the trigger does not.
- Fix approach: As part of the UX rewrite, split GeoEditorView rendering into stance-specific layout components. Remove dead `isDrawingMode` state and wire up `_setMapError` properly, or remove the error display.

### AppSidebar — Overlapping Entity/Content Mode System

- Issue: `src/components/AppSidebar.tsx` (863 lines) implements a secondary mode system (`splitWithEditor`, `activeEntity`, `entityIntent`, `contentMode`, `activeWorkMode`) that shadows the Zustand store's `sidebarViewMode`. These two systems must be kept in sync manually, and both are on the pre-rewrite side of the UX change.
- Files: `src/components/AppSidebar.tsx:225-229,265-300`
- Impact: Two independent sources of truth for what the sidebar shows. Bugs appear when `sidebarViewMode` changes externally without going through AppSidebar's local state.
- Fix approach: UX rewrite consolidates sidebar navigation into a single "navigator" role. AppSidebar's local state should be replaced by a single stance-derived prop.

### ChatPanel and Store — Monolithic Files

- Issue: `src/features/chat/ChatPanel.tsx` (1,845 lines) and `src/features/chat/store.ts` (1,603 lines) have no unit tests and contain deeply interleaved streaming, UI, tool execution, wallet, and payment logic. `src/features/chat/tools/helpers.ts` (1,322 lines) serializes AI tool call results with no independent test coverage.
- Files: `src/features/chat/ChatPanel.tsx`, `src/features/chat/store.ts`, `src/features/chat/tools/helpers.ts`
- Impact: Any change to the chat flow requires manually tracing through all three files. Wallet payment errors are swallowed to `console.error` and not surfaced to the user in all cases.
- Fix approach: Extract streaming logic into a dedicated hook. Extract tool execution into `useToolExecution` hook. Separate the Zustand store slices by concern (messages, payment, settings, tool state).

### `nostr-tools` Used as Implicit Transitive Dependency

- Issue: `nostr-tools` (version 2.18.2 installed) is imported directly in `src/index.ts`, `src/features/auth/SignupDialog.tsx`, `src/features/auth/LoginSessionButtons.tsx`, `src/features/social/hooks/useGeoReactions.ts`, and several other files, but is not listed in `package.json` as a direct dependency.
- Files: `src/index.ts:4`, `src/features/auth/SignupDialog.tsx:19`, `src/features/social/comments/GeoSocialActions.tsx:6`
- Impact: The installed version is resolved transitively through `applesauce-*`. Any applesauce version bump that pins a different `nostr-tools` major version silently breaks all `nip19` and `NostrEvent` type imports without a build error.
- Fix approach: Add `nostr-tools` as an explicit `^2.x` dependency in `package.json`.

### `@types/maplibre-gl` Version Mismatch

- Issue: `package.json` pins `"@types/maplibre-gl": "^1.14.0"` (types for v1) while `"maplibre-gl": "^5.24.0"` (v5 runtime) is installed. This mismatch means the TypeScript type system describes a v1 API surface. Any API added or changed in v2–v5 has no type coverage.
- Files: `package.json:59,84`
- Impact: Type casts with `as any` in `src/features/geo-editor/core/GeoEditor.ts:455,1723-1729` exist partly because the runtime types are wrong. MapLibre v4+ ships its own types — the `@types/` package is not needed at all for v5.
- Fix approach: Remove `@types/maplibre-gl` from devDependencies. The `maplibre-gl` v5 package ships `maplibre-gl.d.ts` natively.

### GeoEditor Style Types — Fully Untyped

- Issue: `src/features/geo-editor/core/types/index.ts:36-48` defines the `EditorStyleOptions` interface with all map layer paint properties typed as `any`.
- Files: `src/features/geo-editor/core/types/index.ts:36-48`
- Impact: Passing an invalid paint property to any layer style is a silent runtime error. No IDE completion for layer styles.
- Fix approach: Replace `any` fields with MapLibre's `LayerSpecification` paint types (`FillLayerSpecification['paint']`, `LineLayerSpecification['paint']`, etc.).

---

## Known Bugs

### Dead `isDrawingMode` State — Pan Lock Logic is Inert

- Symptoms: Pan auto-lock during drawing is described in the toolbar tooltip but never activates. `isDrawingMode` is initialized to `false` with no setter (`const [isDrawingMode] = useState(false)`).
- Files: `src/features/geo-editor/GeoEditorView.tsx:89,905,1299,1883-1884`
- Trigger: Click any draw tool — pan lock should activate but does not.
- Workaround: Users must manually click the pan lock button.

### Map Error Display Unreachable

- Symptoms: A map error banner (`{mapError && ...}`) is rendered at line 1540 but `_setMapError` (the prefixed setter) is never called, so errors that occur during map initialization cannot reach the UI.
- Files: `src/features/geo-editor/GeoEditorView.tsx:80,1540-1543`
- Trigger: Map style load failure — no visible error.
- Workaround: None; errors are silently ignored.

### Relay Blossom Implementation is a Stub

- Symptoms: The Go relay's blossom `StoreBlob` handler always returns `nil` without saving anything. `LoadBlob` returns the literal string `"aaaaa"` as the blob body.
- Files: `relay/main.go:150-158`
- Trigger: Any attempt to upload or retrieve a blob via the relay's Blossom endpoint will return garbage data.
- Workaround: The production app uses mapnolia for blob storage, not the relay's built-in Blossom. This only affects local development relay blossom calls.

---

## Security Considerations

### Private Key Stored in `localStorage` Without Encryption

- Risk: When a user logs in with a private key (`PrivateKeyAccount`) and chooses "Stay logged in", the account (including the serialized private key material) is persisted to `localStorage` at key `earthly:accounts`. The `applesauce-accounts` `toJSON` serialization is called directly — no application-level encryption layer is applied on top.
- Files: `src/lib/nostr/index.ts:64-85`, `src/features/auth/SignupDialog.tsx:331`
- Current mitigation: Ephemeral accounts (`ephemeral: true`) are filtered out and not persisted. NIP-07 and NIP-46 accounts store no private key material.
- Recommendations: For `PrivateKeyAccount`, store only an encrypted form using a user-supplied passphrase (NIP-49 `ncryptsec`), or prompt the user that key material is stored unencrypted in the browser.

### `CLIENT_KEY` Hardcoded in Frontend Bundle

- Risk: `src/config/env.client.ts:26` contains a hardcoded fallback hex private key (`4e842ce1a820603c44f6ce3c4acd6527fdeb4898a9023d84bed51c1b4417eb5c`). This key is used as the signing identity for MCP/ContextVM requests in `src/ctxcn/EarthlyGeoServerClient.ts:760`. Any user of the app can extract this key from the bundle and impersonate the client identity.
- Files: `src/config/env.client.ts:26`, `src/ctxcn/EarthlyGeoServerClient.ts:760`
- Current mitigation: The key is for the ContextVM/MCP transport only — it signs ephemeral event envelopes for the relay transport, not user data events. The server should verify the server pubkey, not the client key.
- Recommendations: Move `CLIENT_KEY` handling server-side and proxy ContextVM calls through the Bun server. Never bundle a private key in client-side code.

### Open Relay — No Auth, No Rate Limiting

- Risk: `relay/main.go:135,141` unconditionally returns `false, ""` from both `RejectFilter` and `RejectEvent`, accepting all events and queries from any client. There is no NIP-42 authentication, no rate limiting, and no kind/pubkey allow list.
- Files: `relay/main.go:118-142`
- Current mitigation: Relay is presumably behind a reverse proxy in production that limits external access.
- Recommendations: Implement NIP-42 and allow only signed events from known pubkeys for write operations. Add query rate limiting.

---

## Performance Bottlenecks

### Module-Scoped Blob Cache — No Eviction for Large GeoJSON

- Problem: `blobCache` (`src/lib/geo/resolveBlobReferences.ts:16`) is a module-level `Map` that never evicts entries. A session that loads many large datasets (each blob can be up to the Blossom file size limit) accumulates all GeoJSON in memory indefinitely.
- Files: `src/lib/geo/resolveBlobReferences.ts:16-31`
- Cause: The cache has no TTL, max-size limit, or LRU eviction. `failedUrls` also grows indefinitely but has negligible cost.
- Improvement path: Add an LRU eviction strategy (max N entries or max bytes). Consider `WeakRef` for very large payloads.

### `JSON.parse(JSON.stringify(feature))` Deep Clone in Hot Path

- Problem: `src/features/geo-editor/core/GeoEditor.ts:1612` uses `JSON.parse(JSON.stringify(feature))` to clone features. This is called on every render cycle for complex geometries with many coordinates.
- Files: `src/features/geo-editor/core/GeoEditor.ts:1612`
- Cause: No structured-clone polyfill or fast deep-clone library.
- Improvement path: Replace with `structuredClone(feature)` which is native in modern browsers and faster for GeoJSON objects, or use a targeted property-path clone for the edit coordinate copy case.

### GeoJSON Parse Worker Has 30-Second Timeout

- Problem: `src/lib/geo/workerJsonParse.ts:96` sets a 30-second timeout for the web worker parse. If the worker is stuck, the fallback `JSON.parse` runs synchronously on the main thread with the full text still in memory, doubling peak memory usage.
- Files: `src/lib/geo/workerJsonParse.ts:96-104`
- Cause: No streaming parse or progressive loading. The full text string is kept in the `pendingRequests` map entry alongside the promise.
- Improvement path: Remove the in-memory `text` field from `pendingRequests` — it serves no purpose since the string was already posted to the worker. For the timeout fallback, re-fetch or return an error rather than block the main thread.

### MapContextEditorPanel is 1,122 Lines with No Code Splitting

- Problem: `src/features/contexts/MapContextEditorPanel.tsx` (1,122 lines) is loaded as part of the main bundle even for users who never open the context editor.
- Files: `src/features/contexts/MapContextEditorPanel.tsx`
- Cause: No `React.lazy()` or dynamic import wrapping.
- Improvement path: Wrap with `React.lazy(() => import('./MapContextEditorPanel'))` in the parent's import.

---

## Fragile Areas

### Blob Reference Resolution — Silent Failure on 4xx

- Files: `src/lib/geo/resolveBlobReferences.ts:136-188`, `src/features/geo-editor/hooks/useDatasetManagement.ts:276,451,603`, `src/features/geo-editor/hooks/useBlobResolution.ts:41`
- Why fragile: When a blob URL returns a 4xx, `fetchBlobReference` silently marks the URL as permanently failed for the session and returns `null`. The caller at `resolveGeoEventFeatureCollection` skips the reference and continues. The dataset renders with missing features and no user-visible error. The `failedUrls` Set persists across dataset loads, so a temporarily unavailable blob stays permanently failed for the session lifetime.
- Safe modification: Any change to retry behavior or failure signaling must account for the `failedUrls` module-level state. Test by pointing a blob reference to a 404 URL and confirming a warning appears.
- Test coverage: Zero — no test files exist in the repository.

### GeoEditor Event Listener Registration — Order Dependent

- Files: `src/features/geo-editor/core/GeoEditor.ts:1568-1583`, `src/features/geo-editor/core/managers/LayerManager.ts:570`
- Why fragile: `GeoEditor.destroy()` removes window event listeners and calls `onRemove()` on each manager. If `map.remove()` fires before `destroy()` is called, the `try/catch` blocks silently swallow errors. If a manager's `onRemove()` throws, subsequent managers are not cleaned up.
- Safe modification: Always call `editor.destroy()` before removing the MapLibre map instance. Wrap each manager `onRemove()` in its own try/catch to prevent short-circuit on partial cleanup.
- Test coverage: Zero.

### Wallet `currentUser` Global Mutable Singleton

- Files: `src/lib/wallet/currentUser.ts`, `src/features/geo-editor/store/persistence.ts:4`, `src/features/geo-editor/store/sessionSyncSlice.ts:2`
- Why fragile: `currentPubkey` is a module-level mutable variable set by the store's session sync slice. The `persistence.ts` localStorage scoping reads from this singleton instead of a reactive store selector. If the session sync fires after a persistence read (e.g., during cold start), storage operations use `null` as the pubkey scope and write to an unscoped key.
- Safe modification: Do not add new callers of `getCurrentPubkey()`. Pass pubkey explicitly to storage helpers as a parameter.

### `desktopRightDockMode` Controls Both Chat and Inspector from One State

- Files: `src/features/geo-editor/GeoEditorView.tsx:86,1245-1247,1706-1748`
- Why fragile: A single `'chat' | 'inspect' | null` value drives which right panel is shown. The `useEffect` at line 1245 auto-clears `desktopRightDockMode` to `null` when the inspector content disappears — this silently dismisses the panel during dataset deselection, not via user intent.
- Safe modification: Separate the chat open state and the inspector open state into independent booleans before adding more right-panel content types.

---

## Scaling Limits

### Relay Message Size Cap at 2 MB

- Current capacity: `relay/main.go:57` sets `relay.MaxMessageSize = 2 * 1024 * 1024`. GeoJSON events with many coordinates approach this limit; very dense polygon collections will be rejected.
- Limit: Events larger than 2 MB silently fail to be accepted by the relay.
- Scaling path: Use the Blossom blob split flow for datasets that exceed ~1.5 MB. The tooling exists (`BlossomUploadDialog`), but there is no automatic enforcement — the user must discover the failure.

### No Subscription Pagination on Dataset Lists

- Current capacity: `src/features/geo-editor/components/GeoDatasetsPanel.tsx` (and similar panels) fetch all matching events in a single relay subscription.
- Limit: On a relay with thousands of 37515 events, the initial load becomes slow and memory intensive.
- Scaling path: Implement cursor-based pagination using the `limit` and `until` filter fields. The UX rewrite's sidebar redesign is a natural time to add this.

---

## Dependencies at Risk

### `coco-cashu-*` Release Candidates in Production

- Risk: `package.json` depends on `coco-cashu-core: "^1.0.0-rc11"` and `coco-cashu-indexeddb: "^1.0.0-rc11"` — release candidates. RC packages may have breaking changes in patch releases.
- Impact: A breaking RC update could silently corrupt the wallet's IndexedDB schema between deploys.
- Migration plan: Pin to exact versions (`1.0.0-rc11`) until a stable `1.x.x` is released, then migrate.

### `@mapbox/shp-write` Outdated Fork

- Risk: `package.json` uses `"@mapbox/shp-write": "^0.4.3"` — this package was archived and is no longer maintained. The shapefile export in `src/features/geo-editor/shapefile.ts` depends on it.
- Impact: Security patches and format-correctness fixes will not come from upstream.
- Migration plan: Evaluate `shpjs` (already a direct dependency for import) for round-trip capability, or use a maintained shapefile library.

---

## Test Coverage Gaps

### Zero Test Files

- What's not tested: The entire codebase has no `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` files. `bun test` will run with no test suite.
- Files: All of `src/`, `relay/`
- Risk: Any refactor or dependency bump can silently break: blob resolution, publishing flows, GeoJSON normalization, auth account serialization, NIP-19 decode paths, and map layer setup.
- Priority: High

### Critical Paths Without Tests

The following subsystems have the highest defect risk and no test coverage:

- `src/lib/geo/resolveBlobReferences.ts` — blob fetch, retry, cache, scope merging
- `src/lib/nostr/geo-event/` — GeoDataset cast logic and feature collection parsing
- `src/features/geo-editor/hooks/usePublishing.ts` — multi-step publish flow with Blossom fallback
- `src/features/geo-editor/core/GeoEditor.ts` — undo/redo, snapping, mode transitions
- `src/lib/wallet/` — Cashu token handling and payment flows

---

*Concerns audit: 2026-05-24*
