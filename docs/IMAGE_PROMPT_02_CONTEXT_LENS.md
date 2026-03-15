# Image Prompt 02: Context Lens

Copy-paste the prompt below as-is:

```text
Create a clean architecture poster titled "Map Context As A Lens" with the subtitle "Why 37518 is not just geometry".

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
- one clear top-down layout
- labels must be short and highly legible
- avoid crossing arrows
- each box should use at most 2 short lines of text

Build the composition like a control tower over two lanes.

Show these boxes:
1. Map Context 37518 - "control object"
2. Sticky Lane - "fixedReferences"
3. Foreign Lane - "datasets with matching c tag"
4. Validation Gate - "schema + geometry rules"
5. Visible Map Lane - "rendered datasets"
6. Small switch badge - "allowForeignAttachments"

Show these arrows with clear labels:
- Map Context 37518 -> Sticky Lane : "pins authored references"
- Datasets 37515 -> Foreign Lane : "self-attach with c tag"
- allowForeignAttachments switch -> Foreign Lane : "open or closed"
- Sticky Lane -> Validation Gate : "always feeds view"
- Foreign Lane -> Validation Gate : "only if allowed"
- Validation Gate -> Visible Map Lane : "strict filters invalid datasets"

Inside or near the Map Context box, add 3 small pills:
- taxonomy
- validation
- hybrid

Add one small technical note near the bottom:
"Dataset -> Context uses raw coordinate 37518:pubkey:d"
"Context -> Dataset pins usually use naddr references"

The poster should make it obvious that the context is a policy and curation layer, not the main geometry payload.
```
