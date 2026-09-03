# A Map with a Margin — clickable sketch

The reference prototype for [`../MAP-WITH-A-MARGIN-SPEC.md`](../MAP-WITH-A-MARGIN-SPEC.md),
the build contract. Background: [`../FROM-SCRATCH-UX-AUDIT-2026-09.md`](../FROM-SCRATCH-UX-AUDIT-2026-09.md)
(designed version: [`../a-map-with-a-margin.html`](../a-map-with-a-margin.html)).
Where the spec is silent, this sketch decides.

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
- **Toolbar**: exists only while a Map is in Edit. One catalogue drives the
  desktop pill, its menus, the overflow and the phone dock: Draw (point, line,
  area, label, arrow, shapes) · Select · Change · History · Geometry (combine,
  reshape, derive) · Snap · File (import, OSM, table, export, save region) ·
  More (measure, callouts, lookup, settings, styling, properties, shortcuts).
  Actions that cannot run say why. Groups collapse into ⋯ as the canvas narrows;
  only the four draw primitives are wired, the rest are there to show the shape.
- **Shelf**: chips for what is drawn, eye toggle, remove, pencil for the map in
  Edit, one **Live** chip for sightings and live positions, *Save this view*.
- **Atlas lens**: on an Atlas page press *Enter atlas* (or open `#/in/skate-spots`).
  A lens bar names the atlas; Browse tabs become *Spots · Stories · People*, search
  is scoped, the Shelf loads the atlas, the + button and *New spot map* pre-fill
  Belongs to, maps get a Properties form from the atlas schema, and the accent
  colour follows the atlas. *Leave ×* undoes all of it; drafts keep their belonging.
- **Circles and Nearby** under Me: pages with members / peers, what is shared
  there, join approval, invites, a circle Chat. Private records carry 🔒 / ⇄.
- **Live**: Me → Share live location (or the phone +) shows a red live bar with
  discovery, share link and Stop; `/live/:id` pages with Follow; stale beacons.
- **Story editing**: paragraphs and headings edited in place; ⌖ reference picks
  a feature from the map; a layer strip under each paragraph shows/hides each
  map from that paragraph on (◉ ○ ◌ inherit) and captures a camera; changes
  accumulate down the page. Reading, the map follows the paragraph in view
  (◎ Follow text) or a click; ▶ Present steps scenes. See “Four Years on the
  Western Front” for snapshot datasets per phase. A Map presentation box sets
  the opening view and layer order.
  Atlases get a Default view. Save this view stores one too (MapPresentationV1).
- **Inbox** in the top bar and under Me: proposals, replies, mentions, atlas
  arrivals, join requests, follows; tapping opens the right tab.
- **Glass panels**: the ◐ button in any margin header, or Me → Panels. Default on
  for phones. Menus, the sheet, the margin and the top bar let the map through.
- **Drafts** and **Me** menus (theme toggle lives under Me).
- **Phone** (≤ 760px): four-item bar Map · Search · + · Me, bottom sheet with
  peek / half / full detents (drag or tap the handle), the **+** chooser.
- **Dismissing the sheet** on a phone: the × in any sheet header, the *Just map*
  tab (the Map tab while a sheet is open), or dragging the sheet down past its
  peek. All three close the sheet and clear the focus; the map's chip stays on
  the Shelf. Search or any tap on a chip brings a sheet back.
- **Phone editing** is its own composition, not the desktop squeezed: the nav
  bar swaps for an **edit dock** at the thumb (Point · Line · Area · Label |
  Undo · More · Ask · Done), the sheet collapses to a one-line peek with
  Publish, search and Shelf give way to a status line with the current hint and
  an Exit button, and selecting a feature raises a strip with Move · Rename ·
  Delete. While drawing, the dock becomes Finish · Undo point · Cancel. Done and
  Exit both keep the draft, so you can never be locked in.

Everything is local state; reload to reset.
