# Project Research Summary

**Project:** Earthly v1.1 AI Chat — Data Ingest, Transform & Safe Authoring
**Domain:** Browser AI chat workbench with sandboxed code interpreter, file ingest, and safe map authoring on a mature React 19 / MapLibre / Nostr app
**Researched:** 2026-06-16
**Confidence:** HIGH

## Executive Summary

Earthly v1.1 expands the existing AI chat panel into a data-ingest-and-transformation workbench: users upload real-world files, run sandboxed JS that drives the map programmatically, and safely edit bound datasets with configurable safety levels. This is an *integration* milestone on a mature codebase — virtually every new capability either extends an already-shipped system (encrypted settings, editor command registry, simplify manager) or slots into a new but well-scoped abstraction (tool registry, authoring API, sandbox host). The architecture research is grounded in the actual `src/` tree; there are no speculative new frameworks.

The recommended build order is strictly dependency-ordered: a typed **Tool Registry** refactor and a clean **Authoring API** barrel (`src/features/geo-editor/api/`) are hard prerequisites for everything else. The sandbox cannot be implemented safely without the Authoring API providing the only mutation surface; the new parametric/batch editor tools have nowhere clean to register until the registry replaces the current `execute.ts` switch. The critical path is **P1 (registry) → P2 (authoring API) → P4 (sandbox)**. File ingest, dataset-aware safe editing, data-driven styling, and geometry optimization all hang off P2 and can be sequenced by demo value.

The single highest-risk decision is the **sandbox isolation boundary**. STACK.md recommends QuickJS-WASM inside a Web Worker; PITFALLS.md warns a blob-URL Worker or same-origin iframe is NOT a security boundary and argues for a cross-origin iframe with strict CSP + message-only RPC. Both agree on message-only RPC and the Authoring API as the controlled surface; they differ on the transport primitive. This must be resolved via a time-boxed spike at the start of the sandbox phase.

---

## Key Findings

### Stack

The existing stack is fixed. Three new dependencies are added:
- **papaparse 5.5.3** (MIT) — CSV parsing, streaming, messy real-world files
- **xlsx 0.20.3 via CDN tarball** (Apache-2.0) — Excel/ODS parsing; the npm `xlsx` is stale at 0.18.5 with a prototype-pollution advisory and must NOT be installed via `bun add xlsx`; pin `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` in package.json
- **quickjs-emscripten 0.32.0** (MIT) — WASM QuickJS VM for the sandbox; no DOM, no `fetch`, no host prototype chain; only explicitly injected host functions are callable from generated code

Already present and should be extended (not rebuilt): `@turf/turf 7.3.5`, `topojson-*`, `applesauce-signers ISigner` (NIP-44 encrypt-to-self already in `settingsStorage.ts`), MapLibre style-spec expressions.

Multimodal capability detection has no standard field in OpenAI-compatible `/v1/models`. Use **layered detection**: Ollama `POST /api/show` capabilities array (authoritative) → OpenRouter/Routstr `modalities` field → name heuristic (fallback, marked "uncertain") → fail-safe to no-vision with explicit user opt-in. The existing `modelMaySupportVision()` substring heuristic is a known footgun to replace.

### Features

**Must have:**
- File attach (+/drag-drop) with chip confirmation; parse-on-ingest summary ("N rows × M cols") shown to user and injected as compact model context
- Format coverage: CSV, Excel, JSON, GeoJSON, plain text, images
- Capability-gated image send — "uncertain" state shows explicit opt-in rather than auto-sending
- Code shown in collapsible block, errors fed back into tool loop for auto-correction
- Sandbox provably cannot touch DOM, network, signer, or wallet
- Visible binding chip — no mutating tool fires without a shown target
- Confirm before destructive change (safety level 2 default)
- Before/after size + vertex metrics on optimization; optimization targets a concrete byte budget

**Should have (differentiators):**
- Sandboxed JS driving a clean map drawing API — the milestone's signature capability
- AI-only parametric/batch primitives on the shared command registry: `draw_circle`, `buffer`, `set_attributes_batch`, `merge_to_multi`, `stitch_microgaps`, `dedup_features`, `apply_style_rule`, `select_by_attribute`, `validate_geometry`
- Data-driven styling by attribute, AI-applied
- Add-vs-modify-vs-delete intent surfaced per operation; diff/preview before apply
- Three configurable safety levels (1/2/3)
- Geometry optimization pipeline: simplify + merge-to-multi + microgap stitch to byte budget with topology validation

**Anti-features to avoid:**
- Server-side code execution (breaks local-first ethos)
- Arbitrary `fetch` from sandboxed code (exfiltration vector)
- Auto-publish AI edits (irreversible public broadcast)
- Per-feature manual recoloring loop (O(N) tool calls; use attribute rules instead)
- Storing API keys in plaintext localStorage

### Architecture

Two new clean abstractions; everything else extends existing systems:

1. **Tool Registry** (`chat/tools/registry.ts`) — replaces the 660-line `execute.ts` switch with a typed `Map<toolName, {schema, execute}>`; schema and handler co-located; unknown tool is a hard error
2. **Authoring API** (`geo-editor/api/`) — `createAuthoringApi(editor): AuthoringApi`; the sole mutation seam for UI, chat tools, and sandbox; no Zustand reach-across

Additional new components: SandboxHost (Worker lifecycle + RPC), FileParsers + IngestStore (parsed data by ref id), editTargetSlice (bound target + intent + safety level), StyleManager (attribute→paint compilation).

**Critical architectural rules:**
- Nothing mutates the editor except through the Authoring API
- Nothing crosses the sandbox boundary except structured-clone JSON
- Model receives compact summaries of ingested data, not raw rows
- Bulk transforms run as rules over the full bound dataset by id — never over the model's context-compacted view

### Pitfalls

1. **Sandbox escape** — blob-URL Worker / same-origin iframe is not a security boundary; can `fetch()` same-origin storage and reach the signer. Prevention: message-only RPC; cross-origin iframe + CSP or QuickJS-WASM inside Worker. Resolve in a spike before wiring the API.
2. **AI clobbers the wrong dataset** — `bindActiveWorkspaceChat()` binds silently; existing write tools have no add/modify/delete classification and no preview gate. Prevention: binding chip + intent classification must land BEFORE any new bulk/transform tool is exposed.
3. **Context-compaction trap** — model sees a compacted subset; "fix all" silently fixes only the visible subset. Prevention: transforms must run as rules over the full bound dataset host-side; model authors the rule, host applies it by id.
4. **Over-simplification destroys topology** — turf `simplify` is per-feature Douglas-Peucker, not topology-aware. On shared-boundary data it creates slivers and gaps. Prevention: use topojson topology-aware pipeline; validate after with `@turf/kinks`; choose tolerance by visual error budget, then check byte size.
5. **Untyped dispatcher rots at 30+ tools** — the current switch hits schema drift and silent no-ops at scale. Prevention: typed registry as a prerequisite before adding any new tool.
6. **Main-thread freeze** — parsing/optimizing 12MB on the main thread freezes/OOMs the tab. Prevention: shared off-main-thread worker pipeline for ingest + geometry ops.
7. **Silent image-to-blind-model** — the substring vision heuristic sends images to non-vision models. Prevention: layered capability detection, fail-safe to no-vision + explicit opt-in on "uncertain".
8. **NIP-46 encrypted-settings** — remote-signer decrypt is async/fallible/maybe-offline; silent `catch→null` looks like data loss; signer rotation orphans the pubkey-keyed envelope. Prevention: async/fallible load + export/import escape hatch + explicit NIP-46 path test.

---

## Implications for Roadmap

Dependency-ordered build sequence (the roadmapper should derive phases from requirements, but this is the technically-forced ordering):

- **Tool Registry refactor** — hard prerequisite for every new tool; behavior-preserving, easy to verify. Avoids schema-drift/silent-no-op pitfall.
- **Authoring API barrel** (`geo-editor/api/`) — the single mutation seam for UI, chat tools, and sandbox; satisfies PROJECT.md's "drawing API as a future package export" mandate. Prerequisite for sandbox AND for the safe-editing gate.
- **File Ingest** — independent of sandbox; unblocks the most user stories; feeds code interpreter + optimization. Includes layered vision-capability detection replacing the substring heuristic. All parsing off-thread.
- **Code Interpreter Sandbox** — hard-blocked on Authoring API. Headline differentiator, highest risk. **Spike required** at phase start: QuickJS-WASM-in-Worker vs cross-origin-iframe-with-CSP. Wall-clock timeout + `worker.terminate()`, output caps, API-call audit log, errors fed back to model.
- **Dataset-Aware Safe Editing** — completes the carried-over binding-chip work; MUST land before new bulk/transform tools are user-exposed. editTargetSlice, visible binding chip, diff/preview ghost layer, safety-gated apply at the Authoring API seam, dataset-level snapshot, transforms-as-rules over full dataset by id.
- **Data-Driven Styling** — independent after Authoring API; additive tag on kind 37515 for round-trip persistence (exact tag schema is an open decision — confirm vs SPEC.md).
- **Geometry Optimization** — mostly composes existing managers + topojson; lands after safe editing to reuse the diff/preview gate for before/after metrics; byte-budget targeting + topology validation; off-main-thread.

### Research Flags
- **Sandbox phase:** time-boxed spike on QuickJS-WASM-in-Worker vs cross-origin-iframe-with-CSP. Verify: (a) generated code provably cannot reach `localStorage`/`fetch`/signer; (b) `worker.terminate()` kills an infinite loop; (c) cross-origin serving works in Bun.serve() dev + prod.
- **Styling phase:** style-rule persistence format (tag vs content) on kind 37515 — decide before building.
- **Settings work:** NIP-46 async decrypt path is untested against a remote signer; needs explicit test + export/import escape hatch.
- **Vision detection:** the optional active-probe step may consume Cashu budget; validate against Routstr prepayment before enabling by default.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry + official docs; SheetJS CDN issue confirmed; Ollama capabilities array confirmed |
| Features | MEDIUM-HIGH | Cross-corroborated against ChatGPT, Felt, LM Studio, agent-UX principles; map-specifics extrapolated from existing Earthly surface |
| Architecture | HIGH | Grounded in actual `src/` tree with file references; only sandbox isolation primitive remains a spike-level decision |
| Pitfalls | HIGH | Codebase-grounded for integration/encryption/tool-dispatch; sandbox + geometry from established web-security and turf/mapshaper behavior |

**Overall: HIGH**

### Gaps to Address
- Sandbox isolation primitive — resolve in a spike at the start of the sandbox phase
- Style persistence format — tag vs content on kind 37515 before the styling phase
- NIP-46 settings async path — explicit remote-signer test + export/import escape hatch
- Vision probe cost — validate against Routstr prepayment before enabling active probe by default
