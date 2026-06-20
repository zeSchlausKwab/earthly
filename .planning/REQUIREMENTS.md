# Requirements: Earthly — v1.1 AI Chat (Data Ingest, Transform & Safe Authoring)

**Defined:** 2026-06-16
**Core Value:** The maintainer (and any user) can open the app for fun, not duty — extended this milestone so analysts, curators, and power users can ingest real-world data, transform it with sandboxed code, and safely author maps via chat.

## v1.1 Requirements

Requirements for this milestone. Each maps to exactly one roadmap phase. Story tags (`[A]`–`[E]`) reference the five user stories in PROJECT.md.

### Tool Infrastructure (prerequisites)

- [x] **INFRA-01**: All chat tools dispatch through a typed registry (schema + handler co-located); an unknown tool name is a hard error, never a silent no-op.
- [ ] **INFRA-02**: A single Authoring API (`src/features/geo-editor/api/`) is the only path that mutates editor geometry; direct UI, chat tools, and sandboxed code all call it — no reaching across into the Zustand store.
- [x] **INFRA-03**: Existing editor write paths (`add_feature_to_editor`, `write_geojson_to_editor`, editor commands) are reimplemented on the Authoring API with no behavior change. (02-03: chat import + UI import sites rerouted through writeGeoJSON; binding OLD-vs-NEW golden gate byte-identical)

### File Ingest

- [x] **INGEST-01**: User can attach files to a chat message via a button and drag-and-drop, with a visible chip per attached file.
- [x] **INGEST-02**: User can ingest CSV and Excel (`.xlsx`) files; parsing runs off the main thread so large files do not freeze the app.
- [x] **INGEST-03**: User can ingest JSON, GeoJSON, and plain-text files.
- [x] **INGEST-04**: User can ingest image files.
- [x] **INGEST-05**: After ingest, the user sees a parse summary (e.g. rows × columns, detected coordinate/geometry columns); the model receives a compact summary, not the raw rows.
- [x] **INGEST-06**: The chat can place rows of tabular/text data onto the map as features, geolocating where needed (ugly logging CSV → mapped points; pasted Telegram message → located feature). `[A][B]`
- [x] **INGEST-07**: The app detects whether the selected model supports vision via layered detection (Ollama capabilities → modalities field → name heuristic → fail-safe to no-vision); the image-send affordance is disabled or marked uncertain when vision is unconfirmed, never silently sending images to a blind model. _(Detection ladder + fail-safe gating delivered in 03-04; user-facing VisionGateControl affordance mounts in 03-06.)_

### Code Interpreter

- [x] **CODE-01**: The AI can author and run JavaScript in a sandbox that provably cannot access the DOM, network/`fetch`, `localStorage`, the Nostr signer, or the wallet. _(04-01: confinement facet PROVEN — every forbidden global `undefined` under `bun test` + static import-boundary scan clean. 04-02: `run_code`→`runSandbox` wired so the sandbox is reachable from the app graph and `bun run build` succeeds; the new host modules pass the tier-A secret-reach scan. Prod `.wasm`-SERVING facet (spike criterion c) RESOLVED via focused fix a417ca5 — `build.ts` emits `dist/emscripten-module.wasm`, `sandbox.worker.ts` points the release-sync variant at the served URL in browser/Worker only, dev+prod serve `application/wasm`; proven `bun run build:production` emits the asset and the prod server returns HTTP 200 + `content-type: application/wasm`, `bun test` green. Remaining facet: live IN-BROWSER wasm execution round-trip, validated by Wave 3 live-chat UAT.)_
- [x] **CODE-02**: Sandboxed code can call the curated Authoring API (draw shapes, add/transform features) and nothing else on the host. _(04-01: surface enumeration proves the injected globals are exactly `authoring`/`turf`/`data`/`console` plus JS built-ins, no host name leaks. 04-02: `run_code` replays only `authoring.*` through `createAuthoring`→`runInterceptors`, no bypass path.)_
- [x] **CODE-03**: Generated code and its output are shown to the user in a collapsible block; runtime errors are fed back into the tool loop for self-correction. _(04-02: the self-correction facet PROVEN — runtime errors AND wall-clock timeouts make `run_code` throw the full error, which `registry.dispatch` wraps into `ToolError(handler_error)` fed to the model loop; self-correction bounded at RUN_CODE_RETRY_CAP=3, timeouts counted. 04-03: the display facet IMPLEMENTED — `CodeRunDisclosure` renders the run_code source+output as a collapsed-by-default read-only block (source + console + authoring counts + JSON return value + truncation marker, D-09/D-10/D-12), each retry its own block (D-07), concise error via the existing red ToolError bubble (D-11), wired into MessageBubble. Live autonomous-loop + collapsible-UX confirmation pending via /gsd-verify-work 4.)_
- [x] **CODE-04**: Sandbox execution is bounded by a wall-clock timeout and output-size caps; a runaway/infinite loop is terminated without freezing the app. _(04-01: timeout-kill + output-cap ENGINE proven — `while(true){}`→`timedOut:true` via in-VM interrupt + host watchdog, 1000-line/256KiB cap. 04-02: the timeout now flows through the `run_code` tool loop as a retryable `ToolError` (D-13), proven by the error-feedback test. Left Pending pending the Plan 04-03 end-to-end demo UAT.)_
- [x] **CODE-05**: The AI can generate geometry programmatically (e.g. "draw 15 circles with increasing fibonacci radii around this point"). _(04-02: the fibonacci-15-circles script runs end-to-end through `run_code` against a headless editor → `counts.created === 15` and 15 real features.)_
- [x] **CODE-06**: The AI can run custom cost-weighted computations over routing data (e.g. weigh distance against per-country overfly fees for an Austria→Bosnia flight path). `[C]` _(04-02: the Austria→Bosnia script reads the seeded overfly-fee rows by handle from the ingest store, computes direct vs. via-Slovenia cost with turf, returns the chosen route + per-variant costs, and draws exactly one feature; the model-summary privacy seam stays intact.)_

### AI-Oriented Editor Tools

- [x] **TOOLS-01**: Parametric shape primitives (circle, buffer) are available as both Authoring API methods and registered AI tools.
- [ ] **TOOLS-02**: A batch attribute-edit tool lets the AI set/modify properties across many features by rule (fill missing descriptions, rewrite/translate names). `[D]`
- [ ] **TOOLS-03**: Select-by-attribute and dedup tools support programmatic selection and cleanup.
- [ ] **TOOLS-04**: A geometry-validation tool reports topology problems (self-intersections, gaps, slivers).

### Dataset-Aware Safe Editing

- [ ] **SAFE-01**: The chat is explicitly bound to a target dataset/context, and that binding is always visible (binding chip) so the user knows exactly what the AI is working on. `[D]`
- [ ] **SAFE-02**: Each AI map operation is classified as add / modify / delete, and that intent is surfaced to the user.
- [ ] **SAFE-03**: Before applying a change to an existing dataset, the user can preview what will be added, changed, and deleted (diff/preview). `[D]`
- [ ] **SAFE-04**: A configurable safety level controls gating — 1 = preview + confirm all, 2 = confirm destructive only (default), 3 = trust + undo — and the choice persists.
- [ ] **SAFE-05**: Bulk transforms operate host-side as rules over the full bound dataset by feature id (never only over the model's compacted context view), so "fix all" does not silently skip out-of-context features. `[D]`
- [ ] **SAFE-06**: Dataset edits are reversible via a dataset-level snapshot/undo that covers property, style, and translation edits — not just geometry.

### Data-Driven Styling

- [ ] **STYLE-01**: The AI can apply data-driven styling — color / stroke / width by feature attribute (ports vs airports vs waterways) — as an attribute rule rather than per-feature edits. `[D]`
- [ ] **STYLE-02**: Applied styles persist with the dataset and round-trip through its Nostr event (kind 37515).

### Geometry Optimization

- [ ] **GEO-01**: The AI can reduce an oversized GeoJSON dataset toward a target byte budget using simplify + merge-to-multi (+ microgap stitching), executed off the main thread. `[E]`
- [ ] **GEO-02**: Optimization reports before/after metrics (byte size, vertex/feature counts) and validates topology so visual quality is preserved. `[E]`
- [ ] **GEO-03**: A dataset that previously exceeded the publish/city-dialog size limit can be brought under the limit and published. `[E]`

### Settings Persistence

- [x] **SET-01**: The user's chat provider config, API keys, and LM Studio/Ollama addresses persist across reloads, encrypted at rest with the user's Nostr key (encrypt-to-self).
- [x] **SET-02**: Encrypted settings load works with NIP-46 remote signers (async/fallible), failing visibly rather than silently appearing as data loss.
- [x] **SET-03**: The user can export and re-import their settings as an escape hatch against signer rotation/loss.

## Future Requirements

Deferred to a later milestone. Tracked, not in this roadmap.

### Nostr-Scrolls / WASM (NIP-5C)

- **SCROLL-01**: User can author a WASM "scroll" for map-related calculations.
- **SCROLL-02**: Scrolls can be persisted, reused, and shared with the community over Nostr.
- **SCROLL-03**: The code interpreter can invoke a shared scroll.

### Compound capability

- **COMPOUND-01**: Compound routing scenarios (multi-stop with preference modeling + detour cost) — already out of scope per PROJECT.md; revisit after single-query routing proves out.

## Out of Scope

Explicitly excluded. Anti-features from research belong here with warnings.

| Feature | Reason |
|---------|--------|
| Server-side / container code execution | Breaks the local-first ethos; the sandbox is client-side only. |
| Arbitrary `fetch`/network from sandboxed code | Data-exfiltration vector (nsec, Cashu). The sandbox's only host surface is the Authoring API. |
| Auto-publish of AI edits | Irreversible public broadcast; publishing always stays an explicit user action. |
| Per-feature manual recolor loop | O(N) tool calls; styling is done by attribute rule instead (STYLE-01). |
| Plaintext API-key storage in localStorage | Keys are always encrypted at rest (SET-01). |
| Heavy new topology-aware simplifier dependency | Prefer composing existing turf/topojson + post-validation over adding a large new lib; revisit only if real inputs demand it. |
| Nostr-scrolls / WASM in this milestone | Builds on the code interpreter; sequenced to the next milestone. |

## Traceability

Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SET-01 | Phase 1 — Encrypted Settings Persistence | Complete |
| SET-02 | Phase 1 — Encrypted Settings Persistence | Complete |
| SET-03 | Phase 1 — Encrypted Settings Persistence | Complete |
| INFRA-01 | Phase 2 — Tool Registry & Authoring API | Complete (02-04: unified typed registry dispatches all 34 tools; unknown tool → ToolError hard error) |
| INFRA-02 | Phase 2 — Tool Registry & Authoring API | Partial (02-03: create seam closed — authoring.* sole caller of editor.addFeature, A3 boundary enforced; updateFeature/deleteFeatures reroute deferred to facade-expansion) |
| INFRA-03 | Phase 2 — Tool Registry & Authoring API | Complete (02-03) |
| TOOLS-01 | Phase 2 — Tool Registry & Authoring API | Complete (02-05) |
| INGEST-01 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-02 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-03 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-04 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-05 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-06 | Phase 3 — File Ingest & Multimodal | Complete |
| INGEST-07 | Phase 3 — File Ingest & Multimodal | Complete (03-04) |
| CODE-01 | Phase 4 — Code Interpreter Sandbox | Partial (04-01: confinement proven; 04-02: run_code wired into the app graph, build succeeds; prod `.wasm`-serving RESOLVED a417ca5 — emits to dist + serves 200 application/wasm; remaining: live in-browser execute via Wave 3 UAT) |
| CODE-02 | Phase 4 — Code Interpreter Sandbox | Complete (04-01: injected surface = exactly authoring/turf/data/console, no host leak; 04-02: run_code replays only authoring.* through the facade) |
| CODE-03 | Phase 4 — Code Interpreter Sandbox | Implemented (04-02: error/timeout → ToolError fed to the model loop, bounded retry cap 3; 04-03: collapsible read-only display block CodeRunDisclosure wired into MessageBubble, D-09/D-10/D-11/D-12/D-07) — live autonomous-loop + UX confirmation pending /gsd-verify-work 4 |
| CODE-04 | Phase 4 — Code Interpreter Sandbox | Implemented (04-01: timeout-kill + output-cap engine proven; 04-02: timeout flows through the run_code tool loop as a retryable ToolError) — live no-freeze confirmation pending /gsd-verify-work 4 |
| CODE-05 | Phase 4 — Code Interpreter Sandbox | Implemented (04-02: fibonacci-15-circles end-to-end → counts.created===15, 15 features) — live autonomous-emit confirmation pending /gsd-verify-work 4 |
| CODE-06 | Phase 4 — Code Interpreter Sandbox | Implemented (04-02: Austria→Bosnia reads handle rows, returns chosen route+costs, draws 1 feature; privacy seam intact) — live autonomous-run confirmation pending /gsd-verify-work 4 |
| SAFE-01 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| SAFE-02 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| SAFE-03 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| SAFE-04 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| SAFE-05 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| SAFE-06 | Phase 5 — Dataset-Aware Safe Editing | Pending |
| TOOLS-02 | Phase 6 — AI Bulk Transform & Data-Driven Styling | Pending |
| TOOLS-03 | Phase 6 — AI Bulk Transform & Data-Driven Styling | Pending |
| TOOLS-04 | Phase 6 — AI Bulk Transform & Data-Driven Styling | Pending |
| STYLE-01 | Phase 6 — AI Bulk Transform & Data-Driven Styling | Pending |
| STYLE-02 | Phase 6 — AI Bulk Transform & Data-Driven Styling | Pending |
| GEO-01 | Phase 7 — Geometry Optimization | Pending |
| GEO-02 | Phase 7 — Geometry Optimization | Pending |
| GEO-03 | Phase 7 — Geometry Optimization | Pending |

**Coverage:**

- v1.1 requirements: 29 total
- Mapped to phases: 29 (SET ×3, INFRA ×3, INGEST ×7, CODE ×6, SAFE ×6, TOOLS ×4, STYLE ×2, GEO ×3 — note TOOLS spans Phase 2 [TOOLS-01] and Phase 6 [TOOLS-02/03/04])
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-16*
*Last updated: 2026-06-16 — traceability renumbered (Encrypted Settings Persistence moved to Phase 1)*
