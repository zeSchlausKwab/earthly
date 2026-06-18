---
status: testing
phase: 04-code-interpreter-sandbox
source: [04-VERIFICATION.md]
started: 2026-06-18T09:55:00Z
updated: 2026-06-18T09:55:00Z
---

## Current Test

number: 2
name: Live overfly demo (CODE-06)
expected: |
  Ingest a small overfly-fees CSV dataset, then prompt the Austria→Bosnia cost-weighted
  flight-path request. The AI reads the data by handle, runs the computation in the sandbox,
  draws the chosen path, and the collapsed block's return value shows the chosen route +
  per-variant costs.
awaiting: user response

## Tests

### 1. Live fibonacci demo (CODE-05)
expected: Prompt "draw 15 circles with increasing fibonacci radii around this point". The AI autonomously emits a run_code call (no confirm — D-04), 15 circles appear on the map, the transcript shows a COLLAPSED "Ran code → 15 features created" block (D-09). Expand it — read-only source, console output, return value visible (D-10/D-12).
result: pass
note: "Re-tested after worker fix 537cac2 — run_code now executes in the live app. Collapsed 'Ran code → 15 features created' block rendered with read-only SOURCE, Result (15 created · 0 updated · 0 deleted), and RETURN VALUE. Self-correction (Test 3) also incidentally observed: first attempt threw 'SyntaxError: return not in a function (attempt 1/3)' as a concise red block, model reasoned + retried successfully. Separate styling gap found — see Gaps."

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
passed: 1
issues: 1
pending: 3
skipped: 0
blocked: 0

## Gaps

- truth: "run_code executes model-authored JS inside the QuickJS Worker sandbox in the live app (dev) and renders a CodeRunDisclosure block"
  status: resolved
  reason: "Failed to construct 'Worker' (file:// cross-origin) under bun dev — AND prod was also broken (worker served as SPA index.html). Root cause: new Worker(new URL('./x.worker.ts', import.meta.url)) does not yield a constructible http URL in this app's serving; shared across all 3 our-code workers. Also the worker bundle crashed on load (curatedTurf imported the api barrel → pino logger throws in browser worker)."
  severity: blocker
  test: 1
  resolution: "Fixed in 537cac2 — serve /workers/*.js over http in dev + prod, spawn via workerUrl(); curatedTurf imports from api/primitives leaf. Verified live by user re-test: run_code now executes."
  artifacts: [src/index.ts, build.ts, src/features/chat/sandbox/transport/quickjsWorker.ts, src/features/chat/sandbox/curatedTurf.ts]
  missing: []

- truth: "When the AI draws geometry with style options (e.g. per-circle colors), the requested styling is applied to the features"
  status: resolved
  resolution: "authoring.circle/buffer now accept a per-feature style+metadata option bag normalized to the editor's canonical renderer keys (fillColor/strokeColor/color/fillOpacity/strokeOpacity/strokeWidth/radius/label/name/description, plus aliases fill/stroke/width/opacity) and applied to the drawn feature before addFeature→runInterceptors; unknown options now throw InvalidStyleOptionError (no silent drop) and values are V5-validated; raw writeGeoJSON/addFeature style props confirmed preserved via toEditorFeature; run_code system prompt advertises the convention. Commits 5fe7f66 (feature+tests incl. 15-circle distinct-colors repro) + 1e9448f (prompt). Gates: bun test 334/0, dev+prod builds + biome green."
  reason: "User asked for 15 circles with DIFFERENT colors. run_code ran and drew 15 circles, but they all rendered with the default blue style. Root cause: authoring.circle's MakeCircleOptions (primitives.ts:83) only accepts units/steps — the fill/stroke/fill-opacity/stroke-width/name/description the model passed are SILENTLY DROPPED (no error). Even via writeGeoJSON the model would fail: the editor styles per-feature from properties.fillColor/strokeColor/color (LayerManager.ts:199/251), but the run_code system prompt (runCode.ts:100) never advertises that styling convention, so the model guesses CSS-ish fill/stroke keys. Net: the AI cannot style what it draws, and the API gives no feedback that styling was ignored."
  severity: major
  test: 1
  artifacts: [src/features/geo-editor/api/styleOptions.ts, src/features/geo-editor/api/primitives.ts, src/features/geo-editor/api/authoring.ts, src/features/chat/sandbox/runCode.ts, src/features/geo-editor/core/managers/LayerManager.ts]
  missing: []
  scope_note: "Authoring-API completeness (Phase 2 TOOLS-01) + styling (Phase 6 data-driven styling) territory, surfaced during Phase 4 UAT. Not in CODE-01..06; Phase 4 SC#4 (generate geometry) is satisfied."
