# Feature Research

**Domain:** AI-augmented collaborative map editor (chat + toolbar + map in unison), layered on top of an existing Nostr GeoJSON publishing platform
**Researched:** 2026-05-26
**Confidence:** HIGH for the AI-mapping landscape (multiple confirmed sources for every major claim); MEDIUM for "what specifically works inside Earthly" (the answer "what would land here" is partly opinion shaped by the codebase).

## Orientation

In 2026 the AI-mapping space has split into four distinct lanes — each with its own table-stakes-vs-differentiator profile. Earthly's Pillar 3 demo touches three of them; Pillar 1/2 set the floor for all four.

| Lane | Canonical players | Earthly-relevant? |
|---|---|---|
| **A. Author-by-chat (geometry generation)** | Mapbox MCP DevKit (generates GeoJSON), MapStory (LLM agents produce editable animation scenes), GeoGPT/QGISGPT (natural-language → GIS operations), Felt AI extensions (NL → custom app code) | YES — this is the demo. |
| **B. Analyze-the-map (read what's there)** | IMAIA quadkey grid grounding, Felt AI SQL queries ("find stores within 5mi of competitors"), ArcGIS Arcade assistant | YES — Pillar 3 secondary goal. |
| **C. POI / utility query ("find me X")** | Google Maps "Ask Maps" (Gemini, multi-step contextual queries), Mapbox MapGPT (in-vehicle voice/text), ChatGPT Atlas (browser + map results), OSM-AI-Map (NL → Overpass QL) | YES — the "find me a cafe" use case, single-query non-compound. |
| **D. Compound routing / itinerary** | Google Maps Ask Maps multi-stop ("Grand Canyon + Horseshoe Bend + stops along the way"), TrailGPT, MapMagic | **NO — explicitly out of scope per PROJECT.md.** |

Critical context for Earthly: nobody mainstream is currently shipping "AI-authored geometry that you accept/reject and then **publish to a decentralized social network**." Felt publishes to its own SaaS, Mapbox MCP DevKit publishes to a Mapbox style, ArcGIS publishes to ArcGIS Online. The combination of "AI authoring + open social publishing surface" is the white space.

## Feature Landscape

### Table Stakes (Users Expect These)

If these are missing the demo flops or the everyday-utility user bounces. Most are **classical** (work without AI/Nostr) — that's the discipline check.

| Feature | Why Expected | Complexity | Pillar | Already in Earthly? | Notes |
|---|---|---|---|---|---|
| **Persistent search bar / address geocoder** | Every map app from Google Maps to Felt opens with "search a place." Without it the empty-shelf landing feels broken. | LOW | 2 (classical) | Partial — `MobileSearch`, ContextVM `SearchLocation`, but not a first-class always-visible affordance | Classical path: typed address → geocoder → map jumps to bbox. No chat needed. |
| **"Search nearby" / POI query (single-hop)** | Google Maps Ask Maps, Mapbox MapGPT, Atlas all answer "find me X near here" as a baseline. Doesn't have to be conversational, but has to exist. | MEDIUM | 2/3 | Partial — ContextVM MCP `SearchLocation`, no UI surface | Classical path: form with category + radius. AI path: chat "cafes with outdoor seating." Both call the same MCP tool. |
| **Drawing tools (point / line / polygon)** | Any user touching a map authoring tool expects to draw shapes by hand. Touch GIS, Felt, Mapbox Studio all ship this. | LOW | 1 (already shipped) | ✅ Existing | Already in `core/managers/`. The toolbar exposes these. |
| **Save / draft / publish workflow with explicit states** | Felt's Drafts → Projects, Sanity-style drafts model, "auto-save then publish on action" is universal. Hidden persistence (current Earthly state) feels broken. | LOW | 1 (Workspaces surfacing) | Partial — `draftSlice`/`workspaceSlice` exist but unsurfaced | Per `UX_REWRITE.md` §5: "Save as workspace" on shelf, "Resume" in Browse landing. |
| **Shareable URL = map state** | Every modern map (Google, Felt, Mapbox, Mappedin) treats URL as canonical. Hash-only routes feel pre-2015. | MEDIUM | 1 | Partial — hash routes exist; `UX_REWRITE.md` §9 mandates path-based | `/c/<naddr>`, `/d/<naddr>`, optional `?v=lng,lat,zoom`. One-way URL → state. |
| **Layer / visibility toggle for what's on the map** | Felt's layers panel, ArcGIS contents pane, MapStack-equivalent. Without it users can't reason about what they're seeing. | LOW | 1 | ✅ Existing (`MapStackPanel`) + new Map Shelf per `UX_REWRITE.md` §3 | Map Shelf consolidates this into a top-strip chip view. |
| **"What is this?" inspect on click** | Felt popups, Google Maps place cards, Mapbox feature popups. The map must be tappable. | LOW | 1 | ✅ Existing (`FeaturePopup`, `LocationInspectorPopup`) | Keep but route through explicit Inspect verb (no auto-stance-change). |
| **Undo / redo for any editing action** | Cursor's edit history, Felt's history, every editor since Word. AI-generated geometry without undo is unacceptable. | LOW | 1 | ✅ Existing (`HistoryManager`) | Critical: AI-generated geometry must enter the same undo stack as hand-drawn. |
| **Visible "AI is thinking" feedback** | Cursor inline diff stream, Claude/ChatGPT streaming tokens, Mapbox MapGPT spinner. Silent AI feels broken. | LOW | 3 | Partial — chat panel streams; toolbar/map doesn't show "AI is drawing now" | Streaming feedback during tool execution is non-negotiable for the demo. |
| **Accept / Reject for AI-generated content** | Cursor's per-chunk accept/reject, Notion AI's accept/discard, Felt AI's "Save" on generated SQL/popups, Bezi's reviewable diffs. The Shape of AI catalogues this as a core pattern. | MEDIUM | 3 | Missing — no AI-suggestion-state in the editor | See "Accept-reject staging" differentiator below. The simplest table-stakes form is "preview then one button to commit." |
| **Chat panel is dismissible/collapsible** | Cursor toggles AI sidebar with Cmd-L, Windows Copilot docks-but-collapses, ChatGPT Atlas sidebar hides. Users hate panels that won't go away. | LOW | 1/2 | Partial — exists but tangled to context scope | `UX_REWRITE.md` §6: detachable, dockable, with binding chip. |
| **Empty state guidance / landing prompt** | Google Maps' "Recent places," Felt's "Recent maps," Atlas's "Ask anything." A blank app on first open is hostile. | LOW | 1 | Missing | `UX_REWRITE.md` §10 net-new: Browse landing prompt (pick city / open last workspace / browse popular). |
| **Mobile-usable map without chrome overload** | Every map app since 2020. Earthly's current chrome eats the map on small screens (per PROJECT.md Active). | MEDIUM | 1 | Partial — `MobilePanel`, `MobileSearch` exist; chrome density acknowledged as problem | Shelf collapses to one-chip-with-count sheet on mobile (`UX_REWRITE.md` §3). |
| **Login is optional for read** | Every modern map. Atlas works without OpenAI login for some queries. Felt allows public-link viewing without account. | LOW | 2 | ✅ Existing — anonymous read works | Reinforce in UI: Nostr lingo (pubkey, NIP-07) does not surface for anonymous browsing. |
| **Plain-language labels for protocol concepts** | Felt never says "vector tile MVT schema" to a casual user. Google never says "Place ID." | LOW | 2 | Missing — "kind 37515," "naddr," "relay" leak | Per PROJECT.md Active: "plain language replaces protocol terms" in classical paths. |

### Differentiators (Competitive Advantage)

Where Earthly competes. These are the features that make people pick Earthly over Felt or Google "My Maps."

| Feature | Value Proposition | Complexity | Pillar | Notes |
|---|---|---|---|---|
| **Map Shelf (working set above the map)** | Decoupling "what's selected in the sidebar" from "what's on the map" is rare. Felt has layers but they're rigidly tied to the map document. Earthly's Shelf treats every visible dataset as a peer chip with isolate/visibility/inspect/share/remove. | MEDIUM | 1 | Per `UX_REWRITE.md` §3. The shelf survives stance transitions, carries through into Author, and is the basis for share URLs. **This is the most distinctive UX bet in the rewrite.** |
| **Single-stance enum + explicit verbs** | Most editors leak mode confusion (Figma's design-vs-prototype mode confusion is a textbook example). Earthly's `stance: browse \| focus \| author` with one button per transition — every action does one explicit thing — is a clarity bet. | HIGH | 1 | Per `UX_REWRITE.md` §2 + §8. Hardest engineering work; biggest user-perceived win when shipped. |
| **Chat binding chip (explicit context for AI)** | Most chat-in-map products bind implicitly (Felt AI auto-uses the open map, MapGPT uses current location). Earthly shows what the chat is bound to — current shelf, single chip, selection, or no binding — and lets the user change it. | MEDIUM | 1/3 | Per `UX_REWRITE.md` §6. Resolves "why did the AI talk about the wrong dataset" confusion. Differentiator against Mapbox/Felt opaque scope. |
| **Toolbar drawing API callable from chat AND direct UI on equivalent paths** | Most "AI draws on a map" products (Mapbox MCP DevKit, MapStory) generate JSON the user then *imports*. Earthly's chat invokes the **same** drawing function a button click invokes. Geometry appears in the **same** unsaved-edits state. | HIGH | 3 | Per PROJECT.md Constraints. "Designed as if it were a future package export." This is the structural bet that makes accept-reject natural — the AI is just another user of the drawing API. |
| **Accept-reject staging for AI-generated geometry** | Cursor's per-chunk diff is the gold standard for code. No mapping tool has a strong equivalent — Felt AI's workflow is "generate code, click Save." Earthly can ship: AI-drawn features land in an **unconfirmed layer** (visual distinction — dashed stroke, "AI" badge), user accepts per-feature or all-at-once before they enter the publishable draft. | HIGH | 3 | Closest analog: Cursor's red/green inline diff. Mapping equivalent must be visual (ghost stroke / different color) since geometry is the artifact, not text. **Without this, AI authoring feels reckless.** |
| **Classical-utility floor for every AI feature** | "Find a cafe with outdoor seating" via chat → MCP. Same query reachable via a non-AI search form with category + radius. The chat is a power layer, not the only path. Felt's AI features are Enterprise-only; Mapbox MapGPT is automotive-only. Earthly's universal availability + non-AI fallback is differentiator + risk mitigation. | MEDIUM | 2 | Per PROJECT.md Constraints — classical-utility-as-discipline. Every AI feature ships its non-AI twin. |
| **Author-by-chat round-trip in one workflow** | "Draw a hiking trail from Hallstatt to Dachstein" → chat invokes drawing tools → geometry appears as AI-pending → user accepts → publish. End-to-end in 60 seconds. Mapbox MCP DevKit stops at "here's the GeoJSON." Felt AI doesn't draw geometry at all. ChatGPT Atlas shows map results but doesn't author. | HIGH | 3 | The signature demo. Reliability is the hard part — the demo must be 60-second-reliable, not "works 4/10 times." |
| **Decentralized publish target** | The output of authoring is a Nostr kind 37515 event — federated, social, no-vendor-lock. Felt locks to Felt SaaS. Mapbox MCP DevKit locks to Mapbox styles. Google My Maps locks to Google. Earthly is the open one. | LOW (already exists) | 2 (classical visibility) | Plumbing exists. The differentiator is realizing it without leaking the protocol — "Publish" not "Sign and publish kind 37515 event to relays." |
| **Inspect-in-place (no layout mutation)** | Per `UX_REWRITE.md` §4: clicking Inspect on a sidebar row replaces the list with detail **in the same panel**, with a Back affordance. Most apps push a new modal or shift layout. The in-place inspect is calmer. | MEDIUM | 1 | Implementation: panel state machine inside the existing sidebar shell. |
| **Workspace = shelf + draft + chat as a resumable bundle** | Save current shelf + active draft + chat session as a named workspace. Felt has Workspaces (Felt 20 introduced this) but they're org-level (collaboration boundary). Earthly's workspace is a personal session bookmark. | MEDIUM | 1 | Per `UX_REWRITE.md` §5. Existing `workspaceSlice` — needs surfacing. |
| **Path-based share URL with optional view-state** | `/c/<naddr>` → recipient lands on bbox-fit. Optional `?v=lng,lat,zoom` for "include current view." Default off (recipient usually wants bbox-fit). Most map share dialogs include zoom by default and ruin the recipient's view. | LOW | 1 | Per `UX_REWRITE.md` §9. Smart default = differentiator. |
| **"AI is visible but ignorable"** | Two-tier UI (casual mode vs power mode) is explicitly rejected per PROJECT.md decisions. Instead one UI where chat is dismissible and never blocks the classical path. Mid-2026 most products fork (ChatGPT casual vs Atlas power). Earthly stays unified. | MEDIUM | 2 | Cross-cuts everything — design constraint, not a feature checkbox. |

### Anti-Features (Commonly Requested, Often Problematic)

These look tempting but conflict with Earthly's core value or known pitfalls.

| Feature | Why Requested | Why Problematic | Alternative |
|---|---|---|---|
| **Auto-mode promotion on dataset load** | "Open dataset → edit it" feels efficient. Felt does it (clicking a layer goes to edit). | The root cause of Earthly's current state mess (`UX_REWRITE.md` §1, §8). Six implicit transitions today; every one is a bug source. | Explicit verbs (Open, Inspect, Fork, New) — `UX_REWRITE.md` §7. User chooses the stance. |
| **AI "auto-publish" when it's confident** | "Draw and publish in one prompt!" sounds slick (some agentic browsers like Atlas go this direction for forms). | Publishing to Nostr is **permanent and signed**. AI shipping unconfirmed geometry to the relay is a reputational and integrity disaster. | Always require explicit user-acceptance + explicit Publish click. The accept-reject staging layer is the firewall. |
| **Compound routing demos ("museum → cafe → park")** | Cool. Google Maps Ask Maps does this. Users will ask for it. | Compounds routing + POI filter + preference modeling + detour-cost. v2 per PROJECT.md Out of Scope. | Defer. Ship single-query POI well. Demo a single deliberate scenario (hiking trail). |
| **Two-tier UI (casual mode vs power mode)** | "Beginners get a simple UI, experts get the full thing." Sounds user-friendly. | Explicitly rejected per PROJECT.md. Doubles maintenance, splits the product identity, and is what Atlas-vs-ChatGPT-classic devolved into. | "Visible but ignorable" — one UI, AI hideable. |
| **Re-implementing the editor in a chat-first UI** | "If the AI is good enough, who needs the toolbar?" Some 2026 demos go full chat-only. | The maintainer cannot dogfood a chat-only map app. Power users need direct manipulation. AI is fragile in 2026 — chat-only is non-functional when the LLM hiccups. | Toolbar stays primary. Chat is a peer surface, not a replacement. |
| **Real-time multi-user co-editing (Figma-style cursors)** | Hot 2026 feature. Felt has it. | Massive scope. Nostr doesn't natively support live cursor presence. PROJECT.md doesn't mention this. | Defer entirely. Edit proposals (kind 37519) are the async collaboration model. |
| **Chat in the sidebar (always docked, no detach)** | Default in ChatGPT Atlas, Cursor, Felt AI. | Earthly's screen real estate is map-primary. Sidebar-locked chat steals horizontal space and undermines "ignorable." | Detachable floating panel per `UX_REWRITE.md` §6. User picks dock or float. |
| **AI-curated Nostr corpus exploration as primary demo** | "Show me all medieval ruins published to Nostr." | Data-starved per PROJECT.md Out of Scope. The corpus isn't dense enough for results to be interesting. | Keep plumbing; don't demo. Focus the demo on authoring (where AI fills a real gap) not curation (where AI lacks data). |
| **AI explains every kind/tag/pubkey** | "The AI can teach users what Nostr is!" | Surfaces protocol details in classical paths — violates the floor. Felt doesn't make you learn about vector tile schemas. | Plain language always. Help/docs surface for the curious; chat never volunteers protocol jargon. |
| **Implicit chat scope ("activeContextScope")** | "Chat knows what you're looking at — magic!" Currently in Earthly. | The source of "why is the chat talking about the wrong dataset" confusion. Confirmed pattern problem per `UX_REWRITE.md` §6. | Explicit binding chip. User sees and can change what the chat is bound to. |
| **AI-generated map style / theme** | Mapbox MCP DevKit does this ("Halloween-themed map"). Cool demo. | Visual design system overhaul is explicitly out of scope per PROJECT.md. The visual primitives stay (Radix + Tailwind). | Defer. If pursued in v2, scope to per-dataset visualization, not app-wide theming. |
| **"AI fork" — AI proposes edits to someone else's dataset** | Natural extension once Propose Edit verb exists. | Conflates two hard problems: AI-authored edits + cross-author proposal review. The Propose Edit flow is already complex (kind 37519). | Ship human-authored proposals first (`UX_REWRITE.md` §7). AI-authored proposals are v2. |
| **Voice input for chat** | Mapbox MapGPT is voice-first. Atlas supports voice. | Not a v1 demo requirement. Adds STT/TTS infra. Mobile-first input pattern but desktop demo is the priority. | Defer. The 60-second demo is screen-recordable typing. |
| **Multi-item shelf URLs (`/shelf?i=a&i=b`)** | Natural for "share my working set." | Per `UX_REWRITE.md` §9, defer until single-chip sharing proves the need. | Single-chip URLs first. Multi-item URLs added when usage shows demand. |
| **AI confidence scores surfaced as numbers** | "82% confident this trail goes through Hallstatt." Seems transparent. | Numerical confidence is mostly fiction — LLMs don't know what they don't know. Erodes trust when wrong. | Show **the actual artifact** for review (ghost geometry). User judges from the visual, not from a fake confidence number. |

## Feature Dependencies

```
stance enum (1) [PILLAR 1]
  └─ required by ─> Map Shelf (1)
  └─ required by ─> Sidebar rework (1)
  └─ required by ─> Path-based routing (1)
  └─ required by ─> Chat binding chip (1)

Path-based routing (1) [PILLAR 1]
  └─ enables ─> Single-chip share URLs (1)
  └─ enables ─> Workspace deep links (1)

Map Shelf (1) [PILLAR 1]
  └─ required by ─> Chat default binding = current shelf (1/3)
  └─ required by ─> "Save as workspace" (1)
  └─ required by ─> Author against references (1)

Toolbar drawing API (3) [PILLAR 3]
  └─ required by ─> Author-by-chat round-trip (3)
  └─ required by ─> Accept-reject staging for AI geometry (3)
  └─ required by ─> Chat tool surface for drawing (3)

Accept-reject staging (3) [PILLAR 3]
  └─ required by ─> Demo reliability (3)
  └─ required by ─> "Visible but ignorable" for author stance (2/3)

Classical-utility POI search (2) [PILLAR 2]
  └─ enables ─> Chat POI query (3) — both call same MCP tool
  └─ requires ─> ContextVM MCP SearchLocation already shipped ✓

Empty state landing prompt (1) [PILLAR 1]
  └─ requires ─> Workspace persistence already shipped ✓
  └─ enhances ─> Anonymous-friendly Browse stance

Plain-language labels (2) [PILLAR 2]
  └─ requires nothing structural — a sweep across the existing UI
  └─ enhances ─> All classical flows
```

### Dependency Notes

- **stance → everything in Pillar 1**: The enum collapse is the prerequisite for Map Shelf, sidebar rework, routing, and chat binding. Cannot ship any of those without it. This is why `UX_REWRITE.md` §11 puts stance collapse as Phase 1.
- **Toolbar drawing API → AI authoring**: The API is the seam between chat and map. If chat calls a Zustand action directly, the package boundary leaks; the demo accidentally couples to the store; v2 packaging becomes harder. Design the API now even though packaging is deferred.
- **Accept-reject staging → demo safety**: Without staging, AI-generated geometry can land directly in the publishable draft. One hallucinated polygon published to the relay is reputational damage. Staging is a firewall, not a nicety.
- **Classical POI search and chat POI query share an MCP tool**: They are not redundant — the chat path adds query parsing ("cafes with outdoor seating that allow dogs"), the classical path is fast and deterministic. Both reach the same `SearchLocation`/`ReverseLookup` MCP.
- **Chat detach has no Pillar 3 dependency**: Can ship in Pillar 1 with binding-chip-bound-to-shelf as default. AI-tool-execution features land later without needing UI rework.
- **Path-based routing must ship before shelf URLs**: Otherwise the URLs the share dialog produces aren't shareable in the new scheme. Phases 2 and 3 in `UX_REWRITE.md` §11 are correct in this order.

## MVP Definition

The MVP here is **"the project's success criteria"** per PROJECT.md: clean orchestration + classical-utility floor + reliable author-by-chat demo. Each pillar has its own MVP cut.

### Launch With (v1 = this project)

**Pillar 1 — Orchestration (must ship, demo flops without it):**
- [ ] `stance` enum (`browse | focus | author`) replaces three overlapping mode systems
- [ ] All six implicit-mode-promotion auto-transitions deleted (per `UX_REWRITE.md` §8)
- [ ] Map Shelf (top strip) with chips for visibility / isolate / inspect / share / remove
- [ ] Sidebar single-navigator role: Pinned → Recent → Search; inspect-in-place; no split panels
- [ ] Path-based routing (`/`, `/c/<naddr>`, `/d/<naddr>`, `/author/<workspace-id>`) with hash redirect shim
- [ ] Chat detachable + binding chip
- [ ] Explicit verbs: Open, Pin, Inspect, New, Fork, Propose Edit, Curate, Share, Save as workspace
- [ ] Browse landing prompt (empty-shelf overlay)
- [ ] Fix structural bugs: form-doubling, dead state, sidebar's secondary mode system

**Pillar 2 — Classical utility floor (must ship as discipline across all work):**
- [ ] Every flow works without engaging chat or revealing protocol
- [ ] Plain-language labels replace kind/relay/pubkey/naddr in classical paths
- [ ] Persistent address search affordance (geocoder via ContextVM `SearchLocation`)
- [ ] Non-AI POI search form (category + radius) that hits the same MCP as the chat path
- [ ] Sidebar pagination unbounded (20-item ceiling removed)
- [ ] Mobile chrome doesn't eat the map; shelf collapses to sheet
- [ ] Anonymous read path verified end-to-end with no auth prompts

**Pillar 3 — Demo lands (must ship to validate the project as more than wonky-fix):**
- [ ] Toolbar drawing API designed as future package export, callable from chat tool execution and direct UI on equivalent paths
- [ ] Chat tool surface: invoke draw-point / draw-line / draw-polygon via tool calls
- [ ] Chat tool surface: read what's on the map (bbox query, feature list)
- [ ] Chat tool surface: POI query via MCP (single-hop only)
- [ ] AI-pending visual state for AI-drawn geometry (distinct stroke, "AI" badge)
- [ ] Accept-per-feature and Accept-all controls; reject removes from pending layer
- [ ] Streaming feedback during tool execution ("AI is drawing now")
- [ ] 60-second demo script runs end-to-end without manual intervention
- [ ] Demo scenario chosen and rehearsed (recommended: "draw a hiking trail from Hallstatt to Dachstein" — concrete, well-known geography, single-hop)

### Add After Validation (v1.x)

- [ ] **Multi-item shelf URLs** (`/shelf?i=a&i=b`) — add when single-chip share proves shareable working sets are wanted
- [ ] **OG previews for shared links** — needs SSR, separate effort
- [ ] **Refine-by-chat for AI-drawn geometry** ("make the trail go through the saddle") — depends on accept-reject staging being solid
- [ ] **Voice input for chat** — when mobile usage justifies STT cost
- [ ] **AI commit-message-equivalent for publishes** ("Trail from Hallstatt to Dachstein, 14km, moderate") — small but improves social discoverability
- [ ] **"Explain this dataset" AI summarization** — when inspect-in-place is stable, surface a "summarize" button that runs on the inspected dataset's content + comments

### Future Consideration (v2+)

- [ ] **Compound routing scenarios** — "museum → cafe → park" routing + POI filter + preference modeling. Cool but compounds three hard problems.
- [ ] **AI-authored edit proposals** — AI generates a kind 37519 against someone else's dataset. Conflates AI-authoring + cross-author review.
- [ ] **AI-curated discovery feeds** — "show me trending hiking datasets in Austria." Data-starved today.
- [ ] **AI-generated map styling/themes** — out of design-scope per PROJECT.md.
- [ ] **Real-time multi-user co-editing** — massive scope; Nostr doesn't natively support presence.
- [ ] **Compound chat sessions per stance** — switching stance switches conversation. Defer until single-session binding is proven.
- [ ] **Nostr-scrolls / WASM tool execution** — aspirational per PROJECT.md Out of Scope.
- [ ] **Mapnolia consumer extraction** — defer per PROJECT.md.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Pillar | Rationale |
|---|---|---|---|---|---|
| stance enum collapse | HIGH | HIGH | **P1** | 1 | Prerequisite for everything in Pillar 1. Maintainer can't dogfood until this lands. |
| Delete implicit mode promotions | HIGH | MEDIUM | **P1** | 1 | Source of most current bugs. Concrete, well-mapped (six call sites per `UX_REWRITE.md` §8). |
| Map Shelf | HIGH | HIGH | **P1** | 1 | The signature structural change. Differentiator. |
| Path-based routing | HIGH | MEDIUM | **P1** | 1 | Foundation for share URLs and deep-linking. Required for Pillar 3 demo to be shareable. |
| Chat detach + binding chip | HIGH | MEDIUM | **P1** | 1 | Resolves "chat talks about wrong thing." Differentiator. |
| Sidebar single-navigator role | MEDIUM | MEDIUM | **P1** | 1 | Resolves info density. Inspect-in-place. |
| Explicit verbs | HIGH | LOW | **P1** | 1 | Mostly a labeling/wiring change once stance lands. |
| Plain-language labels sweep | HIGH | LOW | **P1** | 2 | Cheap, high-impact for classical floor. Sweep, not refactor. |
| Persistent search affordance | HIGH | LOW | **P1** | 2 | Table stakes. Already plumbed via `SearchLocation` MCP. |
| Non-AI POI search form | HIGH | MEDIUM | **P1** | 2 | Classical floor for "find me X." Shares MCP with chat path. |
| Browse landing prompt | MEDIUM | LOW | **P1** | 1 | Cheap. Required for first-open not to feel broken. |
| Toolbar drawing API design | HIGH | HIGH | **P1** | 3 | The structural bet. Cannot retrofit without rework. Design now, package later. |
| Chat → draw tool execution | HIGH | MEDIUM | **P1** | 3 | The demo verb. Requires toolbar API. |
| AI-pending geometry layer | HIGH | MEDIUM | **P1** | 3 | The accept-reject substrate. Required for demo safety. |
| Accept / reject controls | HIGH | LOW | **P1** | 3 | UI on top of pending layer. Cheap once the layer exists. |
| Chat → map awareness (bbox, list) | MEDIUM | MEDIUM | **P1** | 3 | Second demo verb. Required for "what's in this bbox?" |
| Chat → POI query (single-hop) | MEDIUM | LOW | **P1** | 3 | Already mostly plumbed via MCP. Wire into chat tool surface. |
| Streaming "AI is doing X" feedback | HIGH | MEDIUM | **P1** | 3 | Without this the demo feels broken. |
| 60-second demo rehearsal | HIGH | LOW | **P1** | 3 | Discipline, not engineering. Validates that the rest works together. |
| Workspace "Save as" + "Resume" surfacing | MEDIUM | LOW | **P1** | 1 | Already plumbed. Surface in landing prompt + shelf header. |
| Single-chip share URL with view-state option | MEDIUM | LOW | **P1** | 1 | Depends on path-based routing. Smart default (no `?v=`) is the differentiator. |
| Mobile shelf sheet | HIGH | MEDIUM | **P1** | 1/2 | Required for mobile usability. |
| AI commit message for publish | LOW | LOW | P2 | 3 | Nice-to-have. Add after demo proves stable. |
| Refine-by-chat for AI geometry | MEDIUM | HIGH | P2 | 3 | Depends on stable accept-reject. Adds conversational depth post-MVP. |
| "Explain this dataset" AI summary | MEDIUM | MEDIUM | P2 | 3 | Inspect-in-place enables it. Cheap once stance is clean. |
| Multi-item shelf URLs | LOW | MEDIUM | P3 | 1 | Defer per `UX_REWRITE.md` §9. |
| Voice input | LOW | HIGH | P3 | 3 | Defer. |
| Compound routing | LOW | HIGH | P3 | — | Out of scope. |
| AI-authored proposals | LOW | HIGH | P3 | — | v2. |
| AI map styling | LOW | HIGH | P3 | — | Out of design scope. |
| Real-time co-editing | LOW | HIGH | P3 | — | v2. |

**Priority key:**
- **P1**: Must have for this project (the v1 scope per PROJECT.md Active)
- **P2**: Add after the demo lands cleanly (v1.x)
- **P3**: Future consideration (v2+ or out of scope)

## Competitor Feature Analysis

For each major capability, what do the canonical players ship vs Earthly's approach. Specific products only; no vague "industry standards."

| Capability | Felt (SaaS, Enterprise AI) | Mapbox (MapGPT + MCP DevKit) | Google Maps (Ask Maps, 2026) | ChatGPT Atlas | QGIS AI plugins (GeoGPT, QGISGPT) | Earthly's approach |
|---|---|---|---|---|---|---|
| **Author-by-chat (draw geometry)** | No — Felt AI generates SQL/popups/extension code, not geometry | Partial — MCP DevKit generates GeoJSON via LLM for the developer to import | No — purely query/discovery | No — search results only, no authoring | Partial — generates Python that calls QGIS APIs; geometry created as side effect | **Yes, first-class** — chat invokes same drawing API as the toolbar; geometry lands in AI-pending layer |
| **Analyze-the-map** | Yes — AI SQL queries against layer data ("stores within 5mi of competitors") | Indirect via MapGPT conversations | Yes — Ask Maps with multi-step context | Yes via "browser memories" of viewed pages | Yes — LLM has read access to layer attributes | Yes — chat tool surface reads features in bbox, lists what's on the map (Pillar 3 secondary) |
| **POI query ("find X")** | Yes via SQL — "show me hospitals near schools" | Yes — MapGPT is built around this | Yes — flagship feature ("phone is dying, where can I charge without coffee line") | Yes — sidebar gives map results | Yes — generates Overpass QL | **Yes — single-hop, via MCP `SearchLocation`. Classical form + chat path share the same tool.** |
| **Compound routing** | No | Partial — MapGPT does in-vehicle multi-stop | Yes — "Grand Canyon + Horseshoe Bend + stops along the way" | Indirect | No | **Explicitly out of scope (v2)** |
| **Accept/reject for AI output** | Implicit — review generated code, click Save | Implicit — DevKit shows preview link; developer imports manually | None — Ask Maps shows results immediately | None — search results are live | None — Python executes directly | **Yes, first-class** — AI-pending visual layer, per-feature accept/reject (Cursor-inspired) |
| **Chat scope binding** | Implicit (current map) | Implicit (vehicle context, current location) | Implicit (current map view) | Implicit (current tab + memory) | Implicit (current QGIS project) | **Explicit binding chip** showing what chat is bound to; user can override (`UX_REWRITE.md` §6) |
| **Chat detach / dismiss** | Enterprise UI sidebar | In-vehicle voice + screen; not detachable | Sidebar tab | Sidebar with toggle | Dockable panel | **Detachable floating or docked, user choice** |
| **Publish target** | Felt SaaS | Mapbox styles / customer's app | Google ecosystem | Web (read-only browsing) | Local files + plugin-specific | **Decentralized Nostr (kind 37515)** — open, federated, no vendor lock |
| **Non-AI fallback** | All Felt non-AI features available without AI subscription | MapGPT optional; classical Mapbox SDK is the default | "Classic" Maps search still works | Auto-mode switches to Google Search | Plain QGIS works | **First-class — classical-utility-as-discipline. Every AI flow has a non-AI twin.** |
| **Empty / first-open** | Recent maps list | N/A (in-vehicle) | Recent + saved places + recommendations | "Ask anything" prompt | Plain QGIS canvas | **Browse landing prompt** — pick city / open last workspace / browse popular |
| **Sharing model** | Workspace link / public-link with view-state | Per-customer integration | Public Maps URL with place ID | URL of search session | Local QGIS project file | **Path-based `/c/<naddr>` and `/d/<naddr>` with optional view-state. Defaults to bbox-fit.** |
| **Mobile** | Web-responsive | Native automotive | Native mobile flagship | Desktop only (macOS) → mobile coming | QGIS desktop only | **Mobile-first responsive** — shelf collapses to sheet |
| **Auth / login required** | For editing | Customer-side | Optional | Required (ChatGPT account) | None | **Optional for read; required for publish** |

## Demo Scenario Recommendation

PROJECT.md mandates a 60-second author-by-chat demo. Based on the research, the scenario should:

1. **Be geographically concrete and verifiable** — pick a real place users can sanity-check (Hallstatt-to-Dachstein passes this; "a trail in the mountains" doesn't).
2. **Be single-hop, not compound** — one geometry-generating intent, not a routing problem.
3. **Surface accept-reject visibly** — the AI's geometry must land in a state the demo viewer can see is "pending."
4. **End in a real Nostr publish** — the differentiator (decentralized publish) only lands if the demo shows it.

**Recommended script:**
1. (0–5s) Open Earthly. Land on Browse with the landing prompt visible. Click "New dataset" (or activate via "/").
2. (5–10s) Author stance entered. Chat already shows in the floating panel with binding chip "this new draft."
3. (10–25s) Type: "Draw a hiking trail from Hallstatt to the Dachstein cable car." Streaming feedback shows "thinking" → "drawing line" → "added 17 vertices." A dashed line with "AI" badge appears on the map.
4. (25–40s) Click "Accept" on the AI-pending chip. Line becomes solid (committed to draft). Click an attribute field, type a name, hit Publish.
5. (40–55s) Publish modal shows "Publishing to Nostr…" in plain language. Success state shows the URL `/d/<naddr>`.
6. (55–60s) Copy link, paste in new tab — recipient lands on bbox-fit of the trail.

This scenario exercises: stance transition (Browse → Author), classical drawing surface (toolbar present, just not actively used), chat tool execution (the draw call), AI-pending layer (visual distinction), accept-reject, decentralized publish, path-based share URL, recipient view.

What it deliberately doesn't exercise: compound routing, POI query, edit proposals, Nostr discovery. Those have their own validation paths; the demo stays narrow.

## Sources

**Felt:**
- [Felt AI overview](https://felt.com/platform/felt-ai) — HIGH confidence (official)
- [Felt AI extensions help](https://help.felt.com/felt-ai/ai-extensions) — HIGH
- [Getting started with Felt AI](https://help.felt.com/felt-ai/getting-started-with-felt-ai) — HIGH
- [Felt blog: build spatial applications with a prompt](https://felt.com/blog/felt-ai-build-spatial-applications-with-just-a-prompt) — HIGH
- [Felt Workspaces blog](https://www.felt.com/blog/getting-the-most-out-of-workspaces) — HIGH
- [Felt: editing layers](https://help.felt.com/layers/editing-layers) — HIGH
- [Felt 20 announcement (Informed Infrastructure)](https://informedinfrastructure.com/post/introducing-felt-20-the-most-powerful-tool-for-professional-map-making) — MEDIUM (industry press)

**Mapbox:**
- [Mapbox MapGPT product page](https://www.mapbox.com/mapgpt) — HIGH
- [Mapbox MCP DevKit blog](https://www.mapbox.com/blog/the-mapbox-mcp-devkit-equip-ai-coding-tools-with-geospatial-skills-for-mapbox-development) — HIGH
- [Mapbox Location Agent (Conversational Maps blog)](https://www.mapbox.com/blog/maps-turn-conversational) — HIGH
- [Mapbox Location AI](https://www.mapbox.com/location-ai) — HIGH
- [Mapbox MapGPT debut press release](https://www.mapbox.com/press-releases/mapbox-debuts-mapgpt-allowing-automakers-to-take-control-of-their-voice-assistants) — HIGH

**Google Maps (2026):**
- [Google blog: Ask Maps and Immersive Navigation](https://blog.google/products-and-platforms/products/maps/ask-maps-immersive-navigation/) — HIGH (official)
- [TechCrunch: Google Maps AI Ask Maps feature](https://techcrunch.com/2026/03/12/google-maps-is-getting-an-ai-ask-maps-feature-and-upgraded-immersive-navigation/) — MEDIUM (press)
- [Search Engine Journal: Ask Maps conversational search](https://www.searchenginejournal.com/google-maps-launches-ai-conversational-search-with-ask-maps/569585/) — MEDIUM
- [Google Maps Platform: agentic experiences](https://mapsplatform.google.com/resources/blog/powering-the-next-era-of-agentic-experiences-announcing-new-grounding-capabilities/) — HIGH

**ChatGPT Atlas:**
- [OpenAI: Introducing ChatGPT Atlas](https://openai.com/index/introducing-chatgpt-atlas/) — HIGH
- [ChatGPT Atlas product page](https://chatgpt.com/atlas/) — HIGH
- [ChatGPT Atlas Wikipedia](https://en.wikipedia.org/wiki/ChatGPT_Atlas) — MEDIUM
- [ChatGPT Atlas release notes](https://help.openai.com/en/articles/12591856-chatgpt-atlas-release-notes) — HIGH

**OSM / Overpass / natural-language POI:**
- [OSM-AI-Map (GitHub, Steve Attewell)](https://github.com/steveattewell/osm-ai-map) — MEDIUM (community project)
- [ispatialtec: generative-AI-driven spatial data extraction](https://ispatialtec.com/blogs/generative-ai-driven-spatial-data-extraction-in-openstreetmap-using-natural-language/) — MEDIUM
- [OpenCage MCP tutorial](https://opencagedata.com/tutorials/geocode-inside-an-llm-via-mcp) — HIGH

**QGIS / ArcGIS:**
- [QGIS GeoGPT AI Agent](https://plugins.qgis.org/plugins/qgis_ai_agent/) — HIGH
- [QGISGPT plugin](https://plugins.qgis.org/plugins/qgisgpt_plugin/) — HIGH
- [Esri: what's new in AI Assistants (Oct 2025)](https://www.esri.com/arcgis-blog/products/arcgis-online/geoai/whats-new-in-ai-assistants-october-2025) — HIGH
- [ArcGIS Online: configure AI assistants](https://doc.arcgis.com/en/arcgis-online/administer/configure-assistants.htm) — HIGH

**Hiking / route planning:**
- [TrailGPT (HiiKER)](https://hiiker.app/trailgpt) — MEDIUM
- [Backpacker: I asked AI to plan a hike](https://www.backpacker.com/stories/ai-hike-planning/?scope=anon) — MEDIUM (journalism)

**Accept/reject UX patterns:**
- [Cursor forum: per-change accept inline diff thread](https://forum.cursor.com/t/bring-back-per-change-apply-inline-diff-review-you-re-throwing-away-your-best-ux-advantage/160856) — MEDIUM (community)
- [The Shape of AI — UX patterns catalog](https://www.shapeof.ai/) — MEDIUM
- [CMSWire: 10 UX patterns improving AI accuracy and trust](https://www.cmswire.com/digital-experience/10-ux-design-patterns-that-improve-ai-accuracy-and-customer-trust/) — MEDIUM
- [Proxi: prompt-to-map review workflow](https://www.proxi.co/blog/creating-maps-with-ai-proxi-prompt-to-map) — MEDIUM

**Research papers:**
- [IMAIA: Interactive Maps AI Assistant (arXiv)](https://arxiv.org/html/2507.06993v4) — HIGH (peer-reviewed)
- [MapStory: LLM-Powered Text-Driven Map Animation (arXiv)](https://arxiv.org/html/2505.21966v1) — HIGH
- [Development Seed: Language Interfaces for Maps](https://developmentseed.org/blog/2025-01-29-llms/) — MEDIUM
- [Sketch2Terrain (CHI 2025)](https://dl.acm.org/doi/10.1145/3706598.3713467) — HIGH

**Deep linking / sharing:**
- [Mappedin deep linking docs](https://developer.mappedin.com/docs/embed-a-map/deep-linking) — HIGH
- [Google for Developers: app deep links 2025](https://developers.google.com/search/blog/2025/05/app-deep-links) — HIGH

---
*Feature research for: AI-augmented collaborative map editor on top of a Nostr GeoJSON publishing platform*
*Researched: 2026-05-26*
