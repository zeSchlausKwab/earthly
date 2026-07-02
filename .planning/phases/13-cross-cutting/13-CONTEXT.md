# Phase 13: Cross-Cutting - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the cross-cutting concerns that only become verifiable once all four v1.2
entity kinds exist — **and** fold in the spec'd Map Stack ↔ entity-layer
unification (locked during this discussion) so the app's core visibility
invariant holds for every entity.

**Reality check (scout, 2026-07-02):** most of the *nominal* XCUT work already
shipped incrementally during Phases 9–12. Phase 13 is therefore **gap-closure +
one genuinely net-new cross-cutting piece (the Map Stack unification)**, not a
from-scratch build.

Phase 13 delivers three things:

1. **XCUT-01 — comment `K`/`k` root-kind widening, final gap.** The comment
   factory (`geo-comment/factory.ts`) already accepts *any* root kind (never a
   hardcoded allowlist). Group (37518), Story (37520), and Sighting (37522) are
   already comment-wired. **Beacon (37521) is the only unwired kind** (explicitly
   deferred in `BeaconViewPanel.tsx:7-8`). This phase wires it to **full parity**.

2. **XCUT-02 — entity routing/addressing, generalized.** All five entities
   already have clean-path deep-link routes + naddr encode/decode
   (`useRouting.ts`). The "old single-context route shape" the roadmap describes
   replacing is already gone. This phase **generalizes the five bespoke per-kind
   parsers/handlers into a single `naddr→kind` dispatcher** with one shared
   comment-deep-link code path — which closes the known beacon `commentId` gap as
   a byproduct — **while preserving the existing URL shapes byte-for-byte**.

3. **Map Stack ↔ entity-layer unification (FOLDED IN).** Make Live Beacons
   (37521) and Temporal Sightings (37522) **first-class Map Stack citizens** so
   "**what's on the Map Stack is visible**" holds for every entity type, not just
   datasets/contexts. Deletes the `66a155e` `extraMapBeacons` side-channel hack.
   Design SPEC already written: `.planning/design/map-stack-entity-layers-SPEC.md`.

**Out of scope (own phases / deferred):**
- **`/e/:naddr` URL redesign** — rejected this discussion; URL shapes stay stable
  (already-shared beacon/story links + OG cards must keep resolving). Only the
  routing *internals* are refactored.
- **Excluding beacons from commenting** — considered and rejected; beacons get
  full comment parity.
- **Cryptographic beacon/entity privacy** (BEACON-07, encrypted GeoJSON) → the
  **cordn** agenda, a future milestone.
- **Compound / multi-context routing** — deferred per PROJECT.md; the existing
  `/context/:naddr/…` scoped shape is preserved as-is, not extended.
- Human moderation / NIP-72 approval, Saved Map/Scene, Collection-as-list —
  deferred to a later milestone.
</domain>

<decisions>
## Implementation Decisions

### Scope — Map Stack unification folded in  *(discussed)*
- **D-01 — FOLD IN.** The Map Stack ↔ entity-layer unification is part of Phase
  13, not a separate later slice. Rationale: it is genuinely cross-cutting (the
  phase *is* "Cross-Cutting"), the design SPEC is ready, and it makes the
  "on the stack = visible" invariant true for every entity — closing v1.2 with
  the map-visibility model coherent. It also **deletes the `66a155e` hack** that
  Phase 12 had to introduce, so folding it in pays down debt this milestone
  created rather than exporting it.

### Map Stack unification — open questions resolved  *(discussed)*
The design SPEC's four "open questions" are now decided:
- **D-02 — Pinned-entry expiry = auto-remove (dropExpired parity).** A pinned
  individual beacon/sighting whose NIP-40 `expiration` passes has its Map Stack
  entry **auto-removed**, exactly as the aggregate layer's `dropExpired` already
  drops it from the map. No lingering "ended" tombstone stack rows — keeps
  "on stack = visible" honest and matches the beacon honesty posture (Phase 12).
- **D-03 — Clearing isolation = demote + restore.** When a deep-link lands
  `isolated: true` (solo) and the user clears isolation, the entity is **demoted
  to a normal visible non-isolated entry** and the aggregate layers / other
  entries that were suppressed **restore to their prior visibility**. Matches how
  dataset/context isolation already behaves (`mapStackSlice.ts` global rule).
- **D-04 — No distinct marker for double-membership** *(SPEC default, confirmed
  by discretion).** If the aggregate layer is ON and the user also pins one entity
  individually, the freshest-per-`{pubkey,d}` de-dup collapses it to one marker;
  the individual entry only guarantees it survives when the aggregate layer is
  turned off. No bespoke pinned-marker styling.
- **D-05 — Aggregate layers pin to top** *(SPEC default, confirmed by
  discretion).** The `sighting-layer` / `beacon-layer` aggregate entries render
  at the top of the Map Stack panel, above individual dataset/context entries.

### Map Stack unification — locked by the design SPEC (not re-litigated)
- Deep-link / share-link landing = **SOLO** (`isolated: true`, `source: 'route'`).
- A normal **"Add to map stack"** affordance on sighting/beacon view panels + rail
  rows, exactly like datasets/contexts/stories (non-isolated visible entry).
- **Aggregate "Sightings" / "Live beacons" layer entries** (`entityKey: 'all'`)
  toggle the whole subscription-driven layer.
- **Cold-start Browse auto-adds** both aggregate layers with `source:
  'browse-default'`, `visible: true` — today's always-on behavior preserved but
  now removable/toggleable (Clear-aware).
- `useMapLayers` stops rendering sightings/beacons unconditionally; it consumes a
  **stack-derived** input set (mirroring how `visibleGeoEvents` derives from the
  stack) and honors `isolated`. `buildSightingSource`/`buildBeaconSource` de-dup +
  `dropExpired` unchanged — they just receive a stack-gated input.

### XCUT-01 — Beacon comments  *(discussed)*
- **D-06 — Full parity.** Add `LiveBeacon` to the `useGeoComments` `target` union
  (+ the `react()` param union) and mount `<CommentsPanel target={beacon} />` in
  `BeaconViewPanel`, identical to the Story/Sighting pattern. Story/Group/Sighting
  are already done — this is the last kind.
- **D-07 — Own-pubkey d-reuse misattach = known edge, not a blocker.** Comments
  (37517) are permanent and `A`-addressed to `<kind>:<pubkey>:<d>`. Throwaway-keyed
  beacons (D-05 of Phase 12) mint a **fresh pubkey per session**, so the address
  is effectively unique per session even with a reused `d` — no misattach. The
  only residual is the **own-pubkey opt-in** case, where a reused `d` across
  sessions could let old comments carry onto a new beacon. Documented as a known
  edge; **no de-dup/scoping mechanism built this phase.**

### XCUT-02 — Routing generalization  *(discussed)*
- **D-08 — Generalize into one `naddr→kind` entity dispatcher.** Unify the five
  bespoke per-kind route parsers/handlers (`useRouting.ts:110-160` +
  `GeoEditorView` `handleInspect*`) into a single dispatch path that decodes the
  naddr, extracts the kind, and routes to the kind-specific handler through **one
  shared comment-deep-link path**. Pays down the "cloned per kind" debt (Pitfall
  P-5) and makes the next kind trivial.
- **D-09 — Preserve URL shapes exactly.** `/geoevent/:naddr`, `/mapcontext/:naddr`,
  `/story/:naddr`, `/sighting/:naddr`, `/beacon/:naddr`, and the scoped
  `/context/:naddr/…` form stay byte-for-byte; the per-kind path prefix becomes a
  `prefix→kind` lookup feeding the generic dispatcher. Keep the legacy hash-route
  fallback + one-time upgrade (`upgradeLegacyHashRoute`). No `/e/:naddr` redesign
  (would break shared links + OG cards for zero gain — naddr already encodes the
  kind).
- **D-10 — Close the beacon comment-deep-link gap.** `handleInspectBeacon` does
  not currently thread `route.commentId` (unlike Story/Sighting — the WR-06 fix
  `4972eba`). The unified comment-deep-link path (D-08) closes this for beacons
  and guarantees parity across all five kinds.

### Verification  *(discussed)*
- **D-11 — Full 4-kind matrix UAT.** "Verified end-to-end across all four kinds"
  is taken literally: verify **comment + deep-link/route + share** for each of
  Story, Group, Beacon, Sighting (a matrix), **plus** the net-new Map Stack
  behaviors: add-to-stack, isolate/solo on deep-link, aggregate layer toggle,
  and pinned-entry expiry auto-remove (D-02). Automated tests cover the widened
  seams; UAT exercises the changed surfaces across all four kinds.

### Claude's Discretion
The user left these to research + planner defaults — reuse existing machinery,
stay consistent with the locked decisions:
- Exact selector shape for the stack-derived sighting/beacon sets
  (`visibleSightingsFromStack` / `visibleBeaconsFromStack` mirroring
  `visibleGeoEvents`).
- Internal structure of the unified route dispatcher (lookup table vs. registry),
  as long as URL shapes (D-09) and the single comment-deep-link path (D-08) hold.
- Rail/panel affordance placement for "Add to map stack" and the aggregate-layer
  toggles (view panels vs. rail headers vs. Map Stack panel).
- Marker/entry styling within the confirmed behavior (D-04/D-05).
- Test granularity for the 4-kind matrix.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Map Stack unification (the folded-in net-new work)
- `.planning/design/map-stack-entity-layers-SPEC.md` — **AUTHORITATIVE for the
  unification.** Problem, locked decisions (deep-link=solo, "Add to map stack",
  aggregate layers, cold-start defaults), rendering gate, the four open questions
  (now resolved here as D-02..D-05), touchpoints, and the rough implementation
  plan. **Read first.**
- `src/features/geo-editor/store/types.ts` — `MapStackEntryType`
  (`dataset|context|comment|proposal|draft|ai-result`; extend with
  `sighting|beacon|sighting-layer|beacon-layer`) + `MapStackEntry`
  (`visible`/`pinned`/`isolated`) at ~L72/L100.
- `src/features/geo-editor/store/mapStackSlice.ts` — `isolated` global mutual-
  exclusion rule already implemented (~L82/L104); extend source builders to honor
  it for sightings/beacons.
- `src/features/geo-editor/hooks/useMapLayers.ts` — `buildSightingSource` (~L271)
  / `buildBeaconSource` (~L360); today fed unconditionally. Make them consume the
  stack-derived set; keep de-dup + `dropExpired`. **Regression-sensitive: shared
  render path for datasets/contexts too.**
- `src/features/geo-editor/GeoEditorView.tsx` — derive stack sets; **remove
  `extraMapBeacons` state + sync effect + `beaconsForMap` merge (commit
  `66a155e`)**; deep-link → isolated stack entry.
- `src/components/info-panel/BeaconViewPanel.tsx` / `SightingViewPanel.tsx` — add
  "Add to map stack".
- `src/components/BeaconsPanel.tsx` / the Sightings rail panel — rail add + layer
  toggle.
- `src/components/MapStackPanel.tsx` — render/toggle aggregate layer entries.

### XCUT-01 — Comments (kind 37517)
- `src/lib/nostr/geo-comment/factory.ts:46-102` — `GeoCommentFactory.root/reply`;
  accepts any `scope.kind` (no allowlist — widening is read-side/wiring only).
- `src/lib/nostr/geo-comment/helpers.ts:100-113` — `getCommentThreading`
  (`K`/`k`/`A`/`a` as opaque strings).
- `src/features/social/hooks/useGeoComments.ts:27-42` — `target` union
  (`GeoDataset | MapContext | Article | TemporalSighting | null`) + `react()`
  param. **Add `LiveBeacon`.**
- `src/features/social/comments/CommentsPanel.tsx:19-69` — target-passthrough.
- `src/components/info-panel/BeaconViewPanel.tsx:7-8,137-143` — the deferral note
  to remove + the mount point (after ~L160).
- `src/components/info-panel/StoryViewPanel.tsx:217-237` (Phase 10 slice,
  `bf1112e`) / `SightingViewPanel.tsx` / `GroupViewPanel.tsx` — the exact
  add-a-kind pattern to mirror for Beacon.

### XCUT-02 — Routing / addressing
- `src/features/geo-editor/hooks/useRouting.ts` — `RouteState` (L31-46,
  `focusType` union at L37), `parsePathSegments` (L78-223, the 5 per-kind
  parsers), naddr encoders (L481-529), legacy hash-route fallback + upgrade
  (L239-266). **The refactor target for the unified dispatcher (D-08/D-09).**
- `src/features/geo-editor/GeoEditorView.tsx` — per-kind `handleInspect*` focus
  handlers; `handleInspectBeacon` missing the `route.commentId` thread (D-10).
- `src/lib/nostr/kinds.ts` — kind constants 37515 / 37518 / 37520 / 37521 / 37522.
- `src/lib/og/` (`crawler.ts`, `fetchEvent.ts`, `template.ts`, `renderImage.ts`) —
  OG card share path per entity; keep resolving under stable URLs (D-09).

### Milestone context
- `.planning/ROADMAP.md` §"Phase 13: Cross-Cutting" — goal + 2 success criteria.
- `.planning/REQUIREMENTS.md` — XCUT-01, XCUT-02 (+ the mapping notes at L136-137).
- `.planning/PROJECT.md` — v1.2 entity model; "on the stack = visible" UX
  discipline; compound routing deferred.
- `.planning/phases/12-live-beacon-37521/12-CONTEXT.md` — beacon D-05 (throwaway
  key per session), the `/beacon/:naddr` thin slice this phase generalizes, and
  the flagged Phase-13 hand-offs.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Comment stack is already kind-agnostic** — factory accepts any root kind; the
  only work for XCUT-01 is the Beacon union entry + panel mount (three lines +
  a mount, mirroring Story `bf1112e`).
- **All five deep-link routes already exist** — XCUT-02 is a refactor/dedup, not
  net-new routes. naddr encode/decode already generic.
- **`isolated` flag + global mutual-exclusion already ship** for datasets/contexts
  (`mapStackSlice.ts`) — the unification reuses it for the deep-link=solo behavior
  (D-03) rather than inventing isolation.
- **`dropExpired`/`isExpired`** (Phase 8) already applied in the sighting/beacon
  source builders — pinned-entry expiry auto-remove (D-02) reuses the same filter.
- **`browse-default` + Clear semantics** already exist — cold-start aggregate
  layer entries reuse them.

### Established Patterns
- Add-a-comment-kind = union widening + generic `<CommentsPanel target={...} />`
  mount (no render-side `K`/`k` branching). Mirror `bf1112e`.
- Per-entity deep-link via `useRouting` + OG crawler; naddr carries the kind.
- Map Stack entry as the single visibility source of truth (`visibleGeoEvents`
  derived from the stack) — extend to sightings/beacons.
- `isolated` global suppress-all-others (reuse for solo deep-link).

### Integration Points
- `useGeoComments` union + `BeaconViewPanel` mount (XCUT-01).
- `useRouting.parsePathSegments` + `GeoEditorView.handleInspect*` collapsed into
  one dispatcher (XCUT-02); single comment-deep-link path.
- `MapStackEntryType` extension + stack-derived selectors + `useMapLayers` gate +
  removal of the `extraMapBeacons` merge (unification).
- **Highest-risk seam:** `useMapLayers` is the shared render path for
  datasets/contexts too — the stack-derived gating change must not regress
  existing dataset/context rendering. Flag for the researcher/planner.
</code_context>

<specifics>
## Specific Ideas

- Core invariant to protect and finally make universal: **"what's on the Map Stack
  is visible."** Phase 13's success is that this is true for *every* entity type,
  and that the `66a155e` beacon side-channel is gone.
- The three deliverables have very different sizes: XCUT-01 is trivial (last kind
  wired), XCUT-02 is a bounded refactor behind stable URLs, and the Map Stack
  unification is the real body of the phase (touches store types, a slice, the
  shared `useMapLayers` render path, two view panels, two rail panels, the map
  stack panel, and GeoEditorView).
- Verification is deliberately a **matrix** (comment × route × share × 4 kinds +
  the new stack behaviors), because the whole point of the phase is the behaviors
  that only become checkable now that all four kinds coexist.
</specifics>

<deferred>
## Deferred Ideas

- **`/e/:naddr` unified URL redesign** — cleaner canonical entity route, but breaks
  shared links + OG cards; rejected in favor of stable URLs with generic internals
  (D-09). Could revisit if a URL-scheme break is ever taken deliberately.
- **Comment scoping/de-dup for reused own-pubkey beacon `d`** — the D-07 known
  edge; a real fix (session-scoped comment addressing or `d` uniqueness) is not
  built this phase.
- **Cryptographic entity privacy (cordn / BEACON-07)** — encrypted GeoJSON + key
  coordinator across all entities; future milestone (memory:
  `project_cordn_encrypted_geojson_agenda`).
- **Compound / multi-context routing** — the scoped `/context/:naddr/…` shape is
  preserved but not extended; multi-context is a deferred PROJECT.md concern.

None of the above expand Phase 13 scope.
</deferred>

---

*Phase: 13-cross-cutting*
*Context gathered: 2026-07-02*
