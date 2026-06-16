# Pitfalls Research

**Domain:** Concurrent UX refactor + LLM-driven map authoring on an established mapping app
**Researched:** 2026-05-26
**Confidence:** HIGH for domain-specific pitfalls (grounded in PROJECT.md, UX_REWRITE.md, CONCERNS.md and verified industry sources); MEDIUM for Nostr-AI intersection (novel surface, less prior art).

## Reading order

The pitfalls below are ordered by **how much damage they cause to v1**, not by domain. The previous attempt of this rewrite failed on **Pitfall 1** alone; the rest exist because two simultaneous risk surfaces (state-machine refactor + LLM agent surface) compound each other.

Each pitfall is tagged with the **pillar it belongs to**:
- **P1 (Wonky-fix)** — orchestration cleanup, state model, routing
- **P2 (Classical utility as discipline)** — non-AI/non-Nostr path stays first-class
- **P3 (Demo lands)** — author-by-chat round trip
- **CROSS** — affects more than one pillar

---

## Critical Pitfalls

### Pitfall 1: Reimplementing stable leaves instead of amending orchestration (the previous-failure trap)

**Pillar:** P1 + CROSS
**What goes wrong:**
An agent (human or AI) is told "rewrite the UX." It opens `AppSidebar.tsx`, `GeoDatasetsPanel`, `Toolbar.tsx`, a few list rows, and starts replacing them. Each replacement looks tidier in isolation but loses small accumulated fixes (keyboard handling, focus management, mobile sheet animation, accessibility affordances). Meanwhile the *real* disease — the three overlapping mode systems and six auto-`setViewMode` calls — sits untouched, because rewriting leaves is more legible work than collapsing a state graph.

This is exactly how the previous attempt of this rewrite died. The current branch (`feature/new-ux-applesauce`) carries some of that damage.

**Why it happens:**
- Component-by-component is the default "refactor" mental model — it produces small visible PRs.
- Orchestration code is harder to read, harder to test, and harder to PR-review; humans avoid it.
- AI agents in particular over-rewrite when given vague scope, because rewriting whole files is "easier" than understanding what the file's existing seams already give you.
- "Improving" a list component feels productive even when it isn't load-bearing on the goal.

**How to avoid:**
1. **Phase 1 must touch zero leaf components.** State collapse (stance enum, shelfSlice, delete six auto-transitions) ships with no visible UI change. If a phase 1 PR modifies `GeoDatasetsPanel.tsx` body content or any list-row JSX, it is wrong scope.
2. **Make the constraint explicit in every prompt and roadmap doc.** "Amend, don't replace" goes in the phase header, not just PROJECT.md.
3. **Diff budget gate.** For each P1 phase, set a budget: e.g. "no leaf component over 50 LOC changed unless it's removing dead orchestration logic." Review against this before merge.
4. **Whitelist the orchestration surfaces.** `GeoEditorView.tsx`, `AppSidebar.tsx` (only the secondary mode block at lines 225-300), `useViewMode.ts`, `useRouting.ts`, `useDatasetManagement.ts`, `viewModeSlice`, `uiSlice`. These are the targets. Everything else is off-limits in P1 unless it carries a known bug from `CONCERNS.md`.

**Warning signs:**
- A PR titled "phase 1: state collapse" touches `GeoDatasetsPanelContent.tsx` body.
- A list-row component is being rewritten "while we're in there."
- File rename count > 0 in a state-collapse PR.
- Snapshot of visible UI changes between branch and main is non-trivial after P1 ships.

**Phase to address:** Phase 1 (state collapse). Verification gate before phase 2 merges: open the app at main vs P1 head, compare screens — should be visually identical.

---

### Pitfall 2: AI geometry that appears on the map without a clear "this is from chat, accept or reject" handoff

**Pillar:** P3
**What goes wrong:**
Chat invokes the drawing tool, geometry appears on the editor canvas. The user can't tell whether (a) they drew it, (b) the chat drew it, (c) it's a preview, or (d) it's already committed to the draft. They click somewhere; the geometry is now part of their dataset. Or worse: they don't notice the geometry at all (rendered the same as existing features) and publish without realising.

This is the AI-UX equivalent of a silent state mutation, and it is the single biggest reason for distrust of LLM-assisted editors. Geometry without provenance is unrecoverable when the user has no idea what changed.

**Why it happens:**
- The drawing API is the same surface the user calls directly, so the rendered output is indistinguishable.
- Chat tool calls feel like API calls to the developer; they feel like magic to the user.
- "Just commit it and let undo handle it" is the path of least resistance for the implementer.

**How to avoid:**
1. **Two-stage commit.** AI-produced geometry lands in a **proposal layer**, visually distinct (e.g. dashed outline + colour shift + provenance badge), not in the draft features. Only an explicit user action ("Accept" / "Discard") promotes it into the draft. Reject = remove from map and from conversation history.
2. **Provenance is non-optional.** Every feature in the draft carries a `provenance: 'user' | 'ai' | 'imported'` marker internally. Even after acceptance, the inspector shows "drafted by chat (accepted [time])" until publish.
3. **The chat panel announces what it did.** A short, plain-English message ("I added a 4.2 km linestring from Hallstatt to Krippenstein. Review on the map.") with inline accept/reject buttons mirrors the on-map proposal. The user doesn't have to look in two places.
4. **No silent geometry mutations after acceptance.** Once accepted, further chat actions on the same feature require explicit re-invocation by the user — chat cannot "improve" a geometry the user already approved without asking.
5. **Undo includes AI actions atomically.** A chat tool call that draws a single linestring is one undo step, not 47 (one per vertex).

**Warning signs:**
- Demo recording: viewer can't tell when AI did something vs the maintainer.
- The implementer's pitch says "and the undo button is right there if they don't like it" — this is the failure mode in disguise.
- Internal feature objects have no provenance field.
- The chat panel doesn't echo the geometric outcome (only the textual one).

**Phase to address:** Phase 6 / 7 (chat-toolbar bridge + accept/reject UI). Verification: scripted demo where viewer watches over shoulder and is asked "did the AI just draw that, or did you?" — they should always know.

---

### Pitfall 3: LLM hallucinating coordinates or place names off by continents

**Pillar:** P3
**What goes wrong:**
User asks for "a hiking trail from Hallstatt to Dachstein." The LLM, without grounded place lookup, emits coordinates that put the trail somewhere off the coast of Africa, or swaps lat/lon and puts it in Antarctica, or invents place names that don't exist. Demo dies on camera.

Industry research confirms this is a well-documented failure mode: LLMs have weak intrinsic spatial reasoning, regularly swap (lat, lon) vs (lon, lat) (EPSG:4326 axis-order confusion is rampant even in GIS libraries), and confabulate place names that sound plausible.

**Why it happens:**
- The LLM is asked to act as a geocoder when it isn't one.
- GeoJSON uses [lon, lat] order; humans say "lat/lon"; the LLM has seen both in training and picks unpredictably.
- "Hallstatt" exists, "Dachstein" exists, but the model doesn't know the actual coordinates — it interpolates from text it has seen.

**How to avoid:**
1. **Never let the LLM produce raw coordinates as a primary output.** Every coordinate must come from a grounded source: the existing ContextVM `SearchLocation` MCP tool, the map's current bbox/selection, or a feature already on the shelf. The LLM's job is *routing the request through tools*, not generating spatial data.
2. **Validate every coordinate at the tool boundary** before it reaches the editor:
   - Within `[-180, 180]` × `[-90, 90]`.
   - Optional bbox sanity check ("does this fall inside the current map view, or within N km of the user's last interaction?"). If not, surface a confirm rather than silently draw it on the other side of the planet.
   - Reject malformed GeoJSON with a structured error the LLM can recover from ("invalid geometry — feature collection must contain Feature objects").
3. **Force `[lon, lat]` at one specific schema point** and document it in the tool description. The tool description should say "GeoJSON RFC 7946 order: [longitude, latitude]. Latitude/longitude swaps will be rejected."
4. **Round-trip through the geocoder for any human-named place** the LLM is asked to use. If the geocoder returns no result, the LLM tells the user "I couldn't find Krippensteinerhütte" — not "let me approximate."
5. **For routing (Hallstatt → Dachstein), use a routing tool**, not LLM-generated waypoints. If no routing tool is available, the LLM should propose endpoints only and let the user draw between them.

**Warning signs:**
- A tool's input schema accepts `coordinates: number[][]` without any range or order check.
- Tool description doesn't mention coordinate order.
- The LLM is allowed to emit geometry without first calling `SearchLocation` or a similar grounded tool.
- Test query: "draw a polygon around Atlantis" — anything other than "no such place" is a failure.

**Phase to address:** Phase 5/6 (chat tool surface for map). Verification: a fuzz suite of 20 ambiguous place-name queries (real places, fake places, common-noun overlap like "Salt Lake City" the place vs "salt lake" the feature) — all must either ground to a real coordinate or refuse.

---

### Pitfall 4: Runaway tool-call loops during demo

**Pillar:** P3
**What goes wrong:**
The LLM gets confused, calls `SearchLocation`, gets a result it doesn't like, calls it again with a slight reword, again, again — burns 8000 tokens and 30 seconds before producing anything. Or worse: the demo scenario triggers a chain — search → search → draw → search to verify → re-draw — and the 60-second window is gone before geometry appears. Cost spikes are a secondary symptom; the primary one is *the demo doesn't land in 60 seconds*.

This is the documented "eager invocation" pattern: overly granular tools and unclear instructions cause LLMs to call tools more often than necessary.

**Why it happens:**
- Tool descriptions are vague ("search for a location" instead of "search for a place by name; returns at most 5 candidates with coordinates and a confidence score").
- Multiple tools have overlapping responsibilities (Functional Confusion Error — selecting the wrong tool among similar ones).
- No tool-call budget; no early termination when the model is spinning.
- The chat prompt doesn't tell the model "one search, one draw, then ask the user."

**How to avoid:**
1. **Hard cap on tool calls per user turn.** Configure the chat loop with a maximum (e.g. 6 tool calls per user message). On hit: stop, surface "I'm taking too long — could you clarify?" rather than continuing to spin.
2. **Time budget per tool call.** Each tool call has a p95 latency budget (search: 800 ms, draw: 100 ms, analyze: 2 s). Exceed → cancel that call, return a clear error to the model.
3. **Small, single-purpose tools with sharp descriptions.** Each tool's description includes: when to use, when *not* to use, what it returns, examples. Avoid 12 lookup tools that all sound the same; have one geocode tool with a `kind` enum parameter.
4. **Token budget per session.** Demo sessions should not exceed a known cost. Surface a "stop and restart" affordance to the maintainer.
5. **Idempotency.** If the LLM calls the same tool with the same args twice in a row, second call returns cached result instantly — prevents tight loops from costing real time.
6. **Streaming progress.** The chat UI shows "searching for Hallstatt…", "drawing trail…", "verifying…" — if the user sees the same status for 10 s they know to intervene.

**Warning signs:**
- Logs show >5 tool calls per turn on simple requests.
- The same tool is called 3+ times with similar arguments.
- Latency p95 climbs above 5 seconds.
- Demo run-throughs sometimes complete in 30 s, sometimes in 2 min — high variance is the warning.

**Phase to address:** Phase 6 (chat tool execution). Verification: scripted demo run 10 times with `--budget 6 --timeout 60s`; must succeed 9/10 to ship.

---

### Pitfall 5: MCP timeout/error states surfacing as silent failures

**Pillar:** P3 + CROSS
**What goes wrong:**
ContextVM is slow or down. The MCP call to `SearchLocation` hangs. The chat just sits there. Or returns a partial result. Or times out and the LLM, not knowing why, retries — see Pitfall 4. Or the response shape changed (schema drift) and the parsing silently produces `[]`, and the chat says "I couldn't find that" when really the integration is broken.

Already happening in this codebase in a different form: `failedUrls` in `resolveBlobReferences.ts` silently marks blobs as permanently failed for the session, and the dataset renders with missing features and no user-visible error (see `CONCERNS.md` "Fragile Areas").

**Why it happens:**
- MCP servers may be remote, slow to start, behind external auth, or version-skewed (timeout coordination is an open SEP in the MCP spec).
- Error handling is afterthought; happy path is what gets demoed.
- "Failed once = failed forever" caches don't differentiate between schema mismatch, network blip, and genuine 404.

**How to avoid:**
1. **Every MCP/tool boundary has explicit timeout, retry-budget, and error type.** Categorise: `timeout`, `network`, `schema`, `not-found`, `unauthorized`, `server-error`. The LLM gets a structured error it can reason about ("the geocoder is currently unavailable — try again in a moment, or proceed without it").
2. **No silent caching of failures across the session.** Per-call failure surfaces to the user. Maybe per-request memoization (within one turn) is fine; across turns is not.
3. **Schema validation at the boundary** using Zod or similar — incoming MCP responses are parsed against the expected shape, mismatches are loud not silent.
4. **Surface degraded mode visibly.** If ContextVM is unreachable, the chat binding chip shows a small warning, and the chat refuses to attempt geocoding rather than producing hallucinated coordinates (links back to Pitfall 3).
5. **Don't let the LLM retry transparently on tool failure.** The chat returns control to the user with a one-line summary.

**Warning signs:**
- Tool wrappers don't `await` with timeout.
- No `.catch` differentiating error types.
- Failure cache lives at module scope (anti-pattern already present in `resolveBlobReferences.ts:16`).
- "It worked yesterday" complaints from the maintainer — symptom of schema drift.

**Phase to address:** Phase 5 (chat tool surface). Verification: integration test that points each tool at a fixture server which returns timeout / malformed / partial / 4xx / 5xx; each error type surfaces a distinct UX state.

---

### Pitfall 6: Classical-utility floor decays as orchestration churns

**Pillar:** P2 + CROSS
**What goes wrong:**
Pillar 2 says "every flow has a non-AI/non-Nostr path." But while Pillar 1 churns the orchestration, classical paths break: anonymous browsing fails because a route depended on an account, a list filter breaks because the panel was restructured for the stance model. Without continuous verification, the classical floor erodes silently and the team only notices when the demo lands and someone says "this only works if you sign in."

The PROJECT.md is explicit about this: "Classical utility is a discipline, not a phase." But disciplines erode under churn without measurable checks.

**Why it happens:**
- During refactor, all attention is on the new model. Non-AI paths aren't being exercised because they're not the focus.
- Anonymous mode is rarely tested in a logged-in dev session.
- "It works for me" — the maintainer is always logged in.

**How to avoid:**
1. **Per-phase classical-utility smoke checklist** — a 10-item list run at the end of each phase, in private/incognito with no Nostr key, no chat:
   - Can I land on `/`?
   - Can I see a dataset list?
   - Can I open a shared dataset link?
   - Can I see the map fit to a dataset?
   - Can I read a dataset's comments (read-only)?
   - Can I switch between mobile and desktop?
   - Is the chat panel collapsed/dismissable?
   - Is no Nostr lingo (kind, relay, pubkey) visible in default UI?
   - Can I filter/search a list?
   - Can the back button move me through navigation?
2. **Anonymous-first dev mode.** Add a quick toggle (debug-only) for "no account, no chat" so the maintainer can dogfood the classical floor every session.
3. **Treat regressions as blockers, not "nice to fix later."** A phase that breaks the classical floor doesn't merge.
4. **Routing tests** that don't require a session — confirm `/`, `/c/<naddr>`, `/d/<naddr>` render an empty-shelf or read-only shelf without auth.

**Warning signs:**
- "We'll handle the anonymous case after Pillar 3" — wrong order, classical floor is the foundation.
- Routes throw on missing account.
- Chat panel can't be collapsed/closed.
- "Sign in to view" appears anywhere except actual write actions.

**Phase to address:** Every phase. Verification gate at end of each phase: classical-utility smoke list passes.

---

### Pitfall 7: One-way routing rewrite ends up two-way again

**Pillar:** P1
**What goes wrong:**
`UX_REWRITE.md` §8 #6 mandates one-way URL → state. The new `useRouting.ts` is rewritten. Then a "small convenience" feature creeps in: state updates push back to the URL imperatively from a non-routing component. The two-way binding returns, and the bugs `useRouting.ts:243-256` had originally return with it.

**Why it happens:**
- One-way feels weird at first. "Why can't I just `history.pushState` from this handler?"
- The instinct to add convenience helpers (`setStanceAndUpdateURL`) is strong.
- Without a clear chokepoint, multiple call sites accumulate.

**How to avoid:**
1. **Single writer for the URL.** One module — typically the new `useRouting` — is the only thing in the app that calls `history.pushState`/`history.replaceState`. ESLint rule or grep gate: no other file may import history methods.
2. **State → URL is *derived*, not pushed.** A subscription to relevant Zustand slices computes the canonical URL and replaces the browser URL when it diverges. Components never call URL-update functions directly.
3. **URL → state is also derived,** parsed once on navigation events into a single `{ stance, shelf, view }` reducer-apply.
4. **Tests for routing direction.** Set state → assert URL. Set URL → assert state. No test should mix the two.

**Warning signs:**
- Multiple files import `history` or call `pushState`.
- A component has logic like "set state and then set URL."
- The URL flickers (set then reset within ~100 ms — sign of competing writers).

**Phase to address:** Phase 2 (path-based routing rewrite). Verification: grep for `history.pushState`, `history.replaceState`, `window.location` outside `useRouting` — must be empty.

---

### Pitfall 8: Stance enum becomes the new dual-mode system

**Pillar:** P1
**What goes wrong:**
`stance: 'browse' | 'focus' | 'author'` ships, but `viewMode`, `sidebarViewMode`, `editIsolationEnabled`, `activeContextScope` aren't deleted — they're left for "phase 4 cleanup." Both systems coexist for weeks; code is written that reads from both; effectively the disease returns with a new symptom. The same auto-promotion bug surfaces in a new shape: somewhere, a `useEffect` sees `stance === 'focus'` and quietly sets `viewMode = 'view'`, and now four mode systems exist where there were three.

**Why it happens:**
- Big-bang deletion feels scary; "compatibility shim" feels safe.
- Shipping the new model is celebrated; deleting the old model is a chore that gets deferred.
- During the overlap window, lazy code reads from "whichever is convenient."

**How to avoid:**
1. **Stance lands with deletions, not in addition.** Phase 1 PR removes `viewMode`, `sidebarViewMode`, `editIsolationEnabled`, `activeContextScope` from the store types — TypeScript errors are the to-do list. There is no "compat property" that mirrors the old enum.
2. **No new code may read the old props during the transition.** If phase 1 is split into multiple PRs, each PR must reduce the count of references to old props, never increase.
3. **The legacy slice files (`viewModeSlice.ts`) are deleted, not emptied.** A file with a name that suggests the old model is a magnet for new dependencies.
4. **Auto-promotion guard:** add a runtime assertion (dev-only) that no `useEffect` ever sets `stance` based on something other than an explicit user action. If a `useEffect` calls `setStance`, that's a smell.

**Warning signs:**
- `viewMode` references exist after phase 1.
- A "transition helper" file maps between old and new mode.
- New `useEffect` calls in `GeoEditorView.tsx` that set stance based on data changes.

**Phase to address:** Phase 1 (state collapse). Verification: `grep -r 'viewMode\|sidebarViewMode\|editIsolationEnabled\|activeContextScope' src/ | wc -l` → 0 (excluding migration-shim file if temporarily kept).

---

### Pitfall 9: Toolbar API leaks store internals (kills future package boundary)

**Pillar:** P3 + CROSS
**What goes wrong:**
The chat tool execution path needs to draw on the map. Quickest path: import the Zustand store directly, call `useEditorStore.getState().addFeature(...)`. It works. But now the toolbar's "drawing API" is just "the entire store," and the constraint in PROJECT.md ("toolbar drawing API as if it were a package export") is silently violated. When v2 comes to extract the toolbar/chat/map packages, every chat tool has to be rewritten.

**Why it happens:**
- The store is in scope, importing it is one line.
- "It's the same repo for now" — true today, but the design constraint says otherwise.
- The discipline is not enforced by any structural barrier.

**How to avoid:**
1. **The drawing API is a typed module with explicit functions.** `drawing.createLinestring(coords, options): FeatureId`, `drawing.commitProposal(id)`, `drawing.rejectProposal(id)`, etc. No `store` import allowed from chat tool implementations.
2. **The chat tool layer imports only from `@/toolbar/api` (or equivalent path).** ESLint `no-restricted-imports` rule: chat tools cannot import from `@/features/geo-editor/store/*`.
3. **Equivalent paths for chat and UI.** The on-screen "draw linestring" button and the chat tool must call the same `drawing.createLinestring`. If the UI does extra work the API doesn't, the API is incomplete — fix the API, don't bypass it.
4. **Same enforcement for the chat's map-read tools.** A `mapState.getCurrentBbox()`, `mapState.getFeatures()` surface that doesn't expose the store.

**Warning signs:**
- A file in `src/features/chat/tools/` imports `useEditorStore` or any `store` path.
- The drawing API has fewer than ~6-10 functions (probably under-specified).
- UI code does something the chat tool can't, or vice versa.

**Phase to address:** Phase 5 / 6 (toolbar drawing API design + chat-toolbar bridge). Verification: ESLint clean + a script that lists the drawing API surface and reviews it for completeness; chat tools' import graph contains no store paths.

---

### Pitfall 10: Implicit chat binding sneaks back

**Pillar:** P1 + P3
**What goes wrong:**
`UX_REWRITE.md` §6 says "Implicit binding via `activeContextScope` is removed." The chat panel now has an explicit binding chip. But: the default binding is "the current shelf," which is itself implicit — when the shelf changes, the chat's "current understanding" silently changes. The user asks "what's in here?" expecting their previous binding, and gets an answer about a dataset they don't have in mind.

The previous bug was specifically that `activeContextScope` updated implicitly. A binding chip that *displays* an implicit default doesn't actually fix the bug.

**Why it happens:**
- "Default to the shelf" feels like a sensible UX default.
- The chip displaying the binding feels like enough — but if the chip changes without the user clicking it, it's still implicit.
- Convenience overrides discipline.

**How to avoid:**
1. **Binding is sticky once explicit, ephemeral while default.** If the user has never overridden the binding, it follows the shelf and the chip says "Bound to: current shelf (auto)." Once the user manually sets it, it stays put until they unset it — even if the shelf changes.
2. **Visible state change when the implicit binding moves.** If the auto-binding follows the shelf, that's a state change the chat panel announces inline: "Binding updated to [new shelf contents]" with an "Undo" affordance.
3. **The chip is interactive and the implicit path is clearly marked.** Not "Bound to: X" but "Bound to: X (auto)" so the user knows the binding is tracking.
4. **Tool calls receive the binding as an explicit argument**, not by reading it from the store at call time. Easier to reason about, easier to test.

**Warning signs:**
- Chat panel reads `currentBinding` directly from the store inside tool execution.
- Binding chip changes without an inline announcement.
- User can't tell which binding their question is being answered against.

**Phase to address:** Phase 6 (chat detach + binding chip). Verification: scripted test — change the shelf, then ask the chat a question; the chat's answer must clearly indicate which binding it used.

---

### Pitfall 11: Mobile shelf collapse hides the working set entirely

**Pillar:** P1 + P2
**What goes wrong:**
`UX_REWRITE.md` §3 says "on mobile, the shelf collapses to one chip with a count." Implementation ships, the chip is small, the user doesn't notice it; they tap a dataset, it goes "into the shelf" (invisible), they tap another, same thing. The map shows whatever was last opened, the user has no idea what else is in the shelf, and on a small phone there's no obvious way to see.

The shelf is the working set. Hiding the working set is worse than not having one.

**Why it happens:**
- "Save space on mobile" instinct overrides "the user needs to see what they're working with."
- Desktop-first design — mobile gets the leftover space.
- "It opens as a sheet on tap" — true, but does the user know to tap?

**How to avoid:**
1. **The collapsed shelf chip is loud.** Count badge, label ("3 layers"), pulse animation when items are added.
2. **First add to shelf opens the sheet briefly** (peek behavior) so the user sees what just happened, then auto-collapses.
3. **The chip is on the main map view's permanent toolbar**, not hidden behind a hamburger.
4. **Empty shelf shows a different chip** ("Add layers from sidebar") with discovery affordance — not just absent.

**Warning signs:**
- Mobile testing skipped during a phase.
- "It works on desktop" reviews — the maintainer is on a 27" screen.
- The chip is tiny, monochrome, no badge.

**Phase to address:** Phase 3 (Map Shelf) — mobile behaviour is in-scope from day one, not a polish task in phase 6.

---

### Pitfall 12: Privacy hole — chat content with map context published or leaked

**Pillar:** P3 + CROSS
**What goes wrong:**
The user asks the chat "draw a trail to my friend's cabin at [private coordinates]." The chat reasons through it, calls tools, draws. Somewhere in the implementation, the chat's transcript ends up persisted to Nostr (as a draft, as part of a workspace, as comment metadata, as a debug event), and now private location data is on a public relay forever — Nostr events are immutable and rebroadcast freely.

The current chat is described as "monolithic" with no test coverage (`CONCERNS.md`); risk of accidental publication is meaningful.

**Why it happens:**
- "Workspaces" persistence (PROJECT.md mentions resumable workspaces with chat session) is a candidate for sync-everywhere instinct.
- Nostr-everywhere is the platform's default mental model — easy to forget chat isn't a public artifact.
- Debug/telemetry events can leak conversational context.

**How to avoid:**
1. **Chat sessions are local-only by default.** Workspaces store chat history in `localStorage` (scoped per-pubkey via the existing `persistence.ts` pattern, with the known caveat about the `currentUser` singleton — see `CONCERNS.md`). No event, no relay.
2. **Explicit "share this chat" verb if cross-device sync is ever wanted** — but v1 should not have it.
3. **Workspaces published to Nostr (if ever) exclude chat transcript** and only include the metadata (pinned shelf set, draft pointer).
4. **AI-generated geometry, when published as kind 37515, is signed by the user.** This is correct — the user vouches for what they publish. But the *event content* should not embed the chat transcript; a tag like `["ai-assisted", "true"]` is enough provenance for relay-side; the conversation that produced it stays local.
5. **Audit every Nostr event-emit path for what's in `content` and `tags`** before P3 ships.

**Warning signs:**
- A workspace event payload includes `messages: [...]`.
- Debug logs include chat content and a debug-relay endpoint is wired up.
- "Persist chat across devices" is being added without a privacy review.

**Phase to address:** Phase 6 (chat detach + workspaces). Verification: audit pass — `grep` chat store for any path that sends data to `RelayPool` or `pool.publish`; must be empty.

---

### Pitfall 13: Scope creep into visual / typographic design system

**Pillar:** CROSS
**What goes wrong:**
While "improving the UX," the maintainer or an agent starts swapping Radix primitives, normalising spacing, introducing a new font scale, building a button variant taxonomy. PROJECT.md is explicit ("No design system overhaul"), but it's easy to drift, especially because design work feels productive and is visually rewarding.

**Why it happens:**
- Visual polish is dopaminergic.
- Components being touched anyway "could use a refresh."
- AI agents in particular love to "improve" styling because it produces visible diffs.

**How to avoid:**
1. **Visual changes require explicit justification** in every PR description: "this style change is needed because X structural reason." If the answer is "looked better," reject.
2. **Lock the design tokens** — don't introduce new Tailwind tokens, don't change existing component variants outside structural fixes.
3. **Diff review focus on Tailwind class changes** — a PR adding many new utility classes is a smell.
4. **The maintainer-dogfood metric is "I open the app for fun,"** not "the app looks pretty." Coherence > polish.

**Warning signs:**
- New colour values, font sizes, shadow tokens introduced.
- A "design pass" PR shows up in the queue.
- Radix component swaps.

**Phase to address:** Every phase — a PR-template line: "No design-system changes? ☐ confirmed".

---

### Pitfall 14: Long-running AI session drifts because the model's context fills with stale state

**Pillar:** P3
**What goes wrong:**
The chat session lasts 20 minutes. Earlier turns include geometry the user has since rejected, places they've abandoned, tools called and never used. The model's context is now polluted with stale signal; it starts referencing rejected features, calls tools redundantly, gives answers based on the wrong shelf.

This is the documented "context rot" pattern in AI coding agents — applies equally to AI map editors.

**Why it happens:**
- Default chat impls keep full transcript in context.
- Tool results accumulate as messages.
- No mechanism to "forget" rejected proposals or stale tool outputs.

**How to avoid:**
1. **Trim tool result context aggressively.** Once a proposal is accepted or rejected, the tool result message in the LLM's context can be summarised ("created linestring X, accepted") rather than kept verbatim.
2. **System prompt restates current state on each turn** — current binding, current shelf contents, current draft summary. The model doesn't have to remember; it's reminded.
3. **"New session" verb in the chat panel** — easy reset to fresh context, preserving only the map state.
4. **Bounded session length warnings** — at 15 minutes / 50 turns, suggest starting fresh.

**Warning signs:**
- Chat answers reference features the user can't see on the map.
- Cost-per-turn rises monotonically over the session.
- Demo run 1 succeeds; demo run 5 (same chat session) fails.

**Phase to address:** Phase 6 (chat). Verification: stress test — run 30 turns of mixed accept/reject in a single session; final state should still be coherent.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| Keep `viewMode` as a "compat alias" of `stance` during transition | No big-bang refactor of every reader | Two sources of truth re-emerge; the original disease returns | Never. Delete and let TypeScript errors guide the rewrite. |
| AI geometry committed straight to draft, "undo handles it" | One fewer UI surface to build | Users lose trust in the AI surface; can't tell what the AI did; demo feels janky | Never. Two-stage commit is non-negotiable. |
| Chat tool imports the editor store directly | Fastest path to working tool calls | Future toolbar/chat/map package split becomes a rewrite | Never. Build the API even if it's in the same repo. |
| Skip mobile shelf testing until phase 6 | Phase 3 ships faster | Mobile users have no idea what's in their working set; classical-utility floor cracks | Never. Mobile is in-scope from phase 3. |
| Cache MCP failures at module scope ("`failedUrls`") | Avoid duplicate failed requests | Transient failures become permanent for the session; users see missing data with no explanation | Only as per-turn memoization, not per-session. |
| Hash routing kept "for backwards compat" indefinitely | No URL breakage | Two routing systems run in parallel; sharing/linking is ambiguous | Acceptable as a one-time redirect shim (§9), not as ongoing support. |
| Mocked / stubbed Blossom in the relay (`relay/main.go:150-158`) | Local dev "works" | Tests pass against fake data; subtle bugs in real Blossom hide until production | Acceptable for local dev. Must be gated behind dev-only flag and documented. |
| AI-generated coordinates committed without grounding tool call | Demo "runs" faster | Geometry lands in wrong continent on a different prompt; demo is a fluke | Never. Grounded geocoding is the only acceptable path. |
| Persist chat transcript to a Nostr event "for sync" | Cross-device chat | Permanent public record of private location queries | Never in v1. Defer to a deliberate v2 with explicit consent UI. |
| Patch the existing `useViewMode.ts` instead of deleting | Keep some callers working during transition | The "useViewMode" name becomes the new attractor for auto-promotion logic | Acceptable only if the file's exports shrink monotonically per PR. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| ContextVM MCP (`SearchLocation`, `ReverseLookup`) | Treat as in-process function calls; ignore timeout, retry, schema versioning | Wrap with explicit timeout, structured error types, schema validation on response; surface degraded mode in UI |
| MapLibre GL (`@types/maplibre-gl` v1 against runtime v5 — see `CONCERNS.md`) | Trust the v1 types; cast to `any` when reality disagrees | Delete `@types/maplibre-gl` (MapLibre v5 ships its own types); fix the `as any` sites in `GeoEditor.ts:455,1723-1729` |
| Blossom blob upload | Assume large datasets always succeed; no automatic enforcement of the 2 MB relay cap | Detect-and-uplift via existing `BlossomUploadDialog`, but also add a *pre-publish size check* with a clear "this dataset is too large for inline; uploading to Blossom" message |
| Nostr event signing for AI-authored geometry | Sign without attribution metadata | User signs (they're vouching for the publish), but tag the event with provenance (`["ai-assisted", "true"]` or similar) so consumers can filter |
| Applesauce EventStore + RelayPool | Assume events fire immediately and synchronously | All publish flows treat as async with possible failure; UI surfaces "publishing…" / "published" / "failed — retry" states |
| LLM tool schemas (e.g. via Vercel AI SDK or similar) | Tool descriptions written quickly, model picks wrong tool | Each tool has: precise "when to use" / "when not to use" / examples; tool names diverge clearly (no two tools share noun prefixes) |
| Mapnolia (PMTiles + Blossom binary) | Run client and mapnolia on different config; client assumes mapnolia is always up | Health-check at startup; surface mapnolia availability in dev UI; explicit fallback to no-tiles mode |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Module-scoped blob cache with no eviction (`resolveBlobReferences.ts:16` — `CONCERNS.md`) | Memory grows monotonically with each dataset load; long sessions slow down | LRU bound (max N entries or max bytes) | Sessions where the user loads ≥10 large datasets |
| `JSON.parse(JSON.stringify(feature))` in hot path (`GeoEditor.ts:1612` — `CONCERNS.md`) | Frame drops during edit of complex polygons | Use `structuredClone` or a targeted property clone | Polygons with ≥1000 vertices |
| Each chat tool call holds a full feature collection in LLM context | Token cost balloons with each call on large datasets | Summarise: pass feature counts + bbox + sample features, not full geometry | Datasets >100 features |
| Unbounded chat session length | Cost grows linearly with session length; context rot (Pitfall 14) | Bounded session + summarisation between turns | Sessions >20 turns |
| All datasets fetched in one subscription (`GeoDatasetsPanel` — `CONCERNS.md`) | Initial load slow on populated relay | Cursor pagination using `limit` + `until` | Relay with >1000 events of kind 37515 |
| Re-running AI tool calls without idempotency | Latency multiplies, cost compounds | Memoize within a turn | Models with retry behaviour or eager invocation |

## Security Mistakes

| Mistake | Risk | Prevention |
|---|---|---|
| Persisting chat transcript with location queries to Nostr | Public, immutable record of private location data | Chat is local-only by default; explicit consent to share (deferred to v2) |
| `CLIENT_KEY` hardcoded in frontend bundle (`CONCERNS.md` — pre-existing) | Anyone can impersonate the MCP client identity | Move signing server-side; proxy ContextVM calls through Bun server. Not strictly in scope for this project but interacts with P3 (chat ↔ MCP) — flag if AI work expands the MCP surface |
| Private key in `localStorage` unencrypted (`CONCERNS.md` — pre-existing) | Browser XSS exfiltrates user keys | NIP-49 encryption with passphrase, or prompt user about risk |
| LLM-generated geometry published to relay with no user review | An attacker prompts the chat with crafted text that produces a poisoned dataset published under the user's pubkey | Two-stage accept/reject (Pitfall 2) makes this user-driven, not LLM-driven |
| AI-published events with no provenance tag | Cannot filter/audit AI-authored datasets in the future | Standard provenance tag from day one |
| Open relay without auth/rate-limiting (`CONCERNS.md` — pre-existing) | DoS, spam | NIP-42 for writes; rate limit for reads. Not strictly in scope but relevant if v1 demo widens public access |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---|---|---|
| AI changes the map without announcing it | User loses trust, doesn't know what to undo | Two-stage commit + chat panel announces the geometric outcome |
| Mode (stance) changes without user action | User feels the app "did something" without consent | All stance changes via explicit verbs (`UX_REWRITE.md` §8 — all six implicit transitions deleted) |
| Shelf items added silently | User doesn't know what's currently in the working set | Visual confirmation (peek animation, badge) on add |
| Chat panel can't be ignored | User doing classical browsing feels harassed by AI affordances | Detachable, collapsible, dismissible |
| Tool execution looks like "thinking" with no progress signal | User wonders if the app froze | Streaming progress: "searching for Hallstatt…" / "drawing trail…" |
| Geocoding ambiguity not surfaced ("there are 5 Springfields") | User gets a feature in the wrong Springfield, doesn't notice for a while | Tool returns top N with confidence; chat asks user to disambiguate when confidence is low |
| Nostr lingo bleeds into classical paths (kind, relay, pubkey, naddr) | New user thinks they're using a developer tool | Plain language wrappers ("dataset" not "kind 37515 event"); protocol terms only in advanced settings |
| Mobile shelf hidden behind a small chip | User doesn't realise the shelf exists | Loud chip + peek-on-add (Pitfall 11) |
| "Auto-save" with no visible confirmation | User unsure whether their draft persisted | Explicit save confirmation; draftSlice already has the plumbing — surface it |
| Undo doesn't include AI actions atomically | One AI draw = 47 undo steps (one per vertex) | Each chat tool call is one undo step |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Stance enum:** Often missing — old props (`viewMode`, `sidebarViewMode`, `editIsolationEnabled`, `activeContextScope`) still in store types. Verify: `grep -r 'viewMode' src/` returns zero hits outside transition shim.
- [ ] **Implicit transition deletion:** Often missing — at least one of the six auto-`setViewMode` calls left behind. Verify each line from `UX_REWRITE.md` §8 is actually gone.
- [ ] **Map Shelf:** Often missing — mobile collapse UX. Verify: load 3 datasets on a phone-width viewport, can the user see and manage all 3?
- [ ] **One-way routing:** Often missing — a stray `history.pushState` outside `useRouting`. Verify: `grep -r 'pushState\|replaceState' src/ | grep -v useRouting` is empty.
- [ ] **Chat binding chip:** Often missing — chip shows binding but binding still changes implicitly. Verify: change the shelf; chip should either stay (if user set it explicitly) or visibly announce the change.
- [ ] **Toolbar drawing API:** Often missing — chat tools still import the store. Verify: ESLint `no-restricted-imports` blocks it; CI fails if a chat tool imports `useEditorStore`.
- [ ] **AI provenance:** Often missing — feature objects have no `provenance` field; or the field exists but is never set by the AI path.
- [ ] **Accept/reject UI:** Often missing — proposal layer renders the same as committed features. Verify: visually distinct rendering; a non-developer can tell at a glance.
- [ ] **Coordinate validation:** Often missing — chat tool accepts coordinates without lat/lon range or order check. Verify: fuzz test with bad coordinates returns clean error.
- [ ] **Classical-utility floor:** Often missing — incognito + no Nostr signin + chat collapsed; some path breaks. Verify with the per-phase smoke checklist.
- [ ] **Demo reliability:** Often missing — works once, fails the second time. Verify: 10 cold-start demo runs must succeed at least 9 times.
- [ ] **MCP timeout/error states:** Often missing — `await` without timeout. Verify: kill the ContextVM server during a chat tool call; UX should surface a clean error.
- [ ] **Chat privacy:** Often missing — workspace event payload accidentally includes chat transcript. Verify: audit any Nostr publish path that touches workspace data.
- [ ] **Bounded tool calls:** Often missing — chat loop has no max-iterations guard. Verify: a deliberately confusing prompt doesn't burn 50 tool calls.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Reimplemented leaves (Pitfall 1) | HIGH | Audit each rewritten component for lost behaviour; revert to main's version, port only the strictly necessary changes; lesson: re-state the constraint in the next prompt header |
| AI geometry silently committed (Pitfall 2) | MEDIUM | Add the proposal layer post-hoc; mark all features from the last N hours with synthetic `provenance: 'unknown'`; surface them in inspector for retroactive review |
| LLM hallucinated coordinates ship to demo (Pitfall 3) | HIGH | Pull demo; add grounded-geocoder requirement to the prompt and tool schema; fuzz suite; re-record |
| Runaway tool calls in production (Pitfall 4) | LOW | Add tool-call budget and time budget; ship as a hotfix; monitor for one week |
| MCP silent failure (Pitfall 5) | MEDIUM | Add structured error types at the boundary; surface degraded mode UI; clear `failedUrls`-style caches on a timer |
| Classical floor regression (Pitfall 6) | MEDIUM | Add smoke checklist to CI; block phase merges that fail it |
| Two-way routing returns (Pitfall 7) | LOW (if caught early) / HIGH (if entrenched) | ESLint rule + single-writer refactor; if multiple writers exist, refactor to one chokepoint |
| Dual mode system (Pitfall 8) | HIGH (this is the previous-failure mode) | Delete old slices fully; let TypeScript errors guide the cleanup; treat as a phase 1 redo |
| Toolbar API leaks store (Pitfall 9) | MEDIUM | Add ESLint rule; refactor tool implementations to use the API; takes a few days |
| Implicit chat binding (Pitfall 10) | LOW | Make binding sticky-once-explicit; add inline announcement when auto-binding moves |
| Mobile shelf hidden (Pitfall 11) | LOW | Add loud chip + peek animation |
| Chat-content privacy hole (Pitfall 12) | VERY HIGH (events are immutable, broadcast widely) | Cannot un-publish; mitigate by changing pubkey if necessary; for v1, prevent rather than recover |
| Design-system scope creep (Pitfall 13) | LOW-MEDIUM | Revert the design changes; reaffirm constraint |
| Context rot in AI session (Pitfall 14) | LOW | Add "new session" verb; summarise tool results in context |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls. Phase numbers reference the phased rollout in `UX_REWRITE.md` §11.

| Pitfall | Pillar | Prevention Phase | Verification |
|---|---|---|---|
| 1. Reimplementing leaves | P1, CROSS | Phase 1 (state collapse) | Visual diff main vs P1 head shows ~zero leaf changes; only orchestration files in diff |
| 2. AI geometry without accept/reject | P3 | Phase 6 (chat-toolbar bridge + accept/reject UI) | Scripted demo: viewer can always tell when AI acted |
| 3. Hallucinated coordinates | P3 | Phase 5 (chat tool surface) | 20-prompt fuzz suite returns either grounded coords or clean refusal |
| 4. Runaway tool calls | P3 | Phase 5/6 | 60-second demo succeeds 9/10 with hard budget caps |
| 5. MCP silent failures | P3, CROSS | Phase 5 | Integration test against fixture server returning each error type |
| 6. Classical floor decay | P2, CROSS | Every phase | Per-phase incognito smoke checklist passes |
| 7. Two-way routing | P1 | Phase 2 (routing rewrite) | Grep clean for `pushState` outside `useRouting` |
| 8. Stance becomes dual-mode | P1 | Phase 1 (state collapse) | Old prop grep returns 0 |
| 9. Toolbar API leaks store | P3, CROSS | Phase 5 (toolbar API design) | ESLint `no-restricted-imports` clean in chat tools |
| 10. Implicit chat binding | P1, P3 | Phase 6 (chat detach + binding chip) | Manual test: shelf change preserves explicit binding |
| 11. Mobile shelf hidden | P1, P2 | Phase 3 (Map Shelf) — mobile in scope | Mobile viewport test: shelf chip is loud, peek-on-add works |
| 12. Chat privacy leak | P3, CROSS | Phase 6 (chat detach + workspaces) | Audit: no Nostr publish path touches chat transcript |
| 13. Design-system scope creep | CROSS | Every phase | PR template: "No design-system changes? confirmed" line |
| 14. Context rot in AI session | P3 | Phase 6 (chat) | 30-turn stress test; session stays coherent |

### Phase-level guards (what to verify before merging each phase)

- **Before phase 2 merges:** Phase 1 (Pitfall 1, 8) verified. Visual diff is near-empty. Grep for old mode props returns 0.
- **Before phase 3 merges:** Phase 2 (Pitfall 7) verified. Routing is one-way. Single writer for URL.
- **Before phase 4 merges:** Phase 3 (Pitfall 11) verified. Mobile shelf usable. Classical smoke checklist passes.
- **Before phase 5 merges:** Phase 4 verified. Sidebar consolidated, no split branch. Classical smoke checklist passes.
- **Before phase 6 merges:** Phase 5 (Pitfalls 3, 4, 5, 9) verified. Tool boundary clean. Coordinate validation in place. Tool-call budget enforced. MCP errors structured.
- **Before declaring v1 done:** Phase 6 (Pitfalls 2, 10, 12, 14) verified. Demo runs 9/10 in 60 s. Privacy audit clean. Classical smoke passes one last time.

## Sources

- [LLM Function-Calling Pitfalls — Codastra (Medium)](https://medium.com/@2nick2patel2/llm-function-calling-pitfalls-nobody-mentions-a0a0575888b1) — runaway tool calls, eager invocation, schema misalignment
- [Why Bad Tool Calling Makes LLMs Slow and Expensive — Codeant](https://www.codeant.ai/blogs/poor-tool-calling-llm-cost-latency) — tool-call budgets, latency caps, p95 targets
- [Production Pitfalls of LangChain — Medium](https://medium.com/codetodeploy/production-pitfalls-of-langchain-nobody-warns-you-about-44a86e2df29e) — runaway agents, cost blowouts, human-in-the-loop
- [Six Fatal Flaws of MCP — Scalifi](https://www.scalifiai.com/blog/model-context-protocol-flaws-2025) — MCP timeout, schema drift, error handling
- [SEP-1539 Timeout Coordination — MCP GitHub](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1539) — open spec gap on MCP timeouts
- [Tool Drift Hides in the Gaps — Medium](https://medium.com/@duckweave/tool-drift-hides-in-the-gaps-75a68d8198d3) — schema drift, integration tests
- [MCP Tool Design — AWS Heroes (dev.to)](https://dev.to/aws-heroes/mcp-tool-design-why-your-ai-agent-is-failing-and-how-to-fix-it-40fc) — Schema Misalignment / Functional Confusion / Context Understanding errors
- [Mitigating Geospatial Knowledge Hallucination in LLMs — arXiv](https://arxiv.org/html/2507.19586v1) — LLM geospatial hallucination benchmarking
- [Mitigating spatial hallucination via prompt engineering — Nature Sci Reports](https://www.nature.com/articles/s41598-025-93601-5) — spatial reasoning failure modes in LLMs
- [Geospatial Reasoning Capabilities of LLMs — arXiv](https://arxiv.org/html/2510.01639v1) — trajectory recovery, coordinate hallucination
- [GeoPandas Projections — coordinate axis order](https://geopandas.org/en/stable/docs/user_guide/projections.html) — EPSG:4326 lat/lon vs lon/lat confusion
- [I Hate Coordinate Systems](https://ihatecoordinatesystems.com/) — the canonical rant on CRS pitfalls
- [The Strangler Fig Pattern — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/strangler-fig.html) — incremental migration common failures
- [Strangler Fig Pattern — Steve Kinney (Enterprise UI)](https://stevekinney.com/courses/enterprise-ui/strangler-fig-introduction) — UI orchestration specific
- [Incremental Migration: Evolving Without Breaking Production — Medium](https://medium.com/@navidbarsalari/incremental-migration-evolving-without-breaking-production-edf679769918) — pitfalls of dual-state during refactor
- [Context Rot in AI Coding Agents — MindStudio](https://www.mindstudio.ai/blog/context-rot-ai-coding-agents-explained) — long-session degradation in LLM-driven workflows
- [Context Rot is Slowing Down Your AI Agent — LogRocket](https://blog.logrocket.com/context-rot-slowing-down-your-ai-agent-how-fix/) — mitigation strategies
- [Scope Creep as Discovery — Medium](https://medium.com/design-bootcamp/scope-creep-as-discovery-25e766327cff) — solo developer scope-management with AI
- [The Exit Criteria Pattern — dev.to](https://dev.to/novaelvaris/the-exit-criteria-pattern-know-when-to-stop-iterating-with-ai-lb0) — bounded-session discipline
- [AI UX Patterns — The Design System Guide](https://thedesignsystem.guide/blog/ai-ux-patterns-for-design-systems-(part-1)) — Accept/Reject/Undo UX patterns
- [Shape of AI — UX Patterns for AI](https://www.shapeof.ai/) — preview-before-commit, visual provenance
- [10 UX Design Patterns That Improve AI Accuracy and Customer Trust — CMSWire](https://www.cmswire.com/digital-experience/10-ux-design-patterns-that-improve-ai-accuracy-and-customer-trust/) — staged apply, visual distinction of AI content
- [UX Patterns for Trustworthy AI Features — DesignKey](https://www.designkey.studio/post/designing-for-trust-ai-features) — control, partnership, reversibility
- `UX_REWRITE.md` (repo root) — §8 implicit-transition deletion list; §6 chat binding; §3 shelf design
- `.planning/codebase/CONCERNS.md` — existing tech debt, known fragile areas, performance bottlenecks (especially blob-cache, deep clone, `failedUrls` patterns)
- `.planning/PROJECT.md` — pillar definitions, "amend don't replace" constraint, classical-utility discipline, key decisions

---
*Pitfalls research for: Earthly UX refactor + AI map authoring (v1)*
*Researched: 2026-05-26*
