---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: Phase 3 UI-SPEC approved
last_updated: "2026-06-17T06:41:19.633Z"
last_activity: 2026-06-16 -- Phase 02 Plan 06 complete (D-05 poll-based MCP hot-reload; A1 SUPPORTED — live server returned 15 tools incl. create_map_upload drift)
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 9
  completed_plans: 9
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-16)

**Core value:** The maintainer (and any user) can open the app for fun, not duty — extended this milestone so analysts, curators, and power users can ingest real-world data, transform it with sandboxed code, and safely author maps via chat.
**Current focus:** Phase 02 — tool-registry-authoring-api

## Current Position

Phase: 02 (tool-registry-authoring-api) — COMPLETE (6/6 plans)
Plan: 6 of 6 — complete
Status: Ready to execute
Last activity: 2026-06-16 -- Phase 02 Plan 06 complete (D-05 poll-based MCP hot-reload; A1 SUPPORTED — live server returned 15 tools incl. create_map_upload drift)

Progress: [███░░░░░░░] 32%

## Performance Metrics

**Velocity:**

- Total plans completed: 5
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: NIP-46 async decrypt path is untested against a remote signer; needs an explicit test + export/import escape hatch.
- [Phase 3]: Optional active vision-probe step may consume Cashu budget; validate against Routstr prepayment before enabling by default.
- [Phase 4]: Open design decision — QuickJS-WASM-in-Worker vs cross-origin-iframe+CSP for the sandbox isolation boundary. Resolve via a time-boxed spike at phase start before wiring any tool.
- [Phase 6]: Style-rule persistence format (tag vs content) on kind 37515 must be decided before building; confirm against SPEC.md.

## Deferred Items

Items acknowledged and carried forward / out of scope for this milestone:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Feature | Nostr-scrolls / WASM (SCROLL-01/02/03, NIP-5C) | Deferred to next milestone | 2026-06-16 |
| Feature | Compound routing (COMPOUND-01) | Deferred to v2 | 2026-06-16 |
| Refactor | Reroute editor.updateFeature + deleteFeatures + dataset-load setFeatures through Authoring API (facade needs modifyFeature/deleteFeatures surface; then tighten A3 boundary to all 4 verbs) | Deferred to a Phase 2 facade-expansion follow-up | 2026-06-16 (02-03) |

## Session Continuity

Last session: 2026-06-17T05:59:09.756Z
Stopped at: Phase 3 UI-SPEC approved
Resume file: .planning/phases/03-file-ingest-multimodal/03-UI-SPEC.md
