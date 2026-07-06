# Phase 12: Live Beacon (~37521) - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **authoring + live-render UX layer** for Live Beacons (kind **37521** —
a parameterized-replaceable presence/position event bounded by a NIP-40
`expiration`). The data layer already exists from Phase 8
(`src/lib/nostr/live-beacon/` — `LiveBeaconFactory` `create`/`modify`/`beacon`/
`expiration`/`bbox`/`geohash`/`hashtags`/`labels`/`contextReferences`, the
`LiveBeacon` cast exposing `expiresAt`, `isLiveBeacon` `modelVersion` guard). This
phase builds the one **genuinely net-new live-map-render subsystem** of the
milestone and carries the **highest privacy surface** — sequenced last among the
kinds. It delivers:

- **Start a live, time-boxed beacon** that updates on the map as the sharer's
  position changes (default OFF, explicit start, foreground-only) — BEACON-01.
- **Auto-expire via NIP-40** + an **explicit Stop** leaving an unambiguous "ended"
  terminal state; warn that the last point stays public on a no-delete substrate
  — BEACON-02.
- An **honest staleness indicator** ("last seen N min ago") so a stopped/stale
  beacon is never shown as current (grey-out past threshold) — BEACON-03.
- **Public/discoverable OR account-free share-link** viewing — BEACON-04.

**Resolved at roadmap/SPEC level (do NOT re-litigate):**
- **Lifecycle = parameterized-replaceable + NIP-40** — locked in Phase 8 / SPEC §5.
  The roadmap "replaceable vs ephemeral" research flag is **confirmed**, not
  reopened; the research agent's only job there is a **Khatru relay echo test** to
  verify NIP-40 GC behavior and confirm the replaceable representation round-trips.
- Client **always** filters expired beacons on read via the shared
  `dropExpired`/`isExpired` seam (SPEC §10), regardless of relay GC.

**Out of scope (own phases / deferred):**
- Cross-cutting comment-root widening (XCUT-01) + canonical entity routing/
  addressing across all four kinds (XCUT-02) → **Phase 13**. The `/beacon/:naddr`
  share route built here may be a thin slice that Phase 13 generalizes — flag at
  plan time to avoid double-implementing.
- **True cryptographic privacy / encrypted beacons** (BEACON-07, NIP-17 gift-wrap)
  → deferred; the broader strategy is the **cordn** agenda item (see Deferred).
- Beacon driven by external data source / code sandbox (BEACON-05); breadcrumb
  trail history (BEACON-06) → deferred.
- Always-on / background location tracking → explicit milestone non-goal.
</domain>

<decisions>
## Implementation Decisions

### Update cadence  *(discussed)*
- **D-01 — Publish trigger:** **Distance + time floor.** Re-publish a fresh
  replaceable 37521 (same `d`) when the sharer has moved more than ~X meters **OR**
  a max of every ~N seconds, whichever comes first. Avoids relay spam when still,
  stays fresh when moving. Reuses the existing `watchPosition` continuous-tracking
  loop in `src/components/ui/map.tsx`. Exact thresholds are **Claude's discretion**
  — sensible starting defaults (~25 m / ~20–30 s); tune in research/plan.
- **D-02 — Heartbeat keepalive:** **Yes.** The time floor doubles as a heartbeat:
  re-publish on the interval **even when stationary**, so an actively-shared but
  still beacon stays "live" and does not drift into "stale". This is what
  distinguishes "parked but here" from "tab closed / gone". (Directly couples to
  the D-06 staleness threshold.)

### Time box, Stop & "ended" state  *(discussed)*
- **D-03 — Time box input:** **Presets + custom.** Friendly duration presets
  ("15 min / 1 hour / 4 hours / 8 hours") plus a custom duration, with a sensible
  default pre-selected. Mirror the Sighting expiry-preset pattern (Phase 11 D-04).
  This sets the NIP-40 `expiration` via `LiveBeaconFactory.expiration()`.
- **D-04 — "Ended" terminal state:** **Explicit final event.** Tapping Stop
  publishes one last replaceable 37521 carrying a terminal status (e.g.
  `content.status = 'ended'`) **and** sets/keeps the NIP-40 expiration. Viewers see
  a clear **"ended"** marker until expiry removes it — **not** a silent
  disappearance (which would be ambiguous vs a network drop). **IMPLICATION FOR
  PLANNER:** the current `LiveBeaconContent` (`label?`, `position?`) has no status
  field — add a `status: 'live' | 'ended'` discriminator (and likely a precise
  `position`/geometry contract; see D-09).
- **D-05 — Identity model (DEFAULT = anonymous throwaway pubkey):** A beacon is
  published under an **ephemeral throwaway keypair by default**, so the live
  position trail is **not linkable to the user's real Nostr identity**. Key scope =
  **per sharing SESSION**: one throwaway key generated at Start, reused for every
  heartbeat/update (same `d` = one replaceable beacon) through Stop; a brand-new
  Start mints a **fresh unlinkable key** (sessions are unlinkable to each other and
  to the user's identity). Publishing under the user's **own pubkey is an explicit
  opt-in** — and that is the case where the no-delete persistence warning carries
  real weight. **IMPLICATION FOR PLANNER:** the beacon publish path needs a
  **generated signer** (applesauce signer over a generated secp256k1 key), not the
  app's main signer; and the no-delete warning copy/severity should adapt to
  own-pubkey vs throwaway.
- **D-06 — No-delete warning:** Shown **at Start** as informed consent ("your
  positions are published to public relays and cannot be deleted"), with a **brief
  recap at Stop** ("your last point remains visible until it expires"). Weighted
  more strongly in the own-pubkey (D-05 opt-in) case.

### Staleness & live-map render  *(discussed)*
- **D-07 — Lifecycle visual states:** **live / greyed-stale / removed.** Fresh
  (within threshold) = solid live marker + "last seen Ns/m ago"; past the staleness
  threshold = **greyed-out "stale" marker** still showing last-seen age (preserves
  BEACON-03 honesty); past NIP-40 expiry = **removed** by the client `dropExpired`
  filter; explicit Stop = the distinct **"ended"** marker (D-04) until expiry. Use a
  distinct beacon marker style (reads as live presence, not a dataset dot or a
  Sighting).
- **D-08 — Staleness threshold:** **Derived from cadence**, not a fixed magic
  number — define it as a multiple of the heartbeat interval (e.g. ~4× the D-01
  time floor) so threshold and cadence stay in sync automatically. Exact factor =
  planner's call; intent is **tight** (a closed tab greys out within a couple of
  minutes). Compare UTC epoch seconds; staleness is measured off the beacon's
  latest `created_at`, expiry off the NIP-40 tag.

### Visibility & share  *(discussed)*
- **D-10 — Visibility model = ask each time, soft-enforced.** Prompt **public vs
  link-only at Start** (no sticky default — the choice is deliberate each session).
  - **Public** = publish a discoverable marker (e.g. a `t` flag /content marker)
    **plus** the geo tags (`g`/`bbox`) so Earthly's nearby/beacons surface lists it.
  - **Link-only** = **omit** the discoverable marker (and coarsen/omit the geo tag)
    so the Earthly client never surfaces it; it opens only via its `naddr` link
    (`37521:<pubkey>:<d>`).
  - **Enforcement is client-side discovery-gating, NOT cryptographic.** Unencrypted
    events on a public relay can always be firehose-scraped on `kinds:[37521]`;
    "link-only" therefore means **unlisted, not private**. Show an honest caveat to
    that effect. The residual is acceptable because beacons are throwaway-keyed
    (D-05) and time-boxed; closing it cryptographically = BEACON-07 / cordn
    (deferred). **The researcher should confirm the exact marker/tag mechanism that
    cleanly separates the discoverable surface's subscription from link-only reads.**
- **D-11 — Account-free viewing / share link:** The viewer opens a beacon via a
  share link without an account (the app is already largely anonymous-viewable —
  guest scope exists). The link carries the beacon `naddr`; for the default
  throwaway-key beacon it MUST carry the **throwaway pubkey** (since it is not
  discoverable under the user's profile). Mirror the Story/Sighting deep-link +
  OG-card pattern (`useRouting` + `src/lib/og/`). Coordinate scope with Phase 13.
- **D-12 — Entry point / browse surface:** **Dedicated "Beacons" rail tab** in
  `AppSidebar` (mirrors Stories/Sightings): browse public/nearby beacons + the
  user's own active beacon, with Start/Stop controls, the time-box + visibility
  choices, and the share link all hosted there. Carry forward the established
  `RAIL_DESTINATIONS` → browse-panel → open-in-info-panel pattern. The map stays
  the live canvas; the rail tab is the index/control home.

### Claude's Discretion
The user left these to research + planner defaults — **reuse existing machinery**
and stay consistent with the locked decisions above:
- **D-09 — Position/geometry contract:** the beacon needs a precise current
  position. Decide the exact content shape (a GeoJSON `Point` carrying `[lon,lat]`,
  with `bbox`/`geohash` tags derived for discovery — mirror `geo-event`/Sighting
  D-02), and reconcile with the existing `position?: [number, number]` placeholder.
- **Exact cadence thresholds (D-01) and staleness factor (D-08).**
- **Detail / view panel layout** — composition of the read view (label, last-seen
  age, live/stale/ended status, time-box countdown, share affordance, comment/react
  mount if cheaply reused).
- **Edit/resume semantics** — whether a user can resume/adjust an active beacon
  in-place (`LiveBeaconFactory.modify` already preserves `d`).
- **Permission-denied / geolocation-error handling** — what the UI does when the
  browser denies location or a fix is unavailable mid-session.
- **Marker styling specifics** within the D-07 live/stale/ended scheme.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Entity spec + requirements
- `SPEC.md` §5 (Live Beacon kind 37521), §8 (modelVersion discriminator + clean
  break), §10 (NIP-40 expiration — always client-filter on read), §7 (tag
  vocabulary `g`/`bbox`/`L`/`l`/`t`/`c`/`a`). **Read first; authoritative.**
- `.planning/ROADMAP.md` §"Phase 12: Live Beacon (~37521)" — goal, 4 success
  criteria, and the (now-confirmed) lifecycle research flag (Khatru NIP-40 echo
  test, `seq`-tag clock-skew de-dup, staleness threshold, visibility model).
- `.planning/REQUIREMENTS.md` — BEACON-01 … BEACON-04 (and deferred BEACON-05/06/07).
- `.planning/PROJECT.md` — v1.2 entity model; "real-time, shareable/public updating
  position point" framing; applesauce-casting API discipline (v1.2).

### Beacon data layer (extend, do NOT re-create)
- `src/lib/nostr/live-beacon/` (`factory.ts`, `cast.ts`, `helpers.ts`, `index.ts`,
  `live-beacon.test.ts`) — kind-37521 `LiveBeaconFactory`, `LiveBeacon` cast,
  `LiveBeaconContent`. **Needs `status:'live'|'ended'` (D-04) + a precise
  position/geometry contract (D-09) added to content.**
- `src/lib/nostr/kinds.ts` — `LIVE_BEACON_KIND = 37521` (locked).
- `src/lib/nostr/expiry.ts` (`isExpired`/`dropExpired`) — shared NIP-40 read filter
  (BEACON-03; apply at EVERY beacon read path).
- `src/lib/nostr/tags.ts` — shared `bbox`/`g`/`L`/`l`/`t`/`c`/`a` transformers.
- `src/lib/nostr/modelVersion.ts` — `earthly/2` discriminator + legacy skip.

### Live position capture (the net-new subsystem)
- `src/components/ui/map.tsx:~760–945` — existing `navigator.geolocation`
  `watchPosition`/`getCurrentPosition` continuous-tracking + locate-button machinery
  (the foundation for D-01/D-02 publish loop; reuse, don't reinvent).
- `src/features/geo-editor/components/map/GeoEditorMap.tsx:~177` — watchPosition /
  accuracy / click-to-stop integration reference.

### Generated-signer (throwaway key, D-05)
- applesauce signers (project uses applesauce; see `src/lib/nostr/` signer usage)
  — a generated secp256k1 keypair signer for the per-session throwaway publish path.
  Researcher: confirm the exact applesauce API for an in-memory generated signer.

### Reusable UI / nav / share machinery (mirror Phases 10/11)
- `.planning/phases/11-temporal-sighting/11-CONTEXT.md` and
  `.planning/phases/10-story-article-37520/10-CONTEXT.md` — the rail-tab → browse-
  panel → info-panel-open → deep-link + OG-card template this phase mirrors
  (D-11/D-12).
- `src/components/AppSidebar.tsx` — `RAIL_DESTINATIONS`, `WORK_VIEW_MODES`,
  info-panel multiplexing (D-12 integration point; add a `beacons` mode).
- `src/components/SightingsPanel.tsx` / `src/components/StoriesPanel.tsx` /
  `src/components/GeoDatasetsPanel.tsx` — browse-panel patterns to clone for a
  `BeaconsPanel`.
- `src/components/info-panel/StoryViewPanel.tsx` / `StoryEditorPanel.tsx` (+ the
  Sighting view/editor slots) — view/editor info-panel slots to mirror for Beacon.
- `src/features/geo-editor/hooks/useRouting.ts` — deep-link routes
  (`/geoevent/:naddr`, `/mapcontext/:naddr`, `/story/:naddr`, `/sighting/:naddr`)
  to extend with `/beacon/:naddr` (D-11; coordinate with Phase 13 / XCUT-02).
- `src/lib/og/` (`crawler.ts`, `fetchEvent.ts`, `template.ts`, `renderImage.ts`) —
  OG card generation for the share route (D-11).
- `scripts/seed-entities.ts` §"Live Beacons" (~L424) — authoritative built-via-
  factory seeded 37521 examples (label/geohash/expiration); useful as a data-shape
  reference and UAT fixture. Will need `status`/throwaway-key/visibility updates to
  match the new content shape.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **LiveBeaconFactory / LiveBeacon cast / helpers (kind 37521)** already exist —
  this phase wraps them with UI. `modify` preserves `d` (in-place edit/resume),
  `expiration()` sets NIP-40, cast exposes `expiresAt`. Content gaps to fill: a
  `status:'live'|'ended'` discriminator (D-04) and a precise position/geometry
  field (D-09).
- **`watchPosition` continuous geolocation** already implemented in
  `src/components/ui/map.tsx` (locate button + tracking mode) — the foundation for
  the D-01/D-02 publish loop; the net-new work is wiring it to a throttled publish.
- **`dropExpired`/`isExpired`** shared NIP-40 filter (Phase 8) — apply at every
  beacon read path for BEACON-03 removal.
- **Rail tab → browse panel → info-panel open → deep-link + OG card** end-to-end
  pattern (Phases 10/11) — D-11/D-12 follow it closely.
- **App is already largely anonymous-viewable** (guest scope, local-first) — so
  BEACON-04's "open without an account" is mostly a share-link + discovery-gating
  concern, not a new auth-bypass surface.

### Established Patterns
- Left-rail browse destinations (`RAIL_DESTINATIONS`) → panel → open-in-info-panel
  (D-12).
- Deep-link route per entity via `useRouting` + OG crawler (D-11).
- Parameterized-replaceable in-place edit preserving `d` (D-04 ended-event,
  resume).
- `bbox`/`geohash` tags derived from geometry for discovery (apply to D-09).
- applesauce casting contract for all v1.2 entity reads/writes (PROJECT.md API
  discipline): reads via `castEvent`/`castEventStream`, writes via the
  `EntityFactory` blueprint — already followed by the scaffold.

### Integration Points
- New `BeaconsPanel` + a `beacons` rail destination in `AppSidebar`
  (`RAIL_DESTINATIONS`, `WORK_VIEW_MODES`).
- New Beacon view + (Start/control) info-panel slots in the info-panel multiplexing.
- A throttled **publish loop** binding `watchPosition` → `LiveBeaconFactory` under a
  **generated per-session signer** (D-05) — the genuinely net-new subsystem.
- A **live map layer** that subscribes to 37521 (discoverable surface) + resolves a
  specific beacon `naddr` (link reads), renders live/stale/ended marker states
  (D-07), and runs `dropExpired` on every tick.
- A `/beacon/:naddr` route in `useRouting` + OG crawler match (D-11; coordinate
  with Phase 13 addressing).
</code_context>

<specifics>
## Specific Ideas

- Canonical framing (PROJECT.md): the "I am here, for now" entity — a real-time,
  shareable/public updating position point. The seed personas ("Bike courier —
  live", "Park ranger — live", "Delivery rider — live") show the short-TTL,
  moving-dot shape the UX must support.
- **Privacy is the defining axis of this phase.** The honest posture: throwaway-key
  by default (unlinkable), time-boxed, foreground-only, and visibility that is
  *soft client-side discovery-gating* — "link-only" = unlisted, NOT encrypted. Be
  explicit with the user about that boundary; do not imply cryptographic privacy.
- Three clocks coexist — publish `created_at` (drives staleness/last-seen),
  NIP-40 `expiration` (drives removal), and the user-set time box (sets expiration).
  Keep them legible (D-03/D-04/D-07/D-08), not exposed as equal-weight raw fields.
</specifics>

<deferred>
## Deferred Ideas

- **cordn-style encrypted-GeoJSON transport (NEW AGENDA — future milestone).**
  Implement an Earthly version of **cordn** (https://github.com/Cordn-msg/cordn): run
  a **key coordinator** and transmit **encrypted GeoJSONs (carrying feature
  content)** instead of plain text messages. This adds a new **cryptographic privacy
  dimension across ALL entities** (not just beacons) and is the proper home for what
  Phase 12 can only do softly (D-10 discovery-gating) and for the deferred
  **BEACON-07** (NIP-17 gift-wrap encrypted/private per-viewer beacons). Recorded as
  a project agenda item — NOT v1.2 Phase 12 scope. (Memory:
  `project_cordn_encrypted_geojson_agenda`.)
- **Encrypted / private per-viewer beacons (BEACON-07)** — subsumed by the cordn
  agenda above; deferred this milestone.
- **Beacon driven by external data source / the v1.1 code sandbox (BEACON-05)** —
  asset/vehicle/AIS feed, not just the sharer's GPS. Deferred.
- **Beacon trail / breadcrumb history (BEACON-06)** — only meaningful if an
  ephemeral-stream lifecycle is later adopted. Deferred.
- **Full canonical entity-routing/addressing + comment-root widening** — Phase 13
  (XCUT-01/XCUT-02) owns routing + comments across all four kinds; the `/beacon/:naddr`
  route here may be a thin slice generalized in Phase 13. Flag at plan time.

None of the above expand Phase 12 scope.

</deferred>

---

*Phase: 12-live-beacon-37521*
*Context gathered: 2026-06-28*
