---
status: testing
phase: 07-geometry-optimization
source: [07-VERIFICATION.md]
started: 2026-06-22T15:20:00Z
updated: 2026-06-22T15:20:00Z
---

## Current Test

number: 1
name: Live oversized-dataset optimize → review diff headline → publish round-trip
expected: |
  The optimize_geometry tool runs off-thread (no UI freeze), the diff disclosure shows the
  metrics headline (bytes/vertices/features/microgap joins), the result is under the publish
  size limit, topology is preserved visually, and the normal publish flow completes.
awaiting: user response

## Tests

### 1. Live oversized-dataset optimize → review diff headline → publish round-trip
expected: Load a real oversized dataset (e.g. the 12MB West Pacific Trail) into the editor, ask the AI to optimize it, review the before/after diff headline and metrics, then publish successfully. The optimize_geometry tool runs off-thread (no UI freeze), the diff disclosure shows the metrics headline (bytes/vertices/features/joins), the result is under the ~1MB publish limit, topology is preserved visually, and the normal publish flow completes.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
