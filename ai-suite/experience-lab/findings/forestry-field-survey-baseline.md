# Forestry field survey: browser/native handoff audit

- Date: 2026-07-19
- Journey: `forestry-field-survey`
- Personas: `forestry-planner`, `field-crew-member`
- Platforms: desktop web planning → Android-shaped mobile host surface, 390 × 844
- Evidence level: **hypothetical automated replay**, not user validation
- Research status: **context gathering only; no product UI experiment was implemented**

## Result

The planner created and published an authoritative public Dataset containing a survey boundary, then
opened Field sessions. The browser truthfully stopped at `Earthly app required`, but it provided no
way to hand the prepared Dataset to the app or select it for a Field session.

On a mobile surface backed by a deterministic simulation of the native command boundary, the crew
could start a named Field session, see the `host` role and `Nearby only` policy, and begin a new draft
whose persistent destination indicator read `Nearby · <session name>`. Leaving the destination
preserved the unfinished draft and changed the destination back to `Public · Unattached`. After
explicitly closing the resulting Dataset drawer, the crew could begin and cancel an unrelated public
Sighting capture. Neither page reported a page error.

This is deliberately not a transport proof. The simulated native boundary does not exercise Rust,
Wi-Fi, pairing, a participant phone, peer writes, fan-out, reconnect, process restart, or actual
offline behavior. The core planner-to-crew outcome therefore remains incomplete.

| Rubric | Score | Evidence |
| --- | ---: | --- |
| Entry | 2 | Public planning and app-side Field-session creation are each reachable, but continuity between them is absent. |
| Completion | 1 | The plan and host session exist; the plan never reaches the session and no participant delivery was proved. |
| Decisions | 2 | Contribution and Nearby-only policies are explicit; selecting what the session receives is impossible. |
| Vocabulary | 2 | `Field session`, `host`, and `Nearby only` are understandable; Dataset and destination migration remain product concepts. |
| Destination | 3 | The named Nearby destination is persistent during authoring and returns unambiguously to Public when left. |
| Recovery | 2 | The unfinished nearby draft is retained, but leaving opens another navigation surface that must be dismissed. |
| Continuation | 2 | Public capture works after an extra Map action closes the Dataset drawer. |
| Return | 0 | Reconnect, reload, app restart, and host restart were not exercised. |
| Parity | 1 | Browser and app-shaped surfaces expose their respective boundaries; there is no cross-runtime content handoff. |
| Confidence | 1 | Visible destination state is strong, but the journey's peer-delivery outcome has no evidence yet. |

## Triaged findings

### EXP-FS-001 — Existing work cannot move into a collaboration destination

- Severity: **blocker** for the journey's primary outcome
- Step: planner native boundary and plan not transferred
- Observation: the public survey Dataset is available on the planner's map, but neither the browser
  Field-session boundary nor the app-side session Map tab offers an action to select, copy, or
  migrate it into the nearby scope. The Field session starts empty.
- Capabilities: organize, share, author-geometry, destination, offline
- Related journeys: `event-venue-map`; the same capability applies to Private groups and future
  public-to-scoped collaboration flows.
- Shared-product hypothesis: Earthly needs one provenance-preserving operation for reusing an
  existing entity in another destination. Whether the product calls that copy, import, migrate, or
  share-to must be decided across Public, Context, Private group, and Field session semantics.
- Complexity cost: high if every destination invents its own importer; lower if the operation is a
  single entity action with explicit source, target, privacy consequence, and resulting ownership.
- Disposition: **investigate** across scoped-destination journeys before designing the UI.

### EXP-FS-002 — The browser explains the native boundary but cannot carry the plan across it

- Severity: **serious friction**
- Step: planner native boundary
- Observation: `Earthly app required` is honest, but the planner reaches a dead end after preparing
  the exact Dataset the field workflow needs. There is no app link, QR handoff, or durable selection
  that the app can resume.
- Capabilities: share, join, resume, transition, platform parity
- Related journeys: every desktop-author/mobile-consume workflow that requires native-only
  capabilities; `event-venue-map` demonstrates that an ordinary public link handoff can be sound.
- Shared-product hypothesis: runtime handoff should preserve task intent and selected entities,
  rather than merely route to a feature's collection screen.
- Complexity cost: a generic continuation envelope or canonical entity link is preferable to one
  Field-session-specific wizard.
- Disposition: **investigate** after the content-transfer semantics in `EXP-FS-001` are clarified.

### EXP-FS-003 — Named destination and delivery language form a strong shared anchor

- Severity: **opportunity**
- Step: Field session live, nearby draft started, and nearby draft left
- Observation: the session header exposes `host` and `Nearby only`; authoring exposes
  `Nearby · <session name>`; leaving changes it to `Public · Unattached` and reports that the draft
  was retained. The author never has to infer which publisher will receive the draft.
- Capabilities: destination, offline, recover, transition, inspect
- Related journeys: Private groups, Context-focused authoring, and ordinary public capture.
- Complexity cost: none; preserve the existing destination model and test the same semantics in the
  remaining scoped journeys.
- Disposition: **contract** for the frontend boundary; real transport still needs separate proof.

### EXP-FS-004 — Leaving a destination and starting a new task can stack navigation states

- Severity: **serious friction**
- Step: nearby draft left and public follow-up
- Observation: leaving the nearby destination correctly navigates to Datasets but keeps the mobile
  navigation drawer open. The global Create control remains usable, so a Sighting placement can be
  armed behind the drawer; its visible Cancel control cannot be reached until the drawer is closed.
  The replay recovered by pressing Map before beginning the public capture.
- Capabilities: recover, transition, capture, destination
- Related journeys: `squirrel-capture` and every flow that leaves a Context, Private group, Field
  session, inspector, or unfinished draft before using a global additive action.
- Shared-product hypothesis: destination exit, collection navigation, and global Create need one
  compositional rule for which surface owns focus. This is broader than a Field-session fix.
- Complexity cost: potentially low if an existing global action closes transient navigation before
  arming; higher if each feature handles the transition separately.
- Disposition: **investigate** across more exit-and-restart journeys before changing behavior.

### EXP-FS-005 — Small map controls now recur across two mobile personas

- Severity: **confusion/accessibility risk**
- Step: every mobile map-visible state
- Observation: the audit again measured the principal map controls at 32 × 32 pixels, independently
  reproducing `EXP-SQ-005` for a low-patience outdoor crew persona. The bottom dock meets the larger
  target baseline.
- Capabilities: accessibility, location, inspect, recover
- Related journeys: `squirrel-capture`, `event-venue-map`, and all mobile map work.
- Shared-product hypothesis: this is now repeated evidence for map-chrome prioritization or
  grouping, not a forestry-specific request.
- Complexity cost: enlarging every control would consume scarce map space; grouping and task-aware
  visibility need evidence from more journeys before an experiment.
- Disposition: **investigate**; evidence threshold is met, but the research cohort remains open.

## Cross-journey synthesis so far

| Shared product behavior | Evidence | Current position |
| --- | --- | --- |
| One explicit authoring destination | Public Sighting, public venue Dataset, named Nearby Field session | Preserve and extend the same model to every scoped destination. |
| Reuse an entity in another destination | Forestry is blocked; venue sharing proves canonical public links only | Define content-transfer and provenance semantics before UI. |
| Leave one task and safely begin another | Squirrel succeeds from a clean map; venue visitor exits inspection; forestry stacks a drawer and capture | Gather more scoped-exit evidence before changing shell behavior. |
| Mobile inspector versus editor semantics | Independently reproduced by Squirrel and Event | Already cross-cutting; keep in the synthesis backlog during the research freeze. |
| Mobile map-control target size | Independently reproduced by Squirrel and Forestry | Cross-persona evidence exists; wait for prioritization/context evidence. |

## Coverage gaps

- Run the journey on two real Android devices with internet disabled: invite, interrupted join,
  approval, participant write, host fan-out, reconnect, deduplication, and visible role policy.
- Prepare a public Dataset on desktop, then test the eventual provenance-preserving transfer into a
  Field session and a Private group using the same underlying product rule.
- Publish a nearby dataset and an annotated field note, then prove the peer sees stable counts and
  geometry without blinking.
- Exercise cancel-drawing/panning recovery, app background/resume, host process restart, and leaving
  with both saved and unsaved nearby work.
- Ask forestry stakeholders whether `Nearby`, `Field session`, and the current delivery-policy copy
  match their mental model under outdoor/intermittent-connectivity conditions.
