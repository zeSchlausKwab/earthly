# Phase 3: File Ingest & Multimodal - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can drop a real-world file into chat — by button **and** drag-and-drop, with one chip per file — and have it parsed **off the main thread** (CSV, Excel `.xlsx`, JSON, GeoJSON, plain-text, images) without freezing the app. After ingest the user sees a parse summary while the **model receives only a compact summary, never the raw rows**. The AI can place ingested tabular/text rows onto the map as features, geolocating where needed (ugly logging CSV → mapped points; pasted Telegram message → located feature). Images are **only ever sent to models that actually support vision**, via layered capability detection with an explicit opt-in when support is uncertain.

**Requirements:** INGEST-01 (attach via button + drag-drop, chip per file), INGEST-02 (CSV + Excel, off-thread), INGEST-03 (JSON, GeoJSON, plain-text), INGEST-04 (images), INGEST-05 (parse summary to user, compact summary to model — not raw rows), INGEST-06 (place tabular/text rows on the map, geolocating where needed) `[A][B]`, INGEST-07 (layered vision detection; image-send disabled/uncertain when unconfirmed).

**Depends on:** Phase 2 (Tool Registry & Authoring API) — complete enough for this phase's two seams:
- New ingest/placement tools register through the **typed registry** (D-01..D-04) with mandatory `kind` metadata; unknown tool = hard error.
- All map placement (INGEST-06) flows through the **Authoring API** (`authoring.*`, D-07/D-10) — never the Zustand store directly.

**Forward-coupled phases (design the seams to anticipate these):**
- **Phase 4 (Code Interpreter Sandbox)** — sandboxed code must read **ingested data** host-side. The ingest store + handle-id seam (below) is the contract Phase 4 plugs into.
- **Phase 5 (Dataset-Aware Safe Editing) / SAFE-05** — bulk operations run host-side as rules over the full bound dataset by id. The "host-side over full parsed rows" placement decision (below) anticipates this.
- **Phase 7 (Geometry Optimization)** — ingests large GeoJSON; off-thread parsing + size handling here should not preclude it.

**Out of scope (belongs to later phases, do NOT build here):** dataset binding chip / diff-preview / safety levels (Phase 5), the code interpreter itself (Phase 4), geometry optimization/simplification (Phase 7), bulk attribute transforms & data-driven styling (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Parse summary & model handoff (INGEST-05)
- **D-01:** **Model-facing summary = schema + sample rows.** The compact representation sent to the model is the column schema (names/types) plus a small set of **sample rows** — enough for the AI to understand shape and map columns. Raw/full rows are NEVER sent to the model. Extends the existing chat-only compaction pass in `store.ts` (large `features` arrays → counts + samples).
- **D-02:** **Sampling = head + tail + random.** Sample rows are drawn as first-few + last-few + a few random rows (better representation of messy/sorted data for column-mapping and geolocation) rather than just the head. A **column cap** applies for wide tables (cap displayed/sent columns with an "…N more columns" indicator) so a 100k×80 file can't blow the token budget. Exact counts = planner's discretion (see Discretion).
- **D-03:** **User-facing summary = compact stat line (expandable).** In/near the file chip the user sees a compact line: rows × columns, detected coordinate/geometry columns, and parse status. **No always-on data grid** — fits the existing chip pattern; user can expand for more if needed.

### Tabular → map placement & geolocation (INGEST-06)
- **D-04:** **Coordinate/geometry columns: auto-detect + AI override.** A host heuristic detects coordinate/geometry columns by name (lat/latitude/lon/lng/x/y/wkt/geometry, etc.) and surfaces them in the summary; the AI can confirm or override which columns to use when it calls the placement tool. Robust for clean files, flexible for ugly ones.
- **D-05:** **Placement applies host-side over the FULL parsed dataset, by reference.** The AI specifies a **column-mapping rule** (which columns → lat/lon/geometry/name/description); the host applies that rule to **all** parsed rows by handle — **never only the sampled rows the model saw**. This directly satisfies the "ugly CSV → all points" story and anticipates SAFE-05 (host-side rules over the full dataset by id). Placement writes features through the **Authoring API** (D-07/D-10 from Phase 2).
- **D-06:** **Geolocation: both single and batch, AI chooses.** Rows without coordinates (place names, the Telegram observation) are located via geocoding. Expose **both** single-observation geocoding (reusing the existing `search_location` / Nominatim MCP tool) **and** a bounded **batch** geocode tool over a place-name column; the AI picks based on row count. Caps + rate-limit + failure handling = planner's discretion (see Discretion) — must respect Nominatim's public-instance policy (~1 req/s, no heavy bulk).

### Vision gate (INGEST-07)
- **D-07:** **Layered detection ladder (locked by requirement).** Detect vision support via: Ollama capabilities → modalities field → name heuristic → fail-safe to no-vision. This **replaces** today's name-only `modelMaySupportVision()` (`src/features/chat/store.ts:484`).
- **D-08:** **Three-tier gating behavior.**
  - **Confirmed-vision** → image-send enabled normally.
  - **Confirmed-no-vision** → image-send **hard-disabled** (with an explanatory tooltip); an image is never silently sent to a blind model.
  - **Unconfirmed** (name-heuristic only, or unknown) → affordance stays available but **marked uncertain** (warning badge/tooltip); actually sending an image requires an **explicit opt-in confirm** ("this model may not support images — send anyway?"). This keeps local/custom models that don't cleanly advertise capability usable.
- **D-09:** **The gate unifies both image paths.** The layered detection gates **both** user-attached images AND the existing `capture_map_snapshot` → `image_url` one-shot vision flow (`store.ts` ~1259–1512). One source of truth for vision capability, not two heuristics.

### Attachment & ingested-data lifecycle (INGEST-01/05)
- **D-10:** **Dedicated file-chip strip.** File attachments get a **new** component (button + drag-and-drop, one chip per file with parse status) sitting **alongside** the existing `ChatGeometryAttachment` (drawn-geometry) — kept as separate concepts rather than refactoring the working geometry attachment into a unified manager.
- **D-11:** **Parsed data lives in a host-side ingest store keyed by a handle id.** Parsed datasets are held in a dedicated host store; the **model receives only the summary + a handle id**, while chat tools (and Phase 4's sandbox) read the **full rows by handle**. This is the clean seam Phases 4/7 plug into and the enforcement point for "model never sees raw rows."
- **D-12:** **Session-only, in-memory.** Parsed ingest data lives for the session and is **not** persisted to localStorage/IndexedDB (files can be large); the user re-attaches after a reload. Placed features persist via the normal editor → Nostr path anyway. (Eviction/size caps = planner's discretion.)

### Claude's Discretion
- **Off-thread mechanism** — Web Worker (± a small RPC helper) vs main-thread chunked/yielding parsing. Requirement only mandates "off-thread, no freeze" (INGEST-02).
- **Parse-library choices** — e.g. a CSV parser (papaparse-style) and an Excel reader (SheetJS-style); native `JSON.parse` for JSON/GeoJSON. Honor the project's lean-deps ethos (avoid heavy new libs where existing tools suffice); GeoJSON validation can lean on existing `@turf/turf`.
- **Per-type summary shapes** — text → line/char count + head snippet; GeoJSON → feature count + geometry types + bbox; image → filename/dimensions (no pixels sent to non-vision models). These are unambiguous; a unified typed summary interface is optional but encouraged for one rendering path.
- **Sample/column counts** (D-02), **geocode caps + failure handling** (D-06: skip-and-report vs place-with-flag), **ingest-store eviction/size caps** (D-12), **image base64/data-URL encoding** into `image_url` (match existing path), and **registry file layout**.
- **Max file-size guardrails** — sensible caps to protect memory/UX (DoS-ish protection on huge drops).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — INGEST-01..INGEST-07 (full requirement text + phase mapping; note `[A][B]` story tags on INGEST-06).
- `.planning/ROADMAP.md` — Phase 3 goal + four success criteria (verbatim acceptance conditions) and the Phase 4/5/7 dependency notes.
- `.planning/PROJECT.md` — milestone goal; user stories #1 (ugly logging CSV → cutting route) and #2 (Telegram message → located feature) that drive INGEST-06; the "parse-everything + capability-gated vision" design stance.

### Phase 2 foundation (the two seams this phase routes through)
- `.planning/phases/02-tool-registry-authoring-api/02-CONTEXT.md` — D-01..D-16: the typed registry contract (kind/origin metadata, dynamic register/unregister, D-16 error contract) and the Authoring API layering (D-07 strict one-way layering, D-10 single facade, D-11 structured results). New ingest/placement tools and map writes MUST conform.
- `src/features/geo-editor/api/` — the Authoring API facade (sole geometry-mutation seam; placement calls land here per D-05).
- `src/features/chat/tools/registry.ts`, `src/features/chat/tools/definitions.ts`, `src/features/chat/tools/schemas.ts`, `src/features/chat/tools/execute.ts` — the unified typed registry where new ingest/geocode/placement tools register (with `kind`).

### Existing chat code to extend
- `src/features/chat/store.ts` — `modelMaySupportVision()` (line 484, REPLACED by D-07's ladder); the `image_url` content-part handling (~267, ~386) and the `capture_map_snapshot` → vision one-shot flow (~1259–1512, gated by D-09); the chat-only tool-result compaction pass (D-01 extends this).
- `src/features/chat/routstr.ts` — provider config + `GET /models` discovery (line ~190); `image_url` content-part type (~36); the provider matrix (routstr/lmstudio/ollama/custom) the vision ladder must branch on (Ollama needs native `/api/show`/`/api/tags` for capabilities, not just `/v1`).
- `src/features/chat/ChatGeometryAttachment.tsx` — the existing geometry-attachment chip; D-10 adds a **separate** file-chip strip alongside it (don't fold in).
- `src/features/chat/ChatPanel.tsx` — chat input/attachment UI host; image-part rendering (~941); where the file-chip strip + vision gate UI mount.

### Integrations & existing tools
- `.planning/codebase/INTEGRATIONS.md` — Nominatim geocoding (`SearchLocation`/`ReverseLookup` via ContextVM, ~1 req/s public-instance policy) for D-06; ContextVM/MCP client `src/ctxcn/EarthlyGeoServerClient.ts`.
- `src/features/chat/tools/helpers.ts` — `importFeaturesToEditor()` / feature normalization and existing `@turf/turf` imports reusable for placement + GeoJSON handling.

### Forward-coupled phases (read before designing seams)
- `.planning/REQUIREMENTS.md` — CODE-01..CODE-06 (Phase 4): the ingest store handle (D-11) is the surface sandboxed code reads ingested data through. SAFE-05 (Phase 5): host-side rules over the full dataset (D-05 anticipates this).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Existing vision plumbing** — `modelMaySupportVision()` (store.ts:484), the `image_url` content-part type/handling, and the `capture_map_snapshot` one-shot vision send already exist; D-07/D-09 harden + unify them rather than build from scratch.
- **`@turf/turf@^7.3.5`** — already installed; usable for GeoJSON validation/bbox and any coordinate work in placement.
- **`importFeaturesToEditor()` / feature normalization** (`tools/helpers.ts`) — source-tagging + stable-id normalization reusable when materializing ingested rows into features (now routed through the Authoring API, not dual-writing the store).
- **Unified typed registry + D-16 error contract** (Phase 2) — new ingest/geocode/placement tools self-register with `kind` metadata; runtime errors feed back into the model loop AND surface in chat.
- **Chat tool-result compaction pass** (store.ts) — the precedent for D-01's "summary not raw rows" model handoff.
- **`search_location` / Nominatim MCP tool** — reused directly for single-row geocoding (D-06).

### Established Patterns
- **OpenAI-compatible content parts** — text + `image_url`; attached images encode as data URLs into `image_url` (match existing path).
- **GeoEditor source-of-truth + store read-mirror** (Phase 2 D-09) — placement writes via Authoring API; the feature list/UI updates via the existing event-mirror, no direct store writes.
- **Provider matrix** — routstr / lmstudio / ollama / custom; capability detection (D-07) must branch per provider (Ollama exposes capabilities via native endpoints, not the `/v1` surface).

### Integration Points
- **Chat input UI** (`ChatPanel.tsx`) — mounts the new file-chip strip (D-10) and the vision-gate affordance (D-08).
- **Tool registry** — ingest/geocode/placement tools register here; advertised to the model with `kind` metadata.
- **Authoring API** — sole geometry write path for placed features (D-05).
- **Ingest store (new)** — host-side handle-keyed store (D-11), the seam Phase 4's sandbox reads.

</code_context>

<specifics>
## Specific Ideas

- The headline stories are the acceptance bar: (1) an **ugly logging CSV** (names, coordinates, image links) → mapped points / a cutting route; (2) a pasted **Telegram message** ("soccer star spotted at hotel XYZ in Lyon") → a single titled, described, geolocated feature. Column-mapping + both-mode geocoding (D-04/D-06) must make both concrete flows work.
- The user's recurring stance — "always extract maximum structured info from any file; only send images to vision when the model advertises it" — drove the model-handoff (D-01) and the three-tier vision gate (D-08).
- The "model never sees raw rows" guarantee is enforced structurally by the handle-id seam (D-11), not just by convention.

</specifics>

<deferred>
## Deferred Ideas

- **Persisted ingest cache across reloads** (IndexedDB handles, eviction policy) — considered and deferred in favor of session-only in-memory (D-12). Revisit if long-session re-attachment friction proves real.
- **Unified attachment manager** (folding geometry + file attachments into one component) — deferred in favor of a separate file-chip strip (D-10) to avoid refactoring working geometry-attachment code.
- **Richer always-on data-grid preview** in the chip — deferred in favor of the compact expandable stat line (D-03).
- **Self-hosted / higher-throughput geocoder** to escape Nominatim's public rate limits for very large batches — out of scope; D-06 caps batch geocoding to respect the public policy.

None of the above expand Phase 3 scope; they are future considerations.

</deferred>

---

*Phase: 3-File Ingest & Multimodal*
*Context gathered: 2026-06-16*
