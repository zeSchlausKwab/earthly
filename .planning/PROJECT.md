# Earthly

## What This Is

Earthly is a Nostr-based collaborative mapping application. Users publish, discover, and edit GeoJSON datasets over a decentralized relay network, with social features (comments, reactions, city-based discussions) layered on top. The audience is hobbyist mapmakers (authoring), researchers (querying), and everyday utility users ("find me a cafe with outdoor seating") — **not** Nostr developers. The protocol is plumbing; the product is a map.

This project is the **overhaul** that comes after the applesauce migration: it untangles the orchestration debt accumulated under three overlapping mode systems, applies "classical utility without AI/Nostr" as a UX discipline, then layers in AI-driven map authoring as the demo moment.

## Core Value

**The maintainer (and any user) can open the app for fun, not duty.** UX coherence is the floor — every interaction does one explicit thing, nothing auto-promotes. Classical utility is the discipline — every flow works without engaging AI or Nostr. AI-driven authoring is the cherry — chat + toolbar + map work in unison to make "draw a hiking trail from Hallstatt to Dachstein" a thing that just works.

If we ship clean orchestration + classical utility but no AI demo, this project is still a success. If we ship a flashy AI demo on top of the current wonky foundation, this project failed.

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

### Active

<!-- v1 scope. Hypotheses until shipped and validated. -->

**Pillar 1 — Wonky-fix (the prerequisite for everything):**

- [ ] **State collapse**: Replace `viewMode` + `editIsolationEnabled` + `splitWithEditor` + `activeEntity`/`entityIntent` with a single `stance: 'browse' | 'focus' | 'author'` enum. Per `UX_REWRITE.md` §2 + §8.
- [ ] **Delete implicit mode promotions**: Six named auto-transitions (per `UX_REWRITE.md` §8) become explicit user actions. No more "load dataset → setViewMode('edit')."
- [ ] **Map Shelf**: Top strip above the map listing every dataset/context in the working set. Chip actions: toggle visibility, isolate, inspect, share, remove. Per `UX_REWRITE.md` §3.
- [ ] **Sidebar rework**: Single navigator role — no split panels, no inline edit/inspect dual-intent. Pinned → Recent → Search/Discover. Inspect replaces list in-place. Per `UX_REWRITE.md` §4.
- [ ] **Path-based routing**: One-way URL → state. Hash redirect shim for backwards compat. Per `UX_REWRITE.md` §9.
- [ ] **Chat detach + binding chip**: ChatPanel becomes detachable/dockable. Explicit binding chip at the top shows what the chat is bound to. Implicit `activeContextScope` binding deleted. Per `UX_REWRITE.md` §6.
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
*Last updated: 2026-05-26 after initialization*
