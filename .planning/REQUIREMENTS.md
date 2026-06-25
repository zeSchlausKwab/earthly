# Requirements: Earthly v1.2 — Geo Entity Model Split

**Defined:** 2026-06-23
**Core Value:** The maintainer (and any user) can open the app for fun, not duty. (v1.2 lens: the geo schema expresses each real use case as a distinct, coherent first-class entity instead of one overloaded "context.")

## v1 Requirements

Requirements for the v1.2 milestone. Full v2 / clean-break scope: spec + all event classes + full authoring UI for every kind. Each maps to a roadmap phase.

### Spec & Foundation (SPEC)

- [x] **SPEC-01**: SPEC.md v2 documents the split entity model — Story (~37520), slimmed Group (37518), Live Beacon (~37521), Temporal Sighting — replacing the overloaded kind-37518 "context", with final kind-number assignments.
- [x] **SPEC-02**: Each new kind has an event class following the existing Factory + Cast pattern (`helpers.ts`/`cast.ts`/`factory.ts`), sharing one extracted tag-helper module for `bbox`/`g`/`L`/`l`/`t`/`c`/`a`.
- [x] **SPEC-03**: Every new-model event carries an in-content version discriminator, and the client defensively parses so legacy kind-37518 events still present on relays are recognized and skipped rather than mis-rendered (clean-break safety on an append-only substrate).
- [x] **SPEC-04**: Group schema + geometry validation runs off the main thread in a Web Worker with a hard timeout-kill, schema-hash–cached, restricted dialect (no `$data`, no external `$ref`, size/depth capped) — untrusted relay-authored schemas cannot freeze or crash a viewer's tab.
- [x] **SPEC-05**: NIP-40 expiration is shared infrastructure — the client always filters expired events on read regardless of relay garbage-collection behavior.

### Story / Article (STORY) — curate-pull, closed

- [ ] **STORY-01**: A user can create a Story with a title, summary, cover image, and a Markdown body (NIP-23 metadata tags).
- [ ] **STORY-02**: A user can embed inline references to datasets/features (and images/videos) in the Story body that render in place with an eye-toggle (show/hide on map) and a fly-to button.
- [ ] **STORY-03**: Inline `nostr:naddr…` geo references in the body are automatically mirrored to queryable `a` tags on the Story event.
- [ ] **STORY-04**: A user can save a Story as a draft before publishing, and edit a published Story in place (parameterized-replaceable, same `d`-tag lineage).
- [ ] **STORY-05**: A user can comment on and react to a Story (reuses kind 37517 + kind 7).
- [ ] **STORY-06**: A user can propose an edit to a Story's narrative, and the author can preview and accept/reject it (kind 37519 extended to a Markdown-content target).

### Group / Topic (GROUP) — attach-push + governance ladder

- [ ] **GROUP-01**: A user can create a Group with a name, description, and an explicit `governance` setting of open, schema, or closed.
- [ ] **GROUP-02**: A user can attach their dataset (or sighting) to a Group via a `c` tag, and it appears in the Group's contribution (foreign) lane.
- [x] **GROUP-03**: A Group owner can define a contribution schema (allowed geometry types + JSON-Schema property rules) for a schema-governed Group through an authoring UI usable by non-developers.
- [ ] **GROUP-04**: When attaching to a schema Group, the contributor sees inline validation warnings before publishing but is never blocked from publishing a valid standalone dataset.
- [ ] **GROUP-05**: A viewer of a schema Group sees only conforming attachments by default, with a per-view override (off / warn / strict).
- [ ] **GROUP-06**: A Group owner can add optional narrative and pin "canonical" curated references (curate-pull within the Group).
- [ ] **GROUP-07**: A user can comment on and react to a Group.
- [ ] **GROUP-08**: An open Group is usable and trustworthy without human moderation (NO-MOD MINIMUM): curated/pinned refs are the privileged default lane; the foreign lane is collapsed, opt-in, capped and sorted; every `c` coordinate is signature- and kind-validated; and a viewer can locally mute a contributor.

### Live Beacon (BEACON) — real-time position

- [ ] **BEACON-01**: A user can start a live position beacon that updates on the map as their position changes.
- [ ] **BEACON-02**: A beacon auto-expires via a user-set time box (NIP-40), and the user can explicitly stop sharing at any time, leaving an unambiguous ended state.
- [ ] **BEACON-03**: A viewer sees a beacon's current position with an honest staleness indicator ("last seen N min ago") so a stopped/stale beacon is never shown as current.
- [ ] **BEACON-04**: A user can make a beacon public/discoverable or share it via a link that a viewer can open without an account.

### Temporal Sighting (SIGHT) — time-bound observation

- [ ] **SIGHT-01**: A user can create a Sighting — a single placed feature with a title, description, and an observation time (NIP-52 `start`, optional `end`) distinct from the publish time.
- [ ] **SIGHT-02**: A user can attach a Sighting to a Group/Topic via a `c` tag.
- [ ] **SIGHT-03**: A Sighting can carry an expiry so stale sightings auto-fade from the map (NIP-40, client-filtered).
- [ ] **SIGHT-04**: A user can comment on and react to a Sighting.

### Taxonomy (TAX)

- [x] **TAX-01**: A user can apply NIP-32 `L`/`l` controlled-vocabulary labels to entities, a schema Group can enforce an allowed `l`-value set, and freeform `t` hashtags remain available for discovery — the three-way `L`/`l` · `t` · `c` split replacing the overloaded `t`/taxonomy on old 37518.

### Cross-cutting (XCUT)

- [ ] **XCUT-01**: The comment system accepts every new kind as a comment root (NIP-22 `K`/`k` widening) so Story, Group, Beacon, and Sighting are all commentable.
- [ ] **XCUT-02**: Each new entity type is addressable by the router so it can be opened, deep-linked, and shared, replacing the old single-context route shape.

## v2 Requirements

Deferred to a future milestone. Acknowledged, not in this roadmap.

### Story polish

- **STORY-07**: Scroll-linked map camera — the map flies to inline refs as the reader scrolls the prose ("story map" reading order).

### Beacon advanced

- **BEACON-05**: Beacon driven by an external data source / the v1.1 code sandbox (asset/vehicle/AIS feed), not just the sharer's GPS.
- **BEACON-06**: Beacon trail / breadcrumb history (only meaningful if an ephemeral-stream lifecycle is later adopted).
- **BEACON-07**: Encrypted/private per-viewer beacons (NIP-17 gift-wrap).

### Sighting advanced

- **SIGHT-05**: Polished AI paste→Sighting ingest flow (paste a message → AI geolocates → placed Sighting); plumbing exists from v1.1, productize later.
- **SIGHT-06**: Geoprivacy obscuring (coarse location) for sensitive Sightings.

### Moderation & trust

- **MOD-01**: NIP-72 human moderation — approval events + moderator/role lists (kind 30000).
- **MOD-02**: Web-of-trust + mute lists for spam mitigation (the deferred companion to MOD-01).

## Out of Scope

Explicitly excluded for v1.2. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| NIP-72 human approval / moderator role lists | Deferred this milestone; spam is a reading-user concern via web-of-trust + mute (next milestone). Open Groups rely on GROUP-08's NO-MOD MINIMUM instead. |
| Relay-side rejection of invalid attachments | Relays are generic and cannot enforce app schemas; a valid Nostr event cannot be rejected. View-side filter-on-fetch (GROUP-05) is the only enforceable layer. |
| Blocking a contributor's publish on schema failure | Frustrates contributors; their dataset is a valid standalone 37515. Warn-and-allow (GROUP-04) instead. |
| Migration / back-compat for existing kind-37518 data | Clean break — existing 37518 data is seed/test only. SPEC-03 covers defensive skip of legacy events, not migration. |
| Free-form WYSIWYG / arbitrary HTML in Stories | NIP-23 is Markdown; HTML breaks interop and invites XSS. Markdown + a fixed inline ref/media extension set only. |
| Always-on background location tracking / permanent beacon trails on relays | Privacy/surveillance footgun. Beacons are time-boxed (BEACON-02), explicit-start, foreground by default. |
| Editable/replaceable Sightings with version lineage | An observation is a point-in-time claim; mutating rewrites history. Corrections are new Sightings or comments. |
| Saved Map / Scene + Collection-as-list entities | Considered and dropped from this milestone's entity set. |
| Compound routing | v2 per PROJECT.md. |
| v1.0 UX-orchestration debt (stance enum, mode-promotion deletion, sidebar rework, explicit verbs) | Carried-over Pillar 1/2/3 work; remains deferred while v1.2 reshapes the entity model. |

## Traceability

Populated during roadmap creation. Phase numbering continues from v1.1 (which ended at Phase 07), so v1.2 spans Phases 08–13.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SPEC-01 | Phase 8 | Complete |
| SPEC-02 | Phase 8 | Complete |
| SPEC-03 | Phase 8 | Complete |
| SPEC-04 | Phase 8 | Complete |
| SPEC-05 | Phase 8 | Complete |
| TAX-01 | Phase 8 | Complete |
| GROUP-01 | Phase 9 | In progress (09-02: factory/cast/governance contract GREEN; 09-04: GroupEditorPanel governance-ladder create/edit authoring surface + GroupFactory write path landed, build green; live publish/edit confirmation deferred to end-of-phase UAT) |
| GROUP-02 | Phase 9 | In progress (09-03: #c attach-discovery filter + governance!==closed lane gate GREEN; contributor attach UI pending 09-05) |
| GROUP-03 | Phase 9 | Complete (09-04: schemaBuilder.ts compileBuilderSchema → draft-2020-12 + GroupEditorPanel visual builder/advanced-JSON authoring, both feed the Phase-8 off-thread worker; schemaBuilder.test GREEN) |
| GROUP-04 | Phase 9 | In progress (09-03: warn-not-block invariant — canPublishStandalone always true GREEN; inline-warning UI pending 09-05) |
| GROUP-05 | Phase 9 | In progress (09-03: off/warn/strict filterModes off-thread, default-strict-for-schema GREEN; viewer override UI pending 09-06) |
| GROUP-06 | Phase 9 | Pending |
| GROUP-07 | Phase 9 | Pending |
| GROUP-08 | Phase 9 | Pending |
| STORY-01 | Phase 10 | Pending |
| STORY-02 | Phase 10 | Pending |
| STORY-03 | Phase 10 | Pending |
| STORY-04 | Phase 10 | Pending |
| STORY-05 | Phase 10 | Pending |
| STORY-06 | Phase 10 | Pending |
| SIGHT-01 | Phase 11 | Pending |
| SIGHT-02 | Phase 11 | Pending |
| SIGHT-03 | Phase 11 | Pending |
| SIGHT-04 | Phase 11 | Pending |
| BEACON-01 | Phase 12 | Pending |
| BEACON-02 | Phase 12 | Pending |
| BEACON-03 | Phase 12 | Pending |
| BEACON-04 | Phase 12 | Pending |
| XCUT-01 | Phase 13 | Pending |
| XCUT-02 | Phase 13 | Pending |

**Coverage:**

- v1 requirements: 30 total
- Mapped to phases: 30 (Phases 8–13)
- Unmapped: 0 ✓

**Per-phase requirement counts:**

| Phase | Requirements | Count |
|-------|--------------|-------|
| 8. Spec v2 + Foundation | SPEC-01..05, TAX-01 | 6 |
| 9. Group / Topic | GROUP-01..08 | 8 |
| 10. Story / Article | STORY-01..06 | 6 |
| 11. Temporal Sighting | SIGHT-01..04 | 4 |
| 12. Live Beacon | BEACON-01..04 | 4 |
| 13. Cross-Cutting | XCUT-01, XCUT-02 | 2 |

---
*Requirements defined: 2026-06-23*
*Last updated: 2026-06-24 after roadmap creation — all 30 requirements mapped to Phases 8–13*
</content>
