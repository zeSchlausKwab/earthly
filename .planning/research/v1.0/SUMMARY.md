# Project Research Summary

**Project:** Earthly v1 — Orchestration cleanup + classical-utility floor + AI authoring demo
**Domain:** Established Nostr-based collaborative mapping app (post-applesauce-migration overhaul)
**Researched:** 2026-05-26
**Confidence:** HIGH

## Executive Summary

Earthly is not greenfield. The four research streams converged on a sharper conclusion than the prompt asked for: **most of the Pillar 3 plumbing already exists** (Routstr, 20+ chat tools in OpenAI format, ContextVM MCP server with Nominatim/Overpass/Valhalla, applesauce migration complete). The real v1 work is **structural** — collapsing three overlapping mode systems into a single `stance` enum, introducing a **Map Shelf** as the working-set abstraction, and routing every editor mutation through a single **Drawing API** that both UI buttons and chat tool calls invoke equivalently. The AI demo lands on top of that foundation as a thin layer: AI output enters the Shelf as a `kind: 'ai-proposal'` item, the user accepts or rejects via an explicit verb, and the existing publish pipeline takes over. There is no stack to pick — just amendments (Zod-as-source-of-truth for tool schemas, a GeoJSON validation pipeline, a preview MapLibre layer).

The highest-leverage risk is not technical — it is **discipline drift**. The previous attempt at this rewrite died not because the design was wrong but because the executing agent reimplemented stable leaf components instead of amending orchestration. All four research streams independently surfaced this as the primary failure mode (Pitfalls §1, Architecture §3, Stack "what already exists," Features anti-patterns). The roadmap must enforce three cross-cutting constraints on **every** phase: (1) **amend, don't replace** — Phase 1 ships zero leaf-component changes and only deletes orchestration debt; (2) **classical-utility floor as gate** — an incognito-mode smoke checklist runs at the end of every phase, not just at the end of Pillar 2; (3) **visual-diff gate before merge** — for orchestration phases, the visible UI must be near-identical to main, proving the diff lives in the right layer.

The recommended phase sequence is **9 phases** in two passes: Phases 1–6 ship the orchestration cleanup and classical floor (Pillars 1+2, the prerequisite); Phases 7–8 land the AI demo (Pillar 3); Phase 9 is polish + the rehearsed 60-second demo recording. The maintainer cannot dogfood the current app — that is the success signal, not a metric. If Phases 1–6 ship cleanly and the demo never lands, the project is still a success per PROJECT.md. If the demo lands on a still-broken foundation, the project failed.

## Key Findings

### Recommended Stack

The stack is **the existing stack, amended**. No SDK swap, no agent framework, no parallel MCP client. Three of four research streams independently rejected Vercel AI SDK 6, LangChain, and custom Anthropic SDK swaps — each would orphan Earthly's Cashu payment surface, model-marketplace doctrine, and Nostr-transport plumbing without producing value the existing surface doesn't already provide.

**Core technologies (keep + amend):**
- **Routstr** (existing, `src/features/chat/routstr.ts`): OpenAI-compatible streaming + Cashu micropayments — keep, don't replace
- **`@modelcontextprotocol/sdk@1.29.0`** + **`@contextvm/sdk@^0.9.1`** (existing): MCP-over-Nostr transport — pinned, do not bump speculatively (v2 lands Q1 2026)
- **Zod** (promote from transitive to direct): Single source of truth for tool schemas — used to auto-derive OpenAI function-calling JSON via `zod-to-json-schema`, replacing 800 LOC of hand-written schemas in `definitions.ts`
- **Turf.js + AJV + `@yaga/geojson-schema`** (mostly existing): Three-stage validation pipeline for LLM-produced GeoJSON (schema → semantic → anchor-to-map-context)
- **`partial-json`** (new, ~1KB): Render streaming tool-call argument deltas as a visible "AI is drawing" preview
- **MapLibre GL 5.24** (existing): The preview layer for AI proposals uses the existing source/layer API — no fork, no alt-renderer

**Critical non-additions:**
- No Vercel AI SDK, no LangChain, no `@anthropic-ai/sdk` direct
- No MCP Apps / mcp-ui (architectural fit is wrong — Earthly is the host, not an embedder)
- No design system overhaul, no Radix swap, no font/spacing token churn

See `.planning/research/STACK.md` for full rationale.

### Expected Features

The 2026 AI-mapping space has split into four lanes; Earthly's demo touches three. **The white space Earthly occupies is unique**: nobody mainstream is shipping "AI-authored geometry that you accept/reject and then publish to a decentralized social network." Felt locks to Felt SaaS, Mapbox MCP DevKit locks to Mapbox styles, Google My Maps locks to Google. Earthly is the open one.

**Must have (table stakes — without these the demo flops or utility users bounce):**
- Single `stance` enum (`browse | focus | author`) replacing three overlapping mode systems
- Map Shelf — top strip with chip-per-item, the working-set abstraction (signature differentiator)
- Path-based routing (`/`, `/c/<naddr>`, `/d/<naddr>`, `/author/<workspace-id>`) with hash redirect shim
- Persistent address search + non-AI POI search form (classical floor)
- Plain-language labels — protocol terms (kind, naddr, relay, pubkey) never surface in classical paths
- Toolbar drawing API callable from chat tool execution and direct UI on equivalent paths
- AI-pending visual layer with explicit Accept/Reject/Refine verbs
- Browse landing prompt (empty-app overlay)
- Mobile shelf collapses to loud chip with peek-on-add (not silently hidden)

**Should have (competitive differentiators):**
- Chat detach + explicit binding chip (resolves "chat about the wrong dataset" confusion)
- Inspect-in-place (sidebar list replaced by detail in same panel, with Back affordance)
- Workspace = shelf + draft + chat as resumable session bookmark
- Smart share-URL default (bbox-fit, not "snapshot of my zoom level")
- Streaming "AI is drawing" feedback during tool execution
- Decentralized publish target with provenance tagging (`["ai-assisted", "true"]`)

**Demo scenario (recommended):** "Draw a hiking trail from Hallstatt to the Dachstein cable car." Concrete, verifiable geography; single-hop intent; surfaces the AI-pending → Accept → Publish round-trip in under 60 seconds.

**Defer (v2+ or out of scope):**
- Compound routing ("museum → cafe → park") — compounds three hard problems
- AI-authored edit proposals (kind 37519) — adds cross-author review to AI authoring
- AI-curated Nostr corpus discovery — data-starved today
- Real-time multi-user co-editing — massive scope; Nostr lacks native presence
- Voice input — defer until mobile usage justifies STT cost
- AI map styling / themes — out of design scope per PROJECT.md

See `.planning/research/FEATURES.md` for the full feature landscape, competitor analysis, and prioritization matrix.

### Architecture Approach

Four architectural bets, all four research streams agreeing:

1. **One owner per concern.** `stance` enum owned by `editorCoreSlice`. Map Shelf owned by a new `shelfSlice`. Chat binding owned by chat store. **Delete** all derived/shadow state (AppSidebar's local mode mirror, ChatPanel's implicit `activeContextScope`, the `useViewMode` graph).
2. **A Drawing API layer** sits between callers (Toolbar buttons, chat tool executors, keyboard shortcuts) and `GeoEditor`. Function-per-verb, Zod-validated input, returns typed `Result<T>`. UI and chat call the same functions. This is the single most important new boundary.
3. **AI output goes through a Proposal stage on the Shelf**, not directly into the dataset. Chat geometry lands as `shelfItem` with `source: 'ai-proposal'`, `pending: true`. Explicit user verb (Accept/Reject/Refine) promotes it. The Shelf is already the working-set abstraction Pillar 1 introduces — AI proposals are just another `kind`.
4. **"Visible but ignorable" is a state-scoping discipline, not a UI toggle.** Every AI/Nostr surface reads state but does not *gate* a flow. Anonymous users have full read+filter access. Chat panel renders next to the map, never on top of it.

**Major components:**
1. **GeoEditorView** (amend, do not rewrite) — Stance-aware layout shell only. Picks `<BrowseLayout>` | `<FocusLayout>` | `<AuthorLayout>`. Currently 2,088 lines; target ~400 lines orchestrator + extracted hooks.
2. **Drawing API** (`src/features/geo-editor/api/`, NEW) — Function-per-verb registry. The seam between chat/UI/keyboard and `GeoEditor`. Zod schemas in `api/schemas.ts` feed both runtime validation and OpenAI tool definitions via `zod-to-json-schema`.
3. **Map Shelf + shelfSlice** (NEW) — Top strip + Zustand slice owning the working set. `useMapLayers`' input contract changes from `mapStackSlice + activeContextScope*` to `shelfSlice.items`.
4. **Stance discriminated union** — Not a plain enum: `{ kind: 'browse' } | { kind: 'focus'; focusedItemId? } | { kind: 'author'; draftId; sourceItemId? }`. TypeScript exhaustiveness makes impossible states impossible.
5. **One-way useRouting** (rewrite) — URL → state via atomic dispatch. State → URL only via explicit verbs calling `router.push()`. Hash redirect shim, one-shot.
6. **Detached ChatPanel + binding chip** — Implicit `activeContextScope` replaced by explicit `binding` field with sticky-once-explicit semantics.

**Critical interaction: the two Zustand stores stay independent.** Editor store and chat store do not import each other. They converge at the Drawing API. This is the architectural payoff for designing the API as if it were a package boundary (per PROJECT.md constraint).

See `.planning/research/ARCHITECTURE.md` for full diagrams, data-flow paths, and migration playbook.

### Critical Pitfalls

The 14 pitfalls in `PITFALLS.md` collapse into 5 cross-cutting constraints the roadmap must enforce:

1. **Reimplementing stable leaves (Pitfall §1) — the previous-failure trap.** Phase 1 ships zero leaf-component changes; the visible UI before/after Phase 1 is near-identical. Verification: visual diff main vs Phase 1 head shows ~zero leaf changes; only orchestration files in diff. If a list-row JSX changes during state collapse, the phase is wrong scope.

2. **Stance becomes the new dual-mode system (Pitfall §8).** Stance lands *with deletions*, not alongside. Phase 1 PR removes `viewMode`, `sidebarViewMode`, `editIsolationEnabled`, `activeContextScope` from store types; TypeScript errors are the to-do list. No "compat alias." Verification: `grep -r 'viewMode\|sidebarViewMode\|editIsolationEnabled\|activeContextScope' src/` returns 0 outside a transient migration shim.

3. **AI geometry without accept/reject (Pitfall §2) + hallucinated coordinates (§3).** Two-stage commit is non-negotiable. AI output lands in a visually-distinct proposal layer (dashed stroke + AI badge + provenance), never in the draft. The LLM never produces raw coordinates — it routes through grounded tools (`search_location`, `query_osm_*`, `valhalla_route`). Every coordinate validated at the tool boundary (range check, lat/lon order, bbox sanity). System prompt explicitly forbids coordinate invention.

4. **Toolbar API leaks store (Pitfall §9) — kills future package boundary.** ESLint `no-restricted-imports` blocks chat tools from importing `useEditorStore`. The Drawing API is the only seam. UI and chat must call equivalent paths — if UI does extra work the API doesn't, the API is incomplete; fix the API, don't bypass it.

5. **Classical-utility floor decays under churn (Pitfall §6).** Every phase ends with an incognito-mode smoke checklist (10 items: anonymous landing, dataset read, share-link open, mobile chrome, chat dismissible, no protocol lingo, list filter, back button, etc.). Phases that break the classical floor don't merge. The discipline lives in CI, not in willpower.

**Other significant pitfalls covered in PITFALLS.md:** runaway tool-call loops (hard cap of 6 calls/turn + p95 latency budgets), MCP silent failures (structured error types at boundary, no per-session failure caches), one-way routing reverting to two-way (single writer for URL, ESLint guard), implicit chat binding sneaking back (sticky-once-explicit), mobile shelf hidden (peek-on-add + loud chip), chat-content privacy hole (chat is local-only by default; workspaces never include transcript), design-system scope creep (PR-template line), context rot in long sessions (trim tool results, restate state on each turn).

See `.planning/research/PITFALLS.md` for the full pitfall-to-phase mapping and per-phase verification gates.

## Implications for Roadmap

The three research streams that proposed phase sequences (STACK §sub-phases, ARCHITECTURE §10, FEATURES §MVP) converge on a 9-phase v1. The reconciled sequence below absorbs all three: ARCHITECTURE's 9-phase build order is the backbone; STACK's 5 Pillar-3 sub-phases compress into Phases 7–8; FEATURES' "Phase 7: Author-by-chat demo" becomes the rehearsed demo recording in Phase 9.

**Pillars 1+2 are interleaved by design, not sequenced.** Classical-utility is a discipline, not a phase — every phase ends with the incognito smoke checklist. Pillar 3 lands as a thin layer on top of the cleaned foundation.

### Phase 1: Stance Enum + Delete Implicit Transitions
**Rationale:** Nothing else can be built cleanly while three mode systems are alive. The shelf depends on stance being canonical; chat binding depends on it; Drawing API's `stance === 'author'` guards depend on it. This is the highest-risk, highest-leverage phase.
**Delivers:** Single `stance` discriminated union; six implicit `setViewMode` auto-promotions deleted (UX_REWRITE §8); legacy slices (`viewModeSlice`) deleted, not emptied; AppSidebar's secondary mode block removed.
**Touches:** `store/editorCoreSlice.ts`, `store/types.ts`, `useViewMode.ts` (deleted), `useRouting.ts` (six call sites rewritten), `AppSidebar.tsx` lines 225-300, `GeoEditorView.tsx` (only effects that reference old props).
**Avoids:** Pitfall §1 (no leaf-component rewrites), Pitfall §8 (stance lands with deletions, not alongside).
**Verification gate:** Visual diff main↔Phase 1 ≈ zero leaf changes. `grep` for legacy mode props returns 0. Classical-utility smoke checklist passes.

### Phase 2: Drawing API Skeleton + Shelf Slice (Foundations)
**Rationale:** The Drawing API and shelfSlice are the foundations every later phase plugs into. Initially the API is mostly pass-throughs over existing editor methods; the shape is what matters. Shelf slice exists but isn't yet wired into `useMapLayers` (that's Phase 4).
**Delivers:** `src/features/geo-editor/api/` (NEW) with Zod schemas + verb functions returning `Result<T>`; `store/shelfSlice.ts` (NEW) with `ShelfItem` discriminated union including the `'ai-proposal'` kind reserved.
**Uses:** Zod (promoted to direct dep), `zod-to-json-schema`.
**Implements:** Architecture Patterns §1 (Drawing API), §3 (Shelf-as-Working-Set skeleton).
**Verification gate:** No surface change. ESLint rule blocking chat tool imports of `useEditorStore` lands in this phase (even though nothing violates it yet — Phase 8 will).

### Phase 3: Path-Based Routing Rewrite
**Rationale:** Per UX_REWRITE §9 + Pitfall §7. Decouples URL ↔ state, fixes "URL changes don't atomically apply" bugs, prerequisite for share-link work. One-shot hash redirect preserves backwards compat.
**Delivers:** `useRouteHydration` (one-way URL → state), `router.toXxx()` write helpers (called only by explicit verbs), hash redirect shim.
**Avoids:** Pitfall §7 (two-way routing return). Single writer for `history.pushState`; ESLint guard.
**Verification gate:** `grep -r 'pushState\|replaceState' src/ | grep -v useRouting/` is empty.

### Phase 4: Map Shelf UI + Sidebar Open Verb (First Visible Change)
**Rationale:** First user-visible change. Shelf slice from Phase 2 finally gets its UI. `useMapLayers` repointed to `shelfSlice.items`. Sidebar list rows get explicit `Open` verb (adds to shelf). **Mobile shelf collapse is in scope from day one** (not deferred — Pitfall §11).
**Delivers:** `components/MapShelf.tsx` (NEW), `components/StanceIndicator.tsx` (NEW), `useMapLayers.ts` input-contract change, AppSidebar Open/Pin verbs, mobile peek-on-add behavior with loud collapsed chip.
**Addresses:** Map Shelf (signature differentiator); explicit verbs (Open, Pin, Inspect).
**Avoids:** Pitfall §11 (mobile shelf hidden). Maintainer-dogfood checkpoint after this phase.
**Verification gate:** Load 3 datasets on phone-width viewport; user can see and manage all 3. Classical smoke checklist passes.

### Phase 5: GeoEditorView Split + Stance Layouts
**Rationale:** Browse/Focus/Author layouts diverge meaningfully (Toolbar only in Author, shelf only in Focus/Author). Extract per Architecture Pattern §6. Unblocks Author entry verb.
**Delivers:** `layouts/BrowseLayout.tsx` + `FocusLayout.tsx` + `AuthorLayout.tsx` (NEW), 5–6 new extracted hooks (`useDesktopRightDock`, `useMapViewportSync`, `useModeCursor`, `useEditorDialogs`, `useMapEditorBootstrap`), `GeoEditorView.tsx` reduced from ~2,088 → ~400 lines.
**Addresses:** Sidebar single-navigator role works cleanly per stance.
**Verification gate:** No regression in any flow; classical smoke passes.

### Phase 6: Sidebar Rework + Plain-Language Labels Sweep
**Rationale:** Per UX_REWRITE §4. Independent of chat work; should precede chat detach so navigator behavior is stable. Plain-language labels sweep is cheap and orthogonal — bundle here. Closes out the Pillar 1 + Pillar 2 surface.
**Delivers:** AppSidebar consolidated to Pinned → Recent → Search/Discover; inspect-in-place; pagination unbounded; protocol terms (kind, naddr, relay, pubkey) replaced with plain language in classical paths.
**Addresses:** Pillar 2 classical floor finalized.
**Verification gate:** Classical smoke checklist passes one final time before Pillar 3 work. **Maintainer dogfood checkpoint — this is the "I open the app for fun" milestone.** If this checkpoint fails, do not proceed to Pillar 3.

### Phase 7: Chat Detach + Binding Chip + Chat-Store Split
**Rationale:** With stance + shelf + Drawing API + sidebar in place, ChatPanel refactor is safe — no more "where does context come from?" ambiguity. Binding chip becomes meaningful because there's an explicit shelf to bind to.
**Delivers:** Detachable/dockable ChatPanel with `<DraggablePanel>` shell; explicit `binding` field (sticky-once-explicit per Pitfall §10); chat store split into `messagesSlice`, `bindingSlice`, `toolExecSlice`, `paymentSlice`, `settingsSlice`; extracted hooks `useChatBinding`, `useToolExecution`, `useChatStream` (extracted last as riskiest).
**Avoids:** Pitfall §10 (implicit binding return), Pitfall §12 (chat privacy — workspaces never include transcript; chat is local-only).
**Verification gate:** Change the shelf; chat's answer clearly indicates which binding it used. Audit: no Nostr publish path touches chat transcript.

### Phase 8: AI Proposal Verbs on the Shelf (The Demo Unlock)
**Rationale:** With Drawing API + shelf + chat detach in place, the AI proposal flow is the last lap. This is the largest single phase of Pillar 3. Compresses STACK's 5 Pillar-3 sub-phases (schema unification → validation → proposal layer → prompt hardening → streaming polish).
**Delivers:**
- `drawingApi.proposeFeatures()` / `commitProposal()` / `rejectProposal()` verbs
- `chat/tools/registry.ts` migrating editor tools from hand-written JSON Schema to Zod-derived (replacing ~800 LOC in `definitions.ts`)
- Three-stage GeoJSON validation pipeline (AJV schema → Turf semantic → anchor-to-map-context) with repair-loop retry (max 3)
- System prompt hardening with coordinate-discipline rules (never invent coords; route through `search_location`/`query_osm_*`/`valhalla_route`)
- Preview MapLibre layer with dashed stroke + AI badge + provenance
- AI-proposal chip in Map Shelf with Accept/Reject/Refine verbs
- Streaming tool-call argument preview via `partial-json` (vertex-by-vertex animation during long draws)
- Tool-call hard cap (6/turn) and p95 latency budgets
- MCP boundary structured error types (`timeout | network | schema | not-found | unauthorized | server-error`)
- Provenance field on features (`provenance: 'user' | 'ai' | 'imported'`)
- AI undo atomicity (one tool call = one undo step)

**Avoids:** Pitfalls §2, §3, §4, §5, §9, §14.
**Verification gate:** 20-prompt coordinate-fuzz suite returns grounded coords or clean refusal; scripted demo run 10x with `--budget 6 --timeout 60s` succeeds 9/10.

### Phase 9: Polish + Rehearsed Demo Recording
**Rationale:** Per UX_REWRITE §11. The final consolidation phase — landing prompt, share dialog with optional viewport, workspace surfacing, classical-utility audit, demo rehearsal and recording.
**Delivers:**
- Browse landing prompt (UX_REWRITE §10 net-new)
- Single-chip share URLs with smart default (bbox-fit, optional `?v=lng,lat,zoom`)
- Workspace "Save as" + "Resume" surfaced in shelf header and landing prompt
- Anonymous-flow walkthrough audit (final classical smoke)
- Rehearsed demo scenario: "Draw a hiking trail from Hallstatt to the Dachstein cable car" — recorded 10 times; ship recording with 9/10 success rate

**Verification gate:** Demo runs 9/10 in 60 seconds. Privacy audit clean. Classical smoke passes one last time. Maintainer dogfood is genuinely fun.

### Phase Ordering Rationale

- **Stance enum must come first.** Trying to build the Shelf or the Drawing API on top of three mode systems means the new code has to know about both. Don't. Phase 1 alone validates the project's ability to ship the "amend, don't replace" discipline.
- **Drawing API + shelf slice precede their UI** (Phases 2 before 4) so that when the visible UI lands, the data model is already stable.
- **Routing rewrite (Phase 3) precedes Map Shelf UI (Phase 4)** so share URLs work from the moment the Shelf ships.
- **Sidebar rework precedes chat detach** (Phase 6 before 7) so the navigator role is settled before the chat panel is decoupled from it.
- **Chat detach precedes AI proposal verbs** (Phase 7 before 8) so the binding chip is meaningful when AI proposals first appear.
- **Maintainer-dogfood checkpoints land at Phases 4, 6, and 9.** If Phase 6 fails the dogfood test, halt and fix before Pillar 3. The project's success criterion is "I open the app for fun" — measured here.
- **Pillars 1+2 (Phases 1–6) are the prerequisite for project success.** If shipped clean and the demo never lands, the project is still a success. The inverse — flashy demo on broken foundation — is the documented failure mode.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 8 (AI Proposal Verbs):** The single most novel surface. Needs deeper research during `/gsd-plan-phase` on: (a) preview-layer MapLibre source/layer styling that survives feature collection updates without flicker; (b) repair-loop UX when the LLM exceeds 3 retries; (c) provenance tagging interaction with Applesauce's Factory + Cast pattern. Most of the prior art is in text editors (Tiptap, Cursor) — translating accept/reject to geometry is a small but real gap.
- **Phase 7 (Chat Detach + Binding Chip):** Drag-and-drop dock/float UX has surprisingly deep edge cases (mobile pinning, focus restoration after detach, keyboard navigation between docked and floating). Worth a focused planning session.
- **Phase 8 (System Prompt Hardening):** Concrete coordinate-discipline rules need empirical validation against the 20-prompt fuzz suite. Plan to iterate prompt + suite together.

**Phases with standard patterns (can skip deeper research):**
- **Phase 1 (Stance Enum):** Discriminated unions + codemod-driven migration is textbook. Risk is execution discipline, not design.
- **Phase 3 (Path-Based Routing):** One-way routing with redirect shim is a documented pattern; UX_REWRITE §9 is the spec.
- **Phase 6 (Sidebar Rework):** Mostly UI shuffling against the existing panel infrastructure. Spec is locked in UX_REWRITE §4.
- **Phase 9 (Polish):** Each polish task is well-scoped from the surrounding phases' learnings.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Most recommendations are amendments to existing code, verified against `package.json` and source. Routstr/MCP/ContextVM choices are already validated by the running codebase. Only LOW-confidence call is `partial-json` vs `best-effort-json-parser` — marginal choice, verify with a spike. |
| Features | HIGH | Multiple confirmed sources for every major claim. Demo scenario (Hallstatt-to-Dachstein) is geographically concrete and verifiable. MEDIUM confidence on "what specifically lands inside Earthly" — that is partly opinion shaped by reading the codebase. |
| Architecture | HIGH | Patterns map directly to documented prior art (tldraw Agent Starter Kit, Tiptap AI Changes, Vercel AI SDK). MEDIUM confidence only on the atomic-swap migration tactic — synthesized from feature-flag-for-DB-migration prior art applied to a single-client app; reasoning holds but is not directly cited. |
| Pitfalls | HIGH | Domain-specific pitfalls grounded in PROJECT.md, UX_REWRITE.md, CONCERNS.md and verified industry sources (LLM tool-call literature, MCP spec gaps, GeoJSON axis-order documentation). MEDIUM on Nostr-AI intersection specifically — novel surface, less prior art, but the privacy pitfall (§12) is well-bounded by "chat is local-only by default." |

**Overall confidence:** HIGH

### Gaps to Address

- **Mapnolia client-side consumption** is partial. PROJECT.md defers consumer extraction to v2, so this is acknowledged tech debt rather than a planning gap. Phase 9 may want to verify the partial client consumption still works after the orchestration churn.
- **Concrete LLM model choice for the demo.** Routstr supports many models; the demo's reliability budget depends on which one. Address during Phase 8 planning — run the 20-prompt fuzz suite against the top 3 candidate models and pick the one with the best ground-coord rate.
- **CLIENT_KEY hardcoding** (`CONCERNS.md`) — pre-existing security debt, flagged in PITFALLS.md as out-of-strict-scope but interacting with P3 (chat ↔ MCP). Decide during Phase 8 whether to move signing server-side or defer to a v1.x security pass.
- **Seed-script NDK migration** is explicitly out of scope per PROJECT.md but lives in the same repo. Not a planning gap; just noted so the roadmapper doesn't accidentally bundle it.
- **Empirical AI-proposal acceptance UX** (single-button vs per-feature vs hybrid) is best decided by running the demo prototype rather than designed upfront. Plan Phase 8 with two design options and pick mid-phase.

## Sources

### Primary (HIGH confidence)

**Internal:**
- `.planning/PROJECT.md` — Core Value, three pillars, Active requirements
- `UX_REWRITE.md` — locked design spec for orchestration cleanup (§§2, 3, 4, 6, 8, 9, 10, 11)
- `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONCERNS.md` — existing architecture map (refreshed 2026-05-24)
- `src/features/chat/routstr.ts`, `tools/definitions.ts`, `tools/context.ts`, `tools/execute.ts` — existing chat plumbing
- `contextvm/server.ts` — existing MCP server
- `package.json` — pinned dependencies

**Official documentation:**
- Model Context Protocol Specification 2025-11-25 — `outputSchema`, structured output
- MCP TypeScript SDK — v1.29 current, v2 Q1 2026
- Routstr Core Documentation — OpenAI-compatible API + Cashu
- Anthropic Streaming Messages — `input_json_delta`, partial JSON warning
- Turf.js docs, Valhalla docs, Nominatim Usage Policy
- tldraw Agent Starter Kit — Zod-defined action schemas, util-class pattern (closest architectural analog)
- Tiptap AI Changes — accept/reject per change pattern
- Vercel AI SDK — Foundations: Tools — pattern reference, not a dependency
- Felt AI Extensions, Mapbox MCP DevKit, Google Maps Ask Maps, ChatGPT Atlas — competitor surfaces
- MapLibre GL JS docs

### Secondary (MEDIUM confidence)

- GeoJSON Agents (arXiv 2509.08863) — 85.7% accuracy for function-calling vs 48.6% baseline
- Coordinates from Context (arXiv 2510.08741) — LLM grounding of location references
- On the Use of LLMs for GIS-Based Spatial Analysis (MDPI)
- Mitigating Geospatial Knowledge Hallucination in LLMs (arXiv 2507.19586)
- GDELT on LLM geocoders
- LLM Function-Calling Pitfalls — Codastra; Six Fatal Flaws of MCP — Scalifi
- Cursor diff-approval regression thread — instructive failure mode
- The Shape of AI, CMSWire UX patterns for AI trust — accept/reject UX catalogues
- Taming Complex React State with Union Types; Avoid impossible UI states with React, TypeScript and xState
- Mastering the Orchestration Pattern in React — hook-extraction playbook
- The Permission Loop — Medium; LangChain HITL middleware
- Context Rot in AI Coding Agents — MindStudio
- Designing Reliable Tool Schemas with Zod for LLM Agents

### Tertiary (LOW confidence — single source or inference)

- Atomic-swap migration tactic for the three-mode collapse — synthesized from feature-flag-for-DB-migration prior art applied to a single-client app
- The "anchor-to-map-context" heuristic in the GeoJSON validation pipeline — judgment call, tune by demo iteration
- `partial-json` vs `best-effort-json-parser` — marginal choice; verify with a single integration spike

See full source lists in `.planning/research/STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`.

---
*Research completed: 2026-05-26*
*Ready for roadmap: yes*
