# Roadmap: Earthly — v1.1 AI Chat (Data Ingest, Transform & Safe Authoring)

## Overview

v1.1 turns Earthly's AI chat from a map-drawing assistant into a data-ingest-and-transformation workbench. The journey opens with encrypted settings persistence — a structurally independent capability sequenced first so provider config, API keys, and LM Studio/Ollama addresses survive reloads, making every later phase far easier to test without re-entering keys. From there it is strictly dependency-ordered: first lay the two load-bearing seams every later capability routes through — a typed Tool Registry and a clean Authoring API — then add the independent ingest pipeline that unblocks the most user stories. Next comes the headline differentiator, a sandboxed code interpreter that can only touch the map through the Authoring API. Before any destructive bulk tool is exposed, the dataset-aware safe-editing gate (visible binding chip + add/modify/delete intent + diff/preview + configurable safety levels) must land — otherwise every transform ships destructive. Only then do the bulk transform, styling, and geometry-optimization tools become user-facing, each running as a host-side rule over the full bound dataset. The success bar: an analyst can feed an ugly CSV, run sandboxed code, recolor by attribute, optimize an oversized dataset, and publish — all while seeing exactly which dataset the AI is editing, and never re-entering provider keys.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Encrypted Settings Persistence** - Provider config, API keys, and LM Studio/Ollama addresses persist encrypted-to-self, survive reloads (including NIP-46 signers), and export/import as a recovery escape hatch — sequenced first so later phases never re-enter keys. (completed 2026-06-16 — verified 15/15, UAT 5/5, threat-secure)
- [ ] **Phase 2: Tool Registry & Authoring API** - Typed tool registry plus the single mutation seam (Authoring API) with parametric primitives — the prerequisite foundation everything else routes through.
- [ ] **Phase 3: File Ingest & Multimodal** - Attach and parse CSV/Excel/JSON/GeoJSON/text/images off-thread, summarize for the model, and gate image-send on real vision capability detection.
- [ ] **Phase 4: Code Interpreter Sandbox** - AI authors and runs JS in an isolated sandbox whose only host surface is the Authoring API, with timeouts, output caps, and error-feedback self-correction.
- [ ] **Phase 5: Dataset-Aware Safe Editing** - Visible binding chip, add/modify/delete intent, diff/preview, configurable safety levels, and dataset-level undo — the gate that must precede any destructive bulk tool.
- [ ] **Phase 6: AI Bulk Transform & Data-Driven Styling** - Gated batch attribute edit, select-by-attribute/dedup, geometry validation, and attribute-rule styling that round-trips through the Nostr event.
- [ ] **Phase 7: Geometry Optimization** - AI reduces oversized GeoJSON toward a byte budget via topology-aware simplify + merge-to-multi + microgap stitch, with before/after metrics, so it clears the publish size limit.

## Phase Details

### Phase 1: Encrypted Settings Persistence

**Goal**: A user's chat provider config and keys survive reloads encrypted to their own key, work even with a remote signer, and can be exported so a signer change never silently loses them.
**Depends on**: Nothing (independent; sequenced first so later phases can be tested without re-entering keys)
**Requirements**: SET-01, SET-02, SET-03
**Success Criteria** (what must be TRUE):

  1. The user's chat provider config, API keys, and LM Studio/Ollama addresses persist across reloads, encrypted at rest with the user's Nostr key (encrypt-to-self), and decrypted secrets never appear in any persisted or devtools-serialized state.
  2. Encrypted settings load works with NIP-46 remote signers via an async/fallible path that shows a real loading/failed state and fails visibly rather than silently appearing as data loss.
  3. The user can export their settings and re-import them, recovering provider config after a signer rotation or loss.**Plans**: 3 plans

**Wave 1**

  - [x] 01-01-PLAN.md — v2 per-type providerOverrides shape, envelope v2 + migrateV1ToV2, resolveProvider fallback, Wave-0 tests (SET-01)

**Wave 2** *(blocked on Wave 1 completion)*

  - [x] 01-02-PLAN.md — visible loading/failed(+Retry)/loaded/no-signer state for the async NIP-46 load (SET-02)

**Wave 3** *(blocked on Wave 2 completion)*

  - [x] 01-03-PLAN.md — clipboard export (plaintext + warning) and paste-import (validate → replace → re-encrypt) escape hatch (SET-03)

### Phase 2: Tool Registry & Authoring API

**Goal**: The codebase has one typed tool-dispatch seam and one map-mutation seam, both proven behavior-preserving against today's chat, with parametric shape primitives available as the first new tools.
**Depends on**: Nothing structural (foundation for the AI-tooling stack)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, TOOLS-01
**Success Criteria** (what must be TRUE):

  1. Every chat tool the AI can call dispatches through the typed registry; invoking an unknown tool name returns a visible hard error instead of a silent no-op.
  2. All existing editor write paths (add feature, write GeoJSON, editor commands) still produce identical map results after being reimplemented on the Authoring API — the user sees no behavior change in the existing author-by-chat flow.
  3. Direct UI buttons, chat tools, and (future) sandboxed code all reach editor geometry only through the Authoring API; nothing reaches across into the Zustand store.
  4. The AI can draw a parametric circle and a buffer around a feature, and the same primitives are callable as direct API methods.

**Plans**: 6 plans

**Wave 1**

  - [x] 02-01-PLAN.md — Wave 0 test infrastructure: headless GeoEditor harness (mock MapLibre) + shared geo fixtures (the binding-golden-test prerequisite)

**Wave 2** *(blocked on Wave 1)*

  - [x] 02-02-PLAN.md — Authoring API pure facade: addFeature/writeGeoJSON + MutationResult (D-11) + interceptor/intent scaffold (D-12), zero AI/Nostr imports (D-07 boundary test) (INFRA-02, INFRA-03)

**Wave 3** *(blocked on Wave 2)*

  - [ ] 02-03-PLAN.md — D-09 one-way store read-mirror (emit-on-bulk-replace) + reroute chat dual-write & 3 UI sites through authoring + binding behavior-preservation golden gate (INFRA-02, INFRA-03)

**Wave 4** *(blocked on Waves 2+3)*

  - [ ] 02-04-PLAN.md — Unified typed registry (D-01/02/03/04/06) folding the execute.ts switch + commands.ts; ToolError contract fed to model loop AND chat UI (D-16); unknown tool = hard error (INFRA-01)

**Wave 5** *(blocked on Waves 2+4)*

  - [ ] 02-05-PLAN.md — TOOLS-01 parametric circle + buffer as Authoring API methods (D-13/14/15) then registered AI tools; bounded radii (TOOLS-01)

**Wave 6** *(blocked on Wave 4; ISOLABLE/DEFERRABLE)*

  - [ ] 02-06-PLAN.md — D-05 live MCP hot-reload: opens with a live-server listTools() spike (checkpoint:human-verify, A1); poll-based discovery if supported, clean fallback to hardcoded list + defer if not (INFRA-01)

### Phase 3: File Ingest & Multimodal

**Goal**: A user can drop a real-world file into chat and have it parsed into structured data the AI can map, with images only ever sent to models that actually support vision.
**Depends on**: Phase 2
**Requirements**: INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, INGEST-07
**Success Criteria** (what must be TRUE):

  1. A user can attach files by button and drag-and-drop, sees a chip per attached file, and can ingest CSV, Excel, JSON, GeoJSON, plain-text, and image files without the app freezing on large files.
  2. After ingest the user sees a parse summary (rows × columns, detected coordinate/geometry columns) while the model receives only a compact summary, never the raw rows.
  3. The AI can place ingested tabular/text rows onto the map as features, geolocating where needed (ugly logging CSV → mapped points; pasted Telegram message → located feature).
  4. When the selected model's vision support is unconfirmed, the image-send affordance is disabled or marked uncertain with explicit opt-in — an image is never silently sent to a non-vision model.

**Plans**: TBD
**UI hint**: yes

### Phase 4: Code Interpreter Sandbox

**Goal**: The AI can write and run JavaScript that drives the map programmatically through the Authoring API, inside an isolation boundary that provably denies access to secrets and cannot freeze the app.
**Depends on**: Phase 2 (Authoring API is the only host surface), benefits from Phase 3 (read ingested data in code)
**Requirements**: CODE-01, CODE-02, CODE-03, CODE-04, CODE-05, CODE-06
**Success Criteria** (what must be TRUE):

  1. Generated code can call the curated Authoring API (draw shapes, add/transform features) and demonstrably cannot reach the DOM, network/`fetch`, `localStorage`, the Nostr signer, or the wallet.
  2. The user sees generated code and its output in a collapsible block; a runtime error is fed back into the tool loop and the AI self-corrects.
  3. A runaway or infinite-loop script is terminated by a wall-clock timeout and output-size caps without freezing the app.
  4. The AI can generate geometry programmatically (e.g. "15 circles with increasing fibonacci radii") and run a custom cost-weighted routing computation (e.g. distance vs. per-country overfly fees for an Austria→Bosnia flight path).

**Plans**: TBD
**Risks / Notes**: This phase begins with a TIME-BOXED ISOLATION SPIKE to resolve the open design decision — QuickJS-WASM-inside-a-Worker vs. cross-origin-iframe-with-strict-CSP. Both share message-only RPC + the Authoring API as the sole surface; they differ on the transport primitive. The spike must verify, before any tool is wired: (a) generated code provably cannot reach `localStorage`/`fetch`/signer/wallet; (b) `worker.terminate()` (or iframe teardown) kills an infinite loop; (c) the chosen transport serves correctly in Bun.serve() dev and prod. Retrofitting isolation after the API is wired is a rewrite, so the boundary contract is locked first.
**UI hint**: yes

### Phase 5: Dataset-Aware Safe Editing

**Goal**: When the AI edits a dataset, the user always sees which dataset is bound and what is being added, changed, or deleted, and can recover — and this gate is in place before any destructive bulk tool ships.
**Depends on**: Phase 2 (single gate point at the Authoring API mutation seam)
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, SAFE-06
**Success Criteria** (what must be TRUE):

  1. A visible binding chip always shows the target dataset/context the chat is bound to, and no mutating tool fires unless a target is bound and shown.
  2. Each AI map operation is classified and surfaced as add / modify / delete, and before applying a change to an existing dataset the user can preview what will be added, changed, and removed (diff against the bound dataset).
  3. The user can set a safety level — 1 (preview + confirm all) / 2 (confirm destructive only, default) / 3 (trust + undo) — and the choice persists and actually gates applies accordingly.
  4. "Fix all" operates as a rule over the full bound dataset by feature id (never only the model's compacted view), and dataset edits — including property, style, and translation changes — are reversible via a dataset-level snapshot/undo.

**Plans**: TBD
**UI hint**: yes

### Phase 6: AI Bulk Transform & Data-Driven Styling

**Goal**: The AI can clean up and restyle a whole bound dataset by rule — fill/translate properties, select and dedup, validate topology, and recolor by attribute — with every destructive operation running through the safe-editing gate.
**Depends on**: Phase 5 (safe-editing gate must precede destructive bulk tools), Phase 2 (Authoring API methods)
**Requirements**: TOOLS-02, TOOLS-03, TOOLS-04, STYLE-01, STYLE-02
**Success Criteria** (what must be TRUE):

  1. The AI can set or modify properties across many features by rule (fill missing descriptions, rewrite/translate names) operating over the full bound dataset, with the change passing through the diff/preview safety gate.
  2. The AI can select features by attribute and dedup them, and can run a geometry-validation tool that reports topology problems (self-intersections, gaps, slivers).
  3. The AI can apply data-driven styling — color/stroke/width by feature attribute (ports vs airports vs waterways) — as an attribute rule rather than per-feature edits, and the result is visible on the map.
  4. Applied styles persist with the dataset and round-trip through its kind 37515 Nostr event (publish, reload, styles preserved).

**Plans**: TBD
**UI hint**: yes

### Phase 7: Geometry Optimization

**Goal**: A user can take an oversized, messy GeoJSON the publish/city dialog rejects, have the AI shrink it toward a byte budget without visibly degrading it, and then publish it.
**Depends on**: Phase 5 (reuses the diff/preview gate for before/after), Phase 3 (ingest large files), Phase 2 (Authoring API)
**Requirements**: GEO-01, GEO-02, GEO-03
**Success Criteria** (what must be TRUE):

  1. The AI can reduce an oversized GeoJSON dataset toward a target byte budget using simplify + merge-to-multi + microgap stitching, executed off the main thread without freezing the app.
  2. Optimization reports before/after metrics (byte size, vertex and feature counts) and validates topology — no new self-intersections or zero-area collapse, per-feature properties preserved through merge, microgap join count shown.
  3. A dataset that previously exceeded the publish/city-dialog size limit (e.g. the 12MB "West Pacific Trail") can be brought under the limit at preserved visual quality and successfully published.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Encrypted Settings Persistence | 3/3 | Complete    | 2026-06-16 |
| 2. Tool Registry & Authoring API | 1/6 | In progress | - |
| 3. File Ingest & Multimodal | 0/TBD | Not started | - |
| 4. Code Interpreter Sandbox | 0/TBD | Not started | - |
| 5. Dataset-Aware Safe Editing | 0/TBD | Not started | - |
| 6. AI Bulk Transform & Data-Driven Styling | 0/TBD | Not started | - |
| 7. Geometry Optimization | 0/TBD | Not started | - |
