# Image Prompt 03: Runtime Flow

Copy-paste the prompt below as-is:

```text
Create a clean architecture poster titled "Earthly Runtime Flow" with the subtitle "From relay events to publish".

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
- one left-to-right flow
- labels must be short and highly legible
- avoid crossing arrows
- each box should use at most 2 short lines of text

Show these boxes in a horizontal sequence:
1. Relay Events
2. useStations / useMapContexts
3. Latest by kind:pubkey:d
4. Materialized Dataset / Context
5. Editor Draft
6. Required Context Validation
7. Publish Dataset 37515

Use a small amber side box for:
"Block publish if required context fails"

Show these arrows with clear labels:
- Relay Events -> useStations / useMapContexts : "subscribe"
- useStations / useMapContexts -> Latest by kind:pubkey:d : "collapse history"
- Latest by kind:pubkey:d -> Materialized Dataset / Context : "current entity"
- Materialized Dataset / Context -> Editor Draft : "open for view/edit"
- Editor Draft -> Required Context Validation : "check attached required contexts"
- Required Context Validation -> Publish Dataset 37515 : "valid"
- Required Context Validation -> amber side box : "invalid"

Add a small footer note:
"Datasets and contexts behave like parameterized replaceable lineages in the UI"

Make it feel like a runtime systems diagram, not a product marketing graphic.
```
