# Conversational nearby discovery: mobile baseline

- Date: 2026-07-19
- Journey: `conversational-nearby-discovery`
- Persona: `curious-map-explorer`
- Platform: mobile web, 390 × 844
- Evidence level: **hypothetical automated replay**, not user or recommendation-quality validation
- Model lane: controlled OpenAI-compatible fixture using a read-only `get_editor_state` call
- Research status: baseline preserved; targeted responsive shell corrections implemented on 2026-07-20

> Superseded on 2026-08-24: Earthly no longer permits conversation-only submission or lazy Dataset creation. A conversation must be explicitly bound to a retained Dataset edit state before Send; the visible editor never binds it automatically.

## First-pass implementation update — 2026-07-19

`EXP-AI-006` is now resolved and protected by the deterministic mobile journey. A read-only prompt
stays in **Conversation only** scope, completes the two-round `get_editor_state` exchange, and does
not create or surface a Dataset draft. The first actual AI mutation now lazily creates a local draft
at the authoring gate, using the current route destination and originating conversation. Generic
conversation create/switch/delete actions no longer rewrite saved-work associations.

The other findings in this baseline remain open: location-denial recovery, transient inspectable map
results, progressive disclosure, and mobile route/surface agreement were deliberately not bundled
into this first pass.

## Mobile shell implementation update — 2026-07-20

`EXP-AI-007` and the route/surface portion of `EXP-AI-010` are now resolved for responsive mobile.
Location denial produces a persistent explanation, a retry state, and a **Search for a place**
fallback. The authoring dock now retains a global Menu action; opening AI chat temporarily suspends
the map-bound editor sheet, and closing chat restores the same sheet detent, draft, and `/edit`
route. Search, destination, and placement guidance also occupy explicit non-overlapping map lanes.

The transient recommendation lifecycle (`EXP-AI-008`), novice chat density (`EXP-AI-009`), and real
Android permission/settings behavior remain open.

## Result

The nearby journey is currently **blocked before refinement**. The explorer denied location once,
then granted it on the next attempt. Earthly centered the map on the deterministic Vienna position
and exposed **Stop tracking location**, so the technical recovery path works. Denial itself was only
a red locate icon lasting three seconds: there was no explanation, permission guidance, toast, or
manual-place alternative.

AI chat accepted the ordinary-language question, but submission called `ensureChatWorkspace()`
before the model request. With no active workspace, Earthly created an empty Dataset draft and the
mobile shell replaced chat with the Map Stack editor. In the recorded passing run the model request
continued in the background; pressing **Stop editing** returned to chat and revealed the answer.
Repeated deterministic probes also observed the other side of the same race: the workspace was
created after `ensureChatWorkspace()` had already returned false, so the cleared prompt never reached
the fixture. The experience contract therefore accepts either zero model rounds or the complete
two-round tool cycle while the blocker is documented.

When delivered, the answer contained two synthetic park-and-coffee options in prose. Earthly has no
current non-authoring result type or host tool that can put a temporary recommendation, route, or
selection on the map. There was consequently nothing to inspect, refine spatially, or retain in Map
Stack after closing chat. The low-patience persona would reasonably abandon at this point. The audit
did verify that closing the assistant left the located viewport intact and that the explorer could
immediately start and cancel an unrelated public Sighting. No page error occurred; the expected
permission denial was logged as a console error.

| Rubric | Score | Evidence |
| --- | ---: | --- |
| Entry | 2 | AI chat is clearly named in Menu, but it opens a dense expert-oriented surface rather than a lightweight question flow. |
| Completion | 0 | No inspectable nearby result, refinement, or retained recommendation was possible. |
| Decisions | 1 | Location and destination are visible, but denial has no explanation and a read-only prompt unexpectedly enters Dataset editing. |
| Vocabulary | 1 | The prompt and final prose are ordinary language; model metrics, tool calls, Dataset/workspace language, and raw tool output dominate the surface. |
| Destination | 1 | `Public · Unattached` stays visible, but creating an empty authoring workspace implies contribution semantics during a private exploration question. |
| Recovery | 2 | Location succeeds on retry and Stop editing returns to chat, but neither recovery is explained and request delivery can race. |
| Continuation | 3 | The explorer can leave AI chat and immediately begin an unrelated public Sighting. |
| Return | 1 | The located viewport survives, but the recommendation disappears and closing the drawer leaves the URL at `/chat`. |
| Parity | 1 | Responsive browser behavior is covered; Android permission UI and lifecycle remain unproven. |
| Confidence | 2 | The shell, workspace, tool, and location behavior are deterministic enough to reproduce; place quality is deliberately synthetic. |

## Triaged findings

### EXP-AI-006 — Every chat message was coupled to an authoring workspace

- Severity: **blocker** for read-only mobile AI journeys
- Step: first prompt submitted
- Observation: `ChatPanel.handleSubmit` calls `ensureChatWorkspace()` before `sendMessage`. With no
  active workspace it creates an empty Dataset. On mobile that changes stance and replaces chat with
  the Map Stack editor even though the only requested tool is the read-only `get_editor_state`.
  Workspace activation and the immediate boolean check also race: the model request may continue or
  may never start after the composer has already been cleared.
- Capabilities: ai-assist, discover, author-geometry, recover, transition
- Related journeys: casual nearby search, article drafting, explanation/help prompts, public-to-private
  migration planning, and any future assistant question that may never mutate the map.
- Shared-product hypothesis: chat must be usable without an authoring workspace. Workspace creation
  should occur lazily at the consequential mutation boundary (and use the normal approval contract),
  not as a prerequisite for sending a message.
- Complexity cost: lower if the tool registry declares which operations require authoring and one host
  boundary ensures a workspace just before an approved mutation; high if each chat surface guesses
  intent and pre-creates drafts.
- Disposition: **resolved and contracted** for conversation-only submission and lazy draft creation.
  Refinement and transient mapped recommendations remain separate open work under `EXP-AI-008`.

### EXP-AI-007 — Location denial is encoded as a transient icon, not a recovery path

- Severity: **serious friction / accessibility**
- Step: location denied
- Observation: the locate glyph turns red for three seconds while its accessible name remains
  **Track my location**. No visible or announced message says what happened, why location helps,
  whether Earthly will track continuously, how to grant access, or how to enter a place manually.
- Capabilities: location, discover, recover, accessibility
- Related journeys: nearby discovery, live beacons, field sessions, sightings, delivery, and meeting
  point sharing.
- Shared-product hypothesis: location is one recoverable input to a map task, not an icon state. One
  cross-feature permission/recovery contract should explain purpose, state, retry, and manual fallback.
- Complexity cost: low if location consumers share one state machine and message vocabulary; high if
  each feature owns separate permission copy and retry controls.
- Disposition: **resolved and contracted for responsive mobile**. The locate control retains a
  visible retry state, Earthly explains permission denial, and the toast offers **Search for a
  place** as a manual fallback. Real Android `Don't ask again`, settings return, and process restart
  remain native coverage rather than a reason to withhold the responsive recovery path.

### EXP-AI-008 — Earthly lacks a transient, inspectable map-result lifecycle

- Severity: **blocker** for conversational exploration
- Step: first answer recovered
- Observation: the assistant can read the current viewport and return prose, while existing write
  tools can create canonical Dataset geometry. There is no middle lane for temporary candidates,
  routes, highlights, or comparison sets that are visible and inspectable on the map without implying
  publication or opening the editor. Closing chat therefore removes all useful recommendation state.
- Capabilities: ai-assist, discover, inspect, resume, organize
- Related journeys: delivery-route comparison, meeting points, maritime alternatives, event discovery,
  and research results that should be reviewed before becoming a Dataset.
- Shared-product hypothesis: recommendations need an explicit transient map-artifact lifecycle:
  create/update through refinement, inspect, dismiss, and optionally promote to a canonical entity.
  This should be a product-level map concern, not AI-chat-only rendering.
- Complexity cost: moderate if transient entries reuse Map Stack identity/visibility/zoom contracts and
  expose one promotion boundary; severe if every assistant feature invents bespoke overlays.
- Disposition: **investigate across the delivery journey** before choosing an entity or UI.

### EXP-AI-009 — The novice chat surface exposes implementation diagnostics as primary content

- Severity: **confusion / abandonment risk**
- Step: chat ready and answer recovered
- Observation: the mobile surface prominently shows provider type, fixture/model name, payment lane,
  tools enabled, Dataset/workspace chip, context and token budgets, finish reason, tool count,
  `get_editor_state`, and expandable raw JSON. These are useful debugging controls for an analyst or
  developer but compete with the one question and answer for a novice with very low patience.
- Capabilities: ai-assist, discover, accessibility
- Related journeys: nearby exploration and casual capture; expert spatial research may intentionally
  want more of this detail.
- Shared-product hypothesis: assistant diagnostics require progressive disclosure by user intent or
  mode. Trust-critical facts (provider, privacy destination, pending mutation) stay visible; execution
  telemetry and raw tool envelopes can be available without occupying the primary conversation.
- Complexity cost: lower with one shared disclosure policy than with separate “simple chat” and
  “expert chat” implementations.
- Disposition: **investigate** alongside the expert and dispatcher evidence; do not create a second
  chat component.

### EXP-AI-010 — Mobile chat navigation does not preserve route/surface agreement

- Severity: **moderate navigation confusion**
- Step: chat closed
- Observation: closing the AI drawer restores the map, and opening Map Stack works, but the URL remains
  `/chat`. The map is technically still behind the 92dvw navigation drawer while chat is open, yet is
  too narrow to inspect alongside the answer.
- Capabilities: ai-assist, inspect, resume, transition
- Related journeys: every mobile list panel and the existing desktop finding that too many concurrent
  panels can starve the map.
- Shared-product hypothesis: the shell needs one route-to-surface contract and explicit composition
  rules: which surfaces replace the map, which coexist as map-bound sheets, and what closing means for
  route/history restoration.
- Complexity cost: lower if routing and shell ownership are centralized in the GeoEditor refactor;
  high if individual panels patch history and visibility independently.
- Disposition: **resolved and contracted for the replayed mobile transition**. Authoring no longer
  removes global navigation. Menu content temporarily suspends the map-bound sheet; closing it
  restores the prior detent and draft and changes `/chat` back to `/edit`. Broader responsive shell
  composition remains related to `EXP-AI-004`, but this route/surface mismatch is no longer open.

### EXP-AI-011 — A blocked AI task does not trap the user

- Severity: **opportunity / strong existing behavior**
- Step: unrelated task started
- Observation: after stopping the empty edit and closing chat, the bottom Create action immediately
  starts public Sighting placement. The destination remains `Public · Unattached`, placement can be
  cancelled, and no page error occurs.
- Capabilities: recover, transition, author-sighting
- Related journeys: every persona that must abandon one task and begin another.
- Shared-product hypothesis: creation surfaces should remain interruptible and should not silently
  carry failed-task state into a new entity.
- Complexity cost: none; preserve this shell-level escape behavior.
- Disposition: **contract** while fixing the chat/workspace coupling.

## Cross-journey synthesis so far

| Shared product behavior | Evidence | Current position |
| --- | --- | --- |
| AI writes enter canonical entity lifecycles | Spatial analyst successfully reviewed and published a Dataset | Preserve for mutations; do not require the lifecycle for read-only questions. |
| Workspace creation is a consequential transition | Nearby chat creates an empty Dataset before a read-only request | Move workspace activation to the approved mutation boundary. |
| Useful map state must outlive a creation surface | Spatial Dataset survives chat; nearby prose does not | Investigate transient map artifacts with optional promotion to canonical entities. |
| Map and auxiliary surfaces need composition rules | Desktop analyst loses map area; mobile explorer loses usable map access | Treat this as one responsive shell problem, not separate chat tweaks. |
| Diagnostics have persona-dependent value | Analyst can use tool/diff detail; novice is overwhelmed by the same density | Use progressive disclosure within one assistant architecture. |
| Recovery must support a genuinely new task | Squirrel and nearby journeys both escape into another public capture | Preserve interruption and explicit destination reset behavior. |
| Provenance should survive beyond prose | Analyst Dataset lacks receipts; nearby answer has no retained object | A transient/canonical result lifecycle should carry source and transformation receipts. |

## Coverage gaps

- Fix the workspace/send race, then rerun the complete prompt → refinement → inspect → close-chat
  sequence without pre-creating a draft.
- Decide whether a transient map result is a Map Stack entry, a workspace artifact, a Context-like
  entity, or another domain concept only after the delivery journey supplies a second use case.
- Exercise denial through real Android permission UI, including **Don’t ask again**, settings recovery,
  and process restart; responsive manual-place fallback is now contracted.
- Verify route/back behavior for every mobile navigation drawer destination, not only AI chat.
- Test whether transient recommendations should survive reload, expire, or require an explicit Save.
- Ask novice participants which assistant metadata creates trust and which reads as developer noise.
