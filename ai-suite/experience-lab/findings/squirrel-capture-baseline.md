# Squirrel capture: first mobile experience audit

- Date: 2026-07-18
- Journey: `squirrel-capture`
- Persona: `casual-wildlife-observer`
- Platform: responsive mobile web, 390 × 844
- Evidence level: **hypothetical automated replay**, not user validation

## Result

The observer could find Create → Sighting, cancel the first placement, place a point, add a title
and description, publish publicly, find the result in Sightings, inspect another sighting, and
begin a second capture. `Public · Unattached` remained visible throughout. The browser reported no
console errors, page errors, failed requests, or error responses.

The first iteration now keeps observation time, lifespan, and Context attachment behind one
mobile-only `More options` disclosure. The public defaults remain unchanged, desktop and edit
surfaces remain expanded, and the form still has exactly one publish action. The canonical publish
control now stays in the mobile sheet header beside an explicit Cancel action, so it remains
available while the form scrolls.

Photo upload was not exercised because the deterministic localhost suite does not yet provide a
fake Blossom target. The run therefore does not prove the journey's media outcome.

| Rubric | Score | Evidence |
| --- | ---: | --- |
| Entry | 3 | The bottom-dock Create action exposes Sighting directly. |
| Completion | 3 | Publishing succeeds and the one canonical action remains visible in the persistent sheet header. |
| Decisions | 3 | Quick capture presents title, note, and photos; time, lifespan, and Context are optional disclosure. |
| Vocabulary | 2 | “Sighting” and “What did you see?” are clear; `Unattached` and Context remain product terms. |
| Destination | 3 | `Public · Unattached` is visible before and after publishing. |
| Recovery | 3 | Cancellation returns to a usable map and another placement can begin. |
| Continuation | 3 | The observer can inspect another item and start a second capture. |
| Return | 0 | Reload, offline persistence, and another-device visibility were not exercised. |
| Parity | 2 | Responsive behavior passed; Android camera/location/process behavior remains separate. |
| Confidence | 3 | Publish lands on a titled inspector and the item appears in Sightings. |

## Triaged findings

### EXP-SQ-001 — “Clean” development starts accumulated old relay seeds

- Severity: **serious friction** for testing and performance diagnosis
- Step: entry and list return
- Observation: the first run exposed 468 controls and 417 Sightings even though the seeder creates
  12. A direct local-relay query returned 500 unique kind-37522 events from many prior seed runs.
- Cause: `scripts/kill-relay.sh` deleted the retired `events.db` path instead of the canonical
  `relay/data/events-lmdb/` store.
- Capabilities: discover, inspect, capture, recover
- Complexity cost: none; correct an obsolete infrastructure path.
- Disposition: **contracted/fixed**. After a true reset the relay returned 12 unique sightings,
  entry controls fell from 468 to 40, and the post-publish list count was 13.

### EXP-SQ-002 — Sighting placement received contradictory drawing instructions

- Severity: **serious friction**
- Step: placement, cancellation, and editor entry
- Observation: the Sighting overlay said “Click the map to drop your sighting” while a toast said
  “Lock panning to draw” and instructed a press-drag gesture. The toast remained after cancellation
  and after the Sighting editor opened.
- Capabilities: capture, location, recover
- Related journeys: `forestry-field-survey`, `event-venue-map`
- Experiment: suppress generic dataset-drawing guidance during Sighting pin-drop and dismiss it
  whenever drawing ends.
- Complexity cost: no new UI or state; distinguish two existing authoring intents.
- Disposition: **contracted/fixed**. The repeat audit recorded no conflicting alert at placement,
  recovery, editor entry, or second-capture entry. A narrow mobile editor contract now protects it.

### EXP-SQ-003 — Quick capture hides its primary action below advanced choices

- Severity: **serious friction**
- Step: editor ready
- Observation: the initial middle sheet shows title, description, and photo entry, but not Publish.
  Observation time, fade/expiry choices, and optional Context attachment precede the final action.
  Automation can scroll, but the very-low-patience persona may not discover the required action.
- Capabilities: capture, media, destination, publish
- Related journeys: all low-patience capture journeys
- Proposed experiment: preserve the current defaults behind a single “More options” disclosure or
  provide a sheet-aware sticky publish action. Do not remove expiry or Context functionality.
- Complexity cost: one progressive-disclosure rule; avoid a second independent publish mechanism.
- Disposition: **contracted/fixed**. Mobile create exposes one `More options` row for time,
  lifespan, and Context while desktop and mobile edit remain expanded. The one canonical publish
  control portals into the persistent sheet header with Cancel; it is not duplicated in the form.
  A shared header-action slot now also supports Story, Context, and Beacon editors while retaining
  each editor's own validation and loading state. Focused contracts prove the defaults are hidden,
  advanced controls remain reachable, entered work survives toggling, and the action is visible.

### EXP-SQ-004 — Placement guidance competes with the destination indicator

- Severity: **confusion**
- Step: placement armed
- Observation: the centered top placement prompt overlaps part of the top-left
  `Public · Unattached` indicator at 390 px width—the exact moment destination comprehension is
  being evaluated.
- Capabilities: capture, destination, location
- Related journeys: every mobile map-first creation path
- Proposed experiment: reserve a mobile top-safe lane or position transient placement guidance
  below the destination indicator.
- Complexity cost: layout only; no new control.
- Disposition: **contracted/fixed**. The destination is now a compact centered badge in the first
  top-safe lane. Search and placement guidance share a separate second lane, and placement is
  suppressed while search is open. A Pixel-sized editor contract verifies their bounding boxes do
  not overlap each other or the right-hand map controls.

### EXP-SQ-005 — Mobile map controls are below the suite's 44 px target baseline

- Severity: **confusion/accessibility risk**
- Step: entry and every map-visible state
- Observation: zoom, bearing, location, 3D, globe, fullscreen, lookup, theme, and share controls
  measured 32 × 32; the destination control measured 28 px high. The bottom dock itself met the
  target-size baseline.
- Capabilities: discover, location, inspect, accessibility across all journeys
- Complexity cost: increasing targets reduces already-scarce map space, so controls may need
  progressive grouping rather than simple enlargement.
- Disposition: **deferred**. The recurring evidence remains valid, but this UI pass deliberately
  leaves map-control sizing unchanged until grouping and task-aware visibility are designed.

### EXP-SQ-006 — Inspector semantics still read “Editor”

- Severity: **confusion**
- Step: publish result and inspect another
- Observation: the mobile sheet is announced and headed as `Editor` while displaying a published
  read-only Sighting inspector.
- Capabilities: inspect, transition, confidence
- Related journeys: every entity-inspection journey
- Proposed experiment: derive the sheet's semantic title and icon from inspect versus edit state.
- Complexity cost: reuse existing panel state; do not add another sheet mode.
- Disposition: **contracted/fixed**. The existing sheet now derives its title and icon from the
  active entity and intent: for example `Dataset`, `Sighting`, `New story`, or `Edit context`.
  Inspectors use inspect semantics without introducing another panel mode.

### EXP-SQ-007 — Placement could arm before the map editor was ready

- Severity: **serious friction**
- Step: placement after recovery
- Observation: under the full parallel editor suite, the placement prompt could appear before the
  GeoEditor instance finished mounting. React considered placement armed, but no draw mode had
  been applied, so tapping the map did nothing indefinitely.
- Capabilities: capture, location, recovery
- Related journeys: every map-first creation path
- Complexity cost: no new state or UI; reconcile the existing armed state when the editor arrives.
- Disposition: **contracted/fixed**. Late editor initialization now adopts an already-armed
  Sighting placement, and the mobile quick-capture contract reuses the canonical placement task.

## Coverage gaps

- Provide a deterministic local Blossom adapter before promoting the photo portion to a contract.
- Add Android instrumentation only for camera selection, location permission, process lifecycle,
  and native intent behavior; do not duplicate this responsive journey wholesale.
- Exercise reload/draft recovery after the first human session clarifies whether fast capture should
  autosave partial Sighting work.
