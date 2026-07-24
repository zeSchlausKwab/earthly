# Earthly tour demo scenarios

## Purpose

The tour should explain Earthly through short, truthful product stories rather than a feature
checklist. Every film follows one person, starts with a recognizable need, performs the action in
the real Earthly UI, and ends on a visible result on the map.

The Donau Festival map is the recurring setting. It gives the films continuity while still allowing
different perspectives: organizer, visitor, contributor, field crew, and editor.

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

## Next production wave

### Film 06 — Draw precisely on a phone

**Priority:** 1

**Perspective:** Accessibility volunteer on mobile

**Hero candidate:** Yes

**Readiness:** Product UI exists; touch-and-magnifier recording needs a focused proof

**Promise:** Detailed map work is practical in the field, even when a finger covers the exact point.

Suggested story:

> A volunteer maps the accessible entrance beside a stage and traces the short approach route.

Beat sheet:

1. Open the festival map already zoomed to the relevant stage and entrance.
2. Start a small map edit or mobile Dataset draft.
3. Select the point or line drawing tool.
4. Enable the magnifier.
5. Use a real touch gesture so the magnifier follows the finger while the entrance or route is
   placed precisely.
6. Finish the geometry, label it “Accessible entrance,” and end on the saved result.

**Visual requirement:** The magnifier must be unmistakably visible during placement. Do not replace
it with a post-production circle or fake zoom. If Playwright touch synthesis cannot drive it
faithfully, record this film through an Android emulator while keeping the same scripted scenario.

**Chapter explanation:** Pan lock, magnifier zoom, mobile drawing tools, recoverable local drafts,
and editing the same GeoJSON on phone and desktop.

**Automation foundation:** `create.start-dataset`, the mobile editor contract, and a new reusable
touch-placement task only after the scratch recording proves the gesture.

**Suggested assets:** `mobile-drawing-magnifier.mp4`, `mobile-drawing-magnifier.webm`,
`mobile-drawing-magnifier-poster.png`.

### Film 07 — Propose a better map

**Priority:** 3

**Perspective:** Mara contributes on mobile; the map owner reviews on desktop

**Hero candidate:** No—feature chapter

**Readiness:** The real geometry-proposal, preview, and acceptance workflow already has coverage

**Promise:** People can improve a shared map without taking control away from its owner.

Suggested story:

> Mara notices a missing water refill point. She adds it to a proposed copy of the festival map.
> The organizer previews the exact geometry change and accepts it.

Beat sheet:

1. Mara opens the published festival Dataset on her phone.
2. She chooses to propose an edit and places the missing refill point.
3. Cut to the organizer’s desktop with the incoming proposal.
4. Preview the proposal so the new geometry is visually distinct from the canonical map.
5. Accept it.
6. End on the updated festival Dataset with the new point now canonical.

**Chapter explanation:** Signed Nostr events, authorship, proposal status, preview before acceptance,
and the difference between public collaboration and a private group.

**Automation foundation:** `social.propose-dataset-geometry-edit`,
`social.review-dataset-proposal`, and `social.decide-dataset-proposal`. Mobile contributor support
should be proven before recording; desktop-to-desktop is the truthful fallback.

**Suggested assets:** `collaborative-map-proposal.mp4`, `collaborative-map-proposal.webm`,
`collaborative-map-proposal-poster.png`.

### Film 08 — Tell the story around the map

**Priority:** 4

**Perspective:** Festival editor on desktop; reader on mobile

**Hero candidate:** No—feature chapter

**Readiness:** Story creation, publishing, reading, and edit proposals already have workflow coverage

**Promise:** Maps can carry narrative, sources, and practical context—not only shapes.

Suggested story:

> The editor publishes “Tonight at Donau Festival,” links the relevant stages and entrance map, and
> a visitor opens the Story on a phone and jumps from the text to the place.

Beat sheet:

1. Create a Story with a title, short introduction, and one map reference.
2. Publish it and transition into the reader view.
3. Cut to mobile and open the same Story.
4. Tap the referenced stage or Dataset.
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

**Perspective:** Festival field crew on Android

**Hero candidate:** Yes, once the native flow is proven

**Readiness:** Host and nearby-destination behavior are covered; real multi-device transport needs
proof before it is promised on film

**Promise:** A crew can create and exchange spatial field records on a nearby network without
depending on the public internet.

First truthful cut:

1. Open Field sessions in the Android app.
2. Start “Donau Festival setup crew.”
3. Make the “Nearby only” destination and host role clearly visible.
4. Create a nearby Dataset.
5. Draw a blocked entrance, temporary toilet, or safety point on the festival map.
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

## Additional scenario backlog

These are good chapter films after the five requested feature stories:

### Capture a temporary Sighting

A visitor reports a blocked entrance or long toilet queue from a phone, adds a photo or description,
sets its useful lifetime, and publishes it at the exact place. This shows lightweight field capture
without turning every observation into a permanent Dataset.

### Organize a festival Context

An organizer gathers the site plan, program Story, accessibility map, and visitor reports into one
Context. This explains how Earthly can present a coherent project without copying its underlying
content.

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

## Recommended order

1. **Mobile drawing and magnifier proof.** It is the most visually distinctive remaining feature
   and reveals early whether browser touch recording is sufficient or Android capture is required.
2. **AI-assisted festival map.** The deterministic workflow exists and gives the tour a strong
   headline feature.
3. **Public map proposal.** Most of the cross-persona automation already exists.
4. **Story to map.** Record creation and reading first; add editorial proposals to the longer cut.
5. **Field session.** Produce the honest host-only cut first, then upgrade it when a real two-device
   nearby exchange is demonstrably repeatable.

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
