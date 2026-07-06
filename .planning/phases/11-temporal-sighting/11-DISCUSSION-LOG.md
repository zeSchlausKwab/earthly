# Phase 11: Temporal Sighting - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-27
**Phase:** 11-temporal-sighting
**Areas discussed:** Placement & create UX, Time & expiry input, Map render & fade, Browse & discoverability

---

## Placement & create UX

### Create mechanic

| Option | Description | Selected |
|--------|-------------|----------|
| Map pin-drop → form | 'New Sighting' → cursor pin-drop → click map to place → compact info-panel form | ✓ |
| Panel-first form → place | Mirror Story: form opens first, then a 'pick location' step | |
| Reuse point-draw tool | Existing GeoEditor point draw mode + publish dialog | |

**User's choice:** Map pin-drop → form
**Notes:** Map-first fits a placed observation; chosen over the text-first Story flow.

### Geometry scope

| Option | Description | Selected |
|--------|-------------|----------|
| Point only | Single point always; simplest, matches 'single placed feature' | |
| Point + optional area | Default point, allow small line/polygon for 'area where I saw it' | ✓ |
| You decide | Planner picks, default point-only | |

**User's choice:** Point + optional area
**Notes:** Implies adding a geometry field to the 37522 content shape (currently bbox+geohash only). Flagged in CONTEXT D-02.

---

## Time & expiry input

### Observation time

| Option | Description | Selected |
|--------|-------------|----------|
| Default now, expandable | start=now default; 'adjust time' reveals start + optional end | ✓ |
| Always show start + end | Explicit fields always shown, prefilled to now | |
| Instant only (start) | Single timestamp, no end | |

**User's choice:** Default now, expandable
**Notes:** Keeps the 'I just saw it' case one tap while supporting past + future duration events.

### Expiry (NIP-40)

| Option | Description | Selected |
|--------|-------------|----------|
| Presets, independent | Friendly presets (1d/1w/1mo/never) + custom date, independent of end | |
| Derived from end, overridable | Default expiry = end + grace, overridable | |
| You decide | Planner picks; default presets-independent with sensible TTL | ✓ |

**User's choice:** You decide
**Notes:** Default direction = presets-independent + sensible default TTL; client-filter on every read path required.

---

## Map render & fade

### Marker + fade

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct marker + opacity aging | Distinct marker; opacity fades toward expiry; filter removes at expiry | |
| Distinct marker, hard vanish | Distinct marker; full strength until expiry filter drops it | |
| You decide | Planner picks; distinct marker + hard expiry-filter removal minimum | ✓ |

**User's choice:** You decide
**Notes:** Hard NIP-40 expiry-filter removal is the required minimum; gradual aging is a cheap-if-possible nice-to-have.

### Observation-time cue

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, subtle time cue | live-now / upcoming / past distinction on the marker | ✓ |
| No, uniform until expiry | All non-expired render the same; time shown only in detail | |
| You decide | Planner decides | |

**User's choice:** Yes, subtle time cue
**Notes:** Helps the 'happening now' case stand out; keep subtle, reuse existing styling.

---

## Browse & discoverability

### Browse surface

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated Sightings rail tab | Rail destination + browse panel + 'New Sighting' top button | ✓ |
| Map-markers primary + light list | Map as primary surface, only a light list/filter | |
| You decide | Planner picks; default dedicated rail tab | |

**User's choice:** Dedicated Sightings rail tab
**Notes:** Carries forward Phase-10 pattern; avoids the Phase-9 built-but-unwired dead-end.

### Share surface

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, route + OG card | /sighting/:naddr route + OG card (reuse src/lib/og/) | ✓ |
| Route only, no OG card | Route for nav/addressing, skip OG card this phase | |
| You decide | Planner decides; Phase 13 may own routing | |

**User's choice:** Yes, route + OG card
**Notes:** Coordinate with Phase 13 (cross-cutting entity routing) to avoid double-implementing the canonical route shape.

---

## Claude's Discretion

- Expiry input style (D-04) — default presets-independent + sensible TTL.
- Map marker + fade treatment (D-05) — distinct marker + hard expiry filter minimum.
- `c`-attach UX during create (SIGHT-02) — reuse Phase-9 Group-picker + warn-not-block.
- Detail/view panel layout, draft-save behavior, in-place edit flow (modify preserves `d`).

## Deferred Ideas

- AI paste→Sighting ingest (SIGHT-05) — later milestone.
- Geoprivacy obscuring / coarse location (SIGHT-06) — deferred this milestone.
- Gradual opacity-aging toward expiry — nice-to-have within D-05.
- Full canonical entity routing/addressing — Phase 13 owns it; D-08 may be scoped thin.
