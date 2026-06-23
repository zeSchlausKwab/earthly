# Deferred Items — Phase 07 (geometry-optimization)

Out-of-scope discoveries logged during execution. NOT fixed by the discovering plan.

## Pre-existing cross-plan build break: `optimize.worker.ts` missing

- **Discovered during:** 07-02 execution (Task 1 acceptance `bun run build`)
- **Issue:** `bun run build` fails at the `optimize` worker bundling step with
  `ModuleNotFound resolving "src/features/chat/geometry/optimize.worker.ts" (entry point)`.
- **Root cause:** Plan **07-01** (`chore(07-01): register optimize worker asset`,
  commit f4001af) registered the `optimize` entry in `src/lib/workers/workerAssets.ts`
  (`WORKER_ASSETS.optimize.sourcePath = 'src/features/chat/geometry/optimize.worker.ts'`),
  but the worker source file is authored by a LATER plan in this phase (07-03/07-04).
  The build was already broken on HEAD before 07-02 began.
- **Scope:** Plan 07-02 only touches `src/features/chat/safeEditing/` (diff plumbing).
  The main app/HTML bundle (which includes 07-02's touched modules) builds and emits
  `dist/index.html` successfully — only the separate `optimize` worker entrypoint fails.
- **Resolution owner:** The plan that creates `optimize.worker.ts` (07-03/07-04) will
  close this automatically. Do NOT fix in 07-02.
