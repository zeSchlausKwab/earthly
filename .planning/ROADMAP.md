# Roadmap: Earthly

## Milestones

- ✅ **v1.1 AI Chat** — Phases 1–7 (shipped 2026-06-23) — see [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Geo Entity Model Split** — Phases 8–13 (in progress)

## Phases

<details>
<summary>✅ v1.1 AI Chat (Phases 1–7) — SHIPPED 2026-06-23</summary>

Data Ingest, Transform & Safe Authoring — turned the AI chat from a map-drawing assistant into a data-ingest-and-transformation workbench. Full phase details, decisions, and per-plan breakdown archived in [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

- [x] Phase 1: Encrypted Settings Persistence (3/3 plans) — completed 2026-06-16
- [x] Phase 2: Tool Registry & Authoring API (6/6 plans) — completed 2026-06-16
- [x] Phase 3: File Ingest & Multimodal (6/6 plans) — completed 2026-06-17
- [x] Phase 4: Code Interpreter Sandbox (3/3 plans) — completed 2026-06-20
- [x] Phase 5: Dataset-Aware Safe Editing (5/5 plans) — completed 2026-06-21
- [x] Phase 6: AI Bulk Transform & Data-Driven Styling (5/5 plans) — completed 2026-06-22
- [x] Phase 7: Geometry Optimization (5/5 plans) — completed 2026-06-23

</details>

### 🚧 v1.2 Geo Entity Model Split (In Progress)

**Milestone Goal:** Split the overloaded kind-37518 "context" into role-specific geo entity kinds — Story/Article (curate-pull), slimmed Group/Topic (attach-push + governance ladder), Live Beacon (real-time position), Temporal Sighting (time-bound observation) — each with full create/edit/comment/react/attach authoring UI, so the schema expresses each real use case as a distinct first-class entity instead of one discriminated union. Clean break on legacy 37518 data; amend (don't replace) — `group/` refactors `map-context/`, dataset (37515) and proposal (37519) stay untouched (37519 gets a small Markdown-target extension).

The dependency spine: **Foundation blocks everything** → **Group first** (refactor-dominant, exercises the shared seams + the two highest-severity pitfalls) → **Story / Sighting / Beacon** (independent once Foundation lands; Beacon last for net-new live-render + privacy surface) → **Cross-cutting** (comment widening + routing).

- [x] **Phase 8: Spec v2 + Foundation** — Kind assignment, SPEC.md v2, Factory+Cast scaffolding, shared `tags.ts`, version discriminator + legacy skip, off-thread schema-validation worker, NIP-40 expiry filter, NIP-32 `L`/`l` taxonomy helper
- [ ] **Phase 9: Group / Topic (37518 slimmed)** — Attach-push `c`-lane, governance ladder (open · schema · closed), schema authoring + validate-on-fetch, NO-MOD MINIMUM, comment/react
- [ ] **Phase 10: Story / Article (~37520)** — Curate-pull Markdown narrative, inline geo-ref render (eye-toggle/fly-to), naddr→`a` mirroring, draft + in-place edit, comment/react/propose-edit
- [ ] **Phase 11: Temporal Sighting** — Time-bound placed observation (NIP-52 `start`/`end`), optional NIP-40 auto-fade, `c`-attach to Group, comment/react
- [ ] **Phase 12: Live Beacon (~37521)** — Real-time updating position point, NIP-40 time-box + explicit stop, honest staleness, public/share-link viewing, live-map render
- [ ] **Phase 13: Cross-Cutting** — Comment `K`/`k` root-scope widening + entity routing/addressing across all four new kinds

## Phase Details

### Phase 8: Spec v2 + Foundation

**Goal**: Every shared seam the four entity kinds depend on exists and is safe — kind constants, the extracted tag-helper module, the off-thread schema-validation worker, the in-content version discriminator with defensive legacy skip, the shared NIP-40 expiry filter, and the NIP-32 `L`/`l` taxonomy helper — with SPEC.md v2 documenting the whole split entity model. Nothing per-kind ships with copy-paste or an unguarded validator.
**Depends on**: Nothing (first phase of v1.2; builds on shipped v1.1 surface)
**Requirements**: SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05, TAX-01
**Success Criteria** (what must be TRUE):

  1. SPEC.md v2 documents the split entity model (Story ~37520, slimmed Group 37518, Live Beacon ~37521, Temporal Sighting) with final kind-number assignments, replacing the overloaded kind-37518 "context".
  2. Each new kind has Factory+Cast event-class scaffolding (`helpers.ts`/`cast.ts`/`factory.ts`) consuming one shared `tags.ts` module for `bbox`/`g`/`L`/`l`/`t`/`c`/`a` — no copy-pasted tag logic.
  3. A legacy kind-37518 event still present on a relay is recognized via the in-content version discriminator and defensively skipped rather than mis-rendered or crashing the viewer.
  4. An untrusted relay-authored Group schema (e.g. a ReDoS `pattern` or recursive `$ref`) cannot freeze or crash a viewer's tab — schema validation runs off the main thread with a hard timeout-kill, schema-hash cache, restricted dialect (no `$data`, no external `$ref`, size/depth capped).
  5. The client filters expired (NIP-40) events on read regardless of relay garbage-collection behavior, and a user can apply NIP-32 `L`/`l` controlled-vocabulary labels with correct namespace pairing while freeform `t` hashtags remain available — the three-way `L`/`l` · `t` · `c` split is in place.**Plans**: 5 plans (Wave 0 → 3)

**Wave 1**

  - [x] 08-01-PLAN.md — Nyquist Wave-0: create the six test stub files pinning every seam's export contract (RED baseline)
  - [x] 08-02-PLAN.md — kind constants (D-01), shared tags.ts (+migrate 2 consumers), NIP-32 L/l + vocab (TAX-01), modelVersion discriminator (SPEC-03), isExpired/dropExpired (SPEC-05)
  - [x] 08-03-PLAN.md — off-thread hardened schema-validation worker + registration (SPEC-04: ReDoS/$ref/$data/size-depth defenses, fail-closed, compile-once-per-hash)

**Wave 2** *(blocked on Wave 1 completion)*

  - [x] 08-04-PLAN.md — Factory+Cast scaffolds for Article 37520 / Live Beacon 37521 / Temporal Sighting 37522 (SPEC-02/03)

**Wave 3** *(blocked on Wave 2 completion)*

  - [x] 08-05-PLAN.md — SPEC.md v2 in-place rewrite documenting the split entity model + doc-assertion test (SPEC-01)

**Research flag**: SKIP — all decisions documented in research files; kinds + tag helpers + worker harness are proven patterns (v1.1 QuickJS-in-Worker shape).

### Phase 9: Group / Topic (37518 slimmed)

**Goal**: A user can run an attach-push Group with an explicit governance ladder (open · schema · closed) where datasets/sightings self-attach via `c`, schema-governed Groups validate contributions off-thread without blocking valid standalone publishes, and an open Group is usable and trustworthy with no human moderator — the NO-MOD MINIMUM and the schema DoS guard both ship here, never after.
**Depends on**: Phase 8 (tags.ts, schema worker, version discriminator, `L`/`l` helper)
**Requirements**: GROUP-01, GROUP-02, GROUP-03, GROUP-04, GROUP-05, GROUP-06, GROUP-07, GROUP-08
**Success Criteria** (what must be TRUE):

  1. A user can create a Group with name, description, and an explicit `governance` setting of open, schema, or closed, and a non-developer owner can author a contribution schema (allowed geometry types + JSON-Schema property rules) through the authoring UI.
  2. A user can attach their dataset or sighting to a Group via a `c` tag and see it appear in the Group's foreign (contribution) lane; attaching to a schema Group surfaces inline validation warnings before publishing but never blocks publishing a valid standalone dataset.
  3. A viewer of a schema Group sees only conforming attachments by default, with a per-view override (off / warn / strict), and a legible filter-reason for hidden ones.
  4. An open Group is trustworthy without moderation (NO-MOD MINIMUM): curated/pinned refs are the privileged default lane; the foreign lane is collapsed, opt-in, capped and sorted; every `c` coordinate is signature- and kind-validated before render; a viewer can locally mute a contributor; and the owner can flip to closed in one click.
  5. A Group owner can add optional narrative and pin "canonical" curated references, and any user can comment on and react to a Group.

**Plans**: 6 plans (Wave 1 → 5)

**Wave 1**

  - [x] 09-01-PLAN.md — Nyquist Wave-0: 9 RED test stubs pinning every Group seam (GROUP-01..08 + O-03 schema-hash + D-06 worker errors[] + mute store)

**Wave 2** *(blocked on Wave 1)*

  - [ ] 09-02-PLAN.md — `group/` module: refactor map-context → governance enum, isGroup modelVersion gate, EntityFactory + tags.ts delegation, setSchemaHash transformer, useGroups [GROUP-01]

**Wave 3** *(blocked on Wave 2)*

  - [ ] 09-03-PLAN.md — validation pipeline: off-thread worker verdict + per-rule errors[] (D-06), canonical schema-hash (O-03), filterModes off/warn/strict, attach warn-not-block, device-local global mute store [GROUP-02/04/05]

**Wave 4** *(blocked on Wave 3; 04 + 05 run in parallel — disjoint files)*

  - [ ] 09-04-PLAN.md — GroupEditorPanel: governance radio cards (D-01) + visual schema builder + raw-JSON advanced (D-04) + canonical schema-hash write [GROUP-01/03]
  - [ ] 09-05-PLAN.md — contributor attach: c-tag picker + inline per-rule warnings + Publish-anyway (never blocks a standalone publish) [GROUP-02/04]

**Wave 5** *(blocked on Waves 2–4)*

  - [ ] 09-06-PLAN.md — GroupViewPanel NO-MOD two-lane: curated-first/foreign-second, per-coordinate sig+kind+mute gate before render, cap/sort/filter+reason, escape hatch, pin/bless, narrative, comment/react [GROUP-05/06/07/08]

**Research flag**: RESOLVED at planning — `governance` clean-break shape (O-02, legacy triad simply absent); non-developer schema builder + raw-JSON escape hatch (D-04); foreign-lane cap = 50, newest-first (O-01, no trust source in app — follows-boost deferred); NO-MOD UX contract (curated-default, local+global mute) all planned.
**UI hint**: yes

### Phase 10: Story / Article (~37520)

**Goal**: A user can author a curate-pull Story — a Markdown narrative with inline geo references that render in place and a map lane derived from the body — publish/edit it in place with draft support, and let readers comment, react, and propose narrative edits via the reused proposal machinery.
**Depends on**: Phase 8 (tags.ts, naddr/`a` helpers, version discriminator)
**Requirements**: STORY-01, STORY-02, STORY-03, STORY-04, STORY-05, STORY-06
**Success Criteria** (what must be TRUE):

  1. A user can create a Story with a title, summary, cover image, and a Markdown body (NIP-23 metadata tags).
  2. A user can embed inline references to datasets/features (and images/videos) in the body that render in place with an eye-toggle (show/hide on map) and a fly-to button, and inline `nostr:naddr…` geo references are automatically mirrored to queryable `a` tags on publish (single source of truth = the Markdown body; `a` tags re-derived every publish).
  3. A user can save a Story as a draft before publishing and edit a published Story in place (parameterized-replaceable, same `d`-tag lineage).
  4. A user can comment on and react to a Story (reuses kind 37517 + kind 7), and a user can propose an edit to a Story's narrative that the author can preview and accept/reject (kind 37519 extended to a Markdown-content target).

**Plans**: TBD
**Research flag**: SKIP — NIP-23 is well-documented; `getContentPointers` is a library call; the 37519 generalization to a Markdown-content target is small and well-scoped (confirm whether it is a pure content-type extension or needs a spec discriminator during Phase planning).
**UI hint**: yes

### Phase 11: Temporal Sighting

**Goal**: A user can create a time-bound observation — a single placed feature with a title, description, and an observation time distinct from publish time — optionally auto-fading via NIP-40 expiry, attachable to a Group via `c`, and commentable/reactable. Resolves the open phase-research question on Sighting representation (dedicated kind vs 37515 + property + NIP-40).
**Depends on**: Phase 8 (tags.ts, NIP-40 expiry filter, version discriminator), Phase 9 (`c`-attach lane for SIGHT-02)
**Requirements**: SIGHT-01, SIGHT-02, SIGHT-03, SIGHT-04
**Success Criteria** (what must be TRUE):

  1. A user can create a Sighting — a single placed feature with a title, description, and an observation time (NIP-52 `start`, optional `end`) distinct from the publish time.
  2. A user can attach a Sighting to a Group/Topic via a `c` tag and see it land in that Group's contribution lane.
  3. A Sighting can carry an expiry so stale sightings auto-fade from the map (NIP-40, always client-filtered at every read path regardless of relay GC).
  4. A user can comment on and react to a Sighting.

**Plans**: TBD
**Research flag**: NEEDS phase-research decision (LEFT OPEN at roadmap level) — dedicated lightweight kind vs 37515 + property + NIP-40; confirm a new kind number does not require relay-side Khatru filter changes beyond what existing `pool.req` filters handle.
**UI hint**: yes

### Phase 12: Live Beacon (~37521)

**Goal**: A user can run a real-time, time-boxed position beacon that updates on the map as their position changes, auto-expires via NIP-40 with an explicit stop leaving an unambiguous ended state, shows viewers an honest staleness indicator so a stopped/stale beacon is never shown as current, and can be made public or shared via an account-free link. This phase adds the one genuinely net-new live-map-render subsystem and carries the most privacy surface — sequenced last among the kinds.
**Depends on**: Phase 8 (tags.ts, NIP-40 expiry filter, version discriminator)
**Requirements**: BEACON-01, BEACON-02, BEACON-03, BEACON-04
**Success Criteria** (what must be TRUE):

  1. A user can start a live position beacon that updates on the map as their position changes (default OFF, explicit start, foreground by default).
  2. A beacon auto-expires via a user-set time box (NIP-40) and the user can explicitly stop sharing at any time, leaving an unambiguous "ended" terminal state; the user is warned the last point stays public on a no-delete substrate.
  3. A viewer sees a beacon's current position with an honest staleness indicator ("last seen N min ago") so a stopped or stale beacon is never shown as current (grey-out past threshold).
  4. A user can make a beacon public/discoverable or share it via a link that a viewer can open without an account.

**Plans**: TBD
**Research flag**: NEEDS phase-research decision (LEFT OPEN at roadmap level) — Beacon lifecycle: parameterized-replaceable + NIP-40 vs ephemeral; confirm with a relay echo test (Khatru NIP-40 GC behavior), `seq`-tag schema for clock-skew de-dup, and the exact staleness grey-out threshold; plus the visibility/privacy model.
**UI hint**: yes

### Phase 13: Cross-Cutting

**Goal**: The cross-cutting concerns that only become verifiable once all four entity kinds exist are closed: the comment system accepts every new kind as a comment root, and each new entity type is addressable by the router so it can be opened, deep-linked, and shared — replacing the old single-context route shape.
**Depends on**: Phases 9, 10, 11, 12 (all four kinds must exist to widen comments and routing across them)
**Requirements**: XCUT-01, XCUT-02
**Success Criteria** (what must be TRUE):

  1. The comment system accepts Story, Group, Beacon, and Sighting as comment roots (NIP-22 `K`/`k` widening), verified end-to-end across all four kinds.
  2. Each new entity type is addressable by the router so it can be opened, deep-linked, and shared, replacing the old single-context route shape.

**Plans**: TBD
**Research flag**: SKIP — comment widening and routing are incremental; nothing novel.
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Encrypted Settings Persistence | v1.1 | 3/3 | Complete | 2026-06-16 |
| 2. Tool Registry & Authoring API | v1.1 | 6/6 | Complete | 2026-06-16 |
| 3. File Ingest & Multimodal | v1.1 | 6/6 | Complete | 2026-06-17 |
| 4. Code Interpreter Sandbox | v1.1 | 3/3 | Complete | 2026-06-20 |
| 5. Dataset-Aware Safe Editing | v1.1 | 5/5 | Complete | 2026-06-21 |
| 6. AI Bulk Transform & Data-Driven Styling | v1.1 | 5/5 | Complete | 2026-06-22 |
| 7. Geometry Optimization | v1.1 | 5/5 | Complete | 2026-06-23 |
| 8. Spec v2 + Foundation | v1.2 | 5/5 | Complete    | 2026-06-25 |
| 9. Group / Topic (37518 slimmed) | v1.2 | 1/6 | In Progress|  |
| 10. Story / Article (~37520) | v1.2 | 0/TBD | Not started | - |
| 11. Temporal Sighting | v1.2 | 0/TBD | Not started | - |
| 12. Live Beacon (~37521) | v1.2 | 0/TBD | Not started | - |
| 13. Cross-Cutting | v1.2 | 0/TBD | Not started | - |
</content>
</invoke>
