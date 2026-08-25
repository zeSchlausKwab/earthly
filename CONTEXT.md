# Earthly domain language

This document defines the product terms used when Earthly authors map data. It is intentionally narrower than the implementation vocabulary.

## Local draft

A **local draft** is recoverable, unpublished work saved on the current device for the active account. A geometry draft owns its features, metadata, external file references, context attachments, and publish channel.

Use **Local drafts** or **Saved work** in the UI. Do not call this a workspace. `GeoEditorWorkspace` remains an internal compatibility name for the index that groups revisions of one local draft.

## Publish channel

A **publish channel** answers who receives the record:

- **Public** — publish through the user's normal Nostr outbox.
- **Private group** — encrypt and save through the group's MLS coordinator.
- **Field session** — publish to the nearby session relay according to that session's policy.

The active draft owns its channel. Navigation may suggest a channel for a new draft, but changing routes must never silently turn an existing private or nearby draft into a public one.

## Context attachment

A **context attachment** says what public subject a record belongs to, such as “Roman ruins in Carinthia.” It becomes a `c` reference when published.

A context attachment does not provide privacy and is not a storage container. A public draft may have zero or more context attachments.

## Browse scope

A **browse scope** filters the records shown in catalogs and panels. Opening a Context may set a browse scope. Browsing and attaching are distinct actions: leaving a filter does not silently rewrite a saved draft, and merely viewing a Context must not retarget existing work.

## Destination indicator

The **destination indicator** is the single UI summary of the active authoring outcome. It combines the actual publish channel with the relevant attachment:

- `Public · Unattached`
- `Public · Roman ruins in Carinthia`
- `Private · Alpine rescue`
- `Nearby · Saturday survey`

When no draft is active, the indicator describes the destination a newly created dataset would inherit from the current route. If that destination cannot be resolved, the UI keeps it visible as unavailable and publishing is blocked; it must not fall back to Public.

Drafts saved before publish channels were persisted are quarantined as **Destination needed**. They remain recoverable, but publishing and public Blossom upload stay blocked until their destination can be classified explicitly.

The Local drafts panel is the recovery surface for that classification. It lets the user choose Public, one of their active Private groups, or an active Field session. Merely opening a route never performs this migration.

The indicator's close action leaves the current destination or scope while preserving saved work. Leaving Private or Nearby never converts that draft to Public. A separate, explicit destination-change action is required for conversion.

## Conversation

A **conversation** is a durable Chat transcript with its own read-only references and AI-run history. Its place on the left or right of the map is presentation only.

Selecting, creating, moving, or closing the visible Chat surface must not create, switch, close, or retarget authoring work. Likewise, selecting an Inspector or edit surface must not change or cancel a conversation.

Before a conversation can send a prompt, the user must explicitly bind it to a valid retained Dataset edit state with **New map** or **Use current edit**. A visible edit state does not imply consent to bind it, and Earthly never creates, repairs, or changes this target automatically. An unbound or stale conversation remains readable and composable, but starting an AI request is unavailable until the user chooses a target; the unsent prompt is preserved.

A conversation may refer to any number of published entities. A reference supplies read-only context; it never grants permission to edit, update, fork, attach, or show the entity on the map.

## Edit state

An **edit state** is retained authoring work for a Dataset, Story, or Context. It owns its local draft and remains alive when another sidebar surface is selected.

Selecting an edit-state button changes only which authoring surface is visible. It does not start a conversation, close another edit state, change the Map Stack, or publish anything. A visible activity indicator may show that an AI run is working on that edit state without forcing it open.

## Inspector

The **Inspector** is the single read-only sidebar surface for the most recently inspected published Dataset, Story, Context, Sighting, or Beacon. Inspecting a subject may replace the Inspector's subject, but has no other side effects. Local drafts remain in their retained edit state; viewing one must not masquerade as inspection of a published revision.

In particular, inspection does not add or remove Map Stack entries, change browse scope, create or retarget a local draft, activate an edit state, alter Chat references, or influence an AI run. Showing something on the map, adding it to Chat, and editing or forking it are separate explicit actions.

## AI run

An **AI run** is one execution owned by a conversation and bound to the exact authoring target captured when the user sends the prompt. No run or model request begins without that explicit target. Navigation is presentation-only: changing conversations, Inspectors, edit surfaces, or entities never cancels or retargets the run.

Earthly initially executes at most one AI run globally. Other conversations remain browsable and composable while it works, but cannot start another run until it finishes or is stopped. The owning conversation and target edit state display the run's current status.

## Referenceable publication

A Dataset or feature becomes **referenceable** only after the current local draft version containing it has been published. A new or dirty local draft is not referenceable, even if an older version of the same Dataset is already published.

When an operation needs such a reference, Earthly pauses that exact operation and asks the user to **Publish and continue**. Successful publication resumes the operation with the resulting stable reference; cancellation creates no reference. The request remains bound to the captured local draft even if the user navigates elsewhere.

## Delete

**Delete** publishes the applicable Nostr deletion event for an owned entity and hides the publication locally. The UI uses the direct verb **Delete** while briefly acknowledging that relays or peers may retain copies.

Delete is distinct from **Remove from map**, **Remove from Chat**, **Discard local draft**, and **Delete saved work from this device**. Deleting saved work must never implicitly delete its conversation.

## Avoided terms

- **Workspace** — overloaded across local drafts, MLS groups, field sessions, and AI chat. Keep it internal unless referring to a specific legacy type.
- **Isolated** for destination — reserved for Map Stack visibility. Use **Unattached** when a public record has no Context.

## Map content language

**Map callout**:
An author-owned contextual card attached to a geometry and presented on the map without requiring hover or selection. The geometry owns its callouts; compact, collapsed, or hidden states are local presentation only.
_Avoid_: Annotation, popup, overlay box

**Annotation**:
A text-bearing point geometry whose map position is its authored subject. Unlike a map callout, it is geometry rather than contextual content owned by another geometry.
_Avoid_: Callout

## Experience development language

**Test identity**:
A deterministic account and signer used to execute automated scenarios. A test identity has credentials but no assumed goals, patience, or product sophistication.
_Avoid_: Persona, test user

**Experience persona**:
A behavioral archetype defined by a job, product and domain sophistication, patience, constraints, and abandonment triggers. It never contains credentials and may be used by different test identities.
_Avoid_: Test identity, demographic profile

**Journey**:
An end-to-end user goal with an entry state, outcome, recovery branch, and follow-up task. A collaborative journey may involve several experience personas in different roles.
_Avoid_: Test case, feature tour

**Scenario run**:
One experience persona attempting one journey on a particular platform and under stated conditions such as connectivity, privacy, and starting state.
_Avoid_: Journey, persona

**Capability**:
A reusable product behavior that supports one or more journey steps, such as capture, inspect, organize, share, recover, or synchronize. Capabilities are the unit used to find common ground between personas.
_Avoid_: Persona feature

**Experience finding**:
An observed blocker, confusion, contradiction, recovery failure, or product opportunity from a scenario run. A finding records its evidence level and affected capabilities; it is not automatically a feature request.
_Avoid_: Requirement, user request

**Evidence level**:
The provenance of an experience persona or finding: hypothetical, stakeholder-informed, user-observed, or repeatedly validated. Simulated behavior must never be presented as user validation.

**Intent lane**:
A lightweight entry path shaped around Explore, Capture, Coordinate, Build, or Analyze. An intent lane reveals appropriate complexity without becoming a persistent mode that locks the user out of other work.
_Avoid_: App mode, persona mode

**Review lens**:
A stakeholder perspective applied after a scenario run, such as accessibility, privacy, domain practice, product strategy, or platform parity. A review lens evaluates a journey but does not pretend to be its user.
_Avoid_: Persona
