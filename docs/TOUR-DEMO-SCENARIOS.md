# Earthly tour demo scenarios

## Purpose

The tour should explain Earthly through short, truthful product stories rather than a feature
checklist. Every film follows one person, starts with a recognizable need, performs the action in
the real Earthly UI, and ends on a visible result on the map.

The first three films share the Donau Festival setting. New films deliberately rotate industries,
continents, and terrain so Earthly reads as a general spatial tool rather than a festival-specific
product. Vienna is retired as a setting for future recordings.

## Presentation model

Use two related cuts where a scenario needs more room:

- **Hero loop:** 15–22 seconds, silent and understandable without narration. One promise, four or
  five actions, one strong final frame.
- **Chapter film:** 35–60 seconds when the workflow benefits from context, multiple people, or an
  explanation of the technology.

Keep the hero slider to roughly five stories. A long row of seven or eight tabs will weaken the
opening. Additional films should appear in the relevant tour chapters with a concise explanation,
technical note, and use-case examples.

All recordings should use:

- the actual Earthly UI against loopback services and disposable local identities;
- 1440 × 900 for desktop and 390 × 844 for mobile;
- MP4, WebM, and a deliberately selected poster frame;
- real observable waits rather than fixed timing;
- editorial framing, cursor emphasis, and camera crops only—never a fabricated product result.

## Existing films

### Film 01 — Make the festival map

**Status:** Complete

**Perspective:** Festival organizer on desktop

**Promise:** Turn an existing site plan into editable, useful GeoJSON.

The organizer redraws the supplied Donau Festival plan, zooms into the festival grounds, and adds
visitor infrastructure such as stages, stands, entrances, the perimeter, and toilets.

### Film 02 — Join the place

**Status:** Complete

**Perspective:** Festival visitor on mobile

**Promise:** Participate without leaving the map.

The visitor opens a stage, comments with an exact meeting point, and shares the place with someone
else.

### Film 03 — Work in private

**Status:** Complete

**Perspective:** Coordinator on desktop, Mara on mobile, coordinator on desktop

**Promise:** A private spatial conversation can move naturally between devices.

The coordinator creates an MLS-protected festival group, Mara joins and asks where the crew should
meet, and the coordinator draws the exact Crew Gate before replying.

### Film 04 — Ask Earthly

**Status:** Complete

**Perspective:** Map author on desktop

**Promise:** A short request can become a detailed, editable map and a sourced Story.

The author asks:

> “Draw me an informative and detailed map about Chinas belt and road initiative. Don't forget to
> add the new northern passages that could be unlocked due to climate change and make sure to
> annotate the key nodes and ports.”

Earthly creates a 117-feature GeoJSON Dataset with land corridors, maritime routes, annotated nodes
and ports, and three potential Arctic passages. Warm orange anchor markers distinguish ports from
land nodes and Arctic waypoints during the detail pans. The film expands the AI's action details,
keeps the real approval steps visible, publishes the Dataset, and asks for an article with an
inline reference to it. The final frame shows the published Story and its live Dataset reference
together.

**Assets:** `ai-belt-road-story.mp4`, `ai-belt-road-story.webm`,
`ai-belt-road-story-poster.png`.

### Film 05 — Trace the routes

**Status:** Complete

**Perspective:** Map author on desktop

**Promise:** A concise request can turn a dense maritime system into an explorable Dataset.

The author asks:

> “Replace the current shipping lanes with outward routes through Hormuz to major global ports.
> Keep the Gulf ports and label every destination.”

The request deliberately specifies the outcome without naming destinations or dictating a research
workflow. The film shows the real AI action disclosure creating and applying seven outbound route
features, then moves into a verified 38-feature production Dataset: 24 Persian Gulf port and
chokepoint markers, seven labeled global destinations, and seven representative corridors. The
browse sidebar and Map Stack are closed for five readable passes: the Gulf/Hormuz origin, Arabian
Sea branches, Asian destinations, the Suez-to-Rotterdam corridor, and the complete global network.

The Gulf port locations come from OpenStreetMap search results. The global destination markers and
maritime waypoints are intentionally verified production geometry and are presented as
representative connections, not official traffic-separation schemes.

**Assets:** `hormuz-ports-shipping.mp4`, `hormuz-ports-shipping.webm`,
`hormuz-ports-shipping-poster.png`.

### Film 06 — Draw precisely on a phone

**Status:** Complete

**Perspective:** Hiker on mobile

**Hero candidate:** Yes

**Readiness:** Real touch synthesis and the magnifier interaction are proven

**Promise:** Detailed map work stays practical on a remote trail, even without connectivity.

Story:

> Near Refugio Chileno in Torres del Paine, a hiker marks a reported creek-crossing hazard
> precisely and draws a safe detour for friends after the device goes offline.

Beat sheet:

1. Open the saved W Trek area around the remote crossing.
2. Start “W Trek · Friends offline map” as a mobile Dataset draft.
3. Select the point or line drawing tool.
4. Enable the magnifier.
5. Disconnect the browser and verify that the edit continues locally.
6. Use real touch gestures so the magnifier follows the finger while “Creek crossing hazard” and
   “Safe detour” are placed precisely.
7. Finish on both geometries with the offline state still visible.

**Visual requirement:** The magnifier must be unmistakably visible during placement. Do not replace
it with a post-production circle or fake zoom. If Playwright touch synthesis cannot drive it
faithfully, record this film through an Android emulator while keeping the same scripted scenario.

**Chapter explanation:** Pan lock, magnifier zoom, mobile drawing tools, offline basemaps,
recoverable local drafts, and sharing the same GeoJSON when the group reconnects.

**Automation foundation:** `create.start-dataset`, the mobile editor contract, and a new reusable
touch-placement task only after the scratch recording proves the gesture.

**Assets:** `mobile-drawing-magnifier.mp4`, `mobile-drawing-magnifier.webm`,
`mobile-drawing-magnifier-poster.png`.

### Film 07 — Propose a better map

**Status:** Complete

**Perspective:** Forestry contractor in the field; operations planner on desktop

**Hero candidate:** No—feature chapter

**Promise:** People can improve a shared map without taking control away from its owner.

Story:

> On Vancouver Island, a contractor finds a damaged bridge on West Woss Road and proposes a
> surveyed bypass. The operations planner previews the geometry change and accepts it.

Beat sheet:

1. The contractor opens the published forestry operations Dataset on a phone.
2. They place the blocked culvert and draw the usable road alignment in a proposed copy.
3. Cut to the operations planner’s desktop with the incoming proposal.
4. Preview the proposal so the new geometry is visually distinct from the canonical map.
5. Accept it.
6. End on the updated access map with the new point and road now canonical.

**Chapter explanation:** Signed Nostr events, authorship, proposal status, preview before acceptance,
and the difference between public collaboration and a private group.

The base map uses the real OpenStreetMap geometry for the unpaved West Woss Road bridge and its
adjacent road segments. The operations block, protection buffer, damage report, and bypass are
explicitly illustrative scenario data.

**Automation foundation:** `social.propose-dataset-geometry-edit`,
`social.review-dataset-proposal`, `social.decide-dataset-proposal`, and
`editor.place-mobile-precision-point`. The mobile-to-desktop workflow has scenario coverage.

**Assets:** `collaborative-map-proposal.mp4`, `collaborative-map-proposal.webm`,
`collaborative-map-proposal-poster.png`.

## Next production wave

### Film 08 — Tell the story around the map

**Priority:** 4

**Perspective:** Natural-history editor on desktop; student on mobile

**Hero candidate:** No—feature chapter

**Readiness:** Story creation, publishing, reading, and edit proposals already have workflow coverage

**Promise:** Maps can carry narrative, sources, and practical context—not only shapes.

Suggested story:

> An editor publishes “Why the Galápagos Islands Evolved Differently,” links species and geology
> layers, and a student jumps from an inline fact to the exact island on the map.

Beat sheet:

1. Create a Story with a title, short introduction, and one map reference.
2. Publish it and transition into the reader view.
3. Cut to mobile and open the same Story.
4. Tap a referenced species sighting or island Dataset.
5. End with the map centered on that place while the Story remains the source of context.

The longer chapter cut can add editorial collaboration: Mara proposes a corrected paragraph and
the owner reviews and accepts it.

**Chapter explanation:** Long-form Nostr content, local-first drafts, map references, signed
publishing, and proposal-based editing.

**Automation foundation:** `create.story-draft`, `create.publish-story`,
`social.propose-story-edit`, and `social.accept-story-edit`.

**Suggested assets:** `story-to-map.mp4`, `story-to-map.webm`, `story-to-map-poster.png`.

### Film 09 — Keep working nearby

**Priority:** 5

**Perspective:** Disaster-response team on Android

**Hero candidate:** Yes, once the native flow is proven

**Readiness:** Host and nearby-destination behavior are covered; real multi-device transport needs
proof before it is promised on film

**Promise:** A response team can create and exchange spatial field records on a nearby network
without public internet or grid power.

First truthful cut:

1. Open Field sessions in the Android app.
2. Start “Efate cyclone response.”
3. Make the “Nearby only” destination and host role clearly visible.
4. Create a nearby Dataset.
5. Draw a blocked road, water-distribution point, or medical station on the Efate response map.
6. Leave the nearby destination and show that the ordinary public workspace remains separate.

Full two-device cut, only after transport is proven:

1. The host starts the session and exposes the local connection.
2. A second phone joins nearby.
3. One device draws a temporary hazard or facility.
4. The second device receives it on the shared map.
5. End on both devices showing the same nearby record.

**Chapter explanation:** Local Nostr node, nearby-only publishing destination, separation from public
and private-group channels, and what survives when connectivity changes.

**Automation foundation:** The forestry field-survey journey and Android smoke infrastructure. The
browser’s simulated native boundary is suitable for assertions, but the marketing film should use
the Android runtime when showing the local node itself.

**Suggested assets:** `field-session-nearby.mp4`, `field-session-nearby.webm`,
`field-session-nearby-poster.png`.

## Canonical scenario palette

These settings are the default source material for subsequent films. Locations should change only
when the product flow needs geography that is more truthful or visually legible.

| Scenario | Primary setting | Product story |
| --- | --- | --- |
| Logging company | Vancouver Island, Canada | Harvest blocks, access roads, culverts, machinery sightings, and field-to-office map proposals |
| Maritime insurance analysis | Singapore and the Malacca Strait | Ports, vessel corridors, congestion and piracy exposure, claims annotations, and a sourced risk Story |
| Festival organization | Roskilde, Denmark | Site planning, private crews, visitor facilities, temporary changes, and public participation |
| Hiking tour with friends — offline | W Trek, Torres del Paine, Chile | Downloaded area, trail hazards, magnifier drawing, local drafts, and sharing after reconnection |
| Delivery company | Mexico City, Mexico | Depot territories, delivery stops, traffic-aware route alternatives, failed-delivery notes, and dispatch collaboration |
| Data science | Chicago, United States | Import public datasets, style and compare layers, derive spatial patterns, and publish a reproducible explainer |
| Disaster relief — offline / no electricity | Efate, Vanuatu | Nearby field session, blocked roads, water and medical points, device-to-device exchange, and delayed publishing |
| Map encyclopedia / education / trivia | Galápagos Islands, Ecuador | Linked Stories, species and geology layers, quiz-like map exploration, sources, and inline map references |
| Real estate presentation | Lisbon, Portugal | Walking and transit isochrones, schools and amenities, commute comparisons, and a narrative property presentation |

Avoid returning to Vienna in new recordings. Geographic variety is part of the product story.

## Additional scenario backlog

These are good chapter films after the five requested feature stories:

### Capture a temporary Sighting

A visitor reports a blocked entrance or long toilet queue from a phone, adds a photo or description,
sets its useful lifetime, and publishes it at the exact place. This shows lightweight field capture
without turning every observation into a permanent Dataset.

### Organize a festival Context

At Roskilde, an organizer gathers the site plan, program Story, accessibility map, and visitor
reports into one Context. This explains how Earthly can present a coherent project without copying
its underlying content.

### Share live location or a beacon

A crew member shares an intentional, time-bounded location signal while moving between stages. This
should be recorded only after the desired privacy language and expiry behavior are clear in the UI.

### Recover unfinished work

A mapper starts a drawing on mobile, closes the editor, and returns through Local drafts. It is less
spectacular than the hero films but strongly communicates local-first reliability.

### Show portable, signed data

Publish a small map, inspect or copy its canonical link, and open it in a second session. Pair the
film with a concise technical panel explaining GeoJSON, Nostr event signatures, relays, and why the
content is not trapped in an Earthly account.

## Recommended next order

1. **Logging map proposal.** Most of the cross-persona automation already exists and the
   Vancouver Island setting naturally explains field-to-office review.
2. **Maritime insurance analysis.** Build on the proven AI map workflow while shifting from
   infrastructure inventory to risk reasoning around Singapore and the Malacca Strait.
3. **Efate field session.** Produce the honest host-only cut first, then upgrade it when a real
   two-device nearby exchange is demonstrably repeatable.
4. **Galápagos Story to map.** Record creation and reading first; add editorial proposals to the
   longer cut.
5. **Lisbon real-estate presentation.** Pair isochrones and amenities with a polished Story once
   the analysis flow is ready to record.

After Films 04 and 05, reassess the hero order. A likely five-story slider is:

1. Make the map
2. Ask Earthly
3. Draw on mobile
4. Work in private
5. Work nearby

“Join the place,” public collaboration, and Stories can remain prominent immediately below the
hero as chapter films.

## Definition of done for each film

- The scenario succeeds twice against a freshly seeded loopback environment.
- Every mutation comes from a visible Earthly action.
- The final frame proves the promised result without explanatory narration.
- No private keys, provider credentials, public-relay writes, or remote mutations enter the
  recording.
- MP4 and WebM have matching duration and dimensions.
- The poster is selected from the final film rather than generated separately.
- The tour page has concise title, explanation, transcript-like alt text, and a meaningful chapter
  link.
- Playwright coverage verifies the asset URLs and the surrounding slider or chapter interaction.
