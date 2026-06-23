---
status: testing
phase: 07-geometry-optimization
source: [07-VERIFICATION.md]
started: 2026-06-22T15:20:00Z
updated: 2026-06-23T07:20:00Z
---

## Current Test

number: 1
name: Live oversized-dataset optimize → review diff headline → publish round-trip
expected: |
  Load a real oversized dataset (e.g. the 12MB West Pacific Trail) into the editor, ask the AI to
  optimize it, review the before/after diff headline + metrics, then publish. The optimize_geometry
  tool runs off-thread WITHOUT freezing the UI; a pathological/oversized input returns a relayable
  ToolError ("timed out — too large…") that the model can self-correct from, instead of crashing the
  tab; the diff disclosure shows the metrics headline; the result clears the ~1MB publish limit;
  topology is preserved visually; and the normal publish flow completes.
awaiting: user response

## Tests

### 1. Live oversized-dataset optimize → review diff headline → publish round-trip
expected: Load a real oversized dataset (e.g. the 12MB West Pacific Trail) into the editor, ask the AI to optimize it, review the before/after diff headline and metrics, then publish successfully. The optimize_geometry tool runs off-thread (no UI freeze), an oversized/pathological input returns a relayable ToolError (not a crash), the diff disclosure shows the metrics headline (bytes/vertices/features/joins), the result is under the ~1MB publish limit, topology is preserved visually, and the normal publish flow completes.
result: pending
note: |
  Crash BLOCKER recorded 2026-06-22 has been FIXED at the code level by gap-closure plan 07-05
  + the code-review follow-up (commit c6ff708); auto-verification is 5/5 (07-VERIFICATION.md).
  This live round-trip needs a human re-run to confirm: (a) no UI freeze on normal data, (b) a
  pathological/oversized input surfaces a relayable ToolError instead of crashing the tab, and
  (c) the optimize→publish flow completes. Prior failing report retained in the Gaps section below.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- truth: "Asking the AI to optimize the geometry runs optimize_geometry to completion (off-thread, no freeze) and returns a gated diff with a metrics headline."
  status: resolved
  resolved_by: [07-05-PLAN.md, c6ff708]
  resolved_at: 2026-06-23
  reason: |
    FIXED in gap-closure plan 07-05 + the code-review follow-up (commit c6ff708), code-verified 5/5
    in 07-VERIFICATION.md. Both root-cause defects are addressed:
    (1) optimize() is now bounded / near-linear — the binary search uses turf.simplify({highQuality:false})
        and the per-iteration O(V^2) turf.kinks topology validation is gone (validate-once-at-end, with
        kinks skipped above TOPOLOGY_VALIDATION_MAX_VERTICES=5000). Perf regression: a few-large-features
        (~160k vert) fixture completes in ~1.5s vs the old 10s+ hard bound.
    (2) runOptimize()'s timeout is now SAFE — it terminates the worker and size-gates the fallback
        (SYNC_FALLBACK_MAX_BYTES=256KiB): over-threshold inputs REJECT with a relayable "timed out / too
        large" ToolError instead of re-running optimize() synchronously on the main thread. The code-review
        WR-01 fix closed a second-call reopening of the same crash (the workerBroken / no-worker fast paths
        now keep the size gate via settleWithoutWorker(); the timeout recycles the worker instead of
        permanently latching broken). Tests B/C/D pin the contract; bun test 571/0.
    Awaiting human re-test of the live round-trip (Test 1) to confirm end-to-end in the browser.
  original_report: "App crashes. Model called optimize_geometry with arguments {} (no targetBytes); finishReason tool_calls; tool result never returned (completedAt null) — app crashed during tool execution. Endpoint: custom moonshot kimi-k2.7-code-highspeed, tools enabled."
  test: 1
  root_cause: |
    Two compounding defects made optimize() pathological on real large datasets (now both fixed — see
    `reason` above; retained here as the diagnosis of record):
    (1) QUADRATIC complexity in optimize(): the binary search ran MAX_ITERS=12 (+baseline) iterations,
        and EACH iteration called validateGeometryFeatures() (turf.kinks, O(V^2) per feature) AND
        turf.simplify({highQuality:true}) over the FULL dataset. Empirically on ONE LineString: 5k verts
        = 2.1s, 15k verts = 16.7s, 30k verts = 46.6s (clean quadratic). A real ~12MB dataset took
        minutes-to-hours. The synthetic 07-01 fixture passed only because its 43.5k verts spread across
        300 SMALL features (low per-feature V → cheap kinks).
    (2) DANGEROUS main-thread sync fallback in runOptimize(): the 30s timeout called settleViaSync(),
        which re-ran the SAME optimize() SYNCHRONOUSLY on the MAIN THREAD without terminating the still-
        running worker → multi-minute main-thread block → UI freeze → tab OOM → crash.
