---
status: testing
phase: 04-code-interpreter-sandbox
source: [04-VERIFICATION.md]
started: 2026-06-18T09:55:00Z
updated: 2026-06-18T09:55:00Z
---

## Current Test

number: 1
name: Live fibonacci demo (CODE-05)
expected: |
  Prompt "draw 15 circles with increasing fibonacci radii around this point" (give a point).
  The AI autonomously emits a run_code call (no confirm — D-04), 15 circles appear on the
  map, the transcript shows a COLLAPSED "Ran code → 15 features created" block (D-09).
  Expand it — read-only source, console output, return value visible (D-10/D-12).
awaiting: user response

## Tests

### 1. Live fibonacci demo (CODE-05)
expected: Prompt "draw 15 circles with increasing fibonacci radii around this point". The AI autonomously emits a run_code call (no confirm — D-04), 15 circles appear on the map, the transcript shows a COLLAPSED "Ran code → 15 features created" block (D-09). Expand it — read-only source, console output, return value visible (D-10/D-12).
result: [pending]

### 2. Live overfly demo (CODE-06)
expected: Ingest a small overfly-fees CSV dataset, then prompt the Austria→Bosnia cost-weighted flight-path request. The AI reads the data by handle, runs the computation in the sandbox, draws the chosen path, and the collapsed block's return value shows the chosen route + per-variant costs.
result: [pending]

### 3. Live self-correction (CODE-03 — D-06/D-07/D-11)
expected: Prompt something that makes the AI write throwing code. The user sees a CONCISE one-line red ToolError bubble (no giant stack — D-11). The AI self-corrects within ~3 attempts (D-06). Each retry is its own separate collapsed block (D-07).
result: [pending]

### 4. Live no-freeze (CODE-04)
expected: The UI stays responsive throughout all runs, including any runaway that triggers the timeout. No browser hang observed.
result: [pending]

### 5. Read-only affordance (D-12)
expected: In the expanded code block there is NO edit field, textarea, or "Run"/"Rerun"/"Edit" button visible. The code is shown for transparency only.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
