---
phase: 04
slug: code-interpreter-sandbox
status: secured
threats_open: 0
asvs_level: 1
created: 2026-06-19
---

# SECURITY.md — Phase 4: Code Interpreter Sandbox

**Audited:** 2026-06-19
**Auditor:** gsd-security-auditor (Claude)
**ASVS Level:** 1
**Block-on:** high
**Verdict:** SECURED — 15/15 threats CLOSED (12 mitigate, 0 transfer, 3 accept), `threats_open: 0`

This phase runs UNTRUSTED, AI-authored JavaScript inside a QuickJS-WASM-in-a-Worker
sandbox whose only host surface is exactly four globals (`authoring`/`turf`/`data`/`console`).
Confinement is the core security property. Each declared mitigation was verified by grep
against the CURRENT implementation (accounting for the post-plan UAT/hardening evolution),
not against the original PLAN wording, and not by trusting documentation. The full sandbox
test suite (`bun test src/features/chat/sandbox/`) was executed: **69 pass / 0 fail**.

---

## Threat Verification (mitigate)

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-04-01 | InfoDisclosure/Elevation — VM globals | mitigate | CLOSED | Empty-global context; injects ONLY authoring/turf/data/console: `sandbox.worker.ts:166,190,194,209`. Confinement proof asserts fetch/localStorage/document/window/XMLHttpRequest/signer/wallet all `undefined`: `sandboxHost.test.ts:41-64`. Surface enumeration `injectedPresent=['authoring','console','data','turf']`, `forbiddenPresent=[]`: `sandboxHost.test.ts:66-87`. Live UAT confinement probe confirmed (Buffer ReferenceError observed): `04-UAT.md:30`. |
| T-04-02 | DoS — infinite/tight loop | mitigate | CLOSED | In-VM `setInterruptHandler(shouldInterruptAfterDeadline(...))`: `sandbox.worker.ts:149`. Host-side wall-clock watchdog `setTimeout(...) → disposeWarmWorker → worker.terminate()` at `deadlineMs + WATCHDOG_SLACK_MS`: `quickjsWorker.ts:149-156,64-71`. Timeout-kill proof: `while(true){}` settles <3s with `timedOut:true`: `sandboxHost.test.ts:103-113`. |
| T-04-03 | DoS — memory exhaustion | mitigate | CLOSED | `runtime.setMemoryLimit(64MB)` + `runtime.setMaxStackSize(512KB)`, fresh per run: `sandbox.worker.ts:147-148` (MEMORY_LIMIT_BYTES=64*1024*1024:111, MAX_STACK_SIZE_BYTES=512*1024:113). Per-run runtime under the warm-pooled design (limits re-applied each run). |
| T-04-04 | DoS — console.log flooding | mitigate | CLOSED | `createOutputCapture()` line+byte cap (1000 lines / 256KiB) with `…(output truncated)` marker, stops accumulating on overflow: `outputCapture.ts:21-25,52-69`. Wired into worker console: `sandbox.worker.ts:197-209`. Output-cap proof: `sandboxHost.test.ts:115-124`. |
| T-04-05 | DoS — absurd geometry | mitigate | CLOSED (WR-01 fix verified) | `assertSandboxDistanceWithinCap(op,args)` enforced BEFORE turf runs in the worker turf wrapper: `sandbox.worker.ts:178`. Cap reuses `MAX_DISTANCE_METERS` from the leaf `primitives.ts` (no literal redefined): `curatedTurf.ts:40,54,105-139`. Over-cap `turf.circle` → `__turf_error__` proof: `sandboxHost.test.ts:127-145`. |
| T-04-06 | Tampering — cross-run state bleed | mitigate | CLOSED (under CURRENT warm-pooled design) | Plan original = fresh-spawn-per-run. CURRENT = warm-pooled single worker with FRESH `runtime`+`context` per run, disposed in `finally`; only the stateless compiled WASM module is memoized — no VM/script state survives: `sandbox.worker.ts:138-149,260-266,85-108` + rationale `quickjsWorker.ts:1-33`. No state bleed. |
| T-04-07 | InfoDisclosure — static import reach | mitigate | CLOSED | Tier-A import-boundary fs-scan forbids ndk/nostr/applesauce/MCP/contextvm/signer/wallet across ALL sandbox source files: `sandboxHost.test.ts:178-187,227-237`. Worker holds no createAuthoring/signer/wallet import: tier-B scan `sandboxHost.test.ts:188-192,239-253`. curatedTurf imports the leaf primitives, not the api barrel (avoids dragging Nostr stack): `curatedTurf.ts:40`. |
| T-04-08 | InfoDisclosure/Tampering — live-object leak via snapshot | mitigate | CLOSED | `buildReadSnapshot` returns `structuredClone({datasets,features})` — independent copy, fail-closed on non-clonable leak: `readSnapshot.ts:55-63`. Features stripped to plain GeoJSON (no editor internals): `readSnapshot.ts:40-47`. |
| T-04-09 | Tampering — write bypassing the Authoring facade | mitigate | CLOSED (CR-01 fix verified) | Worker exposes ONLY 4 interceptor-routed ops, `editorCommand` excluded: `sandbox.worker.ts:128`. Host replay allow-list `REPLAYABLE_AUTHORING_OPS={addFeature,writeGeoJSON,circle,buffer}` rejects any non-listed op BEFORE it can mutate the editor: `runCode.ts:72,244-248`. All 4 ops route through `runInterceptors()`: `authoring.ts:188,214,242,267(→188),297(→188)`. `editorCommand` is a raw passthrough (`authoring.ts:251-256`) but unreachable from the sandbox. CR-01 proofs: `sandboxHost.test.ts:89-100`. |
| T-04-10 | InfoDisclosure — model reading raw rows via sandbox seam | mitigate | CLOSED | `readSnapshot` reads rows via `getDataset(h)?.fullRows` (sandbox-only accessor), NOT `toModelSummary`: `readSnapshot.ts:27,57`. Model path (summary+handle) preserved; D-11 privacy seam intact (regression-tested per `04-VERIFICATION.md` truth #7). |
| T-04-11 | DoS — runaway self-correction loop | mitigate | CLOSED (hardened to real circuit breaker) | `RUN_CODE_RETRY_CAP=3`: `runCode.ts:55`. Circuit breaker REFUSES the call at the cap BEFORE constructing a sandbox, then resets so the model is not permanently bricked: `runCode.ts:193-201`. `consecutiveFailures` incremented on every failure incl. timeouts (D-13): `runCode.ts:218,102`. (Known non-blocking warning WR-03: counter is module-global, not per-session — does not weaken the DoS bound, only attribution.) |
| T-04-12 | Elevation — signer/wallet/Nostr import into new modules | mitigate | CLOSED | Tier-A scan covers `readSnapshot.ts`/`runCode.ts` (every sandbox file): `sandboxHost.test.ts:227-237`. runCode imports only the Authoring facade + ingest read seam + a `type ToolEntry` (erased): `runCode.ts:40-46`. readSnapshot imports getDataset + type-only editor types: `readSnapshot.ts:26-29`. |
| T-04-SC | Tampering — npm install of quickjs-emscripten (+ SUS singlefile) | mitigate | CLOSED | Legitimacy audit (verdicts + no postinstall) documented: `04-RESEARCH.md:118-130`. Blocking-human checkpoint before install: `04-01-PLAN.md` Task 1. `quickjs-emscripten@^0.32.0` present: `package.json:92`; no postinstall hook in `node_modules/quickjs-emscripten/package.json`. SUS `@jitl/quickjs-singlefile-mjs-release-sync` NOT installed (only the approved `@jitl/quickjs-wasmfile-*` transitive variants present). |

## Threat Verification (accept)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-04-13 | DoS — run_code output flooding transcript | mitigate | CLOSED | Output capped upstream (`outputCapture.ts`, T-04-04). `CodeRunDisclosure` renders capped `consoleLines` + truncation marker, collapsed-by-default (`useState(false)`): `CodeRunDisclosure.tsx:95,97,132-144,140,161`. No `dangerouslySetInnerHTML`. |
| T-04-14 | Tampering — full error stack leaking to user | accept | CLOSED (accepted risk, documented below) | Concise user one-liner reuses the existing red `ToolError` bubble via `parseToolErrorContent` (ChatPanel); the FULL error goes only to the model: `runCode.ts:215-228`, `04-03-PLAN.md` threat row. No separate error channel; failures are not rendered by CodeRunDisclosure (`CodeRunDisclosure.tsx:6-18`). |
| T-04-15 | InfoDisclosure — rendering raw return value echoing sensitive data | accept | CLOSED (accepted risk, documented below) | Return value is the script's own computed result; the sandbox has no path to secrets (T-04-01 confinement holds), so it cannot carry signer/wallet data. JSON-only render via `JSON.stringify`, no HTML injection: `CodeRunDisclosure.tsx:61-68`. |

---

## Accepted Risks Log

- **T-04-14 (Tampering — full error stack to user):** ACCEPTED. The full QuickJS error/stack
  is intentionally routed only to the model loop for self-correction (`runCode.ts:215-228`);
  the user sees a concise one-line message via the audited red `ToolError` bubble. Rationale:
  low risk, no new error channel, the full error contains only the untrusted script's own
  failure (no host secrets, given T-04-01 confinement). Disposition recorded in `04-03-PLAN.md`.
- **T-04-15 (InfoDisclosure — raw return value render):** ACCEPTED. The return value is the
  untrusted script's own computed output, rendered JSON-only (`CodeRunDisclosure.tsx:61-68`).
  Because the sandbox is confined (no fetch/signer/wallet reachable — T-04-01), the return
  value provably cannot echo host secrets. Disposition recorded in `04-03-PLAN.md`.

---

## Unregistered Flags

None. `04-02-SUMMARY.md` `## Threat Flags` declares "None — no new security surface beyond
the threat model." `04-01-SUMMARY.md` and `04-03-SUMMARY.md` carry no Threat Flags section.

Post-plan UAT/hardening additions were reviewed for new attack surface and found NOT to
introduce any unmapped surface:
- `styleOptions.ts` (UAT gap-closure) is reached ONLY through the already-confined Authoring
  facade and FAILS LOUD on unknown options (`InvalidStyleOptionError`, `styleOptions.ts:34,116-139,167`) —
  no silent capability smuggling, no new sandbox bypass; T-04-09 invariant preserved.
- `capture_map_snapshot` vision-model gating (`registry.ts:294`) is a model-capability gate,
  not a sandbox boundary change.
- Warm-pooled worker + WASM memoization is a performance change re-verified to preserve
  per-run isolation (T-04-06).

---

## Non-Blocking Warnings (tracked in 04-REVIEW.md / 04-VERIFICATION.md — informational, not threats-open)

These were raised by code-review/verification and do NOT correspond to an OPEN declared
mitigation. They are recorded for follow-up; none block the phase at `block_on: high`.

- **WR-02** — Direct/fallback transport path (`typeof Worker === 'undefined'`, test/SSR only)
  has no wall-clock watchdog; a wedged synchronous turf call could hang the caller. Production
  browser path is fully watchdogged; WR-01 distance cap bounds turf input regardless.
  (`quickjsWorker.ts:131-134`)
- **WR-03** — `consecutiveFailures` retry counter is module-global, not per-session
  (`runCode.ts:102`). Does not weaken the DoS bound (T-04-11 still refuses at cap); affects
  attribution across concurrent chats only.
- **WR-04** — Recorded authoring-call batch is unbounded in count/arg size, an asymmetric DoS
  gap vs. the capped console output (`sandbox.worker.ts:160`, `runCode.ts:239-259`). The
  per-run wall-clock deadline + circuit breaker bound the practical blast radius.
- **WR-05** — `isTimeout()` classifies timeouts via a fragile error-string regex
  (`sandboxHost.ts:84-88`); a user error containing "interrupted"/"deadline" could be
  mislabeled. Affects retry attribution, not confinement.
- **WR-06** — Worker `onmessage` does not validate inbound request shape; `runId` resets on
  HMR (`sandbox.worker.ts:342-354`, `quickjsWorker.ts:42`). Contained by fresh-per-run/pooled
  correlation.

These warnings are quality/robustness items, not absent declared mitigations. Recommend
addressing WR-04 (unbounded recorded-call write channel) before Phase 5 plugs its safe-editing
gate at the interceptor seam, since the gate will inherit that channel.

---

## Audit Method

- All `<required_reading>` files loaded before analysis (3 PLANs, 3 SUMMARYs, VERIFICATION,
  UAT, REVIEW, and the 13 implementation files).
- Each `mitigate` threat verified by grep for the declared mitigation in the CURRENT cited
  files; CR-01 (T-04-09) and WR-01 (T-04-05) hardening verified in code, not trusted from
  docs.
- Each `accept` threat verified present in this SECURITY.md accepted-risks log with code
  evidence.
- Implementation files were NOT modified.
- Sandbox test suite executed: `bun test src/features/chat/sandbox/` → 69 pass / 0 fail.
