# Phase 9: Group / Topic (37518 slimmed) - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship the **first per-kind entity** of v1.2: an attach-push **Group** (kind 37518, slimmed) with an explicit governance ladder (`open · schema · closed`). Concretely:

- Refactor `src/lib/nostr/map-context/` → `src/lib/nostr/group/` (cast/factory/helpers/index; ~90% carries over) consuming the shared `tags.ts` shipped in Phase 8.
- Slim the content shape from the old `contextUse`/`validationMode`/`allowForeignAttachments` triad to a single `governance: 'open' | 'schema' | 'closed'` enum.
- **Attach lane (`c`):** datasets (and, in Phase 11, sightings) self-attach via a `c` tag and appear in the Group's foreign (contribution) lane. Discovery subscription `{ kinds:[37515], '#c':[groupCoord] }`.
- **Schema governance:** a non-developer owner authors a contribution schema (allowed geometry types + JSON-Schema property rules); contributions are validated **off-thread** (Phase 8's hardened Ajv worker) — warn-not-block on write, filter-on-fetch on read.
- **NO-MOD MINIMUM (GROUP-08):** curated/pinned refs are the privileged default lane; the foreign lane is collapsed/opt-in/capped/sorted; every `c` coordinate is signature- and kind-validated before render; a viewer can locally mute a contributor; the owner can flip to `closed` in one click.
- Comment + react on a Group (GROUP-07, reuses kind 37517 + kind 7).

**Scope anchor:** Group authoring + view + attach + governance + NO-MOD MINIMUM + schema DoS guard wiring. The schema worker itself already exists (Phase 8). Sighting *creation* is Phase 11 (it attaches into the lane built here). Comment-root widening across all kinds and entity routing/addressing are **Phase 13** — not here. Beacon/Story are their own phases. No NIP-72 human moderation (deferred this milestone).

</domain>

<decisions>
## Implementation Decisions

### Create / edit + governance ladder
- **D-01:** Governance ladder presented as **3 radio cards, each with a one-line plain-language explanation** of what it means for contributors (open = anyone attaches; schema = attachments validated; closed = only owner's curated refs). The schema-authoring UI appears only when `schema` is selected.
- **D-02:** The owner's "flip to closed" escape hatch (GROUP-08) is a **visible owner-only button on the Group view panel** itself (e.g. "Lock down / switch to closed"), reachable the moment abuse is seen — not buried in the edit form. Confirms, then republishes with `governance: 'closed'`.
- **D-03:** Curated-ref pinning (GROUP-06) works **two ways**: (a) the owner can **promote any foreign-lane attachment** to the curated lane in one click ("bless a contribution"), AND (b) **add a curated ref directly** by searching/picking a dataset (or naddr). Both flows land the ref in the privileged curated lane.

### Schema authoring + contributor attach
- **D-04:** Schema-authoring model = **visual field-rule builder as the default, plus a raw-JSON "advanced" escape hatch**. The builder lets the owner add property rows (name, type text/number/enum/bool, required?, allowed values) and a geometry-type checkbox set; the app compiles that to draft-2020-12 JSON Schema. Power users can edit raw JSON in the advanced tab. Both paths feed the same Phase-8 hardened worker for validation.
- **D-05:** Attach action lives on the **contributor's own dataset publish/edit flow**: pick a Group to attach to (adds the `c` tag). For a schema Group, validation runs and warnings show **inline in that same publish dialog before publishing**, with a clear "publish anyway" path. **Never blocks a valid standalone publish** (GROUP-04).
- **D-06:** Validation-warning UX = **specific, actionable, dismissible** — list exactly which rules failed (e.g. "property `name` required", "geometry Polygon not allowed") with a prominent "Publish anyway" button. The off-thread worker already returns per-rule errors; surface them to drive schema adoption.

### Foreign-lane presentation (NO-MOD MINIMUM)
- **D-07:** Foreign lane cap = **50 visible, paginate ("load more")**, sorted by **author-trust first, then recency**. (Trust signal = NIP-02 follows boost, locally-muted drop — see open research note O-01.)
- **D-08:** Lane surfaced as a **collapsed "Community contributions (N)" section below the expanded curated refs** — one visual hierarchy: canon first, contributions second/opt-in. (Chosen over co-equal tabs precisely to encode that curated is privileged.)
- **D-09:** Viewer filter override (GROUP-05) = a **per-view off/warn/strict control attached to the foreign lane**, **default strict** (only conforming attachments shown). `warn` shows non-conforming with a badge + legible per-item filter-reason; `off` shows everything. Every hidden/flagged item carries a legible reason.

### Contributor mute (NO-MOD MINIMUM)
- **D-10:** Mute persistence = **local-only (localStorage/IndexedDB)** — per-device, no publish, works without signing, instant. (Matches "local mute" literally; chosen over NIP-51 to avoid relay round-trips and a sign-in requirement.)
- **D-11:** Mute scope = **global per-contributor** — muting hides that contributor's content everywhere in the app, not just this Group. A device-local mute set applied app-wide.
- **D-12:** Mute trigger = a **per-attachment overflow (⋮) menu** with "Mute @contributor", right where the offending content is encountered. Muted contributors drop out of the lane and feed the trust-sort (D-07).

### Claude's Discretion (user said "you decide")
- **Editor refactor strategy:** refactor `MapContextEditorPanel` **in place** into `GroupEditorPanel` (rename + slim old fields to the governance enum) vs build fresh — default to **refactor-in-place** given the clean-break content shape and the research "~90% rename" framing. Planner confirms based on how cleanly the old fields map.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec & requirements
- `SPEC.md` — v2 canonical spec (rewritten in Phase 8). Defines slimmed Group/37518 semantics, the `c`/`a`/`L`/`l`/`t` tag split, governance ladder, schema-hash, two-lane model. **Read first.**
- `.planning/REQUIREMENTS.md` §GROUP-01..08 — the 8 requirements this phase delivers; also §"Out of scope" (NIP-72 deferral, no relay-side rejection, warn-not-block, clean-break).
- `.planning/PROJECT.md` — v1.2 entity model (Group = push/attach, governance ladder), clean-break policy, deferred-moderation rationale (NIP-72/WoT → next milestone).
- `.planning/ROADMAP.md` §Phase 9 — goal + 5 success criteria + the phase-research flag (governance backward-compat shape, schema-authoring UI, foreign-lane cap, NO-MOD UX contract).

### Research (v1.2 — Phase 9 research flag = NEEDS deeper research during planning)
- `.planning/research/SUMMARY.md` §"Phase 2: Group / Topic" — deliverables list, the two highest-severity pitfalls live here, zero-new-deps, EventStore query shapes.
- `.planning/research/PITFALLS.md` — **Pitfall 1** (schema DoS — worker + timeout-kill + size/depth guards), **Pitfall 2** (NO-MOD MINIMUM), **Pitfall 9** (schema-hash + divergent interpretation).
- `.planning/research/ARCHITECTURE.md` — Factory+Cast structure, `group/` rename rationale, attach-discovery `{kinds:[37515],'#c':[coord]}`, curated `a`-refs vs foreign `c`-lane.
- `.planning/research/STACK.md` — `ajv@8.20.0` via `ajv/dist/2020` (draft-2020-12), `applesauce-core@6.1.0` helpers, `worldGeohash.ts`; explicit non-additions (no `ngeohash`, no NIP-72 lib).

### Phase 8 foundation (the seams this phase consumes)
- `.planning/phases/08-spec-v2-foundation/08-CONTEXT.md` — kind constants, `tags.ts`, `modelVersion` discriminator (legacy 37518 silent-drop), NIP-32 `L`/`l` helper + flat `earthly` vocab, schema-worker hardening defaults.
- `src/lib/nostr/tags.ts` — shared `bbox`/`g`/`L`/`l`/`t`/`c`/`a` helpers the `group/` module must consume (no copy-paste).
- `src/lib/validation/schemaWorker.ts` (Phase 8) — off-thread hardened Ajv validate; Group pipeline wires into its typed call interface.

### Casting contract (mandated by maintainer)
- https://applesauce.build/apps/casting/events.html — Group event class MUST follow official applesauce casting (`EventCast` + `castEvent()`/`castEventStream()`, `eventStore.replaceable()` reads, `EventFactory` blueprint writes). `map-context/cast.ts` already extends `EventCast` — mirror it in `group/cast.ts`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/nostr/map-context/{helpers,cast,factory,index}.ts` — renamed/slimmed into `src/lib/nostr/group/`. Content type already carries `geometryConstraints` + `schema` + `allowForeignAttachments`/`validationMode`/`contextUse` — collapse the latter triad into `governance`.
- `src/features/contexts/MapContextEditorPanel.tsx` + `contexts-columns.tsx` — existing authoring UI; refactor in place into the `GroupEditorPanel` (D-01..D-04 reshape it).
- `src/components/info-panel/MapContextViewPanel.tsx` — existing view panel; becomes the `GroupViewPanel` hosting the two-lane render (D-07..D-09), escape-hatch button (D-02), and mute affordances (D-12).
- `src/lib/context/{scope,references,displayOrdering}.ts` — context-layer helpers; `scope.ts` informs the attach-discovery subscription; `references.ts`/`displayOrdering.ts` inform curated-vs-foreign lane ordering.
- `src/lib/context/validation.ts` — existing Ajv usage; the **read/write validation pipeline** calls the Phase-8 off-thread worker, not this in-thread path (move untrusted-schema validation off-thread).
- `src/lib/hooks/useContextEditor.ts` — existing editor hook; analog for a `useGroups` / group-editor hook.

### Established Patterns
- One `helpers.ts` + `cast.ts` + `factory.ts` + `index.ts` per kind (proven 4×); `EventCast` read views, `EventFactory` blueprint writes; parameterized-replaceable (`d`-tag lineage).
- Comment + react reuse kind 37517 (`geo-comment/`) + kind 7 — GROUP-07 is incremental, not novel (full comment-root widening is Phase 13).
- Local per-device UI state (mute set, D-10) follows existing Zustand + persisted-store patterns used elsewhere in the app.

### Integration Points
- Attach: contributor's dataset publish/edit flow gains a "Group to attach to" picker that writes the `c` tag (D-05); validation warnings render inline there (D-06).
- Group view subscribes `{ kinds:[37515], '#c':[groupCoord] }` for the foreign lane; resolves + signature/kind-validates each coordinate before render (GROUP-08).
- Schema pipeline → Phase-8 `schemaWorker.ts` typed call interface for both validate-on-create (write) and filter-on-fetch (read, off/warn/strict).
- Legacy 37518 events skipped via the Phase-8 `modelVersion` discriminator (silent drop — no Group chip for them).

</code_context>

<specifics>
## Specific Ideas

- "Canon first, contributions second" — the curated lane must visually read as privileged/default; the foreign lane is deliberately subordinate (collapsed section, not a co-equal tab). This is the NO-MOD trust posture made visible.
- Schema authoring must be usable by a non-developer **and** not trap a power user — hence builder-default + raw-JSON escape hatch in one panel, both feeding the same hardened validator.
- The escape hatch ("lock down → closed") is framed as an **urgent, in-the-moment** owner action on the view, not a settings change — it's the human fallback that lets us defer NIP-72 moderation.
- Mute is local + global + per-attachment-menu: device-local set, applied app-wide, triggered exactly where offending content appears.

</specifics>

<deferred>
## Open Research / Planning Notes (resolve during plan-phase)

- **O-01 — Trust-sort signal (D-07):** "author-trust then recency" needs a concrete signal. Default proposal: **NIP-02 follows boost + locally-muted drop, then recency**. Confirm a follows/contact-list source exists in the codebase; if not, fall back to newest-first only for Phase 9 and note trust-sort as a follow-up. Do not over-build a trust model here.
- **O-02 — `governance` content shape / backward-compat:** confirm the exact slimmed content JSON (how `geometryConstraints`/`schema` coexist with `governance: 'schema'`; whether legacy `contextUse`/`validationMode` are simply absent under clean-break). Roadmap flags this for research.
- **O-03 — schema-hash + divergent interpretation (Pitfall 9):** confirm how the published schema-hash is computed/verified so author and viewer validate identically.

## Deferred Ideas (other phases)

- **NIP-51 encrypted mute list / cross-device mute sync** — considered for D-10; rejected for Phase 9 in favor of local-only. Revisit if cross-device mute becomes a user need (would also compose with global scope D-11).
- **Author-trust / web-of-trust model beyond follows-minus-mute** — richer trust scoring is a next-milestone concern (WoT deferred with NIP-72).
- **Sighting creation + its `c`-attach** — Phase 11 (it attaches into the lane built here).
- **Comment-root widening across all four kinds + entity routing/addressing** — Phase 13 (GROUP-07 here is just Group comment/react via existing 37517 + kind 7).
- **Relay-side schema enforcement** — out of scope by design; relays are generic, view-side filter-on-fetch (D-09) is the only enforceable layer.

</deferred>

---

*Phase: 9-group-topic-37518-slimmed*
*Context gathered: 2026-06-25*
