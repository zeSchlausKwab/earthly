---
status: issues_found
phase: 07-geometry-optimization
source: [07-VERIFICATION.md]
started: 2026-06-22T15:20:00Z
updated: 2026-06-23T06:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Live oversized-dataset optimize → review diff headline → publish round-trip
expected: Load a real oversized dataset (e.g. the 12MB West Pacific Trail) into the editor, ask the AI to optimize it, review the before/after diff headline and metrics, then publish successfully. The optimize_geometry tool runs off-thread (no UI freeze), the diff disclosure shows the metrics headline (bytes/vertices/features/joins), the result is under the ~1MB publish limit, topology is preserved visually, and the normal publish flow completes.
result: issue
reported: "App crashes. Model called optimize_geometry with arguments {} (no targetBytes); finishReason tool_calls; tool result never returned (completedAt null) — app crashed during tool execution. Endpoint: custom moonshot kimi-k2.7-code-highspeed, tools enabled."
severity: blocker

## Summary

total: 1
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Asking the AI to optimize the geometry runs optimize_geometry to completion (off-thread, no freeze) and returns a gated diff with a metrics headline."
  status: failed
  reason: "User reported: App crashes when optimize_geometry is invoked (arguments {}). The tool call is emitted (finishReason tool_calls) but the tool result never returns (completedAt null) — the app crashes during tool execution."
  severity: blocker
  test: 1
  root_cause: |
    Two compounding defects make optimize() pathological on real large datasets:
    (1) QUADRATIC complexity in optimize(): the binary search runs MAX_ITERS=12 (+baseline)
        iterations, and EACH iteration calls validateGeometryFeatures() (turf.kinks self-
        intersection detection, O(V^2) per feature) AND turf.simplify({highQuality:true})
        over the FULL dataset. Empirically measured on ONE LineString: 5k verts = 2.1s,
        15k verts = 16.7s, 30k verts = 46.6s (clean quadratic). A real ~12MB dataset
        (hundreds of thousands of vertices in a few large features) takes minutes-to-hours.
        The synthetic 07-01 fixture passed only because its 43.5k verts are spread across
        300 SMALL features (low per-feature V → cheap kinks).
    (2) DANGEROUS main-thread sync fallback in runOptimize(): the 30s timeout calls
        settleViaSync(), which re-runs the SAME optimize() SYNCHRONOUSLY on the MAIN
        THREAD — and does NOT terminate the still-running worker. For any dataset the
        worker can't finish in 30s (already true at ~30k verts / ~1.2MB), this guarantees
        a multi-minute main-thread block → UI freeze → tab OOM → crash.
  artifacts:
    - src/features/chat/geometry/optimize.ts  # quadratic per-iteration kinks + highQuality simplify over full set
    - src/features/chat/geometry/optimizeClient.ts  # 30s timeout re-runs optimize() on main thread, no worker terminate
    - src/features/chat/tools/geometry-tools.ts  # optimize_geometry handler (entry point)
  missing:
    - "Bound optimize() cost: avoid O(V^2) topology validation per iteration (skip/cap turf.kinks for high-vertex features, or validate once at the end / on a budget) and use highQuality:false during the search."
    - "Make the timeout fallback safe: never re-run optimize() synchronously on the main thread for large datasets — terminate the worker and reject with a model-self-correctable ToolError (or gate sync fallback behind a small vertex/byte threshold)."
    - "Regression test: optimize() on a realistic large single/few-feature dataset (~100k+ verts) completes under a hard time bound (or returns a graceful over-budget/too-large result) — not just the many-small-features fixture."
