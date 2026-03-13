# Image Prompt 04: Social Review Layer

Copy-paste the prompt below as-is:

```text
Create a clean architecture poster titled "Social Review Layer" with the subtitle "Comments, proposals, and dataset updates".

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
- maximum 7 main boxes
- split the poster into an upper comments lane and a lower proposals lane
- labels must be short and highly legible
- avoid crossing arrows
- each box should use at most 2 short lines of text

Upper lane: comment flow
Show these boxes:
1. Dataset or Context
2. Top-Level Comment 37517
3. Reply Comment 37517

Show these arrows:
- Dataset or Context -> Top-Level Comment 37517 : "root thread"
- Top-Level Comment 37517 -> Reply Comment 37517 : "reply chain"

Lower lane: proposal flow
Show these boxes:
4. Target Dataset 37515
5. Proposal 37519
6. Owner Review
7. Status 1631 Applied
8. Status 1632 Closed
9. Next Dataset Version 37515

Show these arrows:
- Target Dataset 37515 -> Proposal 37519 : "proposal targets dataset"
- Proposal 37519 -> Owner Review : "preview replacement geometry"
- Owner Review -> Status 1631 Applied : "accept"
- Owner Review -> Status 1632 Closed : "reject"
- Status 1631 Applied -> Next Dataset Version 37515 : "dataset republished"

Add one small note near the comments lane:
"Comments may include optional annotation GeoJSON"

Add one small note near the proposals lane:
"Proposal stores full replacement geometry, not a diff"

Make the two lanes visually balanced and clearly related, like one coherent review system around the dataset lineage.
```
