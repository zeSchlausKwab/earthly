# Phase 4: Code Interpreter Sandbox - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 4-Code Interpreter Sandbox
**Areas discussed:** Capability surface, Execution trust model, Code & output display, Self-correction bounds

---

## Capability surface

### Q: What can sandboxed code READ (in addition to writing via authoring.*)?
| Option | Description | Selected |
|--------|-------------|----------|
| Ingested data by handle | Read full parsed rows from the Phase 3 ingest store by handle id (routing CSV for CODE-06) | ✓ |
| Current map features | Read the editor's current feature set (e.g. buffer every airport) | ✓ |
| Neither — inputs passed in | No read API; AI passes data as literal args | |

**User's choice:** Ingested data by handle + Current map features (multi-select)

### Q: What helper toolkit for geometry/math?
| Option | Description | Selected |
|--------|-------------|----------|
| turf + plain JS | Curated @turf/turf subset + standard JS built-ins | ✓ |
| Plain JS only | Standard built-ins only; authoring.circle/buffer still draw | |
| You decide | Planner picks based on transport serialization | |

**User's choice:** turf + plain JS
**Notes:** Covers both fibonacci circles (CODE-05) and routing math (CODE-06); @turf/turf@7.3.5 already installed.

---

## Execution trust model

### Q: When does map-mutating code run?
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-run in the loop | Executes as a tool call in the agentic loop; user sees code+output after | ✓ |
| Confirm before run | User approves generated code before execution | |
| Auto-run, but read-only by default | Pure compute auto-runs; mutations confirm until Phase 5 | |

**User's choice:** Auto-run in the loop
**Notes:** User accepts map edits land un-gated this phase; trusts isolation, defers gating to Phase 5.

### Q: How do multiple authoring.* writes land?
| Option | Description | Selected |
|--------|-------------|----------|
| Batched, one undo step | All mutations from a run committed as one history entry | |
| Live, incrementally | Each call paints as it executes | |
| You decide | Planner chooses based on transport | ✓ |

**User's choice:** You decide

### Q: Should the sandbox keep state across runs?
| Option | Description | Selected |
|--------|-------------|----------|
| Fresh per run | Clean sandbox each run; nothing carries over | ✓ |
| Persistent REPL session | Variables/functions survive into next run | |
| You decide | Planner picks per transport lifecycle | |

**User's choice:** Fresh per run

### Q: Where does Phase 5's safety gate slot in?
| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing interceptor seam | Rely on Authoring API runInterceptors() (Phase 2 D-12); build no gate now | ✓ |
| Add a Phase-4 placeholder gate | Minimal "will modify map" notice, replaced later | |
| You decide | Planner determines forward-compatible seam | |

**User's choice:** Reuse existing interceptor seam

---

## Code & output display

### Q: How should the code + output block appear by default?
| Option | Description | Selected |
|--------|-------------|----------|
| Collapsed, expandable | Compact summary line collapsed; expand for source + output | ✓ |
| Expanded by default | Full source + output inline immediately | |
| Code collapsed, output shown | Hide source, always show output | |

**User's choice:** Collapsed, expandable
**Notes:** Matches existing ChatPanel tool-call rendering.

### Q: What should the output block capture and show?
| Option | Description | Selected |
|--------|-------------|----------|
| console.log stream | Capture console.* and render as primary output | ✓ |
| Authoring result summary | Created/updated/deleted counts from MutationResult | ✓ |
| Return value | Script's final return/expression value (JSON) | ✓ |
| Errors + stack | Full error message + trimmed stack | |

**User's choice:** console.log stream + Authoring result summary + Return value (multi-select; Errors+stack left out → clarified below)

### Q: On error, what does the USER see? (model always gets full error)
| Option | Description | Selected |
|--------|-------------|----------|
| Concise error message | Short one-line message to user; full error to model | ✓ |
| Full error + stack | Complete error + trimmed stack to user too | |
| Silent to user | Errors model-facing only | |

**User's choice:** Concise error message

### Q: Can the user edit and re-run the code?
| Option | Description | Selected |
|--------|-------------|----------|
| Read-only display | Shown for transparency, not editable; steer via chat | ✓ |
| Editable + rerun | User tweaks code and reruns without the model | |
| You decide | Planner decides effort vs value | |

**User's choice:** Read-only display

---

## Self-correction bounds

### Q: How many auto-retry attempts before stopping?
| Option | Description | Selected |
|--------|-------------|----------|
| Small fixed cap (2–3) | ~2–3 attempts then stop + report | ✓ |
| Single retry (1) | One attempt then stop | |
| No special cap | Defer to normal tool-loop max-iterations | |

**User's choice:** Small fixed cap (2–3)
**Notes:** Bounds wallet cost; most fixes land in 1–2 tries.

### Q: What does the user see during retries?
| Option | Description | Selected |
|--------|-------------|----------|
| Each attempt visible | Each failed run + concise error as its own collapsed block | ✓ |
| Only final result | Collapse intermediates; show final only | |
| You decide | Planner picks | |

**User's choice:** Each attempt visible

### Q: Is a wall-clock timeout retryable?
| Option | Description | Selected |
|--------|-------------|----------|
| Retryable like any error | Fed back; counts against the 2–3 cap | ✓ |
| Hard stop | Terminate, no auto-retry | |
| You decide | Planner decides per transport | |

**User's choice:** Retryable like any error

### Q: Timeout + output caps — fixed or configurable?
| Option | Description | Selected |
|--------|-------------|----------|
| Fixed sensible defaults | Hardcoded reasonable values; no settings UI this phase | ✓ |
| Configurable in settings | Surface in Phase 1 encrypted settings store | |
| You decide | Planner decides if defaults suffice | |

**User's choice:** Fixed sensible defaults

---

## Claude's Discretion

- Isolation transport (resolved by the mandatory opening spike — QuickJS-WASM-in-Worker vs. cross-origin-iframe-CSP).
- Write-commit granularity (batched-one-undo vs. live-incremental) — user said "you decide".
- Exact turf export surface, retry count (2 vs 3), timeout duration + output-cap values, and the `run_code` tool registration shape.
- Sandbox cold-start / instantiation cost handling (pooling vs. fresh-spawn) as long as teardown stays clean.

## Deferred Ideas

- Editable code + manual rerun (deferred; read-only this phase).
- Persistent REPL / notebook session (deferred; fresh-per-run this phase).
- User-configurable timeout / output caps in Phase 1 settings store (deferred; fixed defaults).
- Live/incremental write-paint (left to planner discretion; batching recommended).
- Phase 4-built safety gate (explicitly NOT built; Phase 5 owns it via the interceptor seam).
