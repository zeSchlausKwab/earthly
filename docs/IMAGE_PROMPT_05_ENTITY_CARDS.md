# Image Prompt 05: Entity Cards

Copy-paste the prompt below as-is:

```text
Create a visually appealing architecture explainer poster titled "Earthly Geo Entities" with the subtitle "What each Nostr entity does".

Use the exact same visual style as the other Earthly architecture posters:
- flat 2D editorial infographic
- warm white paper background
- dark slate typography and outlines
- deep ocean blue for primary entity cards
- muted teal for supporting cards
- soft amber for status or warning accents
- rounded rectangles, thin 2px lines, generous whitespace
- crisp labels, large text, elegant hierarchy
- subtle paper texture or faint grid only
- no 3D, no isometric, no photos, no screenshots, no neon, no purple, no dark mode

Do not make this a complex graph.
Instead, create a clean card-based layout with 5 cards in a balanced grid.
Each card should have:
- one simple icon
- entity name
- kind number
- 3 short bullet points

Make it feel like a polished product architecture sheet for engineers and designers.

Use these cards:

1. Dataset
Kind: 37515
Icon: map or folded map icon
Bullets:
- Stores the actual GeoJSON FeatureCollection
- Carries bbox, geohash, checksum, and metadata
- Can attach itself to map contexts with c tags

2. Map Context
Kind: 37518
Icon: compass or lens icon
Bullets:
- Acts as a lens over datasets
- Pins sticky references and controls foreign attachments
- Can validate geometry and schema rules

3. Geo Comment
Kind: 37517
Icon: speech bubble icon
Bullets:
- Adds threaded discussion to a dataset or context
- Can include optional annotation GeoJSON
- Supports replies with NIP-22 threading

4. Geo Edit Proposal
Kind: 37519
Icon: git branch, pencil, or merge-request icon
Bullets:
- Suggests a full replacement geometry for a dataset
- Targets an existing dataset lineage
- Lets the owner review changes before applying

5. Proposal Status
Kind: 1630 to 1633
Icon: check-circle or status badge icon
Bullets:
- Tracks draft, open, applied, or closed state
- References the proposal with a tags
- Separates review state from geometry payload

Add a slim footer strip at the bottom with this note:
"Datasets carry geometry. Contexts organize and validate it. Comments discuss it. Proposals change it."

Add one small amber callout in a corner:
"37516 collections are deprecated in the active model"

The poster should prioritize readability, icon clarity, and elegant spacing over diagram complexity.
```
