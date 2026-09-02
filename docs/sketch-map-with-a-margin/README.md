# A Map with a Margin — clickable sketch

A throwaway, dependency-free prototype of the UI proposed in
[`../FROM-SCRATCH-UX-AUDIT-2026-09.md`](../FROM-SCRATCH-UX-AUDIT-2026-09.md)
(designed version: [`../a-map-with-a-margin.html`](../a-map-with-a-margin.html)).

It is not wired to Nostr, MapLibre, or the app. The "world" is an abstract SVG
you can pan and zoom; the objects are modelled on what is actually published on
earthly.city. Its job is to let you click through the modes and menus and feel
the transitions before anything is built for real.

## Run

```bash
bun docs/sketch-map-with-a-margin/serve.ts        # http://localhost:4177
```

Or open `index.html` directly. To produce one self-contained file:

```bash
bun docs/sketch-map-with-a-margin/bundle.ts        # -> dist/sketch.html
```

## What is clickable

- **Search** (top, or the Search tab on a phone): maps, stories, atlases, people,
  places. End a query with `?` to get the read-only **Ask** concierge and its
  single write affordance, *Start a map from this*.
- **Margin**: one object at a time. Open a Map, Story, Atlas, Sighting or
  Person; back is browser back. **Details / Thread** tabs.
- **Edit / Fork**, **Publish update ▾** (audience: Everyone · Circle · Nearby;
  *Publish as new map*), **Done**. Exactly one object is in Edit at a time;
  starting a second asks *Finish with X first?*
- **Belongs to** on a Map: fit-state chips per Atlas, *Add to atlas…* picker.
- **Atlas page**: door policy as a sentence, Pinned / Added by others /
  Waiting (owner), *Add a map ▾*, *Show all on map*, accept-by-pin.
- **Thread** on a Map, Story or Atlas: canned prompts, selection scope chip,
  reference chips, *Edit & send* / *Fork & send*, safety level, Details drawer.
  Proposals appear as amber ghosts on the canvas (maps) or amber paragraphs /
  pins in the margin (stories, atlases) with Apply · Discard · Review.
- **Canvas**: pan, zoom, hover a feature to light up its Shelf chip, click a
  feature for a popup, tool pill while editing (point / line / polygon / label,
  undo / redo, more…), diff bar for pending proposals.
- **Shelf**: chips for what is drawn, eye toggle, remove, pencil for the map in
  Edit, one **Live** chip for sightings and live positions, *Save this view*.
- **Drafts** and **Me** menus (theme toggle lives under Me).
- **Phone** (≤ 760px): four-item bar Map · Search · + · Me, bottom sheet with
  peek / half / full detents (drag or tap the handle), the **+** chooser.

Everything is local state; reload to reset.
