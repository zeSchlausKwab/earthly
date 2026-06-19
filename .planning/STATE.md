---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: 04-03 implementation complete (CodeRunDisclosure + ChatPanel wiring); all 3 Phase-4 plans code-complete. Phase 4 VERIFICATION PENDING — live autonomous-demo UAT deferred to /gsd-verify-work 4 (do NOT mark phase complete)
last_updated: "2026-06-18T09:27:21.000Z"
last_activity: 2026-06-18 -- Phase 04 Plan 03 close-out (CodeRunDisclosure collapsible read-only code+output block D-09/D-10/D-11/D-12/D-07, wired into MessageBubble); Task 3 live UAT deferred to /gsd-verify-work 4
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 18
  completed_plans: 18
  percent: 53
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-16)

**Core value:** The maintainer (and any user) can open the app for fun, not duty — extended this milestone so analysts, curators, and power users can ingest real-world data, transform it with sandboxed code, and safely author maps via chat.
**Current focus:** Phase 04 — code-interpreter-sandbox

## Current Position

Phase: 04 (code-interpreter-sandbox) — IMPLEMENTATION COMPLETE, VERIFICATION PENDING
Plan: 3 of 3 code-complete (live UAT deferred to /gsd-verify-work 4)
Status: Phase 04 implementation done — run_code wired (Wave 2) + collapsible code/output UI (Wave 3); live autonomous-demo UAT PENDING via /gsd-verify-work 4. Phase is NOT yet verified/complete.
Last activity: 2026-06-18 -- Phase 04 Plan 03 close-out (CodeRunDisclosure D-09/D-10/D-11/D-12/D-07 + MessageBubble reroute); Task 3 live UAT deferred to /gsd-verify-work 4

Progress: [██████████] 100% (Phase 4 plans code-complete; live UAT pending)

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 03 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 8min | 3 tasks | 8 files |
| Phase 01 P02 | 5min | 3 tasks | 3 files |
| Phase 01 P03 | 4min | 2 tasks | 3 files |
| Phase 02 P01 | 6min | 2 tasks | 4 files |
| Phase 02 P02 | continuation | 2 tasks | 5 files |
| Phase 02 P03 | 9min | 2 tasks | 9 files |
| Phase 02 P04 | 8min | 2 tasks | 9 files |
| Phase 02 P05 | 12min | 2 tasks | 8 files |
| Phase 02 P06 | 11min | 2 tasks | 6 files |
| Phase 03 P01 | 12min | 4 tasks | 10 files |
| Phase 03 P04 | 4min | 2 tasks | 3 files |
| Phase 03 P02 | 8min | 1 tasks | 2 files |
| Phase 03 P03 | ~5min | 3 tasks | 9 files |
| Phase 03 P05 | ~12min | 2 tasks | 4 files |
| Phase 03 P06 | continuation | 3 tasks | 9 files |
| Phase 04 P01 | ~10min | 4/5 tasks (c deferred) | 10 files |
| Phase 04 P02 | ~8min | 3 tasks | 6 files |
| Phase 04 P03 | continuation | 2/3 tasks (UAT deferred) | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Encrypted Settings Persistence (Phase 1) sequenced first — structurally independent, and persisting provider config/keys early makes every later phase testable without re-entering keys on each reload.
- [Roadmap]: Critical path is Phase 2 (registry + Authoring API) → Phase 4 (sandbox). Both are front-loaded as hard prerequisites after settings.
- [Roadmap]: TOOLS-01 (parametric circle/buffer, non-destructive) lands in Phase 2 so the sandbox has something to call; TOOLS-02/03/04 (bulk/destructive) deferred to Phase 6, after the safe-editing gate.
- [Roadmap]: Safe-editing gate (Phase 5) MUST precede every destructive bulk tool (Phases 6 + 7), or those tools ship destructive.
- [v1.1]: Edit safety is a user config (1 preview / 2 confirm-destructive default / 3 trust+undo).
- [v1.1]: Code interpreter runs client-side; sandbox boundary is message-only RPC over the Authoring API.
- [Phase ?]: [01-01]: Kept localStorage key prefix earthly.chat-settings.v1 stable; bumped only in-envelope version to 2 and migrate on read (avoids orphaning v1 envelopes).
- [Phase ?]: [01-01]: Exported resolveProvider, chatStorePartialize, and migrateV1ToV2 as pure functions for headless bun:test (SC-1 secret-exclusion + migration directly testable).
- [Phase ?]: [01-02]: On decrypt failure the load lifecycle sets a visible 'failed' status + message instead of hydrating DEFAULT settings (D-11/SET-02).
- [Phase ?]: [01-02]: Retry is nonce-driven — requestSettingsReload bumps settingsLoadNonce in the load-effect deps to re-enter the generation guard, never calling the loader directly (Pitfall 2).
- [Phase ?]: [01-03]: Import REPLACES via hydrateSettings and delegates re-encryption to the existing debounced save (D-07/D-09); v1+v2 accepted by reusing migrateV1ToV2; malformed/unknown/oversized rejected via hand-written type guards (T-01-10/V5).
- [Phase ?]: [01-03]: Export reads the live store snapshot (not the encrypted envelope) and is never gated on settingsStatus, so the SET-03 recovery hatch works even when load/save is failing (D-08).
- [Phase 2]: [02-01]: Headless GeoEditor harness keeps the mock map's getStyle() returning undefined so LayerManager.isStyleReady() is false — render/layer paths become safe no-ops, letting later tests use the REAL GeoEditor class without mocking layer internals.
- [Phase 2]: [02-01]: Mock map cast `as unknown as MapLibreMap` only at the harness boundary (T-02-01); production map types never loosened. Harness is test-only — no production module imports core/test-harness (T-02-02 boundary grep clean).
- [Phase 2]: [02-02]: createAuthoring(editor) captures the GeoEditor in a closure and exposes ONLY geometry methods (addFeature/writeGeoJSON/editorCommand) — no signer/wallet/store/getState re-export; boundary.test.ts fs-scans api/*.ts for zero chat/registry/Nostr/NDK/applesauce imports (D-07/T-02-03).
- [Phase 2]: [02-02]: Authoring facade reuses toEditorFeature + dedup-by-id VERBATIM from importFeaturesToEditor (no normalization reimplementation — T-02-04); every mutating method returns a structured MutationResult, never void (D-11).
- [Phase 2]: [02-02]: editor.setFeatures (replace path) does NOT emit create/update today, so the replace path does not yet drive the store mirror — Plan 03 must add the emit-on-bulk-replace (D-09) before the replace path's store sync works.
- [Phase 2]: [02-03]: Bulk-replace emit = NEW typed 'features.replace' event (not 'update' reuse); Editor.tsx mirror subscribes to it. editorCoreSlice.setFeatures kept as the event-driven sink with draft-persist/isDirty/updateStats side-effects preserved (D-09 one-way read-mirror).
- [Phase 2]: [02-03]: Reverse store→editor loop guarded by suppressReverseSyncRef — editor-originated mirror writes skip the reverse push; external dataset loads still sync (Open Question 2 resolved: KEEP reverse push, narrow via flag).
- [Phase 2]: [02-03]: chat dual-write (importFeaturesToEditor) + 4 UI/hook import sites (GeoEditorView 1249/1413/2120 + useOsmQuery handleOsmImport) rerouted through createAuthoring(editor).writeGeoJSON; store dual-write DELETED. authoring.* is now the only caller of editor.addFeature (INFRA-02); A3 boundary test enforces it.
- [Phase 2]: [02-03]: A3 boundary scoped to editor.addFeature (create seam) — updateFeature/deleteFeatures NOT yet rerouted (facade has no modify/delete surface). Deferred to a facade-expansion plan that adds modifyFeature/deleteFeatures + tightens A3 to all 4 verbs.
- [Phase 2]: [02-03]: criterion #2 golden gate (authoring.golden.test.ts) green — OLD importFeaturesToEditor body reproduced verbatim as oracle vs NEW writeGeoJSON, feature sets byte-identical (ids/geometry/importSource/customProperties/skippedDuplicates).
- [Phase 2]: [02-04]: ONE typed registry (registry.ts) dispatches all 34 advertised tools via register/unregister/dispatch/advertise; execute.ts switch + default throw DELETED. Unknown tool / handler failure → structured ToolError (INFRA-01/D-16), fed to model loop AND rendered distinctly in ChatPanel. kind mandatory on every entry (D-03); advertised list derived from live registry (D-04/D-06).
- [Phase 2]: [02-04]: Extracted schemas.ts (dependency-free static OpenAI schemas) to break a registry↔definitions import cycle — registry imports schemas; definitions collapses to geoTools = advertise().
- [Phase 2]: [02-04]: kind map — write/add_feature_to_editor=editor (dispatch into authoring); get_editor_state/capture_map_snapshot=host-builtin; all OSM/valhalla/web/wiki/fetch=remote-mcp (origin=SERVER_PUBKEY); editor_*=editor (self-registered). V5 arg validation (parseToolCallArguments + clamps + MAX_GEOJSON_TEXT_CHARS) preserved at dispatch boundary; no zod added.
- [Phase 2]: [02-05]: TOOLS-01 — circle/buffer are Authoring API methods FIRST (authoring.circle/buffer in api/, primitives.ts wraps turf) then AI tools (draw_circle/buffer_feature, kind:'authoring-primitive'); both draw + return MutationResult. Meters canonical (D-14, no magic default radius); V5 DoS cap MAX_DISTANCE_METERS=40,075,000 (unit-normalized) rejects NaN/Inf/≤0/absurd BEFORE turf runs.
- [Phase 2]: [02-05]: authoring.buffer(featureId) returns featureIds=[sourceId,newId] (source first) for D-11/D-15 composition (Phase 4 chains 'buffer the circle I just drew'); raw-geojson buffer returns [newId]. Degenerate buffer (turf undefined) + unknown id → {ok:false} → tool throws → ToolError(handler_error) (D-16/T-02-15/T-02-16), never a crash.
- [Phase 2]: [02-05]: Primitive tools supply schema INLINE (like editor_* commands), so definitions.ts (geoTools=advertise()) picks them up with ZERO edits (D-04) — file left untouched for clean Plan 06 merge.
- [Phase 2]: [02-06]: A1 RESOLVED=SUPPORTED — live ContextVM geo server returned 15 tools via listTools() (the 14 hardcoded + a new create_map_upload absent from definitions.ts). tools/list works AND the static list was already stale by one tool. Built the success branch (poll-based mcp-sync), did NOT take the fallback/defer branch.
- [Phase 2]: [02-06]: D-05 mcp-sync is POLL-not-push (Pitfall 3, stateless transport) — syncMcpTools() diff-converges the registry's remote-mcp entries (register new/unregister removed, kind:'remote-mcp'+origin=SERVER_PUBKEY); optional cancelable startMcpToolPolling/stopMcpToolPolling; NO setNotificationHandler. On listTools() failure it degrades gracefully (warn + keep last-known/hardcoded set, never throws/wipes).
- [Phase 2]: [02-06]: Synced handlers route through new EarthlyGeoServerClient.callRemoteTool(name,args) (wraps private call()). definitions.ts adds getGeoTools() (live advertise() + hardcoded fallback); store.ts reads it at REQUEST time so sync changes reach the model. Push refresh deferred as a future optimization (needs a stateful transport).
- [Phase ?]: Phase 03 Plan 01: ExcelJS-in-worker spike PASSED (exceljs ^4.4.0 bundles for browser worker under Bun); read-excel-file fallback not needed
- [Phase ?]: Phase 03 Plan 01: extracted pure parse helpers (parse.ts) from ingest.worker.ts so parse correctness is bun:test-able without driving a real Worker
- [Phase 3]: [03-04]: detectVisionSupport(provider,modelId)→'vision'|'no-vision'|'uncertain' is the D-07/D-09 single capability source; Ollama reads native POST /api/show capabilities[] (/v1 stripped; its /v1/models omits them), others read /v1/models capabilities/input_modalities/architecture.input_modalities; cached per (type,baseUrl,modelId); fail-safe to 'no-vision', never throws (degrades to name heuristic → 'uncertain').
- [Phase 3]: [03-04]: Autonomous capture_map_snapshot one-shot sends an image_url ONLY on confirmed 'vision' (acceptance criterion #4); 'uncertain' is opt-in via the Plan 06 VisionGateControl UI, never the silent snapshot loop. Both image paths now gate on canUseVision derived from the one awaited ladder result (D-09); name-only modelMaySupportVision removed.
- [Phase ?]: [03-02]: parseFileInWorker(kind, payload, {timeoutMs}) is the host-side no-freeze client; a shared parseSync powers the no-worker / onerror-latch / 30s-timeout fallbacks so the worker and its sync fallback never diverge
- [Phase ?]: [03-02]: xlsx posted as a transferable ArrayBuffer (postMessage(req,[buffer])) avoids a main<->worker copy (T-03-05); per-request timeout is injectable for deterministic stuck-worker test coverage
- [Phase 3]: [03-03]: D-11 enforced STRUCTURALLY — handle-keyed ingestStore: toModelSummary(handleId)→{handleId,summary} is the ONLY model path (no fullRows field); getDataset(handleId) is the sole fullRows accessor (tools/sandbox). Proven by a serialized-payload no-leak invariant test (T-03-06).
- [Phase 3]: [03-03]: deriveIngestSummary caps schema to MAX_SUMMARY_COLS=30 (+moreColumns, T-03-09) and samples head5+tail5+random5 (INGEST_SAMPLE); compactToolMessageContentForPrompt strips fullRows on {ingestHandle,ingestSummary} tool results (prompt-path defence-in-depth).
- [Phase 3]: [03-03]: Pre-parse size caps INGEST_SIZE_CAPS tabular 50MB (≥A4 12MB) / image 25MB via assertFileWithinCaps run BEFORE parseFileInWorker/putDataset (T-03-07 DoS); detectCoordinateColumns name-heuristic (lat/lon/lng/x/y/wkt/geometry, ambiguous→{}, D-04).
- [Phase 3]: [03-05]: place_dataset_features (host-builtin) iterates getDataset(handleId).fullRows (D-05, NOT the sample → anticipates SAFE-05), builds features from lat/lon | WKT | GeoJSON-geometry, V5-range-validates coords (skippedInvalid), writes via importFeaturesToEditor (Authoring API, never the store), returns counts only (T-03-18). registerIngestTools(register) wired via the injected-register idiom; schemaFor() now exported from schemas.ts.
- [Phase 3]: [03-05]: batch_geocode (remote-mcp) bounded BATCH_GEOCODE_MAX_ROWS=50 (unique names) + throttled BATCH_GEOCODE_MIN_INTERVAL_MS=1000 (~1 req/s) + de-duped + in-call cached, skip-and-report {located,total,failed,message} (T-03-15/T-03-16, D-06). throttle delay + geo client injectable so tests use a fake clock + mock SearchLocation (no sleep, no network). Single-row geocoding reuses the same batchGeocode primitive; Telegram one-shot still uses search_location. WKT parsed in-repo (no new dep).
- [Phase 3]: [03-06]: FileChipStrip (D-10) mounts ALONGSIDE ChatGeometryAttachment (not folded in), mirroring its controlled {files,onChange} idiom — button + native drag-drop, one FileChip per file (compact deriveIngestSummary stat line, Collapsible/Popover expand, NO always-on grid, D-03). handleAttachedFile(file, deps) is a DOM-free dependency-injected pure orchestration (assertFileWithinCaps → parseFileInWorker → putDataset order pinned by fileAttachHandler.test.ts WARNING-5; image → readImageDataUrl → image_url, INGEST-04).
- [Phase 4]: [04-01]: Isolation spike RESOLVED the open design decision — QuickJS-WASM-in-a-Worker (not cross-origin-iframe+CSP). Transport LOCKED = quickjs-emscripten all-in-one .wasm-asset variant; SUS singlefile fallback (@jitl/quickjs-singlefile-mjs-release-sync) NOT installed, reserved for a separate human-action gate only if Wave 2's prod smoke 404s the .wasm.
- [Phase 4]: [04-01]: runSandbox(code,{readSnapshot,deadlineMs,outputCap}) is the transport-agnostic surface Waves 2-3 consume → SandboxRunResult{ok,recordedCalls,consoleLines,returnValue,error,timedOut}; timedOut derived (retryable). Defaults: deadlineMs=3000, memory=64MB, stack=512KB, output caps 1000 lines/256KiB with '…(output truncated)' marker.
- [Phase 4]: [04-01]: Worker RECORDS authoring calls ({op,args}) and returns serializable records — replay through createAuthoring is Wave 2's job — so the worker/transport hold NO editor/createAuthoring/signer/wallet import and confinement stays statically provable. Proven (28 tests): CODE-01 a confinement, CODE-02 surface=exactly authoring/turf/data/console, CODE-04 b timeout-kill, output cap, import-boundary scan.
- [Phase 4]: [04-01]: Spike criterion (c) prod .wasm-serving DEFERRED to Wave 2 (04-02) per explicit human decision — transport not yet imported by any app-graph module, so no .wasm bundles today. Wave 2 MUST run `bun run build:production` + browser smoke confirming the QuickJS .wasm returns 200.
- [Phase 4]: [04-02]: run_code registered with kind:'code-interpreter' (mandatory kind added to ToolKind union); schema = required code:string + optional handles:string[]. Handler: resolve editor → buildReadSnapshot(handles,editor) → runSandbox → (error/timeout) THROW full error so registry.dispatch wraps ToolError(handler_error) for the model (CODE-03/D-11/D-13) → (success) replay recorded authoring.* through createAuthoring(editor)→runInterceptors() (D-03/D-08, NO Phase-4 gate), accumulate MutationCounts, return { ok, counts, consoleLines, truncated, returnValue } (D-10 shape Plan 03 renders).
- [Phase 4]: [04-02]: buildReadSnapshot(handleIds,editor) = D-01 frozen view { datasets: rows-by-handle via getDataset.fullRows (NOT toModelSummary — Phase 3 D-11 seam intact, T-04-10), features: getAllFeatures().map(toPlainGeoJSON) }, run through structuredClone so it is decoupled (T-04-08) and fail-closed on a non-clonable leak (Pitfall 5).
- [Phase 4]: [04-02]: RUN_CODE_RETRY_CAP=3 (D-06) as a module-level consecutiveFailures counter (reset on success, incremented on timeout too per D-13) — a counter LOCAL to run_code, NOT a store-loop change (RESEARCH A3). The 'attempt N/3' note rides the thrown error so the bound is observable to the model.
- [Phase 4]: [04-02]: runSandbox is now reachable from the app graph (registry → runCode → sandboxHost → quickjs transport → quickjs-emscripten) so the .wasm bundles; `bun run build` succeeds. Headless headline proofs inject the editor via useEditorStore.setState({editor:createHeadlessEditor()}) + setSandboxTransportForTests(directEngineTransport). Both pass: fibonacci → counts.created===15 + 15 features (CODE-05); Austria→Bosnia → reads handle rows, returns chosen route+costs, draws 1 feature (CODE-06).
- [Phase 4]: [04-02]: Plan 01's single-tier sandbox import-boundary scan refined into two tiers — tier A (secret reach: signer/wallet/Nostr/NDK/applesauce/MCP) covers ALL sandbox files incl. the new ones (T-04-12); tier B (createAuthoring + geo-editor/store) covers worker/transport ONLY, exempting the host replay seam (runCode.ts/readSnapshot.ts). T-04-09 confinement stays statically provable.
- [Phase 4]: UAT-DUMP FOCUSED FIXES (2026-06-19, 4 atomic commits 8ee175c/bf0552a/b723510/4890114): #1 run_code authoring counts now accurate — addFeature/writeGeoJSON coerce a bare Geometry into a Feature (the silent created:0 trap) and addFeature throws a descriptive error for non-null non-geometry input (FeatureCollection etc.) instead of a misleading zero; makeBuffer treats a null-geometry turf result as degenerate so the buffer no-op contract survives. #2 top-level `return` works in run_code (program-first eval, function-wrap fallback ONLY on QuickJS 'return not in a function', parse-time so no duplicated side effects). #3 capture_map_snapshot gated OFF the advertised surface for non-'vision' models via gateToolsForVision() mirroring canUseVision. #4 prompt steering added to run_code description + map-context system message (return convention, no Node globals, known coords over geocoding, no gratuitous OSM, trust write counts/no re-verify); advertised run_code surface kept in sync. bun test 379/0, both builds + biome green. (search_location geocoder quality stays a remote-CVM concern → .planning/backlog/cvm-osm-cache.md.)
- [Phase 4]: CODE-REVIEW BLOCKER CLOSED (2026-06-18): CR-01 (editorCommand interceptor-seam bypass) fixed in 59ceac3 — removed from sandbox surface, host replay gated on an interceptor-routed allow-list; WR-01 (unenforced SANDBOX_MAX_DISTANCE_METERS DoS cap) fixed in 488cd96 — assertSandboxDistanceWithinCap now range-checks circle/buffer/destination/along before turf runs. Both with tests; bun test + build + biome green. 04-REVIEW.md updated. Remaining review items WR-02..WR-06 + IN-01..IN-04 still open (not in this fix's scope).
- [Phase 3]: [03-06]: composeOutboundContent extracted to its OWN module (src/features/chat/composeOutboundContent.ts), not inlined in ChatPanel — so ingestSendPath.test.ts asserts the D-11 invariant headlessly (dataset → {handleId,summary} from toModelSummary, NEVER fullRows; deep-scan finds no non-sampled row, BLOCKER-3). VisionGateControl (D-08 three-tier: vision=enabled / no-vision=hard-disabled+Tooltip / uncertain=amber+Send-anyway opt-in) + composeOutboundContent share ONE detectVisionSupport result; image_url included only when 'vision' or ('uncertain' && sendAnyway), never silent on 'no-vision'. Same gate governs capture_map_snapshot (D-09). UAT 6/6 approved.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: NIP-46 async decrypt path is untested against a remote signer; needs an explicit test + export/import escape hatch.
- [Phase 3]: Optional active vision-probe step may consume Cashu budget; validate against Routstr prepayment before enabling by default.
- [Phase 4]: RESOLVED (04-01) — sandbox isolation boundary = QuickJS-WASM-in-Worker (not cross-origin-iframe+CSP); spike proved confinement + timeout-kill + surface. Wave 2 (04-02) wired run_code so runSandbox is in the app graph and `bun run build` succeeds. Criterion (c) prod `.wasm`-SERVING now RESOLVED (focused fix a417ca5, NO new package): `build.ts` copies `@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm` → `dist/emscripten-module.wasm` (fails build loudly if source missing); `sandbox.worker.ts` points the release-sync variant at the served `/emscripten-module.wasm` via `newVariant(RELEASE_SYNC,{wasmLocation})` ONLY when a real browser/Worker http(s) origin exists (Node/bun-test keeps `getQuickJS()` fs path — in-process tests stay green); `src/index.ts` serves `.wasm` as `application/wasm` in dev (from node_modules) and prod (from dist) and stops the SPA fallback swallowing it. PROVEN: `bun run build:production` emits `dist/emscripten-module.wasm` (503134 B); prod server returns HTTP 200 + `content-type: application/wasm`; `bun test` 290 pass / 0 fail; `bun run build` green. The singlefile fallback (`@jitl/quickjs-singlefile-mjs-release-sync`) is NO LONGER needed and stays uninstalled. REMAINING carry-forward (NOT a blocker): live IN-BROWSER wasm EXECUTION (instantiate + `runSandbox` round-trip in the deployed app) is validated by Wave 3's live-chat UAT — the asset now demonstrably emits + serves 200, so this is a UAT confirmation, not a build gap.
- [Phase 6]: Style-rule persistence format (tag vs content) on kind 37515 must be decided before building; confirm against SPEC.md.

## Deferred Items

Items acknowledged and carried forward / out of scope for this milestone:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Feature | Nostr-scrolls / WASM (SCROLL-01/02/03, NIP-5C) | Deferred to next milestone | 2026-06-16 |
| Feature | Compound routing (COMPOUND-01) | Deferred to v2 | 2026-06-16 |
| Refactor | Reroute editor.updateFeature + deleteFeatures + dataset-load setFeatures through Authoring API (facade needs modifyFeature/deleteFeatures surface; then tighten A3 boundary to all 4 verbs) | Deferred to a Phase 2 facade-expansion follow-up | 2026-06-16 (02-03) |

## Session Continuity

Last session: 2026-06-18T09:27:21.000Z
Stopped at: 04-03 implementation complete (CodeRunDisclosure + ChatPanel reroute); all 3 Phase-4 plans code-complete. Phase 4 verification PENDING — live autonomous-demo UAT routed to /gsd-verify-work 4. Do NOT mark Phase 4 complete until that UAT signs off.

UAT focused fix (2026-06-19): chat no longer ends a turn silently — empty completions (no content, no tool calls) now surface a visible notice via the existing `error` channel ChatPanel renders; `finishReason: 'length'` gets truncation-specific copy, and truncated-but-non-empty content gets a "(response truncated)" suffix. New pure helper describeEmptyCompletion() + 6 headless tests (now 346/0). Not a phase plan; no SUMMARY, no phase.complete.
Resume file: run `/gsd-verify-work 4` (live UAT for the 5 deferred items in 04-03-SUMMARY.md)

Dep bump (2026-06-19): `@contextvm/sdk` 0.9.1 → 0.12.3 (focused, atomic). New API is backward-compatible with our ctxcn usage — no source edits needed: NostrTransportOptions shape (serverPubkey/signer/relayHandler/isStateless/oversizedTransfer.enabled), PrivateKeySigner, ApplesauceRelayPool, and Client.callTool/listTools all unchanged. SDK now bundles `@contextvm/mcp-sdk` 1.29.2 (identical Transport interface to @modelcontextprotocol/sdk 1.29.0 — structurally compatible). Gates green: bun install clean, dev+prod builds, bun test 388/0, biome clean on changed files, no NEW tsc errors in src/ctxcn/* (pre-existing TS1016 + Osm* export errors are baseline). No SUMMARY, no phase.complete.

UAT gap-closure (2026-06-18): styling gap resolved — authoring.circle/buffer now accept+apply per-feature style normalized to the editor's canonical renderer keys, reject unknown options, and run_code prompt advertises the convention; raw addFeature/writeGeoJSON style props preserved. Commits 5fe7f66 + 1e9448f; bun test 334/0 + dev/prod builds + biome green. 04-UAT.md styling gap marked resolved.

UAT debugging aid (2026-06-18): added a "dump conversation" export button to the ChatPanel header — captures the full active chat as JSON (roles, raw content, reasoning, tool_call id/name/arguments, RAW tool results incl. run_code source/output/errors, endpoint+model label, diagnostics), copies to clipboard AND downloads a .json (Blob, dependency-free); empty-safe with toasts. Secrets excluded: pure buildConversationDump (conversationDump.ts) reads only baseUrl via resolveProvider, never providerOverrides[*].apiKey (mirrors chatStorePartialize); headless test plants a key and asserts absence (7 tests). Commit f0010d8; bun test 355/0 + dev/prod builds + biome green. Not a phase plan; no SUMMARY, no phase.complete.

UAT focused fix (2026-06-19): removed the hardcoded output-token cap (was max_tokens=512, floored to 1024 with tools — artificially truncated 262k-context endpoints to ~1k output). Output budget is now derived per-request from the room left after the prompt (deriveOutputBudget): free/local providers (lmstudio/ollama/custom) OMIT max_tokens entirely (no truncation); paid (routstr) sends the derived budget so estimateMaxCost/prepay/refund use the same number and never underpay. getPromptBudgetTokens inverted to a proportional completion reserve (no fixed sliver). Removed DEFAULT_MAX_TOKENS/MIN_TOOL_ENABLED_MAX_TOKENS + the unused maxTokens store field; MIN_OUTPUT_BUDGET_TOKENS=1024 kept as a tool-call FLOOR (not a cap). Context-overflow recovery intact (emergency path re-derives budget). New exported deriveOutputBudget/getPromptBudgetTokens + 11 headless tests (now 355/0); dev+prod builds + biome green. Not a phase plan; no SUMMARY, no phase.complete.

Ingest+attachment rethink — Slice A SHIPPED (2026-06-19): attached datasets now render in the chat transcript as compact, collapsible AttachmentCards (filename · kind badge · rows×cols · ⚠ warning affordance, empty-safe; schema + sample table behind expand) instead of the raw `{ingestHandle,ingestSummary}` JSON blob. Pure display/payload decouple — composeOutboundContent's model payload is UNCHANGED, D-11 invariant test still green. New AttachmentCard + parseIngestHandlePart, reuses FileChip visual helpers + CodeRunDisclosure collapse idiom. bun test 340/0 + dev/prod builds + biome (changed files) green. Slice B (AI-cleans ingest: lenient+honest parse, raw sandbox access, profile-first prompt, uncertainty surfacing) NOT started.

Phase-4 sandbox OOM/CPU RUNAWAY fixed (2026-06-19): the code-interpreter worker was re-fetching+re-compiling the ~503KB QuickJS wasm and allocating a fresh heap on EVERY run (2,831 req / 1.38 GB toward an OOM crash, pegged CPU core). Root cause = (1) fresh-Worker-per-run × an UN-memoized newQuickJSWASMModuleFromVariant (only getQuickJS() memoizes) → full re-instantiate per run, and (2) RUN_CODE_RETRY_CAP was advisory-only (just appended a "stop" string) so a looping model spawned a sandbox per call with no programmatic stop. Fix: memoize the compiled module in sandbox.worker.ts (compile-once); switch quickjsWorker.ts to ONE warm-pooled worker reused across runs (fresh runtime+context per run keeps isolation — proven no state bleed) so wasm compiles ONCE per session; make the cap a real CIRCUIT BREAKER in runCode.ts (refuse-without-spawn at the cap, then reset so the model isn't bricked); add immutable Cache-Control to the wasm route (dev+prod). Reproduced before/after with the real bundle + a counting wasm server: 6 warm-worker runs → wasm fetched exactly 1×, RSS plateaued (was monotonic climb). bun test 384/0 (+5 new regression tests: module-reuse isolation + circuit-breaker), dev+prod builds green, changed files biome-clean. Live in-browser run_code UAT still pending (human-verify). Debug session: .planning/debug/sandbox-worker-oom-runaway.md. Not a phase plan; no SUMMARY, no phase.complete.

Regression hotfix (2026-06-19): fixed a `ReferenceError: canUseVision is not defined` thrown on EVERY chat send (introduced by vision-gate fix b723510). The request-builder closure read `canUseVision` (gating capture_map_snapshot advertisement) but it was only declared later inside the try block — out of scope. Hoisted `let canUseVision = false` to the sendMessage outer scope (fail-closed default); the later line became a plain assignment; all three uses now share one binding. Gating behavior unchanged. bun test 384/0, dev+prod builds + store.ts biome green. Not a phase plan; no SUMMARY, no phase.complete.

UAT focused fixes (2026-06-19, 4 atomic commits): (1) trim geo tool results in the model-facing prompt seam — strip per-result geojson boundary polygons + extratags from search_location/reverse_lookup, ALWAYS keep coordinates (fixes UAT 21-round coords-buried detour) [551c7ea]; (2) document run_code data shape: data.features is a Feature[] (use data.features.find, NOT data.features.features), data.datasets[handle] is the rows array [6882eea]; (3) make CEP-22 oversizedTransfer.enabled explicit on the geo client (already SDK default, no bump; no stale truncation workaround found) [1a6ebbd]; (4) backlog note — geo MCP server must drop its 42KB geometry truncation + rely on CEP-22 (server-side, out of this repo) [c867665]. bun test 388/0, dev+prod builds + biome (changed files) green. Not a phase plan; no SUMMARY, no phase.complete.
