# Milestones

## v1.1 AI Chat (Shipped: 2026-06-23)

**Phases completed:** 7 phases, 33 plans, 64 tasks

**Delivered:** Expanded Earthly's AI chat from a map-drawing assistant into a data-ingest-and-transformation workbench — ingest real-world files, run sandboxed code that drives the map, transform and restyle bound datasets safely, and optimize oversized GeoJSON under the publish limit — broadening the audience to analysts, curators, and power users.

**Key accomplishments:**

- **Encrypted settings persistence (Phase 1)** — provider config, API keys, and LM Studio/Ollama addresses persist encrypted-to-self (envelope v2 + `migrateV1ToV2`), survive reloads including NIP-46 remote signers via an observable async/fallible load lifecycle that fails visibly, with a plaintext export/import recovery hatch against signer rotation.
- **Tool Registry & Authoring API (Phase 2)** — one typed tool-dispatch seam (unknown tool → hard `ToolError`, all 34 tools registered) and one map-mutation seam, `createAuthoring(editor)`, that Phases 3–7 route every write through; parametric circle/buffer as both API methods and AI tools; live poll-based MCP tool sync replacing the hand-transcribed list.
- **File ingest & multimodal (Phase 3)** — off-thread CSV/Excel/JSON/GeoJSON/text/image parsing with a verified sync fallback; a handle-keyed ingest store that makes "the model never sees raw rows" a structural guarantee; a layered fail-safe vision-capability detection ladder gating every image send; place/geocode tools and a file-chip + vision-gate UI.
- **QuickJS code-interpreter sandbox (Phase 4)** — the AI authors and runs JS confined to a QuickJS-WASM-in-Worker boundary whose only host surface is the Authoring API, provably denied secrets, bounded by wall-clock timeout + output caps with a circuit breaker, and self-correcting on error via the tool loop; renders as a collapsible read-only code+output block.
- **Dataset-aware safe-editing gate (Phase 5)** — an always-visible binding chip, add/modify/delete classification, inline diff/preview, configurable safety levels (1 preview / 2 confirm-destructive default / 3 trust+undo, persisted), a bounded metadata-aware dataset snapshot/undo wired into Cmd+Z, and host-side "fix all" over the full id-keyed dataset — the gate that precedes every destructive bulk tool.
- **AI bulk transform & data-driven styling (Phase 6)** — gated batch attribute edits, select-by-attribute + dedup, geometry/topology validation, and attribute-rule styling that round-trips through the kind 37515 event, every destructive op routed through the safe-editing gate.
- **Geometry optimization (Phase 7)** — off-thread topology-aware simplify + merge-to-multi + microgap stitch toward a byte budget with before/after metrics, bringing an oversized dataset under the publish/city-dialog size limit; the optimize pipeline made near-linear and the worker timeout made safe (terminate + size-gated reject), closing the UAT crash blocker.

**Known deferred items at close:** 4 (see STATE.md → Deferred Items). All are bookkeeping-open rather than work-open: two debug sessions and a Phase 06 verification flag awaiting live in-browser human confirmation, and three Phase 05 CONTEXT design questions already resolved during execution.

---
