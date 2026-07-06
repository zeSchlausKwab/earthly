---
phase: 04-code-interpreter-sandbox
plan: 03
subsystem: ui
tags: [run_code, code-interpreter, chat-render, collapsible, disclosure, ToolError, react]

# Dependency graph
requires:
  - phase: 04-code-interpreter-sandbox
    plan: 02
    provides: "run_code result shape { ok, counts: MutationCounts, consoleLines, truncated, returnValue } + the throws→ToolError(handler_error) error contract Plan 03 renders"
  - phase: 02-tool-registry-authoring-api
    provides: "ChatPanel MessageBubble render dispatch + the red ToolError bubble (parseToolErrorContent) reused for the concise user error (D-11)"
provides:
  - "CodeRunDisclosure component: collapsed-by-default read-only run_code code+output block (D-09/D-10/D-12), each retry its own block (D-07)"
  - "MessageBubble special-cases run_code → routes source + matching role:'tool' result to CodeRunDisclosure; all other tools unchanged"
  - "CODE-03 user-facing display half: console stream + authoring counts + JSON-rendered return value + truncation marker; concise error via the existing red ToolError bubble (D-11)"
affects: ["code-interpreter", "ChatPanel-render", "verify-work-phase-4-UAT"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reused the ToolResultDisclosure collapse idiom verbatim (useState(false) open toggle + ▸/▾ button + preview-line) instead of inventing a new disclosure pattern"
    - "Each run_code tool message is already a distinct transcript entry → one CodeRunDisclosure per message makes each self-correction retry its own collapsed block (D-07) with no extra wiring"

key-files:
  created:
    - "src/features/chat/CodeRunDisclosure.tsx"
    - "src/features/chat/CodeRunDisclosure.test.tsx"
  modified:
    - "src/features/chat/ChatPanel.tsx"

key-decisions:
  - "CodeRunDisclosure reuses the existing ToolResultDisclosure collapse structure verbatim (collapsed-by-default, ▸/▾ toggle) rather than a new disclosure pattern — keeps the transcript idiom consistent and honors D-09."
  - "The concise error path (D-11) reuses the existing red ToolError bubble via parseToolErrorContent — NO second error channel; the full stack already reached the model in Plan 02."
  - "Read-only by construction (D-12): source rendered in a <pre>/<code>, no textarea/contentEditable/Run/Rerun/Edit affordance — the acceptance grep is clean."
  - "Task 3 (end-of-phase live UAT) DEFERRED to /gsd-verify-work 4 per explicit human decision — the mechanics are bun-test-proven; the live autonomous-loop + collapsible UX acceptance is the human-judged bar, routed to the dedicated UAT path."

patterns-established:
  - "run_code render reroute: MessageBubble pairs the assistant tool-call code argument with its matching role:'tool' result (by tool_call_id) and renders CodeRunDisclosure; every other tool stays on the generic ToolResultDisclosure path (pure presentation reroute, no store/loop change)."

requirements-completed: [CODE-03, CODE-05, CODE-06]

# Metrics
duration: continuation (close-out)
completed: 2026-06-18
---

# Phase 4 Plan 03: Code-Run Disclosure UI Summary

**`run_code` now renders in the chat transcript as a collapsed-by-default, read-only code+output block (CodeRunDisclosure) — summary line → expand → read-only source + console stream + authoring counts + JSON-rendered return value (D-09/D-10/D-12), each retry its own block (D-07), with the concise one-line error reusing the existing red ToolError bubble (D-11); the end-of-phase live UAT is deferred to `/gsd-verify-work 4`.**

## Performance

- **Duration:** continuation close-out (Tasks 1–2 delivered in a prior session)
- **Completed:** 2026-06-18T09:27:21Z
- **Tasks:** 2 of 3 delivered; Task 3 (live UAT) DEFERRED to `/gsd-verify-work 4`
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- **`CodeRunDisclosure` (D-09/D-10/D-12/D-07):** a collapsed-by-default block with a compact summary line derived from `result.counts` (e.g. "Ran code → 15 features created"); the full source is absent from the DOM until expanded. On expand it shows (1) the read-only `<pre>`/`<code>` source, (2) the captured `consoleLines`, (3) the authoring counts summary, and (4) the `returnValue` via `JSON.stringify(value, null, 2)`. The `…(output truncated)` marker shows when `result.truncated` is set. No editable control / Run / Rerun / Edit affordance (D-12).
- **Wired into `MessageBubble` (ChatPanel):** `run_code` is special-cased so its source (assistant tool-call `code` argument) + matching `role:'tool'` result (by `tool_call_id`) route to `CodeRunDisclosure`; every other tool's render path is untouched. The concise error path reuses the existing red `ToolError` bubble (D-11) — no second error channel.
- **Each self-correction retry is its own collapsed block (D-07):** each `run_code` tool message is already a distinct transcript entry, so one `CodeRunDisclosure` per message satisfies D-07 with no extra wiring.
- **Gates green at the Task-2 checkpoint:** `bun test src/features/chat/` 233 pass / 0 fail, `bun run build` success, Biome clean on the touched files.

## Task Commits

1. **Task 1: CodeRunDisclosure (TDD)** — `4bfe7f9` (test, RED) → `00a44b3` (feat, GREEN)
2. **Task 2: route run_code through CodeRunDisclosure in MessageBubble** — `26d878a` (feat)
3. **Task 3: end-of-phase live UAT** — DEFERRED to `/gsd-verify-work 4` (no code commit; this is the human-judged acceptance gate, not an implementation task)

**Plan metadata:** this close-out commit (docs: complete code-run UI; defer live UAT to verify-work)

## Files Created/Modified

- `src/features/chat/CodeRunDisclosure.tsx` — `CodeRunDisclosure({ source, result })`: collapsed summary line + ▸/▾ toggle; expand → read-only source, console stream, authoring counts, JSON return value, truncation marker. Reuses the `ToolResultDisclosure` collapse idiom.
- `src/features/chat/CodeRunDisclosure.test.tsx` — render proof for the five behaviors (collapsed, expand, read-only, truncated, error-concise).
- `src/features/chat/ChatPanel.tsx` — `MessageBubble` special-cases `run_code` to `CodeRunDisclosure`; the red `ToolError` bubble path is reused unchanged for failed runs (D-11).

## Decisions Made

- **Reuse, don't reinvent:** `CodeRunDisclosure` copies the `ToolResultDisclosure` collapse structure verbatim — consistent transcript idiom, honors D-09 collapsed-by-default.
- **One error channel (D-11):** the concise user error reuses the audited red `ToolError` bubble (`parseToolErrorContent`); the full error intentionally went only to the model in Plan 02. No new error surface introduced.
- **Read-only by construction (D-12):** source is non-editable markup with no rerun affordance; the acceptance grep for `textarea|contentEditable|Rerun|onRun` is clean.
- **Live UAT deferred (Task 3):** routed to `/gsd-verify-work 4`. The autonomous-loop mechanics are `bun test`-proven (Plan 02); the live, human-observed acceptance bar belongs to the dedicated UAT path. This is an ACCEPTED DEFERRAL, not a failure.

## Deviations from Plan

None for the implemented work — Tasks 1–2 executed exactly as written.

Task 3 (the end-of-phase `blocking-human` live UAT) was DEFERRED by explicit human decision to `/gsd-verify-work 4`. This is a planned routing of the human-judged acceptance gate, not an auto-fix deviation. No product code was changed during this close-out.

## Deferred — Live UAT (Task 3) → `/gsd-verify-work 4`

The phase's implementation is code-complete; the following 5 live-UAT items are the human-judged acceptance bar and remain to be confirmed in the running app via `/gsd-verify-work 4`. They are recorded here verbatim so they are discoverable:

1. **CODE-05 fibonacci:** AI autonomously emits `run_code` (no confirm — D-04); 15 circles drawn on the map; the transcript shows a COLLAPSED "Ran code → 15 features created" block (D-09); expand → read-only source + console + JSON return value (D-10/D-12).
2. **CODE-06 overfly:** ingest a small overfly-fees dataset → Austria→Bosnia cost-weighted path; the AI reads the data by handle, computes in-sandbox, and draws the path; the expanded return value shows the chosen route + per-variant costs.
3. **CODE-03 self-correction:** an induced throwing script → a concise one-line red `ToolError` bubble (no stack — D-11); the AI self-corrects within ~3 attempts (D-06); each retry is its own collapsed block (D-07).
4. **CODE-04 no-freeze:** the UI stays responsive across runs (runaways are killed by the timeout).
5. **D-12 read-only:** there is NO edit-and-rerun affordance on the shown code.

ROADMAP Phase 4 success criteria (SC#1 confinement / SC#2 collapsible block + self-correction / SC#3 timeout/caps no-freeze / SC#4 fibonacci + overfly) are confirmed in code/tests; their LIVE confirmation is owned by `/gsd-verify-work 4`.

## Issues Encountered

None during the close-out.

## User Setup Required

None — no external service configuration required. (Running the live UAT requires a configured chat model in the app; that is exercised by `/gsd-verify-work 4`.)

## Next Phase Readiness

- Phase 4 implementation is code-complete across all three plans (04-01 isolation spike + prod `.wasm` serving, 04-02 `run_code` wiring + headline-script proofs, 04-03 collapsible display UI).
- **Phase 4 is NOT yet verified/complete** — the live autonomous-demo UAT is pending via `/gsd-verify-work 4`. Do not advance to Phase 5 until that UAT signs off the four ROADMAP success criteria live.

## Self-Check: PASSED

- `src/features/chat/CodeRunDisclosure.tsx` — FOUND
- `src/features/chat/CodeRunDisclosure.test.tsx` — FOUND
- `src/features/chat/ChatPanel.tsx` references `CodeRunDisclosure` (5 occurrences) — FOUND
- Commits `4bfe7f9`, `00a44b3`, `26d878a` — all in git history.

---
*Phase: 04-code-interpreter-sandbox*
*Completed: 2026-06-18 (implementation; live UAT deferred to /gsd-verify-work 4)*
