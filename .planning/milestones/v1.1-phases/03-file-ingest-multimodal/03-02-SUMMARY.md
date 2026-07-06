---
phase: 03-file-ingest-multimodal
plan: 02
subsystem: ingest
tags: [web-worker, rpc, sync-fallback, transferable, csv, xlsx, geojson, papaparse, exceljs]

# Dependency graph
requires:
  - phase: 03-file-ingest-multimodal (Plan 01)
    provides: ingest.worker.ts + pure parse.ts helpers + IngestParseRequest/IngestParseResponse contract + four parse fixtures
provides:
  - host-side ingest worker RPC client (src/features/chat/ingest/ingestClient.ts) — parseFileInWorker + terminateIngestWorker
  - the no-freeze guarantee (INGEST-02): lazy worker + id-keyed pending + onerror sync-fallback + workerBroken latch + 30s timeout
  - shared parseSync(id, kind, payload) -> IngestParseResponse contract reused by no-worker / onerror / timeout paths
  - xlsx transferable ArrayBuffer dispatch (no main<->worker copy)
affects: [03-03 size guard (calls parseFileInWorker after the pre-parse cap), 03-06 UI (FileChipStrip drives parseFileInWorker + reads IngestParseResponse)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Worker RPC client mirrors src/lib/geo/workerJsonParse.ts verbatim: lazy getWorker(), id-keyed pendingRequests Map, onerror sync-fallback-all-pending + workerBroken latch, 30s per-request timeout fallback"
    - "Single shared parseSync() powers every fallback path (no-worker, onerror, timeout) so the worker and its sync fallback can never diverge"
    - "Injectable per-request timeoutMs makes the stuck-worker timeout path deterministically unit-testable under bun:test (0ms timeout simulates a hung worker)"

key-files:
  created:
    - src/features/chat/ingest/ingestClient.ts
    - src/features/chat/ingest/ingestClient.test.ts
  modified: []

key-decisions:
  - "parseFileInWorker(kind, payload, {timeoutMs}) — payload is { text?, buffer? }; returns the worker's IngestParseResponse verbatim (rows+schemaFields for csv/xlsx, data for json/geojson/text, { success:false, error } on failure)"
  - "Shared parseSync(id,kind,payload) is the single source of truth reused by the no-worker path, the onerror handler, and the 30s timeout — guarantees the sync fallback produces byte-identical results to the worker (both wrap parse.ts)"
  - "Timeout is injectable (options.timeoutMs, default 30_000) so the hung-worker T-03-03 path is testable with a 0ms timeout; production callers omit it and get 30s"
  - "terminateIngestWorker() also resets workerBroken and clears pendingRequests so test isolation (and a manual recovery after a transient worker failure) is clean — a deliberate superset of the geo analog's terminateParseWorker()"
  - "withoutWorker() test helper removes globalThis.Worker so the sync-fallback path (which the worker round-trip is NOT driveable for under bun:test) is exercised for all five kinds; the real worker round-trip stays covered by Plan 01's build-emission gate + parse.test.ts"

patterns-established:
  - "Host-side worker RPC client: lazy worker, id-keyed promises, latch + timeout, shared sync fallback — the no-freeze contract for any off-thread parse"

requirements-completed: [INGEST-02, INGEST-03]

# Metrics
duration: ~8min
completed: 2026-06-17
---

# Phase 3 Plan 02: Ingest Worker RPC Client Summary

**Host-side `parseFileInWorker` client that drives `ingest.worker.ts` off the main thread with a verified sync fallback (no-Worker, onerror latch, and 30s timeout all converging on one shared `parseSync`), plus transferable-ArrayBuffer xlsx dispatch — the INGEST-02 no-freeze guarantee.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-17 (sequential executor on main working tree)
- **Completed:** 2026-06-17
- **Tasks:** 1 (TDD: RED → GREEN)
- **Files created:** 2

## Accomplishments
- **No-freeze contract delivered:** `parseFileInWorker(kind, payload)` always settles — via the worker when available, and via a synchronous parse when the worker is absent (SSR/unsupported), breaks (`onerror` → `workerBroken` latch), or hangs (30s `setTimeout`). Mirrors the proven `workerJsonParse.ts` machinery verbatim, so zero new bundler config (RESEARCH discretion: in-repo Worker pattern).
- **Single fallback source of truth:** a shared `parseSync(id, kind, payload)` is reused by the no-worker path, the `onerror` sync-fallback-all-pending loop, and the timeout — the worker and its fallback wrap the same `parse.ts` helpers, so they can never diverge.
- **xlsx transferred, not copied (T-03-05):** the xlsx branch posts `postMessage(request, [payload.buffer])`, moving the ArrayBuffer main→worker instead of doubling memory.
- **8 new tests GREEN** covering all five kinds through the client, the no-Worker fallback (T-03-04), the injected-timeout fallback (T-03-03), and `{ success:false, error }` parity for malformed JSON.

## Task Commits

Task 1 was executed TDD-style (RED → GREEN):

1. **Task 1 (RED): failing RPC + sync-fallback + timeout test** - `84d5b94` (test)
2. **Task 1 (GREEN): host-side ingest worker RPC client** - `4563a4d` (feat)

No refactor commit — the GREEN implementation was already DRY via the shared `parseSync`.

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/features/chat/ingest/ingestClient.ts` - host-side worker RPC client. Exports `parseFileInWorker(kind, payload, {timeoutMs})` and `terminateIngestWorker()`. Lazy `getWorker()` builds `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type:'module' })`; id-keyed `pendingRequests`; `onerror` sync-falls-back all pending + latches `workerBroken` + terminates; per-request 30s timeout sync fallback; shared `parseSync` for every fallback path; xlsx posted transferable.
- `src/features/chat/ingest/ingestClient.test.ts` - 8 tests. `withoutWorker()` helper strips `globalThis.Worker` to drive the sync path for all five kinds + the no-Worker case; a 0ms `timeoutMs` exercises the stuck-worker timeout fallback; malformed-JSON asserts the `{ success:false }` boundary.

## Decisions Made
- **Public signature for downstream plans:** `parseFileInWorker(kind: IngestKind, payload: { text?: string; buffer?: ArrayBuffer }, options?: { timeoutMs?: number }): Promise<IngestParseResponse>`. Plan 03 (size guard) calls this AFTER its pre-parse cap; Plan 06 (UI) calls it from the file-chip strip and renders `IngestParseResponse` (rows+schemaFields | data | error).
- **`parseSync` is the shared contract** Plan 03/06 can rely on: the fallback result is identical to the worker result for the same payload, because both wrap `parse.ts`. Downstream code never needs to branch on "did this come from the worker or the fallback".
- **`terminateIngestWorker()` resets `workerBroken`** (superset of the geo analog) for clean test isolation and to permit a fresh worker attempt after a transient failure.
- **Timeout injected for testability:** default 30s in production; tests pass `timeoutMs: 0` to deterministically settle the hung-worker path without fake timers.

## Deviations from Plan

None - plan executed exactly as written. (Task 1's `parseSync` returning a Promise — because xlsx parsing via ExcelJS is async — is the plan's intended "factor the synchronous parse into a shared `parseSync`" with the one necessary accommodation that the xlsx kind is inherently async; all callers `await`/`.then()` it uniformly.)

## Issues Encountered
- **Biome `noDelete` suppression warning:** the first draft of the test used `delete globalThis.Worker` with a `biome-ignore` comment Biome flagged as having no effect. Replaced with `globalThis.Worker = undefined` (still makes `typeof Worker === 'undefined'`), clearing the lint warning. Resolved before the GREEN commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Plan 03 (size guard):** ready — apply the pre-parse input-size cap (Plan 01's recommended ~10 MB raw-byte cap, T-03-01) BEFORE calling `parseFileInWorker`; the client itself owns no size cap by design.
- **Plan 06 (UI):** ready — the file-chip strip drives `parseFileInWorker` and renders `IngestParseResponse`. Importing `ingestClient` from a UI module is what finally makes the ingest worker chunk emit under the html-driven production build (Plan 01's open handoff); no UI imports it yet, so the chunk still does not emit, but `bun run build` is green.
- Gates: `bun test src/features/chat/ingest/` (13 pass / 0 fail — 5 parse + 8 client), `bun run build` (exit 0), biome (clean on both new files).

## Self-Check: PASSED

- FOUND: src/features/chat/ingest/ingestClient.ts
- FOUND: src/features/chat/ingest/ingestClient.test.ts
- FOUND commit: 84d5b94 (test, RED)
- FOUND commit: 4563a4d (feat, GREEN)
- Gates: bun test (13 pass / 0 fail), bun run build (exit 0), biome (clean)

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17*
