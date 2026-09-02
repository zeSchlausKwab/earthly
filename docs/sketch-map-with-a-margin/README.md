# A Map with a Margin — clickable sketch

A throwaway, dependency-free prototype of the UI proposed in
[`../FROM-SCRATCH-UX-AUDIT-2026-09.md`](../FROM-SCRATCH-UX-AUDIT-2026-09.md)
(designed version: [`../a-map-with-a-margin.html`](../a-map-with-a-margin.html)).

It is not wired to Nostr or the app. The basemap is OpenFreeMap (Liberty style)
via MapLibre GL loaded from unpkg; when the script or tiles are unavailable (the
artifact sandbox blocks tile fetches) it falls back to an SVG graticule. Objects
are modelled on what is actually published on earthly.city, at real coordinates. Its job is to let you click through the modes and menus and feel
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

- **Browse** (landing, the Browse button, or the Search tab on a phone): list
  views for Maps, Stories, Atlases, Sightings and People with a filter box,
  sort, show-on-map and edit affordances per row. Lists, not tiles.
- **Search** (top bar): maps, stories, atlases, people, places. A question
  (ends with `?` or starts with how/what/where…) offers **Ask Earthly**, which
  opens as its own read-only surface in the Margin with one write affordance:
  *Start a map from this*. That creates a Map in Edit and moves the
  conversation into the Map's Thread.
- **Margin**: one object at a time. Open a Map, Story, Atlas, Sighting or
  Person; back is browser back. **Details / Thread** tabs.
- **Edit / Fork**, **Publish update ▾** (audience: Everyone · Circle · Nearby;
  *Publish as new map*), **Done**. Exactly one object is in Edit at a time;
  starting a second asks *Finish with X first?*
- **Social row** under every object title: react, zap, comments, favourite,
  share, more. List rows show counts and reveal ♡ 💬 ☆ on hover, with a ⋯ menu.
- A single **+** at the end of the Browse tabs creates whatever the active tab
  shows (map, story, atlas, sighting); inside a lens it reads *New spot map*.
- **Comments tab** on Maps, Stories, Atlases and Sightings: NIP-22 threads,
  replies, likes, sort; *Attach a place ▾* drops a pin or draws a line that
  travels with the comment and shows in green on the canvas.
- **Propose changes** on anything you don't own: edit in a *proposing* state
  (their map grey, your changes as ghosts), *Send proposal* with a message; the
  author gets a Proposals section with Preview, Accept & publish, Decline.
  The Hippie Trail ships with one incoming proposal so you can play the author.
- **Belongs to** on a Map: fit-state chips per Atlas, *Add to atlas…* picker.
- **Atlas page**: door policy as a sentence, Pinned / Added by others /
  Waiting (owner), *Add a map ▾*, *Show all on map*, accept-by-pin.
- **Thread** on a Map, Story or Atlas. On screens 1100px and wider it sits as a
  right-hand column beside the canvas (Details stay in the left Margin), 28vw
  each side with the map between; alone, the Margin is 30vw. Below that it is a tab of the Margin; on a phone it is a tab of the sheet. Canned prompts, selection scope chip,
  reference chips, *Edit & send* / *Fork & send*, safety level, Details drawer.
  Proposals appear as amber ghosts on the canvas (maps) or amber paragraphs /
  pins in the margin (stories, atlases) with Apply · Discard · Review.
- **Canvas**: pan, zoom, hover a feature to light up its Shelf chip, click a
  feature for a popup, diff bar for pending proposals.
- **Toolbar**: exists only while a Map is in Edit. Desktop: a pill at the top
  centre of the canvas, icon + label from 1180px, icons only below. Phone: a
  scrollable strip pinned above the sheet. It slides away when you press Done
  or open something else.
- **Shelf**: chips for what is drawn, eye toggle, remove, pencil for the map in
  Edit, one **Live** chip for sightings and live positions, *Save this view*.
- **Atlas lens**: on an Atlas page press *Enter atlas* (or open `#/in/skate-spots`).
  A lens bar names the atlas; Browse tabs become *Spots · Stories · People*, search
  is scoped, the Shelf loads the atlas, the + button and *New spot map* pre-fill
  Belongs to, maps get a Properties form from the atlas schema, and the accent
  colour follows the atlas. *Leave ×* undoes all of it; drafts keep their belonging.
- **Glass panels**: the ◐ button in any margin header, or Me → Panels. Default on
  for phones. Menus, the sheet, the margin and the top bar let the map through.
- **Drafts** and **Me** menus (theme toggle lives under Me).
- **Phone** (≤ 760px): four-item bar Map · Search · + · Me, bottom sheet with
  peek / half / full detents (drag or tap the handle), the **+** chooser.

Everything is local state; reload to reset.
