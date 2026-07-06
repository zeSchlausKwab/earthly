# Phase 11: Temporal Sighting - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **authoring + reading UX layer** for Temporal Sightings (kind **37522** /
NIP-52 time-bound observations). The data layer already exists from Phase 8
(`TemporalSightingFactory` / `TemporalSighting` cast / helpers in
`src/lib/nostr/temporal-sighting/` with `title`/`description`/`start`/`end` +
`modelVersion`, a NIP-40 `expiration()` setter, and `c`-attach via
`contextReferences()`). This phase builds:

- Create a Sighting — a single placed feature with title, description, and an
  observation time (NIP-52 `start`, optional `end`) distinct from publish time
  (SIGHT-01).
- Attach a Sighting to a Group/Topic via a `c` tag so it lands in that Group's
  contribution lane (SIGHT-02 — the lane + discovery subscription already exist
  from Phase 9).
- Carry an optional NIP-40 expiry so stale sightings auto-fade from the map,
  always client-filtered at every read path regardless of relay GC (SIGHT-03).
- Comment on + react to a Sighting (SIGHT-04 — reuse kind 37517 + kind 7).

**Resolved at roadmap level:** The flagged open research question ("dedicated
lightweight kind vs 37515 + property + NIP-40") was **settled in Phase 8 in favor
of a dedicated kind 37522**. No relay-side Khatru filter changes are needed beyond
what existing `pool.req` filters handle (37522 is an addressable kind like the
others). Do not re-litigate the kind choice.

**Out of scope (own phases):** Live Beacon (Phase 12); cross-cutting comment-root
widening + entity routing/addressing across all four kinds (Phase 13 — note the
deep-link route below may partially overlap Phase 13's addressing work, flag at
plan time); AI paste→Sighting ingest (SIGHT-05, deferred); geoprivacy obscuring
(SIGHT-06, deferred); NIP-72 moderation (deferred this milestone).
</domain>

<decisions>
## Implementation Decisions

### Placement & create UX  *(discussed)*
- **D-01 — Create mechanic:** **Map pin-drop → form.** "New Sighting" turns the
  cursor into a pin-drop; the user clicks the map to place the point, then a
  **compact form opens in the right info panel** (title / description / observation
  time / expiry / optional Group attach). Map-first because a Sighting is
  inherently a placed observation, unlike the text-first Story. Reuse GeoEditor
  point placement + the info-panel form/multiplexing pattern.
- **D-02 — Geometry scope:** **Point + optional small area.** Default is a single
  point; the user may optionally draw a small line/polygon for the "area where I
  saw it" case (e.g. a feeding ground). **IMPLICATION FOR PLANNER:** the current
  37522 content interface (`title`/`description`/`start`/`end`) has **no geometry
  field** — placement is currently only `bbox`+`geohash` tags (a quantized
  centroid, lossy). The planner MUST add a geometry representation to
  `TemporalSightingContent` (a GeoJSON Point by default, extensible to
  Line/Polygon) carrying precise coordinates, and keep `bbox`/`geohash` tags
  derived from it for discovery. Mirror how `geo-event` stores geometry.

### Time & expiry input  *(discussed)*
- **D-03 — Observation time:** **Default "now", expandable.** Observation defaults
  to `start = now`, no `end`, so "I just saw it" is one tap. An "adjust time"
  affordance reveals explicit `start` + optional `end` pickers for past sightings
  and duration events (the seed already uses start+end ranges, incl. future
  "pop-up this weekend" cases). Observation time is stored distinct from
  `created_at` (SIGHT-01).
- **D-04 — Expiry (NIP-40):** *Claude's discretion*, with this default direction:
  **presets, independent of observation end** — friendly choices ("fade after
  1 day / 1 week / 1 month / never") plus a custom date, modeling "when should this
  disappear from the map." Pick a sensible default TTL. Whatever is chosen, the
  expiry MUST be **client-filtered on every read path** via the shared
  `dropExpired`/`isExpired` seam (Phase 8) regardless of relay GC (SIGHT-03).

### Map render & fade  *(discussed)*
- **D-05 — Marker + fade:** *Claude's discretion*, minimum bar: Sightings render
  with a **distinct marker style** (read as ephemeral observations, not dataset
  dots) and are **removed by the client-side NIP-40 expiry filter** at/after
  expiry. Gradual opacity-aging toward expiry is a nice-to-have the planner may add
  if cheap; the hard expiry-filter removal is required.
- **D-06 — Observation-time cue:** **Yes, a subtle time cue on the map.** Encode
  observation state on the marker — e.g. "live now" (within start–end) highlighted,
  future ("upcoming") badged, past shown normally/dimmer — so the "happening now"
  case stands out. Keep it subtle; reuse existing map-layer styling.

### Browse & discoverability  *(discussed)*
- **D-07 — Browse surface:** **Dedicated "Sightings" rail destination** in
  `AppSidebar` (browse panel listing the user's + nearby/recent sightings; clicking
  flies-to + opens detail), with a **"New Sighting" button at the top** of that
  panel. Carry forward the Phase-10 `RAIL_DESTINATIONS` → browse-panel →
  open-in-info-panel pattern. Explicitly chosen to avoid the Phase-9
  "built-but-unwired" discoverability dead-end. The map remains the canvas; the
  rail tab is the index.
- **D-08 — Share surface:** **Deep-link route + OG card.** A `/sighting/:naddr`
  route (via `useRouting`) **AND** an open-graph social card (reuse `src/lib/og/`
  crawler/template/renderImage), consistent with Story/dataset/context routes —
  supports the "soccer star spotted at hotel" shareable case. **Coordinate with
  Phase 13** (cross-cutting entity routing/addressing across all kinds): if Phase
  13 owns the canonical route shape, scope this to the route + OG card and let
  Phase 13 generalize; flag at plan time to avoid double-implementing.

### Claude's Discretion
The user left these to research + planner defaults — must **reuse existing
machinery** and stay consistent with the locked decisions above:
- **`c`-attach UX during create (SIGHT-02):** reuse the Phase-9 D-05 pattern — a
  Group-picker in the Sighting create/edit form that adds the `c` tag; for a schema
  Group, run the Phase-8 off-thread validator warn-not-block, never blocking a valid
  standalone publish.
- **Detail / view panel layout** — exact composition of the read view (title,
  description, observation time range, expiry countdown, comments/react mount).
- **Draft-save behavior** — local-only-until-publish vs an event draft; local-first
  preferred for simplicity (mirror the editor draft pattern).
- **Edit flow** — parameterized-replaceable in-place edit preserving the `d`-tag
  (`TemporalSightingFactory.modify` already preserves `d`, no lineage fork).
- **Expiry input (D-04)** and **marker/fade treatment (D-05)** per notes above.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Entity spec + requirements
- `SPEC.md` — v2 canonical Nostr event spec (rewritten Phase 8). Defines kind 37522
  Temporal Sighting (NIP-52 time bounds + NIP-40 expiry), the `c`/`a`/`L`/`l`/`t`
  tag split, and tag contracts. **Read first; authoritative.**
- `.planning/ROADMAP.md` §"Phase 11: Temporal Sighting" — goal, 4 success criteria,
  and the (now-resolved) Sighting-representation research flag.
- `.planning/REQUIREMENTS.md` — SIGHT-01 … SIGHT-04 (and deferred SIGHT-05/06).
- `.planning/PROJECT.md` — v1.2 entity model; the Sighting "soccer star spotted at
  hotel" framing; applesauce-casting API discipline (v1.2).

### Sighting data layer (extend, do NOT re-create)
- `src/lib/nostr/temporal-sighting/` (`factory.ts`, `cast.ts`, `helpers.ts`,
  `index.ts`) — kind-37522 `TemporalSightingFactory` (`create`/`modify`/`sighting`/
  `expiration`/`bbox`/`geohash`/`hashtags`/`labels`/`contextReferences`), the
  `TemporalSighting` cast, `TemporalSightingContent`. **Needs a geometry field
  added (D-02).**
- `src/lib/nostr/kinds.ts` — `TEMPORAL_SIGHTING_KIND = 37522` (locked).
- `src/lib/nostr/expiry.ts` (`isExpired`/`dropExpired`) — shared NIP-40 read filter
  (SIGHT-03; apply at every read path).
- `src/lib/nostr/tags.ts` — shared `bbox`/`g`/`L`/`l`/`t`/`c`/`a` transformers used
  by the factory.
- `src/lib/nostr/modelVersion.ts` — `earthly/2` discriminator + legacy skip.

### `c`-attach lane + governance (SIGHT-02)
- `.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md` §D-05/D-06 — the
  contributor attach flow (Group-picker, inline warn-not-block schema validation).
- `src/lib/nostr/group/` — Group factory/cast/helpers; discovery subscription shape
  `{ kinds:[...], '#c':[groupCoord] }` the Sighting must self-attach into.
- Phase-8 off-thread schema-validation worker — for attaching to a `schema` Group.

### Reusable UI / nav / share machinery (mirror Phase 10)
- `.planning/phases/10-story-article-37520/10-CONTEXT.md` — the navigation pattern
  template (D-01 rail tab, D-03 info-panel open, D-04 route + OG card) this phase
  mirrors.
- `src/components/AppSidebar.tsx` — `RAIL_DESTINATIONS`, info-panel multiplexing
  (D-07 integration point).
- `src/components/GeoDatasetsPanel.tsx` / `src/components/StoriesPanel.tsx` — browse
  panel patterns to clone for a `SightingsPanel`.
- `src/components/info-panel/StoryViewPanel.tsx` / `StoryEditorPanel.tsx` — the
  view/editor info-panel slots to mirror for Sighting.
- `src/features/geo-editor/hooks/useRouting.ts` — deep-link route handling
  (`/geoevent/:naddr`, `/mapcontext/:naddr`, `/story/:naddr`) to extend for D-08.
- `src/lib/og/` (`crawler.ts`, `fetchEvent.ts`, `template.ts`, `renderImage.ts`) —
  OG card generation for the share route (D-08).
- `src/features/social/comments/` (`CommentsPanel`, `GeoSocialActions`) — comment +
  react mount (SIGHT-04), already proven on Groups + Stories.
- `scripts/seed-entities.ts` §"Temporal Sightings" — the authoritative built-via-
  factory example of seeded 37522 events (start/end/expiration/`c`-attach), useful
  as a data-shape reference and UAT fixture.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **TemporalSightingFactory / cast / helpers (kind 37522)** already exist — this
  phase wraps them with UI. `modify` preserves the `d`-tag (in-place edit),
  `expiration()` sets NIP-40, `contextReferences()` sets `c`. Geometry field is the
  one content gap to fill (D-02).
- **`c`-attach lane + discovery subscription** (Phase 9) — SIGHT-02 is a mount +
  Group-picker, not new lane infrastructure.
- **CommentsPanel / GeoSocialActions** wired for comment+react on an entity
  coordinate (proven on Groups + Stories) — SIGHT-04 is a mount.
- **`dropExpired`/`isExpired`** shared NIP-40 filter (Phase 8) — SIGHT-03 applies it
  at every Sighting read path.
- **Rail tab → browse panel → info-panel open → deep-link + OG card** end-to-end
  pattern (Phase 10 Story) — D-07/D-08 follow it closely.

### Established Patterns
- Left-rail browse destinations → panel → open-in-info-panel (D-01/D-07).
- Deep-link route per entity via `useRouting` + OG crawler (D-08).
- Parameterized-replaceable in-place edit preserving the `d`-tag (D-04/edit).
- bbox/geohash tags derived from geometry for discovery (apply to D-02's new
  geometry field — mirror `geo-event`).
- applesauce casting contract for all v1.2 entity reads/writes (PROJECT.md API
  discipline): `EventCast` reads via `castEvent`/`castEventStream`, writes via the
  `EntityFactory` blueprint — already followed by the scaffold.

### Integration Points
- New `SightingsPanel` + a `sightings` rail destination in `AppSidebar`.
- New Sighting view + editor info-panel slots in `GeoEditorInfoPanel` multiplexing.
- Map-first pin-drop authoring hooks into GeoEditor point placement (+ optional
  area draw for D-02).
- Distinct Sighting map layer with time-cue + expiry-aware styling (D-05/D-06).
- A `/sighting/:naddr` route in `useRouting` + OG crawler match (D-08; coordinate
  with Phase 13 addressing).
</code_context>

<specifics>
## Specific Ideas

- The canonical use case is **"soccer star spotted at hotel"** (PROJECT.md) — a
  single placed, time-stamped, auto-fading observation. The "pop-up this weekend"
  and wildlife-sighting cases in `scripts/seed-entities.ts` show the start+end
  range and `c`-attach shapes the UX must support.
- Discoverability is a first-class concern — the dedicated Sightings rail tab (D-07)
  is chosen specifically to avoid repeating the Phase-9 "table built but never wired
  into the rail" dead-end, same rationale as Phase 10's Stories tab.
- Three timestamps coexist (publish `created_at`, observation `start`/`end`, NIP-40
  `expiration`) — D-03/D-04 are designed to keep that legible, not expose all three
  as equal-weight raw fields.
</specifics>

<deferred>
## Deferred Ideas

- **AI paste→Sighting ingest** (SIGHT-05) — paste a message → AI geolocates →
  placed Sighting. Plumbing exists from v1.1; productize in a later milestone. Not
  this phase.
- **Geoprivacy obscuring / coarse location** (SIGHT-06) — for sensitive sightings.
  Deferred this milestone.
- **Gradual opacity-aging toward expiry** — a nice-to-have within D-05; ship only if
  cheap, else just hard expiry-filter removal.
- **Full canonical entity-routing/addressing** — Phase 13 (Cross-Cutting) owns
  routing across all four kinds; the D-08 route here may be scoped to a thin route +
  OG card and generalized in Phase 13. Flag at plan time.

None of the above expand Phase 11 scope.

</deferred>

---

*Phase: 11-temporal-sighting*
*Context gathered: 2026-06-27*
