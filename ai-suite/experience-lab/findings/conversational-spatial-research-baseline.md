# Conversational spatial research: deterministic AI baseline

- Date: 2026-07-19
- Journey: `conversational-spatial-research`
- Persona: `spatial-data-analyst`
- Platform: desktop web, 1440 × 900
- Evidence level: **hypothetical automated replay**, not user or model-quality validation
- Model lane: controlled OpenAI-compatible fixture; the live-provider audit was verified to skip
  without explicit local configuration and was not run against a paid provider
- Research status: **context gathering only; no product UI experiment was implemented**

## First-pass implementation update — 2026-07-19

The transition portion of `EXP-AI-012` is now resolved for the replayed path. **New conversation**
changes only the transcript and leaves the Dataset's saved-work association untouched. Starting an
unrelated Story parks Dataset editing: the active draft/workspace and `draft:active` Map Stack entry
are cleared, while the published Dataset remains visible as an ordinary map layer. Chat now labels
the no-target state **Conversation only** and explains that an AI edit will start a local draft for
review.

Dirty unpublished-task resume/discard semantics and applying the same explicit parking contract to
every other entity editor remain follow-up work rather than being inferred from this one Story path.

`EXP-AI-013` was discovered in a human Paris-tour replay and fixed in the same lifecycle boundary:
geometry baked directly from an MCP result now creates the ordinary active draft before import, and
the chat target pill provides an **Open** action that restores the geometry editor from another panel.

## Result

The analyst imported a no-secret model fixture through the real Chat settings UI. The settings were
encrypted to the local test identity, survived a page reload, and were decrypted back into the
active chat. The fixture then responded to a natural-language spatial request with the same streamed
tool-call protocol as an OpenAI-compatible provider.

Earthly displayed the proposed `write_geojson_to_editor` call and a `+4 added · ~0 changed · −0
deleted` diff. With confirm-all safety enabled, the canonical editor remained at zero features until
the analyst pressed **Apply**. It then contained two points and two polygons, while a second tool set
the Dataset name and description. The assistant completed its next model round only after both tool
results existed. The analyst published the draft through the ordinary Dataset action, reached the
ordinary Dataset inspector with all four named features, closed AI chat, and retained the inspector
and mapped result. The browser reported no console or page errors.

The extended transition replay then reopened the assistant and selected **New chat**. This created a
distinct empty conversation and hid the research transcript, but retained the same four-feature
Dataset as the active editor workspace. The chat implementation also rebound that workspace to the
new conversation. After the analyst hid chat and saved an unrelated Story draft, Earthly correctly
opened `/stories` and preserved the Story fields, yet Map Stack still presented the trailhead Dataset
under **Editing** and the editor store still contained its four features. The published Dataset, its
locally active editing workspace, the old research chat, the new empty chat, and the unrelated Story
draft therefore all coexisted without a single explanation of which task was current, paused, or
finished.

This is a product-contract proof, not an intelligence proof. The fixture supplied synthetic
geometry directly; it did not query OpenStreetMap, calculate real walking catchments, judge spatial
quality, or establish source provenance. A separate live smoke exists but requires an ignored local
settings file, disables credential-bearing Playwright artifacts, and uses a read-only prompt.

| Rubric | Score | Evidence |
| --- | ---: | --- |
| Entry | 3 | Chat is one persistent toolbar action and opens with provider, model, tools, safety, and destination visible. |
| Completion | 3 | The proposal became a named, published, inspectable four-feature Dataset. |
| Decisions | 2 | The inline diff clearly gates mutation, but New chat, workspace state, and starting another entity have no equivalent task-boundary explanation. |
| Vocabulary | 2 | Dataset and geometry language fit the analyst; `binding`, tool names, and model rounds remain implementation-oriented. |
| Destination | 3 | `Public · Unattached` remained explicit from the empty map through the AI-authored draft and publication. |
| Recovery | 3 | Cancel was available before apply, undo after apply, and ordinary editor controls remained available. |
| Continuation | 2 | An unrelated Story can be started, but the prior Dataset remains actively editing and the new chat silently inherits its workspace binding. |
| Return | 3 | Encrypted provider settings survived a reload before the journey began. |
| Parity | 1 | Canonical Dataset reuse supports later viewers, but no mobile AI or handoff behavior was exercised. |
| Confidence | 2 | Tool/editor boundaries are strong; source and answer quality are intentionally outside this replay. |

## Triaged findings

### EXP-AI-001 — AI output can use the ordinary Earthly entity lifecycle

- Severity: **opportunity / strong existing behavior**
- Step: proposal applied → Dataset published → chat left
- Observation: the chat tool created an ordinary local workspace, used ordinary Dataset metadata,
  published through the existing public action, and landed in the existing inspector. Closing the
  assistant did not remove or downgrade the result.
- Capabilities: ai-assist, author-geometry, organize, publish, inspect, transition
- Related journeys: delivery route preparation, event planning, forestry analysis, and any future
  AI-assisted authoring task.
- Shared-product hypothesis: AI should remain an alternate input method into canonical Earthly
  entities, never a parallel class of “AI maps” whose lifecycle ends with the conversation.
- Complexity cost: low if the assistant continues to dispatch through the Authoring API and normal
  publication pipeline; high if future AI features add bespoke result stores.
- Disposition: **contract** the current architecture and reuse it in the next AI journeys.

### EXP-AI-002 — The approval gate is a meaningful trust boundary, not decorative confirmation

- Severity: **opportunity / strong existing behavior**
- Step: proposal awaiting review
- Observation: the transcript exposed the mutating tool and a four-feature diff while the editor
  still contained zero features. Apply changed it to four; Cancel was available before mutation and
  Undo afterward. The second model round waited for the actual tool outcome.
- Capabilities: ai-assist, author-geometry, inspect, recover
- Related journeys: every AI-assisted edit, bulk change, route correction, or imported analysis.
- Shared-product hypothesis: “assistant proposes, Earthly previews, user decides, canonical editor
  applies” is the reusable safety contract across all authoring destinations.
- Complexity cost: low when every mutating tool uses the one host-side gate; severe if individual
  tools implement their own confirmation UI or bypass it.
- Disposition: **contract** with narrower deterministic tests as new mutating tools appear.

### EXP-AI-003 — A geometry diff does not answer the analyst’s provenance questions

- Severity: **serious friction** for real research, not a failure of this synthetic contract
- Step: proposal awaiting review and Dataset published
- Observation: the analyst can inspect tool names, raw arguments, feature names, and add/change/delete
  counts, but the proposal has no structured account of source, query, retrieval time, assumptions,
  or transformation method. The published Dataset only contains metadata the model chose to write.
- Capabilities: ai-assist, discover, inspect, organize, publish
- Related journeys: delivery geocoding, maritime risk analysis, forestry planning, and any AI result
  assembled from external sources.
- Shared-product hypothesis: provenance should travel with the proposed/canonical entity as a
  product-level record, not rely on prose remaining in one chat transcript. The appropriate existing
  entity or metadata convention needs investigation before UI work.
- Complexity cost: high if each model/tool invents explanatory prose; lower if tool executions emit
  a common source-and-transformation receipt that entities may retain.
- Disposition: **investigate** across the nearby and delivery journeys before designing a surface.

### EXP-AI-004 — Expert desktop work can expose too many simultaneous surfaces

- Severity: **confusion / spatial friction**
- Step: chat ready through proposal applied
- Observation: the default Sightings list, floating Map Stack, and right AI sidebar all remained
  open while AI created an editor workspace. At 1440 × 900 the audit counted more than 160 visible
  controls at entry and more than 200 after applying the proposal; the actual map became the smallest
  major region even though spatial inspection was central to the task.
- Capabilities: ai-assist, inspect, author-geometry, transition
- Related journeys: the complex analyst and dispatcher personas; simpler personas may need much
  stronger progressive disclosure rather than the same surface arrangement.
- Shared-product hypothesis: Earthly needs a compositional shell rule for list, inspector/editor,
  Map Stack, and assistant surfaces rather than AI-specific hiding behavior.
- Complexity cost: high if every feature closes unrelated panels ad hoc; lower if the shell owns
  focus modes, minimum map area, and reversible panel restoration.
- Disposition: **investigate** in the next desktop AI journey and the later GeoEditor refactor; do
  not implement a one-journey panel rule now.

### EXP-AI-005 — Closing the assistant preserves task state and a visible way back

- Severity: **opportunity / strong existing behavior**
- Step: chat left, result retained
- Observation: **Hide AI chat** reclaimed the right side without changing the route, Dataset
  inspector, map-stack membership, geometry, or public destination. **Show AI chat** remained in the
  toolbar, so the assistant was neither a modal commitment nor a destructive exit.
- Capabilities: ai-assist, inspect, resume, transition
- Related journeys: the mobile nearby journey must achieve the same state preservation through a
  different shell, and the delivery journey must preserve destination/privacy state as well.
- Complexity cost: none; preserve the separation between assistant visibility and task state.
- Disposition: **contract** on desktop and seek parity evidence on mobile.

### EXP-AI-012 — Chat, workspace, editor, and entity tasks had independent hidden lifecycles

- Severity: **serious friction / wrong-task risk**
- Step: published Dataset → New chat → unrelated Story draft
- Observation: **New chat** creates a distinct empty transcript, but it does not create or leave the
  current workspace. Instead, `ChatPanel.handleCreateChat` silently updates the active workspace's
  `chatSessionId` to the new conversation. The already-published Dataset remains represented by an
  active local editing workspace with four features. Starting and saving an unrelated Story changes
  the route and left editor successfully, while Map Stack continues to label the Dataset as
  **Editing** and the geometry remains loaded behind the Story task. None of these transitions says
  whether the Dataset was finished, paused, still dirty, or intentionally attached to the new chat.
- Capabilities: ai-assist, author-geometry, author-story, organize, recover, resume, transition
- Related journeys: any analyst starting a second query, interrupted field work, switching between
  private/public destinations, and every future multi-document workflow.
- Shared-product hypothesis: conversation, workspace, and entity are separate concepts, but task
  transitions need one explicit contract. **New chat** should mean conversation only and must not
  silently reassign workspace ownership. Starting another entity should make the previous authoring
  task's state visible as finished, paused, or still active, while allowing its map layers to remain
  intentionally visible without calling the whole task current.
- Complexity cost: lower if the shell owns a single active-task/paused-task lifecycle and chats are
  explicit optional attachments; severe if each editor, route, and assistant independently mutates
  workspace bindings and Map Stack state.
- Disposition: **resolved and contracted for conversation switching and Dataset → Story parking**.
  Retain the baseline for the remaining dirty-draft and cross-entity lifecycle cases.

### EXP-AI-013 — Generated map geometry had no visible working-set handoff

- Severity: **blocker** for acting on a successful AI result
- Source: human desktop replay, “Can you create me a one-day tour through this city with 2 or 3
  important sights?”, 2026-07-19
- Observed behavior: the route and three sights rendered on the map and the chat target reported four
  features, but the Map Stack contained only the aggregate Sighting and Beacon layers. No geometry
  list was visible from the result.
- Root cause: `toEditor=true` MCP results were baked after tool dispatch without entering the shared
  draft lifecycle. The route was therefore the first editor mutation but never established the
  `draft:active` Map Stack entry that hosts the geometry list.
- Shared product behavior: every editable AI map result—direct GeoJSON, route, isochrone, OSM query,
  or boundary—must land in the same recoverable Dataset draft. Its chat target must remain an
  actionable return path after the user visits another panel.
- Disposition: **resolved and contracted** by the tool-result authoring test and the spatial-research
  journey, which proves the geometry list is visible and recoverable through the target's Open action.

## Cross-journey synthesis so far

| Shared product behavior | Evidence | Current position |
| --- | --- | --- |
| One explicit authoring destination | Public Sighting, public venue Dataset, named Nearby Field session, public AI Dataset | Preserve the same destination model; AI must not create an implicit destination. |
| Canonical entities outlive their creation surface | Event venue link handoff and AI Dataset after closing chat | Treat every creation method as input to one entity lifecycle. |
| Review before a consequential mutation | AI diff gate now has deterministic proof | Reuse one approval contract; do not add per-tool confirmation systems. |
| Reuse an entity in another destination | Forestry remains blocked; delivery is specified but not replayed | Still requires source/target/provenance semantics before UI. |
| Multiple desktop work surfaces compete for map area | First clearly measured in the analyst journey | Gather dispatcher and deep-editor evidence before a shell experiment. |
| Provenance survives beyond conversation | Not yet provided by the AI Dataset | Investigate as a cross-domain entity concern rather than chat-only transcript copy. |
| Starting unrelated work retires active editing without hiding map context | New conversation preserves the Dataset association; Story parks its editor while the published layer remains | Extend the same explicit active/paused/finished contract to dirty drafts and every entity editor. |

## Coverage gaps

- Run the opt-in live read-only smoke with a rotated provider credential stored under
  `ai-suite/.secrets/`; judge only connectivity and interaction, not exact wording.
- Add a deterministic remote-data receipt so a future contract can distinguish source retrieval,
  transformation, proposed geometry, and canonical entity metadata.
- Exercise Cancel and Undo as complete recovery branches, including a refined second prompt.
- Run the mobile nearby journey to test chat/map coexistence, permission recovery, refinement, and
  state retention after closing chat.
- Run the delivery journey to test public-to-private transfer semantics and ensure Private-group
  content is never added to external-model context implicitly.
- Ask real analysts which provenance fields and approval detail are necessary before they trust a
  generated Dataset.
- Repeat the transition with a dirty unpublished Dataset, then exercise resume, discard, and explicit
  completion so the future task lifecycle covers loss prevention as well as published work.
- Verify whether switching back to the original chat restores its original workspace association or
  whether **New chat** has permanently reassigned the active workspace.
