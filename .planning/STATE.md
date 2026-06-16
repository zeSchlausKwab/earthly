---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: milestone
status: executing
stopped_at: Completed 02-02-PLAN.md (authoring-api facade)
last_updated: "2026-06-16T18:50:00.000Z"
last_activity: 2026-06-16 -- Phase 02 Plan 02 complete (authoring-api facade)
progress:
  total_phases: 7
  completed_phases: 1
  total_plans: 9
  completed_plans: 5
  percent: 19
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-16)

**Core value:** The maintainer (and any user) can open the app for fun, not duty — extended this milestone so analysts, curators, and power users can ingest real-world data, transform it with sandboxed code, and safely author maps via chat.
**Current focus:** Phase 02 — tool-registry-authoring-api

## Current Position

Phase: 02 (tool-registry-authoring-api) — EXECUTING
Plan: 3 of 6
Status: Executing Phase 02 (Plans 01-02 complete)
Last activity: 2026-06-16 -- Phase 02 Plan 02 complete (authoring-api facade)

Progress: [██░░░░░░░░] 19%

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

## Session Continuity

Last session: 2026-06-16T18:50:00.000Z
Stopped at: Completed 02-02-PLAN.md (authoring-api facade)
Resume file: .planning/phases/02-tool-registry-authoring-api/02-03-PLAN.md
