---
status: awaiting_human_verify
trigger: "run_code tool fails in bun dev: Failed to construct 'Worker': Script at file:///.../sandbox.worker.ts cannot be accessed from origin http://localhost:3000"
created: 2026-06-18T00:00:00Z
updated: 2026-06-18T10:16:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "Bun's fullstack/HTML-import dev server does NOT support `new Worker(new URL('./x.worker.ts', import.meta.url))`. The dev bundler replaces `import.meta.url` with the module's literal absolute SOURCE file:// path, so the worker URL resolves to file:///.../sandbox.worker.ts. The browser blocks constructing a Worker from a file:// script when the document origin is http://localhost — hence the cross-origin error. (Bun issue #17705)"
  confirming_evidence:
    - "Bundled dev client at /_bun/client/index-*.js contains literally: new Worker(new URL(\"./sandbox.worker.ts\", \"file:///Users/schlaus/workspace/earthly/src/features/chat/sandbox/transport/quickjsWorker.ts\")) — import.meta.url substituted with absolute file:// source path. 0 occurrences of import.meta.url remain in the bundle."
    - "Same literal file:// substitution for ./ingest.worker.ts (ingestClient.ts) and ./geoJsonParseWorker.ts (workerJsonParse.ts) — all three our-code workers identically affected."
    - "Requesting http://localhost:3199/src/features/chat/sandbox/transport/sandbox.worker.ts returns Content-Type: text/html (the SPA index via the '/*': index catch-all), not a transpiled JS module — dev server has no worker route."
    - "Bun GitHub issue #17705: 'Fullstack dev server does not handle or support web workers' (open). Canonical workaround: a dev route that runs Bun.build() on the worker entrypoint and returns the artifact with a JS content-type."
  falsification_test: "If after the fix, curling the served worker URL in `bun dev` returns Content-Type text/javascript (not text/html) AND the bundle's new Worker(new URL(...)) resolves to an http URL, the hypothesis-driven fix is correct. If the worker still resolves file://, the fix is wrong."
  fix_rationale: "Root cause is the dev bundler emitting a file:// worker URL + no http route serving the transpiled worker. The fix must (a) make the worker URL an http(s) URL the browser can construct, and (b) serve the transpiled worker JS at that URL with a JS content-type. Production (build.ts) already bundles workers correctly via Bun.build splitting (verified: prod path emits worker chunks), so the fix is dev-only and must not touch the prod spawn form. Smallest correct change: a worker-URL indirection that points at an http dev route in dev and keeps the bundler new URL(import.meta.url) form in prod."
  blind_spots: "Need to confirm build.ts prod actually emits a worker chunk for sandbox.worker.ts (not yet verified empirically — will run bun run build and inspect dist). Need to confirm the wasm route still works and runSandboxCode in-worker can fetch /emscripten-module.wasm. Need to confirm the typeof Worker===undefined bun-test fallback is untouched."
  next_action: "Run `bun run build` and inspect dist/ for the sandbox worker chunk + emscripten-module.wasm to confirm prod is correct. Then design the dev worker-serving route + spawn indirection."

## Symptoms

expected: run_code invokes QuickJS sandbox worker over http origin in bun dev; circles drawn via sandbox authoring recording.
actual: "Failed to construct 'Worker': Script at 'file:///Users/schlaus/workspace/earthly/src/features/chat/sandbox/transport/sandbox.worker.ts' cannot be accessed from origin 'http://localhost:3000'." Model self-corrected to draw_circle x15; sandbox path never executed.
errors: "Failed to construct 'Worker': Script at 'file://...sandbox.worker.ts' cannot be accessed from origin 'http://localhost:3000'."
reproduction: bun dev, origin http://localhost:3000, invoke run_code tool in chat.
started: Phase 4 feature (new), never worked in dev.

## Eliminated

## Evidence

- timestamp: 2026-06-18T00:00:00Z
  checked: quickjsWorker.ts:65 and ingestClient.ts:142
  found: Both use identical spawn form `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`. quickjsWorker has typeof Worker===undefined fallback to runSandboxCode. ingestClient has onerror sync fallback (SILENT, console.warn only).
  implication: If the file:// resolution is a dev-server issue, ingest worker is also broken in dev but silently degrades to sync parse — consistent with the shared-root hypothesis.

- timestamp: 2026-06-18T00:00:00Z
  checked: Live dev server (PORT=3199 bun src/index.ts) bundled client /_bun/client/index-*.js
  found: Bundle literally contains new Worker(new URL("./sandbox.worker.ts","file:///.../transport/quickjsWorker.ts")). import.meta.url substituted with absolute file:// SOURCE path; 0 import.meta.url left. Same for ingest.worker.ts and geoJsonParseWorker.ts. GET /src/.../sandbox.worker.ts returns Content-Type text/html (SPA index).
  implication: Dev root cause confirmed empirically. Worker URL is file:// so browser blocks Worker construction cross-origin from http://localhost. All three our-code workers identically affected.

- timestamp: 2026-06-18T00:00:00Z
  checked: Production build (bun run build) dist/*.js
  found: NO worker chunk emitted. Prod chunk keeps new Worker(new URL("./sandbox.worker.ts",import.meta.url)) with import.meta.url PRESERVED, resolving at runtime to https://host/sandbox.worker.ts which the prod catch-all serves as index.html. Bun bundler does NOT auto-emit the worker as a separate entry from this form (Bun issues #7534/#7901/#16869).
  implication: PROD IS ALSO BROKEN, same root cause. The build.ts/code comments claiming this form emits a worker chunk are FALSE. Fix must explicitly bundle each worker as its own entrypoint and serve it at a stable http URL in BOTH dev and prod, then point the spawn at that URL.

- timestamp: 2026-06-18T00:00:00Z
  checked: dist/emscripten-module.wasm + serve route + build.ts
  found: WASM correctly emitted to dist/emscripten-module.wasm (503KB), served application/wasm in dev (serveQuickjsWasm) and prod (serveBuiltFile). sandbox.worker.ts pins wasmLocation to /emscripten-module.wasm.
  implication: WASM serving is fine; do not regress it. Only the worker module itself is missing.

## Resolution

root_cause: |
  Bun's HTML-import (fullstack) dev server does not support web workers (Bun issue #17705).
  The dev bundler replaces `import.meta.url` in browser modules with the module's literal
  absolute SOURCE file:// path, so `new Worker(new URL('./sandbox.worker.ts', import.meta.url))`
  resolves to `file:///.../sandbox.worker.ts`. The browser refuses to construct a Worker from a
  file:// script when the document origin is http://localhost:3000 → cross-origin error. Also the
  dev server's `"/*": index` catch-all serves the .ts path as text/html (the SPA), so there is no
  http route serving the transpiled worker module. SHARED across all three our-code workers
  (sandbox.worker.ts, ingest.worker.ts, geoJsonParseWorker.ts); ingest/geo silently degrade to
  sync via their onerror/catch fallbacks so the breakage was invisible until run_code (which has
  no sync fallback for the worker construction error) surfaced it.
fix: |
  Bundle each worker as its OWN entrypoint and serve it at a stable origin-rooted URL.
  1. New src/lib/workers/workerAssets.ts: single source of truth mapping logical worker ids
     to served name + source path; workerUrl(id) returns /workers/<name>.js (an origin-relative
     string the browser resolves to a same-origin http URL — constructible in dev AND prod).
  2. New src/lib/workers/buildWorker.ts: shared Bun.build helper (browser/esm, no splitting,
     same frontend env define) used by BOTH the dev route and prod build so they can't diverge.
  3. Spawn sites (quickjsWorker.ts, ingestClient.ts, workerJsonParse.ts) now pass workerUrl('id')
     to new Worker(...) instead of new URL('./x.worker.ts', import.meta.url).
  4. Dev: src/index.ts adds a /workers/:name route that Bun.builds the worker on demand
     (cached per served-name; sandbox spawns fresh-per-run) and serves text/javascript.
  5. Prod: build.ts emits each worker to dist/workers/<name>.js; src/index.ts prod catch-all
     serves dist/workers/* as text/javascript and 404s missing /workers/* (no SPA fallback);
     serveBuiltFile now sets text/javascript for .js/.mjs.
  6. SECONDARY ROOT CAUSE fixed: curatedTurf.ts imported MAX_DISTANCE_METERS from the
     @/features/geo-editor/api BARREL, which re-exports createAuthoring → drags the whole
     GeoEditor + Nostr stack + a Node `pino` logger into the worker (2MB, pino.destination
     throws on load in a browser Worker). Switched to the leaf import
     @/features/geo-editor/api/primitives → worker drops to ~0.46-0.58MB, pino gone.
  The typeof Worker===undefined bun-test fallback and the /emscripten-module.wasm route are
  untouched.
verification: |
  - DEV (PORT=3199 bun src/index.ts): GET /workers/{sandbox,ingest,geoJsonParse}.worker.js →
    200 text/javascript; bundle's new Worker(...) now uses workerUrl(...) → /workers/*.js (0
    file:// refs remain). Headless: fetched served sandbox worker, ran it as a real Worker with
    a simulated http origin → loaded, fetched wasm over http, ran turf.circle + recorded
    authoring.addFeature + console capture, returned "Polygon" (success).
  - PROD (bun run build && bun run build:production both green): dist/workers/*.js emitted +
    dist/emscripten-module.wasm present. NODE_ENV=production server: /workers/sandbox.worker.js
    → 200 text/javascript; missing worker → 404 (not SPA); wasm → application/wasm. Headless
    prod worker run → loaded over http, fetched wasm over http, turf+authoring OK, returned
    "Polygon".
  - bun test: 308 pass / 0 fail (baseline held). bun run build + build:production: green, worker
    + wasm assets emitted, prod sandbox worker pino-free. Biome: new files 0/0, spawn-site edits
    clean, no NEW errors in src/index.ts (repo-wide biome has 113 pre-existing errors / 109
    warnings unrelated to this change; build.ts is outside biome.json's src/** scope).
files_changed:
  - src/lib/workers/workerAssets.ts (new)
  - src/lib/workers/buildWorker.ts (new)
  - src/features/chat/sandbox/transport/quickjsWorker.ts
  - src/features/chat/ingest/ingestClient.ts
  - src/lib/geo/workerJsonParse.ts
  - src/features/chat/sandbox/curatedTurf.ts
  - src/index.ts
  - build.ts
