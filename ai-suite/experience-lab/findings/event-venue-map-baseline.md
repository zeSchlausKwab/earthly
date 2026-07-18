# Event venue map: organizer-to-visitor experience audit

- Date: 2026-07-18
- Journey: `event-venue-map`
- Personas: `event-organizer`, `event-visitor`
- Platforms: desktop web authoring → fresh mobile web visitor, 390 × 844
- Evidence level: **hypothetical automated replay**, not user validation

## Result

The organizer created one public Dataset containing a venue outline plus named stage, bar, and
food labels, corrected a misspelled stage in place, published it, added a comment with a map
annotation, and copied the canonical link through Share. A signed-out mobile visitor opened only
that link, received the intended venue, found Main Stage and River Bar, saw the organizer's meeting
point note and annotation by default, closed the inspector without losing the map or URL, and then
inspected an unrelated Sighting. Neither browser reported a page error.

This validates a useful first composition: a public venue is a Dataset, named services are label
features, and operational guidance can remain optional annotated discussion. It does not yet prove
multi-organizer updates, poor-network use, Android behavior, or outdoor human comprehension.

| Rubric | Score | Evidence |
| --- | ---: | --- |
| Entry | 2 | The organizer can start a Dataset, but must translate “venue map” into Earthly's entity model. |
| Completion | 3 | Author, publish, annotate, share, and mobile consumption all completed. |
| Decisions | 2 | One Dataset is sufficient; the UI still exposes substantial geometry/editor machinery. |
| Vocabulary | 2 | Stage and service labels read clearly after the experiment; Dataset and Editor remain internal terms. |
| Destination | 3 | Public · Unattached remains visible and the share link opens without authentication. |
| Recovery | 3 | The misspelled stage was corrected in place before publish. |
| Continuation | 3 | The visitor safely closed inspection and opened an unrelated public Sighting. |
| Return | 2 | The canonical venue route survives inspector close; reload and organizer republish were not run. |
| Parity | 3 | Desktop authoring handed the same geometry and comment annotation to mobile consumption. |
| Confidence | 3 | The visitor saw the exact venue title, named services, note, and map overlay from only the link. |

## Triaged findings

### EXP-EV-001 — Share described a Dataset as a “feature collection”

- Severity: **confusion**
- Step: organizer shared
- Observation: Share said “Share this feature collection,” a term the organizer persona explicitly
  does not use, even though the rest of the UI calls the entity a Dataset.
- Capabilities: share, organize, confidence
- Complexity cost: none; align existing copy with the canonical entity name.
- Disposition: **contracted/fixed**. Dataset share metadata now says Dataset; Context and generic map
  views retain their own labels.

### EXP-EV-002 — Venue services looked like implementation objects

- Severity: **confusion**
- Step: visitor venue opened
- Observation: the mobile inspector rendered service rows as `Text “Main Stage”` and
  `Text “River Bar”`. The visitor thinks in labels and places, not geometry representation.
- Capabilities: inspect, discover
- Related journeys: every read-only Dataset containing annotations
- Complexity cost: copy only; no new entity or rendering mode.
- Disposition: **contracted/fixed**. Annotation badges now read `Label`, and read-only rows show the
  label text without editor-style quotation marks.

### EXP-EV-003 — Read-only venue inspection is still announced as “Editor”

- Severity: **confusion**
- Step: visitor venue opened and inspector closed
- Observation: the signed-out visitor's sheet is titled and announced as `Editor` even though no
  editing is possible. This independently reproduces `EXP-SQ-006` on a Dataset.
- Capabilities: inspect, transition, confidence
- Related journeys: `squirrel-capture` and every mobile entity deep link
- Proposed experiment: derive the sheet title/icon from inspect versus author state while retaining
  the same sheet and route lifecycle.
- Complexity cost: one semantic mapping in the existing shell; do not add another panel mode.
- Disposition: **investigate** as a cross-entity correction.

### EXP-EV-004 — Venue authoring exposes a very dense desktop surface

- Severity: **opportunity**
- Step: organizer correction and draft ready
- Observation: the geometry draft remained usable, but the automated surface inventory recorded
  more than 200 visible controls while the Dataset catalog, Map Stack editor, and map tools were all
  present. Naming three services also leaves three expanded label editors in the narrow Map Stack.
- Capabilities: author-geometry, organize, recover
- Related journeys: `forestry-field-survey`
- Proposed experiment: evaluate a focused authoring stance or collapse completed feature rows; do
  not hide advanced geometry functions until the forestry journey establishes their value.
- Complexity cost: potentially high because expert workflows need the same tools.
- Disposition: **investigate** across the organizer and forestry personas before changing layout.

### EXP-EV-005 — The canonical public handoff is sound

- Severity: **opportunity**
- Step: share, visitor open, close, and continuation
- Observation: a clean `/geoevent/:naddr` link opened the correct Dataset for a signed-out visitor;
  geometry-comment overlays were visible by default; closing the sheet preserved both URL and map;
  and browsing another entity remained possible.
- Capabilities: share, inspect, recover, transition
- Complexity cost: none; preserve this behavior as other mobile semantics are refined.
- Disposition: **contract** through the journey audit.

## Coverage gaps

- Simulate a slow or intermittent venue connection and verify useful content appears progressively.
- Exercise an organizer republish while a visitor keeps the shared route open.
- Run the visitor lane on Android for deep-link, back-button, and outdoor target/readability checks.
- Ask a human visitor to find a service from the rendered map itself; the current proof uses the
  feature list and does not yet measure map-label discoverability.
