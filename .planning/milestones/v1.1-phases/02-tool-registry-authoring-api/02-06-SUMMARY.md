---
phase: 02-tool-registry-authoring-api
plan: 06
subsystem: chat-tools-registry
tags: [mcp-sync, hot-reload, tool-registry, remote-mcp, d-05, d-04, poll-not-push, infra-01]

# Dependency graph
requires:
  - phase: 02
    plan: 04
    provides: "register/unregister/advertise + ToolEntry{kind:'remote-mcp', origin} — the dynamic registry mcp-sync converges"
provides:
  - "D-05 live MCP hot-reload — poll-based syncMcpTools() pulls the live server manifest via listTools() and diff-converges the registry's remote-mcp entries (register new / unregister removed), tagged kind:'remote-mcp' + origin=SERVER_PUBKEY"
  - "D-04 advertised list reflects the live manifest — getGeoTools() reads live registry state at request time, falling back to the hardcoded bootstrapped entries when sync is inactive/failed"
  - "EarthlyGeoServerClient.callRemoteTool(name,args) — generic remote-tool passthrough reused by synced handlers"
affects: ["Phase 4 (sandbox tools dispatch through the same registry; live-synced remote tools advertised to the model)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Poll-not-push manifest sync (Pitfall 3): refresh on explicit call + optional cancelable interval over the stateless Nostr transport; NO setNotificationHandler push subscription"
    - "Diff-to-converge registry sync: only mcp-sync's own synced names are tracked + unregistered; bootstrap/hardcoded entries are never clobbered on graceful-degradation"
    - "Live-state advertisement: getGeoTools() = advertise() at request time so register/unregister propagates to what the model sees"

key-files:
  created:
    - src/features/chat/tools/mcp-sync.ts
    - src/features/chat/tools/mcp-sync.test.ts
  modified:
    - src/ctxcn/EarthlyGeoServerClient.ts
    - src/features/chat/tools/definitions.ts
    - src/features/chat/tools/index.ts
    - src/features/chat/store.ts
  deleted:
    - scripts/spike-list-mcp-tools.ts

key-decisions:
  - "[02-06]: A1 RESOLVED = SUPPORTED. The live ContextVM geo server returned 15 tools via listTools() — the 14 currently-hardcoded names PLUS a new create_map_upload absent from definitions.ts. tools/list works AND the hardcoded list is already stale by one tool — the exact drift D-05 eliminates. → Built Task 2 (success branch), did NOT take the fallback."
  - "[02-06]: Poll-based (Pitfall 3) — syncMcpTools() refreshes on explicit call + optional cancelable startMcpToolPolling(intervalMs)/stopMcpToolPolling() (default 60s, .unref()'d). NO setNotificationHandler('notifications/tools/list_changed') push path: the stateless transport (isStateless:true) does not guarantee server-initiated notifications."
  - "[02-06]: Diff-to-converge tracks only mcp-sync's OWN synced names (syncedToolNames Set); on a manifest change it unregisters names that vanished and (re)registers the live set. On listTools() failure it degrades gracefully (warn + keep last-known/hardcoded entries; never throws, never wipes the registry) — T-02-18."
  - "[02-06]: Synced handlers route through a new EarthlyGeoServerClient.callRemoteTool(name,args) passthrough (wraps the existing private call() — same stateless transport + isError unwrapping the hand-written remote-mcp handlers use). Every synced tool is forced kind:'remote-mcp' + origin=SERVER_PUBKEY (T-02-17) and only valid-shaped manifest entries register (T-02-19)."
  - "[02-06]: definitions.ts adds getGeoTools() (live advertise() with hardcoded fallback); store.ts reads it at request time instead of the import-time geoTools snapshot, so live sync changes reach the model. geoTools const retained for back-compat."

requirements-completed: [INFRA-01]

# Metrics
duration: 11min
completed: 2026-06-16
---

# Phase 2 Plan 06: Live MCP Hot-Reload (D-05) Summary

**The chat tool registry now PULLS the connected ContextVM geo server's live tool manifest via poll-based `EarthlyGeoServerClient.listTools()` and diff-converges its `kind:'remote-mcp'` entries to match it (register new / unregister removed), tagged `origin: SERVER_PUBKEY` — replacing the hand-transcribed MCP list with a live-synced one (D-05/D-04). The A1 gate resolved SUPPORTED: the live server returned 15 tools, the 14 hardcoded names plus a `create_map_upload` that was missing from `definitions.ts` — proving both that `tools/list` works and that the static list was already stale by one tool. Discovery is poll-based with graceful fallback to the hardcoded set on failure; there is intentionally NO push subscription (Pitfall 3, stateless transport).**

## A1 Spike Outcome (Task 1 — checkpoint:human-verify)

- **Verdict: SUPPORTED.** The live ContextVM geo server (pubkey `ceadb7d5…`) returned a **non-empty 15-tool manifest** via `listTools()`.
- **Drift confirmed:** the manifest contained the 14 currently-hardcoded tool names **plus a new `create_map_upload`** not present in `definitions.ts` — the precise staleness D-05's hot-reload eliminates.
- **Decision:** proceed to Task 2 (the SUCCESS branch). The fallback/defer branch was NOT taken; D-05 is delivered in this plan, not carried forward.
- The Task 1 `listTools()` passthrough (commit `3658d0a`) was kept and promoted into a real method; the throwaway `scripts/spike-list-mcp-tools.ts` was deleted per the plan.

## What Shipped (Task 2 — commit `cafb069`)

- **`mcp-sync.ts`** — `syncMcpTools(client?)`: polls `listTools()`, validates manifest shape, maps each tool's `inputSchema` to an OpenAI `Tool` schema, and `register`s it (`kind:'remote-mcp'`, `origin: SERVER_PUBKEY`). Tools that vanished from the manifest are `unregister`ed (diff-to-converge over a `syncedToolNames` set). Optional cancelable `startMcpToolPolling(intervalMs=60_000)` / `stopMcpToolPolling()` (immediate sync + `.unref()`'d interval). Exposes `isMcpSyncActive()` / `getSyncedMcpToolNames()` and a test-only reset. **No push handler.**
- **`EarthlyGeoServerClient.callRemoteTool(name, args)`** — generic remote-tool passthrough (wraps the private `call()`), so synced handlers route through the same stateless transport + `isError` unwrapping path the hand-written handlers use.
- **`definitions.ts`** — `getGeoTools()` reads live `advertise()` (synced set) with the hardcoded bootstrapped entries as fallback; the `geoTools` import-time snapshot retained for back-compat.
- **`store.ts`** — the model request reads `getGeoTools()` at request time (not the stale `geoTools` const), so register/unregister changes propagate to what the model sees.
- **`index.ts`** — barrel exports `getGeoTools` + the mcp-sync API.
- **`mcp-sync.test.ts`** — offline, `client.listTools()` mocked deterministically; asserts: remote-mcp registration with origin (T-02-17), register/unregister convergence on a manifest change (D-05), `advertise()` reflects the manifest (D-04), graceful degradation that keeps the last-known set on `listTools()` failure (T-02-18), malformed-entry rejection (T-02-19), and a source-grep that no push handler is wired (Pitfall 3).

## Poll Cadence

- Manual: `syncMcpTools()` on demand (e.g. on connect / chat open).
- Optional interval: `startMcpToolPolling(60_000)` — default 60s, cancelable, `.unref()`'d so it never keeps the process alive. Off by default; callers opt in.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a generic `callRemoteTool()` passthrough to EarthlyGeoServerClient**
- **Found during:** Task 2
- **Issue:** The plan's "handler routes the call through EarthlyGeoServerClient, reusing the remote-call path Plan 04 handlers used" had no public entrypoint — the existing `call()` is `private`, and the hand-written handlers call typed per-tool methods (`SearchLocation`, etc.) that don't exist for dynamically-discovered tools.
- **Fix:** Added `async callRemoteTool<T>(name, args)` that wraps the existing private `call()` (same stateless transport + `isError` unwrapping). Synced handlers invoke it by tool name.
- **Files modified:** `src/ctxcn/EarthlyGeoServerClient.ts`
- **Commit:** `cafb069`

**2. [Rule 3 - Blocking] Request-time tool advertisement (getGeoTools) instead of an import-time snapshot**
- **Found during:** Task 2
- **Issue:** `definitions.ts` exported `geoTools = advertise()` captured ONCE at import. Synced register/unregister after import would never reach the model, defeating D-05.
- **Fix:** Added `getGeoTools()` (live `advertise()`); `store.ts` reads it at request time. Kept `geoTools` const for back-compat consumers.
- **Files modified:** `definitions.ts`, `index.ts`, `store.ts`
- **Commit:** `cafb069`

## Threat Model Compliance
- **T-02-17 (remote tool masquerades as local):** mitigated. Every synced tool is forced `kind:'remote-mcp'` + `origin: SERVER_PUBKEY` — it can never register as `editor`/`authoring-primitive`. Asserted in the test.
- **T-02-18 (listTools hangs/errors → registry stalls):** mitigated. Poll-based with graceful degradation — on failure it warns and keeps the last-known/hardcoded set, never throws, never wipes the registry; no blocking push subscription. Asserted in the test.
- **T-02-19 (malformed remote schema):** mitigated. `isValidManifestTool` rejects entries without a string name / with a non-object inputSchema before registering; schema projection degrades unknown property shapes to `type:'string'` rather than crashing. Asserted in the test. Dispatch-boundary arg validation (parseToolCallArguments + clamps) from Plan 04 still applies to all dispatched calls.
- **T-02-SC (package installs):** none — `@modelcontextprotocol/sdk` already present; no new dependencies.

## Gates
- `bun test src/features/chat/tools/mcp-sync.test.ts` — 5 pass / 0 fail.
- `bun test` (full repo) — 109 pass / 0 fail.
- `bun run build` — succeeds (~759ms).
- `bunx biome lint` on all 6 changed files — clean, no diagnostics.
- Source assertions: `mcp-sync.ts` contains no `setNotificationHandler` and no `notifications/tools/list_changed` (both grep to 0 — Pitfall 3 poll-only); `EarthlyGeoServerClient` exposes `listTools()` + `callRemoteTool()`.

## Known Stubs
None. The hardcoded `search_location`/`reverse_lookup`/… entries remain as the deliberate graceful-degradation fallback when sync is inactive or `listTools()` fails — documented behavior (T-02-18), not a goal-blocking stub. Live sync, when run, supersedes them.

## Next Phase Readiness
- Phase 4's sandbox dispatches through the same typed registry; live-synced remote tools are advertised to the model via `getGeoTools()` automatically once `syncMcpTools()` (or `startMcpToolPolling`) runs.
- Push-based refresh remains a documented future optimization, contingent on a stateful MCP transport being confirmed (Pitfall 3).

## Self-Check: PASSED
- Files verified present: `mcp-sync.ts`, `mcp-sync.test.ts` (created); `EarthlyGeoServerClient.ts`, `definitions.ts`, `index.ts`, `store.ts` (modified); `scripts/spike-list-mcp-tools.ts` (deleted — confirmed absent).
- Commits verified in git log: `3658d0a` (Task 1 passthrough + spike), `cafb069` (Task 2 mcp-sync).

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
