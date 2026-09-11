# GeoLibre integration notes

> Decision note for the current Map-with-a-Margin rewrite. The implementation contract remains
> [`MAP-WITH-A-MARGIN-SPEC.md`](MAP-WITH-A-MARGIN-SPEC.md); where earlier exploration below is
> superseded, this note says so explicitly.
>
> GeoLibre snapshot reviewed: [`fcc274e`](https://github.com/opengeos/GeoLibre/tree/fcc274e8646824a06e98639d0bf36ace71c27dd3) (2026-08-08).

## Locked rewrite boundary (2026-09-03)

The UI and routing migration is one release-level cutover. Work may be ordered behind temporary
local adapters, but no partial rollout, feature flag, or intentionally mixed old/new experience is
part of the design; those adapters are removed before acceptance.

- No Nostr protocol, event-kind, tag, or comment migration is part of this rewrite. Comments stay on
  Earthly's existing kind 37517. Parameterized replaceable events above kind 30000 get no Versions
  UI or new history/version scheme.
- `MapPresentationV1` is the only serialized-data addition. Its `version: 1` is an embedded JSON
  parser/writer discriminator, not a protocol or event version.
- The client uses a code-based TanStack Router without TanStack Start, SSR, or file-route codegen.
  TanStack owns in-app path/search/history state; Bun continues to own HTTP/API/static serving and OG
  metadata. `/story/:id` stays in the application Margin, while `/read/:id` is the canonical shared
  editorial/OG route. Existing aliases and comment deep links remain valid.
- The sketch's emoji, Unicode glyphs, and ASCII labels are illustrative. Implementation reuses the
  existing Earthly icons and desktop toolbar components.
- Performance benchmarking is deferred until the rewritten shell and rendering path are in place.

## Current recommendation: do not introduce a standalone presentation entity

A presentation/project does not need another event kind or first-class entity. The useful
cartographic state belongs to entities that already provide its meaning and reference boundary:

| Carrier | What it owns | Which geometry may be presented |
| --- | --- | --- |
| Story/Article | An authored narrative and, optionally, its cartographic direction | Only Maps referenced by the story |
| Atlas (Group/Context, kind 37518) | A curated subject and, optionally, its canonical default view | Only the owner's canonical `a` attachments |
| Map (kind 37515) | Geometry and intrinsic feature properties | Its own data; no composition or narrative state |

This preserves the existing distinctions:

- A Story remains a narrative. Presentation metadata can make it a story map, but is not required.
- An Atlas remains a collaborative subject. Its presentation describes only the curated lane;
  foreign `c` contributions stay discoverable without silently entering the canonical map.
- A Map remains reusable geographic data rather than absorbing the preferences of every consumer.

No new event kind, catalog item, navigation concept, or “presentation versus Story versus Atlas”
choice is justified by the current workflows.

A standalone presentation entity should be reconsidered only when users need to publish, fork,
discuss, or embed a cartographic composition **without** either a narrative or a collaborative
subject. That would be a genuinely independent lifecycle, not merely a bag of display settings.

### Shared embedded presentation value

Stories and Atlases use one small embedded value instead of independently inventing camera and layer
fields. The locked shape is:

```ts
type NostrCoordinate = `${number}:${string}:${string}`
type PresentationLayerId = string

interface MapCameraV1 {
  center: [longitude: number, latitude: number]
  zoom: number
  bearing?: number
  pitch?: number
}

interface PresentationStyleOverrideV1 {
  color?: string
  fillColor?: string
  strokeColor?: string
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
  radius?: number
  lineDash?: 'solid' | 'dashed' | 'dotted'
  arrowStart?: boolean
  arrowEnd?: boolean
  displayIcon?: string
}

interface PresentationLayerV1 {
  id: PresentationLayerId
  source: NostrCoordinate
  featureIds?: string[]
  visible?: boolean
  opacityMultiplier?: number
  style?: PresentationStyleOverrideV1
}

interface MapPresentationV1 {
  version: 1
  initialView?: MapCameraV1
  layers?: PresentationLayerV1[]
}
```

An ordered array of layer instances is intentional: the same foreign Map may appear more than once
with different feature selectors or styles. Order is bottom-to-top and each `id` is stable and unique
inside its Story or Atlas. `source` is an exact kind-37515 coordinate and resolves the latest
replaceable event; event-id pinning is not supported. Missing `featureIds` selects the whole Map.

Important invariants:

- Story presentation sources must be authorized by Story-body references. A whole-Map mention may
  select any subset; feature-only mentions authorize only their cited ids. A missing feature remains
  visibly unresolved and never widens to the whole Map.
- Atlas presentation sources must be a subset of the owner's accepted/curated `a` attachments.
  Foreign `c` contributions never enter the canonical presentation automatically.
- Missing presentation metadata means normal current behavior. An unknown schema version is
  preserved through unrelated edits rather than destructively rewritten.
- Camera state is published intent, not transient editor state. Do not persist every pan or zoom.
- Clients that do not understand this optional value can ignore it without losing the underlying
  Story, Atlas, or Map.

There is no independently serialized legend in V1. A future legend should be derived from effective
styles. Stories also do not extend this object with scenes; their sequence lives in inline body view
blocks described below.

## Opacity: a composition multiplier, not a source edit

Earthly already has canonical `fillOpacity` and `strokeOpacity` feature properties. Those answer:
**how translucent is this feature's fill or stroke?** They travel with the Map and reflect its
author's styling.

A presentation-level opacity answers a different question: **how strongly should this Map layer
participate in this particular composition?** It is named `opacityMultiplier`, with effective opacity
approximately:

```text
feature fill/stroke opacity × presentation opacity multiplier
```

The rewrite has concrete uses for this distinction: fading a foreign reference layer, comparing
layers, and changing emphasis between inline Story views. `opacityMultiplier` therefore ships in
`MapPresentationV1`. It defaults to `1`, is clamped to `[0, 1]`, and never rewrites the referenced
Map's feature properties.

The existing generic layer opacity used by basemaps/PMTiles is not this contract. Remote Nostr Maps
must retain source/layer-instance provenance in the renderer so the multiplier can be applied to the
intended presentation layer only.

## Styling another person's Map

A composer applying presentation overrides is not editing or republishing the source Map. It is
closer to quoting data inside an authored cartographic argument. That can be legitimate, but the UI
must not imply that the source author chose the resulting appearance or emphasis.

Guardrails for overrides:

- Keep the original event immutable; store overrides only on the containing Story or Atlas.
- Attribute both roles, for example “Data by Alice · presentation by Bob.”
- Provide “use author styling” or “reset presentation” where an override exists.
- Distinguish styling from filtering. Hiding features changes the apparent claim and deserves stronger disclosure than changing a color.
- Use a bounded declarative style schema: no executable JavaScript/CSS, arbitrary network requests, or unsafe asset references.
- References always follow the latest replaceable Map event. Detect selectors or overrides that no
  longer resolve and show them as unresolved; do not substitute broader data.
- Default to inherited Map styling. Composer overrides should be explicit, visible choices.

Stories are the least ambiguous place for overrides: the result is clearly the story author's
presentation. An Atlas default view is also valid for its canonical attachments, but should remain
visibly distinct from each Map author's own styling.

The style patch is deliberately bounded to Earthly's current presentation vocabulary (`color`,
`fillColor`, `strokeColor`, `fillOpacity`, `strokeOpacity`, `strokeWidth`, `radius`, `lineDash`,
`arrowStart`, `arrowEnd`, and allowlisted `displayIcon`). Names, descriptions, labels, executable
code/CSS, arbitrary asset URLs, and arbitrary MapLibre expressions are not style overrides.

## Ambient route layers

The public `on=a,b,c` query remains route-local Shelf state and is never silently written into a
Story or Atlas. If `on=` names a source already present in a Story, it acts as a temporary visibility
override. Otherwise it creates a temporary whole-Map layer using the source author's style. Inline
Story views cannot mutate these ambient layers. “Add to Story” is the explicit persistence boundary:
it first adds an authoritative body reference, then a presentation layer.

## GeoLibre ideas worth stealing

“Steal” here means adapt the product and module ideas, not transplant GeoLibre's application architecture.

### 1. Data-driven symbology and automatic legends — high value

GeoLibre has pure, testable classification and color-ramp machinery: categorized styles, equal intervals, quantiles, and Jenks/natural breaks. Earthly can expose a compact version in the existing style editor and derive a legend from the same normalized style specification.

Useful donors:

- [`packages/core/src/color-ramp.ts`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/packages/core/src/color-ramp.ts)
- [`vector-style-classification.ts`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/apps/geolibre-desktop/src/lib/vector-style-classification.ts)

Earthly adaptation:

- Keep classification algorithms as pure utilities with deterministic tests.
- Normalize output into Earthly's existing feature-style vocabulary.
- Generate the legend from the effective style instead of maintaining unrelated manual legend state.
- Let presentation overrides reuse this vocabulary without mutating source features.

### 2. Inline Story views and layer choreography — high value

GeoLibre's story-map model demonstrates camera changes, layer enter/exit behavior, and scroll-driven
progression. Earthly adopts the useful behavior without adopting a scene array or anchor model.

Useful donor:

- [`docs/user-guide/storymaps.md`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/docs/user-guide/storymaps.md)

Earthly adaptation:

- Put the opening camera and layers in the Story's embedded `MapPresentationV1`.
- Put each later camera/presentation change in a physical `StoryViewBlockV1` in the Markdown body. A
  view moves with the prose, so there are no scenes, numeric anchors, or orphaned indexes.
- Represent views as cumulative sparse deltas keyed by stable presentation-layer id. A view may
  change camera, visibility, opacity, or style, but cannot retarget a source or `featureIds`.
- Render `figure` views live inside Earthly; do not upload static Blossom snapshots or encode view
  state into ordinary Markdown link queries for hypothetical cross-client behavior.
- Start with explicit click/step navigation and the reader's follow mode; only add more elaborate
  scroll choreography after its authoring and accessibility behavior is proven.

```ts
interface StoryViewBlockV1 {
  version: 1
  type: 'view'
  id: string
  title: string
  caption?: string
  display: 'cue' | 'figure' | 'both'
  camera?: MapCameraV1
  layers?: Record<PresentationLayerId, {
    visible?: boolean
    opacityMultiplier?: number
    style?: PresentationStyleOverrideV1
  }>
}
```

### 3. One action registry for menus, shortcuts, and command palette — high value, low risk

GeoLibre treats commands as registered actions rather than wiring each entry point independently. Earthly already has geo-editor commands and a command UI; unify them so availability, labels, keyboard shortcuts, and execution live in one place.

Useful donor:

- [`apps/geolibre-desktop/src/lib/commands.ts`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/apps/geolibre-desktop/src/lib/commands.ts)

Earthly adaptation:

- Keep actions behind the existing Authoring facade.
- Make toolbar buttons, context menus, shortcuts, and the palette invoke the same command definitions.
- Include disabled-state reasons so unavailable actions explain themselves.

### 4. Attribute workbench patterns — medium/high value

The useful parts are map-linked row selection, sortable/filterable columns, virtualization, field statistics, and safe column operations. The donor component itself is a large monolith and should not be copied wholesale.

Useful donor:

- [`AttributeTable.tsx`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/apps/geolibre-desktop/src/components/panels/AttributeTable.tsx)

Earthly adaptation:

- Extract pure statistics and column-operation functions.
- Keep selection synchronized with the map without making the table the source of truth.
- Route edits through the Authoring facade so undo/redo, validation, and future collaboration semantics remain consistent.
- Build focused components rather than reproducing the donor's all-in-one panel.

### 5. Processing operation registry — medium value

GeoLibre exposes many spatial operations through a common catalog. Earthly does not need the breadth, but a small registry of deterministic operations would let the visible Analysis UI and AI tools call the exact same reviewed capabilities.

Start with operations that produce understandable GeoJSON and have stable browser implementations, such as buffer, dissolve, simplify, centroid, bbox/clip, and basic spatial predicates. Each operation should declare input geometry constraints, parameters, provenance, output behavior, and cancellation/progress support.

This registry should produce ordinary Earthly edits or derived Maps through the Authoring boundary;
it should not become an unrestricted plugin runtime.

### 6. Broader import, selectively — medium value

GeoLibre shows the value of treating format loading as a capability rather than binding it to one dialog. Earthly should reuse its existing CSV/XLSX path and consider GPX and KML next. GeoParquet, GeoPackage, and reprojection may later justify a lazy DuckDB-WASM worker.

Do not import GeoLibre's entire loader or make a heavy analytical runtime part of the initial application bundle. Each format should earn its complexity through an actual Earthly workflow, especially on mobile and offline targets.

### 7. Embedded-value normalization ideas — conceptual value

GeoLibre's project format is useful as a model for strict parsing, normalization, deterministic
writing, and stripping transient state from an embedded application value. This does not justify an
Earthly event-version protocol or migration framework.

Useful donor:

- [`docs/project-format.md`](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/docs/project-format.md)

Earthly adaptation:

- Apply those techniques to the `MapPresentationV1` codec and local drafts.
- Keep Nostr events and coordinates canonical.
- Never make `.geolibre.json` or an Earthly equivalent the canonical collaborative object.

## Do not steal, at least for now

- GeoLibre's global store and map-controller architecture; it would compete with Earthly's existing editor and Nostr boundaries.
- Its collaboration model; Earthly already has Nostr events, MLS/private collaboration, and field-session concerns.
- External executable/plugin loading across the signer boundary.
- The full desktop GIS surface: SQL workspace, Cesium/3D, LiDAR, raster cubes, or a giant processing catalog.
- The monolithic attribute-table component.
- A standalone project file or presentation entity as the canonical unit of sharing.

## Suggested sequence

1. Implement and test the pure `MapPresentationV1` parser, normalizer, writer, and effective-view reducer.
2. Add Story opening camera and ordered layer instances, including selective foreign-Map features,
   author-style fallback, bounded overrides, opacity, and unresolved-reference behavior.
3. Add inline Story view blocks and the `/read/:id` reader using the same live canvas.
4. Add Atlas canonical presentation while explicitly excluding the contribution lane.
5. Add deterministic classification plus a derived legend in the existing style editor.
6. Independently unify editor actions behind a command registry and incrementally improve the
   attribute workbench/import formats.

## Licensing and provenance

GeoLibre is MIT-licensed. If source code is adapted rather than independently reimplemented, retain the required copyright/license notice and record the donor commit and source file in Earthly's provenance or third-party notices.

Useful references:

- [GeoLibre README](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/README.md)
- [GeoLibre architecture](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/docs/architecture.md)
- [GeoLibre license](https://github.com/opengeos/GeoLibre/blob/fcc274e8646824a06e98639d0bf36ace71c27dd3/LICENSE)
