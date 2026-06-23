# Deferred Items — Phase 04 Code Interpreter Sandbox

## From Plan 04-02 (run_code wiring)

- **Repo-wide `bun run lint` (Biome) pre-existing backlog (~114 errors / ~109 warnings).**
  Out of scope for this plan. Confirmed pre-existing by linting the HEAD version of
  `src/features/chat/tools/registry.ts` (the OSM-handler formatting diagnostics at
  lines ~674/814 predate this plan). All FOUR files this plan created/edited
  (`readSnapshot.ts`, `readSnapshot.test.ts`, `runCode.ts`, `runCode.test.ts`) plus the
  edited `sandboxHost.test.ts` are Biome-clean. Do NOT auto-fix the backlog here.

- **Prod `.wasm` browser smoke (Wave-1 carry-forward, criterion c).** This plan made
  `runSandbox` reachable from the app graph and confirmed `bun run build` succeeds. The
  production browser smoke (`bun run build:production` + confirm the QuickJS `*.wasm`
  returns 200 and `runSandbox("typeof fetch") === 'undefined'`) is the orchestrator's
  post-plan gate. Fallback if it 404s: human-gated `@jitl/quickjs-singlefile-mjs-release-sync`.
