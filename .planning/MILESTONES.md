# Milestones

## v1.2 Geo Entity Model Split (Shipped: 2026-07-03)

**Phases completed:** 6 phases (8–13), 31 plans, 36 tasks
**Timeline:** 2026-06-25 → 2026-07-03 (~9 days) · git 95c35a6…8474477 · 216 files, +24,596/−1,974 in src
**Milestone audit:** PASSED — 30/30 requirements, 5/5 cross-phase seams, 4/4 E2E flows (see `milestones/v1.2-MILESTONE-AUDIT.md`)

**Delivered:** Split the overloaded kind-37518 "context" into four role-specific geo entity kinds — Story/Article (37520), slimmed Group/Topic (37518), Live Beacon (37521), Temporal Sighting (37522) — each a first-class entity with full create/edit/comment/react/attach authoring UI, over one shared foundation, so the schema expresses each real use case distinctly instead of as one overloaded union. Clean break on legacy 37518 data.

**Key accomplishments:**

- **Phase 8 — Spec v2 + Foundation:** the six shared seams every new kind inherits ship verified — kind constants, extracted `tags.ts` (bbox/g/t/c/a read+write), the `modelVersion='earthly/2'` in-content discriminator + legacy-37518 no-throw skip (SPEC-03), the off-thread hardened schema-validation worker (`rejectUnsafeSchema` DoS gate before `ajv.compile`, fail-closed watchdog), the NIP-40 `dropExpired` filter, and the NIP-32 `L`/`l` taxonomy helper (TAX-01) — with SPEC.md rewritten to v2 and pinned by `spec.doc.test.ts`.
- **Phase 9 — Group / Topic (37518 slimmed):** governance ladder (open · schema · closed) with visual + raw-JSON schema authoring; the contributor `c`-attach lane that warns-but-never-blocks a valid standalone publish (GROUP-04); and the security-critical NO-MOD MINIMUM two-lane view where every foreign `c` coordinate is kind + signature + mute validated before it can paint (GROUP-08).
- **Phase 10 — Story / Article (37520):** curate-pull Markdown narrative with inline geo-refs (eye-toggle/fly-to, default hidden), body-derived `a` mirroring, draft + in-place edit, comment/react, and reader propose-edit via the generalized kind-37519 proposal (STORY-06).
- **Phase 11 — Temporal Sighting (37522):** time-bound placed observation with geometry-on-content + turf-derived bbox/g, a live/upcoming/past observation-state classifier, per-read-path NIP-40 expiry (SIGHT-03), a distinct state-aware map marker, and comment/react parity.
- **Phase 12 — Live Beacon (37521):** the end-to-end real-time position flow — no-pin-drop control panel, always-on "you are live" banner + one-tap Stop, throwaway-pubkey share link, honest staleness (removed>ended>stale>live), public-vs-link-only discovery gating, and a live-map render layer. Code review caught + fixed 2 GPS-leak privacy criticals.
- **Phase 13 — Cross-Cutting:** comment/react parity across all 5 kinds (XCUT-01); the 5 per-kind route parsers collapsed into one `SHARE_ROUTES` dispatcher with byte-for-byte URL parity + comment deep-links (XCUT-02); and the Map Stack ↔ entity-layer unification (`deriveVisibleEntitiesFromStack` render gate, add-to-stack, aggregate layers, cold-start defaults, expiry auto-remove; `66a155e` side-channel deleted). Gap-closure (13-05/06/07 + fix(13-uat)) closed the UAT cluster 9/9, incl. beacon share-link, deep-link inspect, and own-beacon auto-add.

**Known deferred items at close:** 3 acknowledged carry-forwards (see STATE.md → Deferred Items), all bookkeeping-open not work-open: two v1.1 sandbox debug sessions awaiting live human confirmation (fix landed + regression-tested) and a Phase 11 UAT-BROWSER stub (Phase 11 UAT already 3/3). Plus documented tech debt in the audit: XCUT-01 type-union hygiene, CR-01 beacon Follow-button forwarding, a full-suite `bun test` mock-leakage flake (passes in isolation), repo-wide biome/tsc baseline debt, and Nyquist partials on Phases 10/11/12/13. v2 backlog: STORY-07, BEACON-05/06/07, SIGHT-05/06, MOD-01/02.

---

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
