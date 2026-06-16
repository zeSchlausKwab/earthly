# Feature Research

**Domain:** AI chat workbench for collaborative GeoJSON mapping (data ingest, sandboxed code, safe authoring) — Earthly milestone v1.1
**Researched:** 2026-06-16
**Confidence:** MEDIUM-HIGH (analogous-product behavior cross-corroborated across multiple sources; map-specific specifics extrapolated from existing Earthly chat/editor surface + GIS tooling norms)

> Scope note: This is a SUBSEQUENT milestone on a mature app. Earthly already ships multi-session chat, entity refs, streaming + 10-round tool loop, 19 tools (editor commands + OSM/Overpass + Valhalla routing/isochrones + map snapshot vision), Cashu wallet prepay/refund, cost estimation, diagnostics, encrypted (nip44/nip04) per-pubkey settings storage, a headless `editor_*` command registry, and a `simplify` command. Those are NOT re-proposed below. This file is about how the **seven NEW v1.1 capabilities should behave**, benchmarked against ChatGPT/Claude code interpreter + file upload, LM Studio js-code-sandbox, Felt/Atlas AI map tools, and data-cleaning assistants.

> Story key (PROJECT.md "Representative user stories"): **S1** ugly CSV → dataset + cutting route · **S2** Telegram paste → geolocated titled feature on a context · **S3** Austria→Bosnia cost-weighted flight path · **S4** clean a convoluted context (fill descriptions, translate names, recolor ports/airports/waterways, dataset-aware) · **S5** 12MB messy trail GeoJSON → ~900KB at same visual quality.

---

## Feature Landscape

### Table Stakes (Users Expect These)

If these are missing, the v1.1 capability feels broken relative to ChatGPT/Felt/Claude.

| Feature | Why Expected | Complexity | Notes / Dependencies |
|---------|--------------|------------|----------------------|
| **Attach via "+" button AND drag-drop onto chat** (1) | Every analogous tool offers both; drag-drop is the desktop default in ChatGPT. | LOW | Hooks into existing `ChatPanel.tsx`. Drag-drop desktop-only is an accepted norm. Story: **S1, S2(paste), S5**. |
| **File chip/preview after attach** (1) | ChatGPT shows a card; users need confirmation the file landed before sending. | LOW | Reuse `ChatGeometryAttachment.tsx` pattern (transient attachment already exists). |
| **Parse-on-ingest summary: "loaded N rows × M cols", detected headers/types** (1) | ChatGPT emits "I've loaded a file with 9,994 rows and 21 columns"; users expect the model to *acknowledge structure*, not silently swallow the file. | MEDIUM | Client-side parse (CSV/Excel/JSON/GeoJSON) → structured digest injected to model + shown to user. Decision in PROJECT: "parse-everything." Story: **S1, S4**. |
| **Format coverage: CSV, Excel (xlsx), JSON, GeoJSON, plain text, images** (1) | These are the milestone's named formats and match ChatGPT's CSV/Excel/PDF/text baseline. | MEDIUM | Excel needs a parser (e.g. SheetJS-class). GeoJSON path already exists. |
| **Capability-gated image send** (1) | Sending an image to a non-vision model produces silent failure or garbage; users expect the affordance to disappear/grey out. | MEDIUM | Decision in PROJECT. Depends on model capability detection (extend `routstr.ts` `/models` discovery). Story: **S1 (image links), S2**. |
| **Code shown in a collapsible block, output shown beneath** (2) | Universal code-interpreter pattern; users want to *see* what ran. Earthly already has collapsible tool-result blocks — extend, don't reinvent. | LOW | Reuses `ChatPanel.tsx` disclosure pattern. Story: **S1, S3**. |
| **Errors fed back into the loop so the AI self-corrects** (2) | ChatGPT keeps prior code + outputs in context and retries automatically; "it just fixes it" is the expectation. | MEDIUM | Earthly's tool-call loop (`MAX_TOOL_CALL_ROUNDS = 10`) already does this for tools; sandbox stdout/stderr becomes another tool result. Story: **S1, S3**. |
| **Sandbox cannot touch the page / network by default** (2) | LM Studio's js-code-sandbox and browser-sandbox norm: locked-down Worker/iframe, no DOM, no `fetch`, terminable on runaway loop/timeout. | HIGH | Web Worker (preferred) or sandboxed iframe; whitelist a narrow `map`/`draw` API bridge via postMessage. Decision in PROJECT (client sandbox). |
| **Visible binding: "editing → [dataset name]"** (5) | This is the carried-over binding chip; an AI silently editing the wrong dataset is the scariest failure. Users must always see the target. | MEDIUM | `bindActiveWorkspaceChat()` exists but binds silently. Surfacing the chip is the table-stakes half. Story: **S2, S4**. |
| **Confirm before destructive change (default safety level)** (5) | "Human confirmation for high-impact/destructive actions (delete, publish)" is a near-universal agent-UX principle. PROJECT default = level 2 confirm-destructive. | MEDIUM | Needs add-vs-modify-vs-delete intent classification on editor mutations. Story: **S4, S1**. |
| **Before/after metrics on optimization: size + vertex count** (6) | Every simplify tool (mapshaper, QuickMapTools) reports coordinate-count reduction, file-size savings, reduction %. Users won't trust "I simplified it" without numbers. | LOW-MEDIUM | `simplify` command exists; wrap with measurement + reporting. Story: **S5**. |
| **Hit the size budget the city dialog complains about** (6) | The whole point of S5 is clearing the publish/relay size limit. Optimization must target a concrete byte budget, not a generic "simplify." | MEDIUM | Iterative: simplify → measure → tighten tolerance until under budget. Story: **S5**. |
| **Keys persist across reload, scoped to identity** (7) | "Remember my provider/keys" is assumed; re-entering an API key every reload is broken UX. | LOW | Already shipped (`settingsStorage.ts`, nip44/nip04, per-pubkey). v1.1 mostly *extends payload* (provider config, LM Studio/Ollama addresses) + UX polish. Story: all. |

### Differentiators (Competitive Advantage)

Where Earthly does something ChatGPT/Felt do not — the v1.1 wow surface.

| Feature | Value Proposition | Complexity | Notes / Dependencies |
|---------|-------------------|------------|----------------------|
| **Sandboxed code that drives a clean map drawing API** (2,3) | "Draw 15 circles with fibonacci radii" or a cost-weighted flight path expressed as *code*, not 15 tool calls. ChatGPT plots matplotlib; Earthly plots **geometry onto a live collaborative map**. This is the milestone's signature. | HIGH | Sandbox + the toolbar drawing API (PROJECT constraint: designed as a package boundary, no store leakage). Bridge exposes `draw.point/line/polygon/circle/buffer`, `editor.*`. Story: **S1 (route), S3 (flight path)**. |
| **AI-only parametric/batch primitives** (3) | Tools a human toolbar shouldn't carry but an AI loves: parametric circle/regular-polygon/star, geodesic buffer, batch attribute set, bulk transform, dedup, merge-to-multi, microgap stitch. | MEDIUM-HIGH | Add to `editor_*` command registry so they're callable from chat AND sandbox via one surface. (Enumerated in detail below.) Story: **S3, S4, S5**. |
| **Data-driven styling by attribute, AI-applied** (4) | "Make ports blue, airports red, waterways thick teal" → a per-attribute style rule, not per-feature hand-coloring. Felt does this via UI; Earthly does it via *one sentence*. | MEDIUM-HIGH | Needs a per-dataset style spec (categorical/ramp rules keyed on a property) + an `apply_style` tool + persistence in/alongside the kind 37515 event. Story: **S4**. |
| **Per-dataset style persistence** (4) | Recolor survives reload/publish and travels with the dataset (so a viewer sees ports-blue too). | MEDIUM | Where to store: style spec as event metadata or sidecar. Decision needed; depends on Nostr event surface. Story: **S4**. |
| **Add-vs-modify-vs-delete intent surfaced per operation** (5) | The AI says "I will ADD 1, MODIFY 3 (fill description), DELETE 0" before acting — turning an opaque edit into a reviewable plan (agent-plans-as-PR pattern). | MEDIUM-HIGH | Needs the editor to classify each pending mutation; ties to diff/preview. Story: **S4**. |
| **Diff/preview before destructive change** (5) | Show the changeset (counts + a visual highlight of affected features on the map) before commit; keep/undo decision. This is what makes users *trust* the AI on their data. | HIGH | Map-highlight of pending changes + a summary panel. Depends on intent classification. Story: **S1, S4**. |
| **Three configurable safety levels** (5) | 1 = preview+confirm-all, 2 = confirm-destructive only (default), 3 = trust + undo. Most tools hardcode one model; making it a user dial respects power users without abandoning cautious ones. | MEDIUM | Decision locked in PROJECT. Level 3 leans on existing undo/redo (`HistoryManager`). Story: **S4**. |
| **Geometry optimization as a guided, quality-preserving pipeline** (6) | Not raw Douglas-Peucker — simplify + merge-to-multi + microgap stitching tuned to a byte budget, with the AI choosing tolerance and explaining the tradeoff. Solves a real GIS pain (40-60% size cuts) inside chat. | HIGH | `simplify` exists; merge-to-multi + microgap stitch are new primitives. Story: **S5**. |
| **Visual before/after diff for optimization** (6) | Overlay original vs simplified so the user *sees* quality is preserved, not just trusts a number. mapshaper-style real-time preview. | MEDIUM-HIGH | Needs a transient overlay layer in the editor. Nice-to-have above the metrics floor. Story: **S5**. |
| **Free/local-model parity (LM Studio/Ollama) for the whole workbench** (1,2,7) | Felt/ChatGPT lock data analysis behind paid tiers + cloud. Earthly runs the same ingest+code+style flow against a local model with no data leaving the machine. | MEDIUM | Capability detection must degrade gracefully (no vision, smaller context). Reuses existing provider switch. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Server-side / container code execution** | "Real" code interpreters (ChatGPT) run Python in a cloud VM with full libs. | Adds backend, breaks the no-middleware chat architecture, leaks user data, and contradicts the local-first/Nostr ethos. | Client-side Web Worker sandbox with a curated JS map API (PROJECT decision). Accept narrower capability. |
| **Arbitrary network/`fetch` from sandboxed code** | "Let the code pull a live API." | Turns the sandbox into an exfiltration/SSRF vector; defeats isolation. | Route external data through the *existing vetted tools* (OSM, web_search, fetch_url); pass results INTO the sandbox as inputs. |
| **Auto-publish AI edits to the relay** | "Just save it for me." | Publishing is irreversible and public (kind 37515); an AI mistake becomes a permanent broadcast. | Edits stay local until an explicit human Publish verb. Never let safety level 3 ("trust") imply auto-publish — trust = local apply + undo only. |
| **Per-feature manual recoloring loop by AI** | "Color each port." | O(N) tool calls, blows the context/budget, fragile. | Attribute-driven style rule applied once (the differentiator above). |
| **Streaming/auto-running code as the model types** | "Faster feedback." | Runs half-formed code, side effects on the map mid-stream, scary. | Run only on a complete, parsed code block; show code first, then execute (optionally with a run gate at safety level 1). |
| **Lossy optimization that silently changes topology** | "Just make it small." | Over-simplification creates spikes/self-intersections and breaks routing/area semantics; user loses data without knowing. | Budget-targeted simplify with visual diff + a floor tolerance + validity check; report what was dropped. |
| **Storing API keys in plaintext localStorage "for convenience"** | "Encryption is a hassle / no nsec when using a NIP-07 extension." | Plaintext secrets in localStorage are trivially stolen by any XSS. | Keep the nip44/nip04-via-signer envelope already shipped; for NIP-07/remote signers, derive encryption via the signer's encrypt API (already abstracted as `ISigner`). Degrade to session-only if no encryption available. |
| **A second "power mode" UI for the workbench** | "Analysts need more controls." | PROJECT explicitly rejected two-tier UI; forking the UI re-introduces orchestration debt. | "Visible but ignorable" — workbench affordances live in the existing chat, gated by capability not by mode. |
| **Generic "AI cleans your data" magic with no visibility** | Data-cleaning assistants market full autonomy. | On a *destructive, shared* dataset, opacity destroys trust — the core risk this milestone is built to manage. | Always-visible binding + intent breakdown + diff/preview. Trust is earned by showing work. |

---

## AI-Oriented Editor Tools — Candidate Enumeration (Q3)

Tools that make sense for an AI/sandbox but would clutter a human toolbar. All should land on the **one `editor_*` command registry** (`src/features/geo-editor/commands.ts`) so chat tool-calls AND sandbox code share a surface, per the PROJECT "design as a package export" constraint.

| Candidate primitive | Why AI-suited (not toolbar) | Complexity | Story |
|---------------------|-----------------------------|------------|-------|
| `draw_circle` / `draw_regular_polygon` / `draw_star` (parametric: center, radius, n) | Humans drag; AI parameterizes ("15 circles, fibonacci radii"). | LOW-MEDIUM | S3 |
| `buffer` (geodesic, meters) around feature/selection | Already prompt-cookbooked ("2km buffer"); formalize as a primitive. | MEDIUM | S1, S3 |
| `set_attributes_batch` (set property on N matched features) | "fill missing descriptions", "tag source=osm". Tedious by hand. | LOW-MEDIUM | S1, S4 |
| `transform_features_batch` (translate/scale/rotate a set) | Bulk geometric ops; toolbar transforms one selection. | MEDIUM | — |
| `dedup_features` (by geometry hash / proximity) | Cleaning imported messes. | MEDIUM | S5 |
| `merge_to_multi` (collapse many singles → MultiLineString/MultiPolygon) | Core of S5 size reduction; topology-aware. | MEDIUM-HIGH | S5 |
| `stitch_microgaps` (snap near-coincident endpoints, tolerance) | Fixes the "hundreds of polylines with microgaps" case. | HIGH | S5 |
| `simplify` (tolerance / target budget) | EXISTS — extend to accept a byte budget + report metrics. | LOW (extend) | S5 |
| `apply_style_rule` (attribute → color/stroke/width) | Data-driven styling primitive. | MEDIUM-HIGH | S4 |
| `select_by_attribute` / `query_features` (filter loaded features) | Lets AI scope batch ops precisely ("all features where amenity=port"). | LOW-MEDIUM | S4 |
| `translate_attribute` (e.g. Arabic names → English) via model, batched | S4 names-translation; pairs with `set_attributes_batch`. | LOW (orchestration) | S4 |
| `validate_geometry` (self-intersection, winding, NaN coords) | Pre-publish safety; AI can auto-fix. | MEDIUM | S5 |

---

## Feature Dependencies

```
File Upload + Parse (1)
    └──feeds──> Code Interpreter sandbox inputs (2)
    └──feeds──> Geometry Optimization (6)  [the 12MB GeoJSON arrives via upload]

Toolbar Drawing API (existing constraint, must be clean)
    └──required-by──> Code Interpreter map bridge (2)
    └──required-by──> AI-oriented editor primitives (3)

AI-oriented editor primitives (3)
    └──required-by──> Data-driven styling (4)   [apply_style_rule]
    └──required-by──> Geometry Optimization (6)  [merge_to_multi, stitch, simplify]

Add/modify/delete intent classification (5)
    └──required-by──> Diff/preview (5)
    └──required-by──> Safety levels (5)
    └──enhanced-by──> Visible binding chip (5)

Visible binding chip (5)  [carried-over UX-rewrite item]
    └──required-by──> Dataset-aware safe editing as a whole (5)

Capability detection (model /models)
    └──required-by──> Capability-gated image send (1)
    └──enhances──> Local-model parity (graceful degrade)

Encrypted settings (7) [largely SHIPPED]
    └──extended-by──> provider config + local addresses persistence

Safety levels (5) ──conflicts──> Auto-publish (anti-feature)
Sandbox network access (anti-feature) ──conflicts──> Sandbox isolation (2)
```

### Dependency Notes

- **Code interpreter requires the clean toolbar drawing API.** The sandbox can only be useful if it has a stable, store-decoupled `draw/editor` surface to call across the postMessage bridge. This is already a PROJECT constraint — v1.1 makes it load-bearing.
- **Data-driven styling and geometry optimization both require new primitives on the shared command registry.** Build the primitives once; expose to chat tools and sandbox alike.
- **Safe editing is a stack, not a toggle:** binding chip (visibility) → intent classification (what kind of change) → diff/preview (show it) → safety levels (how much to gate). Each layer depends on the one below.
- **Upload feeds three downstream features** (code inputs, optimization input, styling-by-attribute on tabular joins) — it is the earliest item that unblocks the most.
- **Encrypted persistence is mostly done;** treat as a small extension + the NIP-07/remote-signer edge case, not a from-scratch build.

---

## MVP Definition

### Launch With (v1.1 core)

- [ ] **File upload + parse + structured summary** (CSV/Excel/JSON/GeoJSON/text/image) — unblocks S1, S2, S5; earliest dependency.
- [ ] **Capability-gated image send** — cheap, prevents a broken-feeling failure mode.
- [ ] **Clean toolbar drawing API + Web Worker sandbox with map bridge** — the signature differentiator (S1 route, S3 flight path).
- [ ] **Core AI-oriented primitives:** parametric shapes, buffer, set_attributes_batch, merge_to_multi, simplify-to-budget — minimum set for S3/S4/S5.
- [ ] **Visible binding chip + add/modify/delete intent + confirm-destructive (level 2 default)** — the trust floor for editing shared data (S4).
- [ ] **Geometry optimization to a byte budget with before/after size+vertex metrics** — clears S5's size-limit complaint.
- [ ] **Encrypted settings extension** (provider config + local addresses) — small lift on shipped foundation.

### Add After Validation (v1.1.x)

- [ ] **Visual before/after overlay for optimization** — trigger: users distrust the metrics-only report.
- [ ] **Full diff/preview with on-map highlight of pending changes** — trigger: confirm-destructive proves too coarse.
- [ ] **Safety levels 1 and 3 (preview-all / trust+undo)** — trigger: power users find level 2 friction-y or cautious users want more gating.
- [ ] **Per-dataset style persistence travelling with the published event** — trigger: viewers should see the AI's styling, not just the author.
- [ ] **dedup / stitch_microgaps / validate_geometry** — trigger: real messy-import datasets beyond the West Pacific Trail demo.

### Future Consideration (v2+)

- [ ] **Nostr-scrolls / WASM authoring (NIP-5C)** — explicitly deferred in PROJECT; builds on the sandbox.
- [ ] **Compound routing scenarios** — deferred in PROJECT.
- [ ] **Tabular join → geocode → choropleth** (Felt-style geomatching) — natural extension of CSV ingest, but a milestone of its own.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| File upload + parse + summary (1) | HIGH | MEDIUM | P1 |
| Capability-gated image send (1) | MEDIUM | LOW | P1 |
| Sandbox + clean drawing API bridge (2) | HIGH | HIGH | P1 |
| Core AI-oriented primitives (3) | HIGH | MEDIUM | P1 |
| Visible binding chip (5) | HIGH | MEDIUM | P1 |
| Intent + confirm-destructive default (5) | HIGH | MEDIUM-HIGH | P1 |
| Optimization-to-budget + metrics (6) | HIGH | MEDIUM-HIGH | P1 |
| Encrypted settings extension (7) | MEDIUM | LOW | P1 |
| Data-driven styling by attribute (4) | HIGH | MEDIUM-HIGH | P1/P2 |
| Per-dataset style persistence (4) | MEDIUM | MEDIUM | P2 |
| Full diff/preview on-map (5) | HIGH | HIGH | P2 |
| Safety levels 1 & 3 (5) | MEDIUM | MEDIUM | P2 |
| Visual before/after overlay (6) | MEDIUM | MEDIUM-HIGH | P2 |
| dedup / stitch / validate (3,5) | MEDIUM | MEDIUM-HIGH | P2 |

**Priority key:** P1 must-have for the v1.1 demo/value; P2 should-have post-validation; P3 future.

## Competitor Feature Analysis

| Feature | ChatGPT / Claude (code interp + upload) | Felt / Atlas AI maps | LM Studio js-sandbox | Our Approach |
|---------|------------------------------------------|----------------------|----------------------|--------------|
| Code execution | Cloud Python VM, full libs, plots inline | n/a (UI-driven AI) | Client JS in sandbox, no network | **Client Web Worker JS + curated map API**, errors loop back |
| File ingest | "+"/drag-drop, CSV/Excel/PDF/text, "loaded N rows × M cols", Pandas | "upload anything", auto-geocode tabular → points/polygons | n/a | Parse-everything client-side, structured summary to user+model; geocode via existing OSM tools |
| Styling | n/a (charts) | Attribute-driven color/size, classification methods, UI | n/a | **One-sentence attribute styling**, AI-applied, persisted per dataset |
| Destructive-edit safety | Sandbox is disposable; no shared-data risk | Manual UI edits (human-gated) | n/a | **Binding chip + intent + diff + 3 safety levels**; never auto-publish |
| Optimization | n/a | n/a (handles big data server-side) | n/a | **Budget-targeted simplify+merge+stitch** with before/after metrics + visual diff |
| Key persistence | Account-based, server-side | Account-based | Local app config | **nsec/signer-encrypted localStorage, per-pubkey** (shipped) |

## Sources

- ChatGPT Code Interpreter behavior (inline output, self-correct on errors, prior code+output retained in context): [Hatica](https://www.hatica.io/blog/chatgpt-code-interpreter-feature/), [DataCamp](https://www.datacamp.com/tutorial/how-to-use-chat-gpt-code-interpreter), [365 Data Science](https://365datascience.com/trending/chatgpt-code-interpreter-what-it-is-and-how-it-works/) — MEDIUM
- ChatGPT file upload UX ("+"/drag-drop desktop-only, CSV/Excel/PDF/text, "loaded N rows × M cols", Pandas parse, 512MB limit, premium-gated): [datastudios.org](https://www.datastudios.org/post/chatgpt-spreadsheet-uploading-excel-and-csv-support-data-analysis-features-formula-interpretation), [Definite](https://www.definite.app/blog/analyzing-data-in-chatgpt), [systoolsgroup](https://www.systoolsgroup.com/how-to/use-chatgpt-for-csv-file-analysis/) — MEDIUM
- Felt AI mapping (upload anything → auto-geocode, attribute-driven color/size, classification methods, AI extensions): [Felt AI](https://felt.com/platform/felt-ai), [Felt 2.0 launch](https://www.businesswire.com/news/home/20231110849445/en/Introducing-Felt-2.0-The-Most-Powerful-Tool-for-Professional-Map-Making), [geomatching/choropleths](https://www.felt.com/blog/geomatching-geocoding-choropleths), [Felt vector layer styling](https://help.felt.com/layers/styling/vector-layers) — MEDIUM
- Agent edit-safety UX (diff preview for destructive actions, per-call→autopilot permission tiers, secondary confirm on delete/publish, undo window, agent-plans-as-PR): [AI Agent UX Principles](https://medium.com/techacc/ai-agent-ux-design-principles-223da9f4d7f2), [VS Code agent trust & safety](https://code.visualstudio.com/docs/agents/concepts/trust-and-safety), [Preview Mode First / plan diff](https://dev.to/crisiscoresystems/preview-mode-first-agent-plans-as-prs-plan-diff-invariants-4ikd) — MEDIUM-HIGH (cross-corroborated)
- Geometry simplification (Douglas-Peucker, 40-60% size cut, tolerance tradeoff, spikes at high simplification, real-time preview + before/after coordinate/size metrics): [mapshaper REFERENCE](https://github.com/mbloch/mapshaper/blob/master/REFERENCE.md), [QuickMapTools simplify](https://www.quickmaptools.com/simplify-geojson), [Map Library optimization](https://www.maplibrary.org/10019/7-ways-to-optimize-map-file-sizes-for-web-use/) — MEDIUM-HIGH
- Browser-based LLM-code sandboxing (sandboxed iframe locked-down, Web Worker with fresh terminable worker, no unauthorized network, CSP inheritance): [the browser is the sandbox](https://aifoc.us/the-browser-is-the-sandbox/), [Amir's code sandboxes for LLM](https://amirmalik.net/2025/03/07/code-sandboxes-for-llm-ai-agents) — MEDIUM
- Earthly internal grounding (existing surface, NOT re-proposed): `src/features/chat/ARCHITECTURE.md`, `src/features/chat/tools/definitions.ts`, `src/features/chat/settingsStorage.ts`, `src/features/geo-editor/commands.ts`, `.planning/PROJECT.md` — HIGH

---
*Feature research for: AI chat data-ingest/transform/safe-authoring workbench (Earthly v1.1)*
*Researched: 2026-06-16*
