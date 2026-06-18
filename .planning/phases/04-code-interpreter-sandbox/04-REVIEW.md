---
phase: 04-code-interpreter-sandbox
reviewed: 2026-06-18T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - build.ts
  - package.json
  - src/features/chat/ChatPanel.tsx
  - src/features/chat/CodeRunDisclosure.test.tsx
  - src/features/chat/CodeRunDisclosure.tsx
  - src/features/chat/sandbox/curatedTurf.test.ts
  - src/features/chat/sandbox/curatedTurf.ts
  - src/features/chat/sandbox/outputCapture.test.ts
  - src/features/chat/sandbox/outputCapture.ts
  - src/features/chat/sandbox/readSnapshot.test.ts
  - src/features/chat/sandbox/readSnapshot.ts
  - src/features/chat/sandbox/runCode.test.ts
  - src/features/chat/sandbox/runCode.ts
  - src/features/chat/sandbox/sandboxHost.test.ts
  - src/features/chat/sandbox/sandboxHost.ts
  - src/features/chat/sandbox/transport/quickjsWorker.ts
  - src/features/chat/sandbox/transport/sandbox.worker.ts
  - src/features/chat/sandbox/transport/types.ts
  - src/features/chat/tools/registry.ts
  - src/index.ts
findings:
  critical: 1
  warning: 6
  info: 4
  total: 11
status: issues_found
resolved:
  - CR-01  # fixed 2026-06-18, commit 59ceac3
  - WR-01  # fixed 2026-06-18, commit 488cd96
open_after_resolution:
  warning: 5  # WR-02..WR-06
  info: 4     # IN-01..IN-04
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-18
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

This is a security-sensitive phase that runs untrusted, AI-authored JavaScript inside a
QuickJS-in-Worker sandbox whose host surface is intended to be exactly four globals
(`authoring`, `turf`, `data`, `console`). The core confinement design is sound: the worker
instantiates an empty-global QuickJS context, only serializable data crosses the RPC
boundary, every handle is disposed per run, writes are buffer-then-apply (recorded in the
worker, replayed on the host), and the read snapshot uses `structuredClone` to fail closed.
The static import-boundary test enforces no signer/wallet/Nostr reach across the sandbox
tree.

However, the adversarial pass surfaced one BLOCKER and several WARNINGs that undermine
specific documented security guarantees:

1. The `editorCommand` replay path bypasses the interceptor seam that the whole phase
   claims is where "every write flows through `runInterceptors()` for free." Combined with
   `editorCommand` dispatching ANY editor command id (clear/delete/mode) against full editor
   state, this is a confinement/authorization gap that the documented Phase 5 gate will not
   cover as designed.
2. The advertised DoS distance cap (`SANDBOX_MAX_DISTANCE_METERS`) is exported and tested
   for *existence* but is never actually enforced anywhere in the boundary — the code comment
   claims a range-check that does not exist.
3. The `consecutiveFailures` retry counter is module-global and shared across all chats and
   all editors, so the self-correction "cap" is not per-task and behaves incorrectly under
   concurrent/sequential unrelated runs.

The narrative findings below build on direct code reading; no structural-findings substrate
was provided with this review.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `editorCommand` replay bypasses the interceptor seam and dispatches arbitrary editor commands

**Status:** RESOLVED 2026-06-18 (commit 59ceac3). The sandbox does not need
`editorCommand` (no headline script or sandbox test uses it), so it was removed
from the sandbox-facing surface: the worker's `AUTHORING_METHODS` list no longer
exposes it, and the `runCode.ts` advertised surface string was updated to match.
`editorCommand` remains on `createAuthoring` for trusted (non-sandbox) callers
(boundary.test still asserts it). Defence-in-depth: `runCode` now gates replay on a
`REPLAYABLE_AUTHORING_OPS` allow-list (exactly the four interceptor-routed ops), so
even a forged/foreign recorded batch naming a non-intercepted op is rejected before
it can mutate the editor. New tests prove `authoring.editorCommand` is `undefined`
inside the boundary and that a forged `editorCommand` replay is refused with the
editor left untouched.

**File:** `src/features/chat/sandbox/runCode.ts:179-196`, `src/features/geo-editor/api/authoring.ts:173-178`, `src/features/geo-editor/commands.ts:556-565`

**Issue:**
`runCode.ts` documents (lines 16-21) that on success it "REPLAYS the recorded calls IN ORDER
through `createAuthoring(editor)` so every write flows through `runInterceptors()` for free
(D-03 / D-08 — this phase builds NO safety gate of its own; Phase 5 owns the gate at the
interceptor seam)."

That guarantee is false for `editorCommand`. In `authoring.ts`, only `addFeature`,
`writeGeoJSON`, `circle`, and `buffer` call `runInterceptors(...)`. `editorCommand` is a raw
passthrough to `executeEditorCommand(id, args)` (authoring.ts:173-178) which dispatches
`command.execute(useEditorStore.getState(), args)` against the FULL editor state by command
id (commands.ts:560-564) — with no interceptor, no allow-list, and no validation of which
command id the untrusted code chose.

`editorCommand` is one of the five method names the worker exposes
(`sandbox.worker.ts:93-99`), so untrusted sandbox code can record
`authoring.editorCommand('<any-command-id>', {...})` and have it replayed on the host main
thread. Because the entire Phase 4 safety story defers gating to "the interceptor seam in
Phase 5," any command reachable through `editorCommand` (e.g. clearing/deleting features,
mode switches, or any future state-mutating command) will NOT be gated by that seam as the
phase claims — it routes around it entirely.

This is the central confinement/authorization promise of the phase, and it is not upheld for
one of the five exposed write ops. Either remove `editorCommand` from the sandbox surface for
this phase, route it through `runInterceptors` (with a `MutationIntent` that the Phase 5 gate
can see), or restrict it to a vetted allow-list of non-destructive command ids.

**Fix:**
```ts
// Option A — drop editorCommand from the sandbox surface until the gate exists:
// sandbox.worker.ts
const AUTHORING_METHODS = ['addFeature', 'writeGeoJSON', 'circle', 'buffer'] as const

// Option B — gate it on replay so the Phase 5 interceptor actually sees it:
// authoring.ts
function editorCommand(id: EditorCommandId, args: EditorCommandArgs = {}) {
  const { intent } = runInterceptors({ intent: 'command', commandId: id, featureIds: [] })
  if (intent === 'deny') return failure(id, 'Command denied by policy.')
  return executeEditorCommand(id, args)
}
```

## Warnings

### WR-01: Advertised DoS distance cap is never enforced

**Status:** RESOLVED 2026-06-18 (commit 488cd96). The cap is now actually enforced.
`curatedTurf.ts` exports `assertSandboxDistanceWithinCap(op, args)` which, for the
distance-bearing ops (`circle`/`buffer`/`destination`/`along`), rejects NaN /
Infinity / ≤ 0 and any distance whose meter-equivalent is at or above
`SANDBOX_MAX_DISTANCE_METERS` (normalizing km/miles/etc to meters via the per-call
`units`, turf default `kilometers`). The worker's turf wrapper calls it BEFORE
invoking turf, so an absurd radius can't burn CPU on the worker thread; rejection
surfaces as the catchable `__turf_error__:` marker. The misleading comment was
corrected to point at the real enforcement. New tests cover the helper (in-bounds
pass, no-op for non-distance ops, over-cap reject in m + km, NaN/Inf/0/negative)
plus an end-to-end proof that an over-cap `turf.circle` inside the sandbox returns
`__turf_error__`.

**File:** `src/features/chat/sandbox/curatedTurf.ts:12-16,39-49`, `src/features/chat/sandbox/transport/sandbox.worker.ts:139-157`

**Issue:**
`curatedTurf.ts` documents that the cap exists so "A sandbox loop that asks for absurd
geometry can be rejected against this cap before turf burns CPU" and that "The boundary
range-checks generated geometry against this before invoking turf so an absurd radius can't
burn CPU." `SANDBOX_MAX_DISTANCE_METERS` is exported and `curatedTurf.test.ts` asserts its
value — but `grep` confirms it is referenced ONLY in the test and its own definition. The
worker (`sandbox.worker.ts`) invokes every curated turf function with raw, unchecked args
(lines 142-156); there is no range check anywhere. The mitigation the comments and the
threat-model reference (T-04-05) describe does not exist in code. `turf.buffer`/`turf.circle`
with an absurd radius will run unbounded until the wall-clock interrupt fires — and a single
synchronous turf call on huge geometry is exactly the kind of host-callback work the in-VM
interrupt cannot preempt (see WR-02).

**Fix:** Either enforce the cap before invoking distance-bearing turf functions
(`circle`, `buffer`, `destination`, `along`) inside the worker, or correct the comments and
test so they do not claim an enforcement that is absent. If enforcing:
```ts
// sandbox.worker.ts, inside the turf wrapper for radius/distance-bearing ops
if ((key === 'circle' || key === 'buffer' || key === 'destination') &&
    Number.isFinite(args[1]) && Math.abs(args[1] as number) > SANDBOX_MAX_DISTANCE_METERS) {
  return vm.newString('__turf_error__:distance exceeds SANDBOX_MAX_DISTANCE_METERS')
}
```

### WR-02: Synchronous host-callback work (turf) is not covered by the in-VM interrupt; direct/fallback transport has no wall-clock watchdog at all

**File:** `src/features/chat/sandbox/transport/sandbox.worker.ts:120,142-156`, `src/features/chat/sandbox/transport/quickjsWorker.ts:58-62,77-84`

**Issue:**
`shouldInterruptAfterDeadline` only fires between JS operations inside the VM; it cannot
preempt a long-running synchronous HOST callback. Each curated `turf` function executes on
the host (worker) thread synchronously (lines 142-156). A single `turf.buffer`/`turf.circle`
call on pathological geometry (compounding WR-01) can block past the deadline; in the REAL
worker this is ultimately killed by the host `worker.terminate()` watchdog
(quickjsWorker.ts:77-84), which is correct defence-in-depth.

But the `typeof Worker === 'undefined'` fallback path (quickjsWorker.ts:58-62) runs
`runSandboxCode` directly with NO watchdog. The comment frames this as a bun-test/SSR-only
path, but the guard is purely runtime feature detection — any non-browser embedding without a
global `Worker` would silently take the unwatchdogged path, where a wedged synchronous turf
call (or any host-callback hang) freezes the calling thread indefinitely with no timeout.
The DoS guarantee (CODE-04/D-13) holds only on the real-Worker path.

**Fix:** Document/assert that the direct path is test-only (throw if reached outside a test
env), or wrap the direct engine call in a wall-clock guard. At minimum, do not rely on the
in-VM interrupt for the turf surface; enforce WR-01's cap so host-callback turf work is
bounded by input, not just by the watchdog.

### WR-03: `consecutiveFailures` retry counter is module-global and shared across chats/editors

**File:** `src/features/chat/sandbox/runCode.ts:78,164-177`

**Issue:**
`consecutiveFailures` is a module-level counter incremented on every failed `run_code` run
and reset to 0 only on success. It is not scoped to a chat session, a task, or an editor. The
"bounded self-correction" (D-06) is therefore global state shared by every chat in the app:
- A failure in chat A bumps the cap that chat B sees; chat B can hit "retry cap reached" on
  its first-ever failure.
- The counter never resets except on a success, so a user who returns later to a chat after
  3 earlier unrelated failures is immediately told the cap is reached.
- The cap is purely advisory text appended to the error message — nothing actually STOPS
  dispatch after the cap (the model is merely "told" to stop), so it does not bound
  resource use anyway; it just produces misleading attempt counts.

**Fix:** Scope the counter to the active chat/task (e.g. a `Map<chatId, number>` keyed by the
session, or pass an attempt count in through `ToolExecutionContext`) and reset it when a new
user turn begins. If the cap is meant to be a hard stop, enforce it (return a terminal
ToolError) rather than only annotating the message.

### WR-04: `editorCommand` and other replayed args are unbounded in size/depth

**File:** `src/features/chat/sandbox/transport/sandbox.worker.ts:130-133`, `src/features/chat/sandbox/runCode.ts:185-196`

**Issue:**
Recorded authoring calls store `args: argHandles.map((h) => vm.dump(h))` with no bound on the
number of calls, the size of each arg, or nesting depth. Untrusted code can push a very large
number of `authoring.addFeature(hugeFeature)` calls (or one `writeGeoJSON` with a massive
array) within the deadline; the worker accumulates them all into `recordedCalls`, posts the
entire batch across the RPC boundary, and the host replays every one synchronously on the
main thread (runCode.ts:185-196) with no cap. The console output is carefully capped
(outputCapture.ts) but the recorded-call channel — the one that actually mutates the editor —
is not, which is an asymmetric DoS gap on the write path.

**Fix:** Cap the number of recorded calls and/or the total serialized arg bytes in the worker
(append a truncation marker / fail the run when exceeded), mirroring the console cap. Reject
runs whose recorded batch exceeds a sane feature/byte budget before replay.

### WR-05: Timeout classification relies on a fragile error-string regex that can misclassify user errors

**File:** `src/features/chat/sandbox/sandboxHost.ts:84-88,108`

**Issue:**
`isTimeout()` decides the retryable-timeout flag (D-13) by regex-matching the error string
against `/exceeded .*wall-clock|interrupted|deadline/i`. This is the only signal feeding
`timedOut`, and the worker/engine never sets an explicit structured timeout flag. A user
script that throws an Error whose message contains "interrupted" or "deadline" (entirely
plausible for code dealing with routing/scheduling data) will be misclassified as a timeout,
mislabeling the failure to the model and counting it as a timeout against the retry cap. The
in-VM interrupt also surfaces as a generic engine exception caught at
`sandbox.worker.ts:203-212`, whose message is QuickJS-version-dependent, so the heuristic is
also brittle to dependency upgrades.

**Fix:** Carry an explicit `timedOut: boolean` through `SandboxWorkerResponse` set by the
interrupt/watchdog paths, and stop inferring it from the human-readable error text.

### WR-06: Worker `onmessage` does not validate the request `id`, and `runId` resets on HMR

**File:** `src/features/chat/sandbox/transport/sandbox.worker.ts:281-293`, `src/features/chat/sandbox/transport/quickjsWorker.ts:30,49,86-89`

**Issue:**
The host correlates responses by `id` (quickjsWorker.ts:86-89, dropping mismatched ids), but
`runId` is a module-level counter starting at 0. Because workers are fresh-spawn-per-run the
risk is contained, yet on HMR / module re-init `runId` resets, so ids like `sandbox-1` can
recur across the app lifetime. Since each run uses its own dedicated worker this does not
currently cross runs, but the `id` filter gives a false sense of cross-talk protection that
the id scheme does not actually guarantee. Additionally, `self.onmessage` does not assert the
incoming message shape (`code`, `deadlineMs`) before executing — a malformed/foreign
postMessage to the worker would be run as code (`code` could be `undefined`, handled, but the
contract is unchecked).

**Fix:** Use a process-unique id (`crypto.randomUUID()`) rather than an incrementing counter,
and validate the inbound request shape in `self.onmessage` before executing.

## Info

### IN-01: `outputCap` option is plumbed but never used

**File:** `src/features/chat/sandbox/runCode.ts:57-58,154-159`, `src/features/chat/sandbox/sandboxHost.ts:52-58`

**Issue:** `OUTPUT_CAP = 1000` is passed as `outputCap` into `runSandbox`, but
`SandboxRunOptions.outputCap` is explicitly "advisory only" and never forwarded to the
transport (the transport signature is `{ readSnapshot, deadlineMs }`). The real cap lives in
`outputCapture.ts`. This is dead/misleading plumbing — a future maintainer may believe the
per-run cap is configurable from `runCode.ts` when it is not.

**Fix:** Either wire `outputCap` through to `createOutputCapture` or remove the option and the
`OUTPUT_CAP` constant to avoid implying a control that does not exist.

### IN-02: `data` snapshot is documented as "frozen" but is not actually frozen

**File:** `src/features/chat/sandbox/readSnapshot.ts:31,62`, `src/features/chat/sandbox/transport/sandbox.worker.ts:159-162`

**Issue:** Multiple comments call the read snapshot the "FROZEN plain-data view." It is
`structuredClone`d (giving independence from the live editor, which is the real safety
property) but never `Object.freeze`d. Inside the VM the snapshot is re-materialized via a
JSON round-trip (`jsToHandle`), so VM-side mutation cannot reach the host regardless — the
confinement is intact. The wording is simply inaccurate; "frozen" implies immutability that
the object does not have on the host side.

**Fix:** Drop the "frozen" wording (the independence comes from the clone + JSON round-trip),
or actually `Object.freeze` deep if the immutability claim is intended to hold.

### IN-03: `vm.dump` on a turf-returned handle is round-tripped through JSON twice

**File:** `src/features/chat/sandbox/transport/sandbox.worker.ts:142-157,222-246`

**Issue:** turf wrappers `vm.dump` the args (host JS), call the host turf fn, then
`jsToHandle` the result back into the VM via `JSON.stringify` + in-VM `JSON.parse`. This is
correct but means any non-JSON-serializable turf return silently becomes `undefined`
(jsToHandle:229-230) rather than an error the user code can see. For the curated set this is
fine (all return plain GeoJSON/numbers), but it is a latent foot-gun if the curated list
grows. Not a current defect.

**Fix:** None required now; add a note that curated additions must return JSON-serializable
values, or surface a `__turf_error__` marker when serialization yields `undefined`.

### IN-04: WASM source-resolution fallback path in `build.ts` is untested and silently version-fragile

**File:** `build.ts:218-251`

**Issue:** The build copies the QuickJS `.wasm` by first trying `import.meta.resolve` of the
package export and then falling back to a hardcoded `node_modules/@jitl/.../dist/...` path.
The fail-loud-on-missing behavior is good. However the dev server (`src/index.ts:323-337`)
hardcodes the same `node_modules/.../dist/emscripten-module.wasm` path independently; if the
dependency layout changes, dev and prod can diverge (prod's `import.meta.resolve` succeeds,
dev's hardcoded path 404s) with no shared constant. Low risk but a maintenance trap.

**Fix:** Extract the package-relative wasm path to a single shared resolver used by both
`build.ts` and the dev server, so a dependency move fails in exactly one place.

---

_Reviewed: 2026-06-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
