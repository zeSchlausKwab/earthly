# Image Prompt 01: Entity Overview

Copy-paste the prompt below as-is:

```text
Create a clean architecture poster titled "Earthly Geo Entity Overview" with the subtitle "Nostr-native mapping model".

Use the exact same visual style as the other Earthly architecture posters:
- flat 2D editorial infographic
- warm white paper background
- dark slate typography and outlines
- deep ocean blue for primary entity boxes
- muted teal for supporting boxes
- soft amber for status or warning boxes
- rounded rectangles, thin 2px lines, orthogonal arrows, generous whitespace
- crisp labels, large text, no paragraphs inside nodes
- subtle paper texture or faint grid only
- no 3D, no isometric, no photos, no screenshots, no neon, no purple, no dark mode

Keep the graph simple because image models are weak at dense diagrams:
- maximum 6 main boxes
- one central hub layout
- labels must be short and highly legible
- avoid crossing arrows
- each box should use at most 2 short lines of text

Show these boxes:
1. Dataset 37515 - "FeatureCollection + metadata"
2. Map Context 37518 - "lens / taxonomy / validation"
3. Geo Comment 37517 - "threaded text + optional GeoJSON"
4. Geo Edit Proposal 37519 - "replacement geometry"
5. Proposal Status 1630-1633 - "draft / open / applied / closed"
6. Next Dataset Version 37515 - "same d-tag lineage"

Place Dataset 37515 in the center as the primary geometry entity.

Show these arrows with clear labels:
- Dataset 37515 -> Map Context 37518 : "c tag attaches to context"
- Map Context 37518 -> Dataset 37515 : "fixedReferences pin datasets"
- Geo Comment 37517 -> Dataset 37515 : "comment on dataset"
- Geo Comment 37517 -> Map Context 37518 : "comment on context"
- Geo Edit Proposal 37519 -> Dataset 37515 : "targets dataset"
- Proposal Status 1630-1633 -> Geo Edit Proposal 37519 : "resolves state"
- Geo Edit Proposal 37519 -> Next Dataset Version 37515 : "accepted -> republish"
- Dataset 37515 -> Next Dataset Version 37515 : "same d + p tag history"

Add one small side note in amber:
"37516 collections are deprecated in the active model"

Make the result feel like a product architecture poster for engineers: elegant, minimal, readable, diagram-first.
```
