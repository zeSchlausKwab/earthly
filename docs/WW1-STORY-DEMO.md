# WW1 Story styling fixture

This is a **synthetic UI fixture**, not a historically validated article or dataset.
It recreates the Western Front example from `sketch-map-with-a-margin/data.js`
using the application's real Story, Map, and inline-view paths.

## Open the demo

With the app on port 3001 and the development relay on port 3334:

- [Read the Story](http://localhost:3001/read/naddr1qvzqqqyjjqpzpp4g9j433v5n757t42hgeh97u0m7csnlm70eeyeakauqpw677w9qqqt8wae394jx2mt094mk2um5v4exuttxwfhkuaq0c4w43)
- [Inspect the Story](http://localhost:3001/story/naddr1qvzqqqyjjqpzpp4g9j433v5n757t42hgeh97u0m7csnlm70eeyeakauqpw677w9qqqt8wae394jx2mt094mk2um5v4exuttxwfhkuaq0c4w43)

The Story belongs to the Earthly Curator development identity. The five source
Maps belong to a different development identity, so this exercises foreign-map
references rather than relying on ownership. Use the owner to edit the original,
or make a copy under another identity.

## What to style and check

The opening `MapPresentationV1` has nine stable layer instances referencing four
front-line Maps and one seven-point battle Map. Multiple instances reuse the same
source with different feature selections and styles. Original source properties
remain unchanged.

| Physical block | Display | Purpose |
| --- | --- | --- |
| November 1914 | Cue and figure | Blue front; selected Marne/Ypres markers |
| 1916 | Cue | Amber front; selected Verdun/Somme markers |
| Static comparison | Figure only | Independent oblique camera and magenta styling |
| Spring 1918 | Cue and figure | Rose front plus a faint dashed 1914 reference |
| Armistice | Cue | Green closing view |

Present, Previous/Next, and the Reader timeline step through the four driving
blocks, scrolling to their position in the article. Follow text is optional and
changes state only when a driving block crosses the reading line. The comparison
figure must not move the main map or change later cues. Figures are live map
canvases, with no generated image or upload requirement.

## Author another Story manually

1. Create a Story and add real Map or feature mentions to its prose. Those
   semantic references authorize which source features its presentation can use.
2. In **Opening view**, add layer instances from those references. Choose feature
   subsets, opening visibility, opacity, styles, and an initial camera. Keep layer
   IDs stable when changing the article.
3. Insert a Story view at the desired position in the prose. Set its title,
   caption, and display mode. **Camera and layers** exposes camera values and
   per-layer changes; **Capture current map** captures the current camera and
   available authored layer changes.
4. Leave controls on **Inherit** when no change is intended. A driving view
   accumulates changes from preceding driving views. A figure inherits that
   state but keeps its own changes local. View blocks do not change sources or
   feature selections; configure those in Opening view.
5. Use the block's up/down controls to move it with respect to surrounding prose.
   Preview figures or apply driving views, then use the existing save/publish
   workflow. The body stores physical `earthly-view` JSON fences.

Figures and Apply view work before publication. Discard clears the applied draft
preview as well as its local content; saving and leaving the editor retains the
draft without giving it control of another Map or Atlas.

## Ask the Story Thread

For example, while working on a Story with these Maps available:

> Read the five WW1 demo Maps and create a synthetic Western Front Story. Add
> semantic references to the source Maps and selected battles. Define opening
> layers with stable IDs, then insert four chronological Story views for 1914,
> 1916, spring 1918, and the armistice. Vary the camera, visibility, opacity, and
> colors. Include one independent comparison figure between the second and third
> cues. Label the article and geometry as synthetic. Save a draft; do not publish.

The existing `write_story_draft` tool accepts `presentation` and `markdown`
together. `read_story_draft` and `read_entity` expose opening presentation and
view diagnostics. The tool validates the shared codecs and body authorization;
views cannot retarget foreign sources or expand feature selectors. Existing
draft-target and write-approval gates still apply. No protocol/event-kind change
or automatic publication is involved.

## Seed and iterate safely

```sh
bun run seed:ww1 --dry-run --format=json
bun run seed:ww1 --app-url http://localhost:3001
```

The seeder accepts only a loopback relay on port 3334. It adds exactly five Maps
and one Story, skips identical content, and refuses differing existing demo
addresses before writing anything. It never resets the relay, deletes events,
updates profiles, or sends data to public relays. Do not use `bun dev` merely to
refresh this fixture: that command's broader seeding workflow is unnecessary.

Edit `scripts/fixtures/ww1-story.ts` to change the synthetic content/geometry or
view settings. Updating already-seeded fixture content requires the explicit
`--update-existing` flag, which replaces only those six demo addresses. Do not use
that flag if you want to preserve manual edits to the seeded Story or Maps.

The Reader layout is in `src/pages/read/reader.css`, shared inline blocks in
`src/components/editor/RichContentRenderer.tsx`, and authoring controls in
`src/components/editor/StoryViewBlockEditor.tsx`.
