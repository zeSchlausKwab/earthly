# Earthly

## What This Is

Earthly is a Nostr-based collaborative mapping application. Users publish, discover, and edit GeoJSON datasets over a decentralized relay network, with social features (comments, reactions, city-based discussions) layered on top. The audience is hobbyist mapmakers (authoring), researchers (querying), and everyday utility users ("find me a cafe with outdoor seating") — **not** Nostr developers. The protocol is plumbing; the product is a map.

This project is the **overhaul** that comes after the applesauce migration: it untangles the orchestration debt accumulated under three overlapping mode systems, applies "classical utility without AI/Nostr" as a UX discipline, then layers in AI-driven map authoring as the demo moment.

## Core Value

**The maintainer (and any user) can open the app for fun, not duty.** UX coherence is the floor — every interaction does one explicit thing, nothing auto-promotes. Classical utility is the discipline — every flow works without engaging AI or Nostr. AI-driven authoring is the cherry — chat + toolbar + map work in unison to make "draw a hiking trail from Hallstatt to Dachstein" a thing that just works.

If we ship clean orchestration + classical utility but no AI demo, this project is still a success. If we ship a flashy AI demo on top of the current wonky foundation, this project failed.

## Current Milestone: v1.2 Geo Entity Model Split

**Goal:** Un-bloat the kind-37518 "context" by splitting it into role-specific geo entity kinds — each with full create/edit/comment/react/attach authoring UI — so the schema expresses curated articles, community-attach groups, live position, and time-bound observations as distinct first-class entities instead of one overloaded discriminated union.

**The defect being fixed:** kind 37518 varies along two orthogonal axes at once — *reference direction* (curate-pull vs attach-push) and *governance* (open→schema→closed). Splitting along reference direction (the axis that changes the create flow and default UI) is the clean cut; governance stays a policy object inside the attach-style Group.

**Target entity model (spec v2):**
- **Dataset** (37515, unchanged) — geometry + properties atom.
- **Story / Article** (new, ~37520) — pull/curate, **closed**: Markdown narrative with inline `naddr` references mirrored to `a`, comment/react/propose-edit (reuses kind 37519 proposals). The "Roman ruins in Austria" essay.
- **Group / Topic** (37518, slimmed to one kind) — push/attach: datasets attach via `c`; governance **ladder open · schema · closed**; optional narrative + pinned "canonical" refs. Absorbs "best surfing beaches" (open) and "hiking trails" (schema-enforced: client validates `geometryConstraints` + JSON Schema on create, filters invalid on fetch).
- **Live Beacon** (new, ~37521) — real-time, shareable/public updating position point.
- **Temporal Sighting** (new) — NIP-52-flavored time-bound observation (the "soccer star spotted at hotel" case).

**Cross-cutting taxonomy:** NIP-32 `L`/`l` (controlled, schema-enforceable) + `t` (freeform discovery) + `c` (entity-backed attach). Principled split removes the `t`/taxonomy overlap.

**Scope decisions:**
- **Full v2** — spec + all event classes + full authoring UI for every kind, in one milestone.
- **Clean break** — existing 37518 data is seed/test only; redefine the kinds freely, no migration or back-compat.
- **Deferred to a later milestone:** NIP-72 human moderation/approval + role lists (spam handled by web-of-trust + muting); Saved Map/Scene; Collection-as-list; compound routing; and the carried-over v1.0 UX-orchestration debt (Pillar 1/2/3 below).
- **Open for phase-level research:** Beacon lifecycle (replaceable vs ephemeral) + visibility model; Sighting representation (dedicated kind vs property + NIP-40 expiry).

## Last Shipped: v1.1 AI Chat — Data Ingest, Transform & Safe Authoring (2026-06-23)

**Shipped:** Expanded the AI chat from a map-drawing assistant into a data-ingest-and-transformation workbench — upload and parse real-world files, run sandboxed code that drives the map programmatically, give the AI more authoring tools, and let it safely edit datasets it is explicitly bound to — broadening Earthly's audience to analysts, curators, and power users. All 29 v1.1 requirements delivered across 7 phases / 33 plans. Full record: [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md), [`MILESTONES.md`](MILESTONES.md).

**Delivered (all ✓ — see Validated below for requirement-level detail):**
- ✓ Encrypted settings persistence — provider config, API keys, LM Studio/Ollama addresses encrypted-to-self, surviving reloads incl. NIP-46 signers, with export/import recovery hatch.
- ✓ Tool Registry & Authoring API — one typed tool-dispatch seam + one map-mutation seam (`createAuthoring`); parametric circle/buffer; live MCP tool sync.
- ✓ File ingest & multimodal — off-thread CSV/Excel/JSON/GeoJSON/images/text parse; handle-keyed model-privacy seam; vision-capability detection ladder.
- ✓ Code interpreter (client sandbox) — AI authors & runs JS in a QuickJS-WASM-in-Worker sandbox whose only host surface is the Authoring API; timeouts, output caps, error-feedback self-correction.
- ✓ AI-oriented editor tools — parametric shapes, batch attribute edit, select/dedup, geometry validation.
- ✓ Data-driven styling — color/stroke/width by attribute as a rule, round-tripping through kind 37515.
- ✓ Dataset-aware safe editing — visible binding chip, add/modify/delete intent, diff/preview, configurable safety level (1/2/3), dataset-level snapshot/undo.
- ✓ Geometry optimization — off-thread simplify + merge-to-multi + microgap stitch toward a byte budget, clearing the publish/relay size limit.

**Next milestone:** not yet scoped — run `/gsd-new-milestone`. The carried-over v1.0 UX-orchestration debt (Pillar 1/2/3 below) remains the most likely focus. Nostr-scrolls / WASM (NIP-5C) authoring/persist/share is deferred and builds naturally on the now-shipped code interpreter.

**Representative user stories:**
1. A logging team lead feeds an ugly CSV (names, coordinates, image links); after a chat interaction the result is a dataset/collection with an ideal cutting route.
2. A news curator pastes a Telegram message ("soccer star spotted at hotel XYZ in Lyon"); the AI geolocates the observation and adds a titled, described feature to the topic's context.
3. A pilot computes an ideal Austria→Bosnia flight path that weighs distance against exorbitant overfly fees (crossing Slovenia may be shorter but costlier).
4. A curator cleans up a convoluted context: fill missing descriptions, translate Arabic names, recolor ports/airports/waterways distinctly — with the AI precisely aware of which dataset it edits and what already exists, and the user able to see that awareness.
5. A hiking enthusiast imports a 12MB messy "West Pacific Trail" GeoJSON (hundreds of polylines, microgaps, superfluous vertices); the AI applies simplify + merge-to-multi to reduce it to ~900KB at the same visual quality, clearing the city dialog's size-limit complaints.

## Requirements

### Validated

<!-- Shipped and proven valuable. Inferred from the codebase as of 2026-05-24. -->

**Nostr event surface (applesauce-based):**
- ✓ Kind 37515 — publish, edit, load GeoJSON datasets — existing
- ✓ Kind 37516 — collections of datasets — existing
- ✓ Kind 37517 — threaded comments on datasets — existing
- ✓ Kind 37518 — map context events (read-side) — existing
- ✓ Kind 37519 — edit proposal machinery — existing
- ✓ Factory + Cast pattern for all Nostr reads/writes — existing
- ✓ Applesauce migration (EventStore + RelayPool + AccountManager) — existing

**Editor engine:**
- ✓ MapLibre-based GeoEditor with drawing modes (point, linestring, polygon) — existing
- ✓ Selection, snapping, undo/redo, transforms — existing
- ✓ Layer/rendering managers — existing
- ✓ Blossom blob upload for datasets that exceed relay limits — existing

**UI surface:**
- ✓ Toolbar with drawing controls and publish actions — existing
- ✓ AppSidebar with dataset, context, social, settings panels — existing (architecturally tangled — see Active)
- ✓ Comments + reactions (kind 37517 + NIP-25) — existing
- ✓ Shoutbox (city-based discussions) — existing
- ✓ TipTap rich text editor with mentions + media — existing
- ✓ Workspace + draft persistence — existing
- ✓ Onboarding tour manager — existing

**AI / chat:**
- ✓ Chat panel with streaming + tool execution + wallet/payment — existing (monolithic — see Active)
- ✓ ContextVM MCP geo server client (search, geocoding) — existing
- ✓ Author-by-chat plumbing exists (chat → tool calls) — partially shipped, not yet a coherent demo

**Backend:**
- ✓ Go relay (Khatru) with SQLite event storage + Bluge full-text search — existing
- ✓ Bun.serve() HTTP/WebSocket server — existing
- ✓ Mapnolia integration for PMTiles chunking (server-side complete, client consumption partial) — existing

**AI Chat workbench (v1.1, shipped 2026-06-23):**
- ✓ Encrypted settings persistence (SET-01/02/03) — encrypt-to-self provider config + keys, NIP-46-safe async load, export/import recovery hatch
- ✓ Typed tool registry + single Authoring API mutation seam (INFRA-01/02/03) — `createAuthoring`, hard error on unknown tool, live MCP tool sync
- ✓ Parametric shape primitives — circle/buffer as API methods + AI tools (TOOLS-01)
- ✓ File ingest & multimodal (INGEST-01..07) — off-thread CSV/Excel/JSON/GeoJSON/text/image parse, handle-keyed "model never sees raw rows" privacy seam, vision-capability detection ladder, place/geocode tools, file-chip + vision-gate UI
- ✓ Code-interpreter sandbox (CODE-01..06) — QuickJS-WASM-in-Worker confined to the Authoring API, secret-denial proven, timeout + output caps + circuit breaker, error-feedback self-correction, collapsible code+output display
- ✓ AI bulk transform tools (TOOLS-02/03/04) — batch attribute edit, select-by-attribute + dedup, geometry/topology validation
- ✓ Dataset-aware safe-editing gate (SAFE-01..06) — visible binding chip, add/modify/delete classification, diff/preview, configurable safety levels (1/2/3, persisted), dataset-level snapshot/undo, host-side fix-all over full id-keyed dataset
- ✓ Data-driven styling (STYLE-01/02) — attribute-rule color/stroke/width, round-trips through kind 37515
- ✓ Geometry optimization (GEO-01/02/03) — off-thread simplify + merge-to-multi + microgap stitch toward a byte budget with before/after metrics, clears the publish size limit

**UX orchestration (v1.0 cleanup, shipped 2026-06 outside the GSD framework):**
- ✓ Map Shelf / Map Stack — working-set strip listing datasets/contexts with chip actions (isolate, pin, inspect, zoom, load-to-editor, remove, clear) — `MapStackPanel.tsx` + `mapStackSlice.ts`
- ✓ Path-based routing — one-way URL→state with legacy hash-redirect shim for backwards compat — `useRouting.ts`
- ✓ Catalog (Pinned/Recent) — `catalogSlice.ts` with persistence
- ◐ Stance enum (`browse|focus|author`) — slice created and integrated, but old `viewMode`/`splitWithEditor`/`activeEntity`/`editIsolationEnabled` system still coexists (state-collapse incomplete)
- ◐ Chat workspace binding — `bindActiveWorkspaceChat()` binds silently; visible binding chip not yet surfaced (folded into v1.1 below)

### Active

<!-- The active milestone is **v1.1 AI Chat** — detailed, scoped requirements live in REQUIREMENTS.md.
     The Pillar items below are carried-over v1.0 UX debt: some shipped (now in Validated), the rest
     remain real but are not the focus of v1.1 unless a story needs them (e.g. the chat binding chip). -->

**Pillar 1 — Wonky-fix (carried over; partially shipped):**

- [ ] **State collapse**: Replace `viewMode` + `editIsolationEnabled` + `splitWithEditor` + `activeEntity`/`entityIntent` with a single `stance: 'browse' | 'focus' | 'author'` enum. Per `UX_REWRITE.md` §2 + §8.
- [ ] **Delete implicit mode promotions**: Six named auto-transitions (per `UX_REWRITE.md` §8) become explicit user actions. No more "load dataset → setViewMode('edit')."
- ✓ **Map Shelf**: Shipped — see Validated (`MapStackPanel`). Per `UX_REWRITE.md` §3.
- [ ] **Sidebar rework**: Catalog (Pinned → Recent) shipped; split-panel/dual-intent removal still pending. Per `UX_REWRITE.md` §4.
- ✓ **Path-based routing**: Shipped — see Validated (`useRouting`). Per `UX_REWRITE.md` §9.
- [ ] **Chat detach + binding chip**: Detach/dock + silent workspace binding shipped; the **visible binding chip** is now pulled into v1.1 AI Chat (dataset-aware safe editing needs it). Per `UX_REWRITE.md` §6.
- [ ] **Explicit verbs**: Open, Pin, Inspect, New, Fork, Propose Edit, Curate, Share, Save as workspace. Per `UX_REWRITE.md` §7.
- [ ] **Fix specific structural bugs** surfaced in the codebase map: form-doubling (Create context rendering in two panels), dead `isDrawingMode` state, unreachable `_setMapError`, AppSidebar's secondary mode system.
- [ ] **Reduce info density problems**: Sidebar overload, mobile chrome eating the map, shelf collapse on small screens.
- [ ] **Tame component-internal jank**: Within-component bugs that aren't orchestration issues (keyboard nav, focus management, transitions).

**Pillar 2 — Classical utility as discipline (applied during Pillar 1):**

- [ ] **Every flow has a non-AI/non-Nostr path**: Anonymous user can find, browse, filter, and inspect datasets without engaging the chat or revealing protocol details.
- [ ] **"Visible but ignorable"**: Chat panel, identity surface, and Nostr-flavored UI elements remain present but never block core flows. Chat is detachable/collapsible.
- [ ] **Nostr lingo (kinds, relays, pubkeys) does not surface in classical paths**: When users authenticate or publish, plain language replaces protocol terms.
- [ ] **Sidebar list pagination is unbounded** (20-item ceiling removed per `UX_REWRITE.md` §4).

**Pillar 3 — Demo lands (author by chat, end-to-end):**

- [ ] **Author-by-chat round-trip works**: User asks chat to draw something ("a hiking trail from X to Y through Z"), chat invokes toolbar drawing API, geometry appears on map, user accepts and publishes (kind 37515).
- [ ] **Toolbar drawing API**: Clean interface designed as if it were a future package export. No internal map-state coupling. Callable by chat tool execution and by direct UI in equivalent ways.
- [ ] **Chat tool surface for map awareness**: Chat can read what's currently on the map (analyze: "what's in this bbox?", "what's the densest cluster?").
- [ ] **Chat tool surface for utility / POI queries**: Chat answers "find me a cafe with outdoor seating nearby" via MCP / external POI data. Single-query, not compound routing.
- [ ] **60-second demo runs end-to-end without manual intervention**: A scripted demo (author by chat → publish) is reliable enough to show on camera.

### Out of Scope

<!-- Boundaries with reasoning. -->

- **Mapnolia consumer extraction** — Defer to v2. Easier to choose the right library abstraction after the UX foundation is stable. Keep using the existing partial client consumption.
- **Nostr-scrolls / WASM execution** — Demo aspirational. Not v1.
- **Compound routing scenarios** — The "parliament → museum → cafe with outdoor seating → ice cream → eat in a park" scenario is genuinely cool but compounds routing + POI filter + preference modeling + detour-cost. v2.
- **Toolbar / chat / map package split** — Defer extraction. Design the toolbar's drawing API *as if* it were a package boundary (clean interface, no map-state leakage), but ship in one repo. Revisit packaging when surfaces are stable.
- **Visual / typographic design system overhaul** — Three of four UI gripes selected were structural; visual polish was explicitly *not* selected. This project is about coherence and density, not aesthetics. Radix + Tailwind v4 primitives stay.
- **Multi-item shelf URLs** (`/shelf?i=…`) — Per `UX_REWRITE.md` §9. Defer until single-chip sharing proves needed.
- **OG previews for shared links** — Needs server-side rendering. Separate effort.
- **Comments side-rail / shelf badge** — Per `UX_REWRITE.md` §9. Comments stay in current inspector location.
- **"Curate from Nostr corpus" as a primary AI use case** — Data-starved. The Nostr corpus is not dense enough for "find Roman ruins in Carinthia" to return interesting results today. Keep the plumbing; don't demo it.
- **Rewriting stable components in isolation** — This was the failure mode of the previous attempt. List components, panel shells, form components are fine in isolation. Amend orchestration; don't reimplement leaves.
- **Seed-script migration off NDK** — NDK compat shim works; this is separate cleanup tracked in `.planning/codebase/CONCERNS.md`.
- **Two-tier UI (casual mode vs power mode)** — Considered and rejected. "Visible but ignorable" is the chosen path. Don't fork the UI.

## Context

- **v1.1 AI Chat shipped 2026-06-23** (7 phases, 33 plans, 64 tasks). New runtime surface: a QuickJS-WASM-in-Worker code sandbox, off-thread ingest workers (papaparse + exceljs), turf-based geometry primitives/optimization, and the repo's first `bun:test` suite (grown alongside the milestone). Provider settings are now encrypted-to-self in localStorage. Two debug sessions and a Phase 06 verification flag remain open for live in-browser human confirmation only (see STATE.md → Deferred Items); the implementations carry regression tests.
- **Established app, not greenfield**. Earthly has been running. The codebase is mapped in `.planning/codebase/` (refreshed 2026-05-24). Validated requirements above were inferred from that map.
- **Applesauce migration is done** for the main app. Seed scripts still import NDK through a compat shim — tracked separately, not in this project.
- **`UX_REWRITE.md` (repo root)** is the locked design spec for the orchestration cleanup. Design locked on 2026-05-08. It is the binding spec for Pillar 1.
- **Previous UX rewrite attempt failed** because the executing agent reimplemented stable components (lists, panels) instead of amending orchestration. The current branch (`feature/new-ux-applesauce`) carries some of that work; we will salvage selectively.
- **The maintainer cannot dogfood the app right now** because the UX is too confusing to be enjoyable. This is the lever for prioritizing Pillar 1 above Pillar 3.
- **Architectural fork in the future**: toolbar, chat, and map will eventually have package boundaries (potentially three packages, potentially one). That decision is deferred until v1 stabilizes the surfaces.
- **External integrations**: ContextVM MCP for geo services (search, geocoding); mapnolia for PMTiles + Blossom blob storage; OSM/Overpass-style POI data via MCP is implied for the "cafe" use case.

## Constraints

- **Tech stack**: Bun (not Node.js), React 19, TypeScript strict, MapLibre GL 5, Tailwind v4, Radix UI, applesauce-core. Go (Khatru) for the relay. No changes to this stack in this project.
- **Approach — Amend, don't replace**: Components in isolation (list rows, panel shells, form primitives, the GeoEditor managers) are stable. Orchestration (state slices, view-mode promotion, sidebar's secondary mode system) is the disease. Touch orchestration; leave leaves alone unless they carry bugs.
- **Visual primitives stay**: Radix + Tailwind + shadcn conventions. No design system swap, no typography overhaul.
- **Compatibility — Share links**: Path-based routing must redirect existing hash routes once for backwards compat (per `UX_REWRITE.md` §9).
- **People**: Solo maintainer + AI agents. Review velocity is the bottleneck; prefer fewer larger explicit decisions to many small ambiguous ones.
- **API discipline — Toolbar drawing**: Must be designed as if it were a future package export. No internal coupling to the Zustand store reaching across the boundary. Chat tool execution and direct UI must call equivalent paths.
- **API discipline — Applesauce casting (v1.2)**: The new entity event classes (Story, slimmed Group, Beacon, Sighting) MUST follow the official applesauce casting patterns, not hand-rolled wrappers. Read views extend `EventCast` and are obtained via `castEvent()` / `castEventStream()` / `castTimelineStream()` (per-class instance sync, `$`-suffixed reactive props consumed with `use$`); parameterized-replaceable reads go through `eventStore.replaceable(addressPointer)`; writes use `EventFactory` blueprints. Reference: https://applesauce.build/apps/casting/events.html. Mirror the existing `src/lib/nostr/` `{helpers,cast,factory}` modules and the `Article`/`Stream`/`CodeSnippet` cast examples. Binding for Phase 8 scaffolding.
- **Classical-utility floor**: For every Active requirement, ask "does this still work if AI and Nostr UI are hidden?" If no, the requirement is wrong.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Amend, don't replace** | Previous rewrite failed by reimplementing stable components. Components in isolation are fine; orchestration is the disease. | — Pending |
| **Classical utility is a discipline, not a phase** | If shipped as a separate phase, coupling re-enters during Pillar 1. Apply as a constraint across all work instead. | — Pending |
| **AI is a power layer ("visible but ignorable"), not the interface** | Every flow has a non-AI/non-Nostr path. Chat is detachable, ignorable. | — Pending |
| **Pillar order: Wonky-fix → Classical-utility-as-discipline → Demo** | Maintainer can't dogfood the current app. Foundation must come first. AI demo on a broken app is worse than no demo. | — Pending |
| **Defer toolbar/chat/map packaging** | Package boundaries follow stable surfaces. v1 changes those surfaces. Design API cleanly; don't extract. | — Pending |
| **Defer mapnolia consumer extraction** | Same logic. Stabilize first, choose abstractions after. | — Pending |
| **No design system overhaul** | "Visual polish" was explicitly *not* selected as a UI gripe. Stay focused on structure, density, and component-jank. | — Pending |
| **Demo target: "author by chat"** | The single 60-second wow moment. Compound scenarios are v2. | — Pending |
| **Maintainer-dogfood as success signal** | "I open the app for fun" is the lived test alongside automated/UAT checks. | — Pending |
| **"Curate from Nostr corpus" deprioritized** | Data-starved. Keep plumbing; don't demo it. | — Pending |
| **v1.1 — Code interpreter runs client-side with map-API access** | Generated JS executes in a browser Web Worker/iframe sandbox and can drive a clean toolbar/drawing API. Most powerful path for programmatic authoring; demands sandbox isolation + a clean exposed API. | ✓ Good — Phase 4: QuickJS-WASM-in-Worker confined to the Authoring API; confinement + timeout-kill proven under test |
| **v1.1 — Edit safety is a user config, default "confirm destructive only"** | Hardcoding one safety model frustrates someone. Config: 1 preview+confirm / 2 confirm-destructive (default) / 3 trust+undo. | ✓ Good — Phase 5: safety level 1/2/3 persisted in the encrypt-to-self envelope, gates every AI mutation |
| **v1.1 — File ingest = parse-everything + capability-gated vision** | Always extract maximum structured info from any file; route images to vision only when the model advertises it, else disable the image affordance. | ✓ Good — Phase 3: off-thread parse for all types + fail-safe vision-detection ladder gating both image paths |
| **v1.1 — Nostr-scrolls / WASM deferred** | NIP-5C authoring/persist/share builds on the code interpreter; sequence it after the sandbox lands. | ✓ Held — deferred to next milestone; sandbox now shipped so the prerequisite exists |
| **v1.1 — Chat must be explicitly bound to its edit target, visibly** | The AI editing a dataset is destructive; the user must see what it is working on and add-vs-modify-vs-delete intent. Completes the carried-over binding-chip work. | ✓ Good — Phase 5: always-visible binding chip + add/modify/delete diff classification shipped |
| **v1.1 — Single Authoring API is the only geometry-mutation seam** | One typed mutation seam (`createAuthoring`) for direct UI, chat tools, and sandboxed code; nothing reaches across into the Zustand store. Enables the safe-editing gate to have one choke point. | ✓ Good — Phase 2: INFRA-02 seam; A3 boundary scan enforces all four write verbs route through it from the AI trust boundary |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-23 — started milestone v1.2 Geo Entity Model Split: split the bloated kind-37518 context into role-specific geo entity kinds (Story/Article, slimmed Group, Live Beacon, Temporal Sighting), adopt NIP-32 `L`/`l` taxonomy, schema-only group governance, clean break on existing 37518 data, full authoring UI. NIP-72 moderation + WoT/mute deferred. Previous: v1.1 AI Chat archived in `.planning/milestones/v1.1-*`.*
