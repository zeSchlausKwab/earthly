# Phase 4: Code Interpreter Sandbox - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

The AI can author and run JavaScript inside an isolation boundary whose **only** host surface is the Authoring API — provably denied DOM, network/`fetch`, `localStorage`, the Nostr signer, and the wallet, and unable to freeze the app (wall-clock timeout + output-size caps terminate runaways). Generated code reads ingested data and current map features, computes with a curated geometry/math toolkit, and drives the map through `authoring.*`. Code and its output appear in a collapsible chat block; runtime errors (and timeouts) are fed back into the tool loop so the AI self-corrects within a bounded number of attempts. Headline proofs: programmatic geometry ("15 circles with increasing fibonacci radii") and a cost-weighted routing computation ("Austria→Bosnia flight path weighing distance vs. per-country overfly fees").

**Requirements:** CODE-01 (sandbox provably denies DOM/`fetch`/`localStorage`/signer/wallet), CODE-02 (code can call the curated Authoring API and nothing else on the host), CODE-03 (code + output shown in a collapsible block; runtime errors fed back for self-correction), CODE-04 (wall-clock timeout + output-size caps terminate runaways without freezing the app), CODE-05 (programmatic geometry generation), CODE-06 `[C]` (custom cost-weighted computation over routing data).

**Depends on:** Phase 2 (Authoring API is the sole host surface — `src/features/geo-editor/api/authoring.ts`, boundary already proven by `boundary.test.ts`). **Benefits from** Phase 3 (sandboxed code reads ingested datasets via the handle-keyed ingest store, `src/features/chat/ingest/ingestStore.ts`).

**Locked upstream (NOT re-litigated here):**
- **Isolation transport = roadmap-locked time-boxed spike.** QuickJS-WASM-inside-a-Worker vs. cross-origin-iframe-with-strict-CSP. The phase MUST open with this spike (see ROADMAP.md Phase 4 Risks/Notes) before any tool is wired. Both share message-only RPC + the Authoring API as the sole surface; they differ on the transport primitive. The spike verifies, before wiring: (a) generated code provably cannot reach `localStorage`/`fetch`/signer/wallet; (b) `worker.terminate()`/iframe teardown kills an infinite loop; (c) the transport serves correctly in `Bun.serve()` dev AND prod. The decisions below are transport-agnostic by design.

**Out of scope (belongs to later phases — do NOT build here):** the dataset binding chip / diff-preview / safety levels / dataset-level undo (Phase 5), bulk attribute transforms & data-driven styling (Phase 6), geometry optimization/simplification (Phase 7). This phase auto-runs map-mutating code with **no** confirm gate — the safety gate is Phase 5 and plugs into the existing interceptor seam (see D-08).

</domain>

<decisions>
## Implementation Decisions

### Capability surface (CODE-01 / CODE-02 / CODE-05 / CODE-06)
- **D-01:** **Read access = ingested data by handle + current map features.** Sandboxed code can read full parsed rows from the Phase 3 ingest store **by handle id** (the routing/CSV input for CODE-06) and read the editor's **current feature set** (e.g. "buffer every existing airport"). Both are read-only views passed/exposed across the message boundary; the model still never receives raw rows (Phase 3 D-11 privacy seam is preserved — the *sandbox* reads by handle, not the model's context).
- **D-02:** **Helper toolkit = curated `@turf/turf` subset + plain JS built-ins.** Expose a curated subset of turf (distance, buffer, area, etc.) plus standard JS (`Math`, `Array`, `JSON`, …) inside the sandbox. Covers both fibonacci-circle generation (CODE-05) and routing math (CODE-06). `@turf/turf@^7.3.5` is already installed. The exact exported turf surface = planner's discretion (what the chosen transport can safely serialize/expose).
- **D-03:** **Write = `authoring.*` only.** The sole host mutation surface is the Authoring API facade (`createAuthoring`). No signer/wallet/store/getState is reachable — this is the V4 access-control boundary that `boundary.test.ts` already enforces (forbids imports from chat/registry/Nostr/NDK/applesauce). The sandbox confinement reuses this exact boundary; CODE-02's "and nothing else" is structurally true because the facade exposes only geometry methods.

### Execution trust model (CODE-03 / forward-couples Phase 5)
- **D-04:** **Auto-run in the agentic loop, no confirm.** Running code is a tool call the AI invokes autonomously; the user sees code + output **after** (D-09). Isolation guarantees no secret access (D-01/D-03), so map mutations apply without a per-run approval. This keeps the autonomous fibonacci/routing demo flow intact. (User accepted that map edits land un-gated this phase; the gate is Phase 5 — see D-08.)
- **D-05:** **Fresh sandbox per run.** Each `run_code` invocation gets a clean sandbox; no state carries between runs (no persistent REPL session). Simpler, deterministic, and gives clean teardown — `terminate()`/iframe-teardown reliably kills a run. The AI re-derives anything it needs across runs.
- **D-08:** **Phase 5's safety gate reuses the existing interceptor seam — build NO gate now.** Sandbox writes already pass through the Authoring API's `runInterceptors()` scaffold (Phase 2 D-12, `src/features/geo-editor/api/interceptor.ts`). Phase 5 inserts add/modify/delete classification + diff/preview there. This phase must NOT add its own confirm/placeholder gate — just ensure sandbox mutations flow through the interceptor like every other authoring write.

### Code & output display (CODE-03)
- **D-09:** **Collapsed, expandable block.** Default render is a compact summary line (e.g. "Ran code → 15 features created"), collapsed; the user expands to see full source + output. Matches the existing tool-call rendering pattern in `ChatPanel.tsx`. Keeps long transcripts clean.
- **D-10:** **Output captures `console.log` stream + authoring result summary + return value.** The output block shows: (1) captured `console.log`/`warn`/`error` from the sandbox; (2) a structured authoring result summary (created/updated/deleted counts from `MutationResult`); (3) the script's final return/expression value, JSON-rendered (the computed route for CODE-06). This is also what feeds the model for self-correction.
- **D-11:** **User-facing errors = concise message; full error → model.** On failure the user sees a short one-line error message (no big stack trace), keeping the transcript clean. The **full** error is always fed back to the model for self-correction (CODE-03, non-negotiable).
- **D-12:** **Read-only display.** Code is shown for transparency but is not user-editable; the user steers via chat ("make them bigger"). No in-place edit-and-rerun this phase (deferred — see Deferred Ideas).

### Self-correction bounds (CODE-03 / CODE-04)
- **D-06:** **Small fixed retry cap (2–3), then stop + report.** Auto-correction is capped at ~2–3 attempts; after that the AI stops and reports the failure to the user. Bounds wallet cost (each retry is a paid model round-trip) and prevents runaway self-correction loops. Exact number (2 vs 3) = planner's discretion.
- **D-07:** **Each retry attempt is visible** as its own collapsed block, so the user watches the AI iterate (consistent with D-09).
- **D-13:** **Timeouts are retryable and count against the cap.** A wall-clock kill (e.g. infinite loop) is fed back to the model ("script exceeded Ns, terminated") and counts against the 2–3 retry cap, so the AI can fix an accidental infinite loop — but repeated hangs still terminate within the cap.
- **D-14:** **Fixed sensible timeout + output-size caps; no settings UI this phase.** The planner picks reasonable hardcoded values (a few seconds wall-clock; an output byte/line cap). Not surfaced in the Phase 1 settings store now — can be exposed later if real need emerges (deferred).

### Claude's Discretion
- **Isolation transport** — resolved by the mandatory opening spike (QuickJS-WASM-in-Worker vs. cross-origin-iframe-CSP); all decisions above are transport-agnostic.
- **Write-commit granularity** — how multiple `authoring.*` writes from one run land on the map (batched as one undo step vs. live/incremental). User said "you decide" — recommend batching toward Phase 5's dataset-level undo, but pick what the transport's RPC makes clean.
- **Exact turf export surface** (D-02), **retry count 2 vs 3** (D-06), **timeout duration + output-cap values** (D-14), and the **`run_code` tool's registration shape** (it registers through the Phase 2 typed registry with a mandatory `kind`, like every other tool).
- **Sandbox cold-start / instantiation cost** handling (per-run fresh sandbox, D-05) — pooling vs. fresh-spawn is an implementation detail as long as teardown stays clean.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — CODE-01..CODE-06 (full requirement text + phase mapping; note `[C]` story tag on CODE-06).
- `.planning/ROADMAP.md` — Phase 4 goal, four success criteria (verbatim acceptance conditions), and the **Risks/Notes** block mandating the opening isolation spike (QuickJS-WASM-in-Worker vs. cross-origin-iframe-CSP; the three things it must verify before wiring).
- `.planning/PROJECT.md` — milestone goal; user story #3 (Austria→Bosnia overfly-fee routing) that drives CODE-06; the "code interpreter (client sandbox) with a clean toolbar/drawing API" target feature.

### Phase 2 foundation — the sandbox's sole host surface (READ FIRST)
- `src/features/geo-editor/api/authoring.ts` — the `Authoring` facade (`createAuthoring(editor)`): `addFeature`, `writeGeoJSON`, `editorCommand`, `circle`, `buffer`. Geometry-only; NO signer/wallet/store. This is what the sandbox calls (D-03).
- `src/features/geo-editor/api/boundary.test.ts` — the D-07 strict-layering / T-02-03 confinement test (forbidden imports: chat, tool registry, Nostr, NDK, applesauce, MCP). The sandbox boundary reuses this guarantee; extend/mirror it for the sandbox confinement proof (CODE-01).
- `src/features/geo-editor/api/interceptor.ts` — `runInterceptors()` scaffold (Phase 2 D-12). Sandbox writes pass through here; this is where Phase 5's gate slots in (D-08). Do not bypass it.
- `src/features/geo-editor/api/results.ts` — `MutationResult` / `MutationCounts` shape (feeds D-10's authoring result summary).
- `.planning/phases/02-tool-registry-authoring-api/02-CONTEXT.md` — D-01..D-16: typed registry contract (mandatory `kind`/origin metadata, D-16 error contract → model loop AND chat UI) and the Authoring API layering decisions. The `run_code` tool registers through this registry; runtime errors use the D-16 error contract.

### Phase 3 coupling — the data the sandbox reads
- `.planning/phases/03-file-ingest-multimodal/03-CONTEXT.md` — D-11 handle-keyed ingest store (model sees summary + handle, sandbox reads full rows by handle). This is the exact seam D-01 plugs into.
- `src/features/chat/ingest/ingestStore.ts` — the host-side ingest store (read full rows by handle for CODE-06 routing input).

### Chat tool registry & UI integration
- `src/features/chat/tools/registry.ts`, `src/features/chat/tools/definitions.ts`, `src/features/chat/tools/schemas.ts`, `src/features/chat/tools/execute.ts` — where the `run_code` tool registers (with `kind`); unknown tool = hard error.
- `src/features/chat/tools/errors.ts` — D-16 error contract surface for feeding runtime/timeout errors back to the model (D-11/D-13) and to the chat UI.
- `src/features/chat/ChatPanel.tsx` — chat transcript host; existing tool-call rendering pattern the collapsible code/output block (D-09) reuses; where the block mounts.
- `src/features/chat/store.ts` — the agentic tool loop the auto-run + bounded self-correction (D-04/D-06) hooks into (existing max-iterations behavior to coordinate with).

### Reusable geometry/math
- `@turf/turf@^7.3.5` (installed) — curated subset exposed inside the sandbox (D-02); also used by `src/features/geo-editor/api/primitives.ts` (`makeCircle`/`makeBuffer`) which the `authoring.circle`/`buffer` surface already wraps.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Authoring API facade** (`api/authoring.ts`) — already the sole geometry-mutation seam with `MutationResult` returns; the sandbox host wraps this verbatim as the only callable host object. No new mutation path.
- **Boundary import test** (`api/boundary.test.ts`) — already proves the facade is Nostr/wallet/chat-free; the sandbox confinement proof (CODE-01) extends this rather than starting cold.
- **Interceptor scaffold** (`api/interceptor.ts`, `runInterceptors`) — Phase 5's gate insertion point; sandbox writes route through it for free (D-08).
- **Ingest store** (`chat/ingest/ingestStore.ts`) — handle-keyed full-row access (Phase 3 D-11); the read surface for CODE-06.
- **Typed tool registry + D-16 error contract** (Phase 2) — `run_code` self-registers with `kind`; runtime/timeout errors feed the model loop AND the chat UI through the existing error path.
- **Chat tool-call rendering** (`ChatPanel.tsx`) — the collapsible-block precedent for D-09/D-10/D-07.
- **`primitives.ts`** (`makeCircle`/`makeBuffer`, turf-backed) — proves the turf-in-host pattern for D-02's curated math.

### Established Patterns
- **Message-only RPC to the host** — the spike-chosen transport (Worker or cross-origin iframe) exchanges only serializable messages; the host applies authoring calls and returns `MutationResult`s. No live object handles cross the boundary.
- **Fresh-spawn + terminate teardown** — `worker.terminate()` / iframe teardown is the kill switch for CODE-04; D-05's fresh-per-run aligns with clean teardown.
- **Tool errors as structured feedback** (Phase 2 D-16) — the channel by which runtime errors (D-11) and timeouts (D-13) reach the model for self-correction.

### Integration Points
- **Sandbox host module (new)** — instantiates the spike-chosen transport, exposes the curated `authoring.*` + read APIs (D-01/D-02/D-03), enforces timeout + output caps (D-14), captures `console.log`/return value (D-10).
- **`run_code` tool (new)** — registers in the typed registry (`tools/registry.ts`) with mandatory `kind`; invoked auto in the loop (D-04).
- **Chat transcript** (`ChatPanel.tsx`) — mounts the collapsible code/output block (D-09) and renders each self-correction attempt (D-07).
- **Ingest store + editor feature set** — the two read surfaces handed into the sandbox (D-01).

</code_context>

<specifics>
## Specific Ideas

- The two headline scripts are the acceptance bar: (1) **"15 circles with increasing fibonacci radii"** around a point — programmatic geometry via `authoring.circle` in a loop (CODE-05); (2) **Austria→Bosnia cost-weighted flight path** weighing distance against per-country overfly fees (crossing Slovenia may be shorter but costlier) — reads routing data by handle, computes with turf+JS, draws the chosen path (CODE-06). Both must run end-to-end through auto-run + the bounded self-correction loop.
- The user's recurring stance — **trust the isolation boundary, keep the demo autonomous** — drove auto-run with no confirm (D-04) and the explicit decision to defer all map-edit gating to Phase 5's interceptor seam (D-08) rather than build a throwaway gate now.
- **Transcript-clean transparency** — collapsed-by-default code/output (D-09), concise user-facing errors with full errors model-only (D-11), each retry visible but collapsed (D-07). The user wants to *see* what the AI ran without the chat becoming a wall of code.

</specifics>

<deferred>
## Deferred Ideas

- **Editable code + manual rerun** — letting the user tweak generated code in-place and re-run without the model. Deferred in favor of read-only display (D-12); revisit if power-user demand appears (overlaps Phase 5 concerns).
- **Persistent REPL / notebook session** — variables surviving across runs. Deferred in favor of fresh-sandbox-per-run (D-05) for clean isolation/teardown.
- **User-configurable timeout / output caps** in the Phase 1 encrypted settings store. Deferred in favor of fixed sensible defaults (D-14); expose later only if a real need emerges.
- **Live/incremental write-paint** (watch each `authoring.*` call land) — left to planner discretion under write-commit granularity; batching toward Phase 5 undo is the recommended default.
- **Phase 4-built safety gate** — explicitly NOT built; Phase 5 owns add/modify/delete classification + diff/preview at the interceptor seam (D-08).

None of the above expand Phase 4 scope; they are future considerations.

</deferred>

---

*Phase: 4-Code Interpreter Sandbox*
*Context gathered: 2026-06-18*
