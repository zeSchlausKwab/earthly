# A Map with a Margin — implementation spec

Status: **build contract**, 2026-09-03. Supersedes the discussion in
[`FROM-SCRATCH-UX-AUDIT-2026-09.md`](FROM-SCRATCH-UX-AUDIT-2026-09.md) wherever the two differ.
The reference behaviour is the clickable sketch in
[`sketch-map-with-a-margin/`](sketch-map-with-a-margin/README.md); when this document is silent,
the sketch decides. Protocol changes are in §16; everything else is UI and application state.

Everything here is on branch `sketch/map-with-a-margin`. Nothing in `src/` has been changed yet.

---

## 1. Vocabulary (final)

User-facing nouns. Anything not listed is internal and must not appear in UI copy.

| Noun | Kind | Meaning |
| --- | --- | --- |
| **Map** | 37515 | Features someone drew, imported, or generated. Has a title, summary, topics, belonging, one Thread. |
| **Story** | 37520 | Prose that references maps and features. |
| **Atlas** | 37518 | A place maps belong to. Owner pins (`a` lane); others attach (`c` lane) behind a door policy. Has a noun, an emblem, a colour, and optionally schema fields. |
| **Sighting** | 37522 | Something seen at a place and time; expires. |
| **Live** | 37521 | An action, "share my live location", not a destination. |
| **Circle** | MLS group | An audience. Offered on Publish ▾ and listed under Me; has a page (§11a) but never appears in Browse or the top-level navigation. |
| **Nearby** | field session | An audience, same rule as Circle. |

Surfaces: **Canvas**, **Margin** (one object at a time), **Thread** (the conversation of the object in the Margin), **Shelf** (what is drawn), **Lens bar** (you are inside an Atlas).

Verbs: **Open** (read), **Edit** (your working copy; only for things you own), **Propose** (a working copy of something you don't own, sent to its author), **Fork** (your own copy at a new address).

States of a thing you are authoring: **draft** (unpublished, never published), **editing**, **proposing to X**, **published vN · date**.

Words that must not appear in UI: workspace, context, stance, destination, unattached, inspector, map stack, edit state, conversation (use Thread).

## 2. Routes

Hash routes in the sketch; path routes in the app. Both carry the same grammar.

| Route | Margin shows | Notes |
| --- | --- | --- |
| `/` | Browse (phone: nothing, bare map) | |
| `/browse/:kind` | Browse tab `maps` `stories` `atlases` `sightings` `people` | |
| `/map/:id` `/story/:id` `/atlas/:id` `/sighting/:id` `/person/:id` | The object, read-only | `:id` is the naddr / npub the app already uses |
| `/map/:id/edit` `/story/:id/edit` `/atlas/:id/edit` | The object in Edit (owner) or Propose (non-owner) | Entering `/edit` on a non-owned thing means Propose, never Fork |
| `/ask` | Ask Earthly (read-only concierge) | |
| `/shelf` | What is on the map | |
| `/in/:atlas` | Enters the Atlas lens, then redirects to `/browse/maps?in=:atlas` | The shareable "mini-app" link |
| `/circle/:id` `/nearby/:id` | The audience's page (§11a); its shared maps join the Shelf | Reachable from Me, Publish ▾ pills, and lock badges |
| `/live/:id` | One beacon (§11b); Live chip on, camera on it | From the live bar, a live dot, or a share link |
| `/inbox` | Notifications (§11d) | Badge in the top bar and under Me |
| `/me/circles` `/me/nearby` | Lists under Me | |

Query: `on=a,b,c` visible Shelf maps · `live=1` Live chip on · `in=:atlas` active lens. All three survive navigation; `replaceState` when they change without a route change.

Opening a Map adds it to the Shelf and frames it. Opening a Story adds its maps and frames them. Opening an Atlas does not touch the Shelf (Show all on map does). Opening a Sighting turns the Live chip on and frames it. Back is browser back.

## 3. Layout tokens

| Token | Value |
| --- | --- |
| Margin width, Thread docked | `30vw` |
| Margin and Thread column, Thread pulled out | `28vw` each, map between; only at `≥ 1100px` |
| Phone breakpoint | `≤ 760px` |
| Top bar / Lens bar / Shelf strip | 46 / 38 / 42 px |
| Top bar first column | `var(--margin-w)`, so the search field's left edge meets the Margin's right edge |
| Corners | none (0) everywhere |
| Type | Display: Bricolage Grotesque 800. UI: IBM Plex Sans. Mono: IBM Plex Mono for kinds, counts, dates, coordinates. Prose (Story body): Source Serif 4. |
| Palette | Light ground `#EDF0EA`, surface `#F7F8F5`, ink `#172019`, accent `#1F5F8B`; dark ground `#0E1412`, surface `#161D1A`, ink `#E5ECE6`, accent `#74B3E0`. A lens overrides `--accent` with the atlas colour. |

Geometry states on the canvas (the one rule the audit set):

| State | Style |
| --- | --- |
| published | grey `--published`, solid |
| working (your copy in Edit) | accent, solid, slightly heavier; its Shelf chip wears ✎ |
| proposed (AI or someone's proposal, or your own Propose draft) | amber `--proposed`, dashed lines, hollow points |
| comment annotation | green `--green` |
| selected | amber stroke ring |
| hover | +1.5px line / +2px radius via feature-state |
| removed / modified base | 30% / 25% opacity |

## 4. Surfaces

### 4.1 Top bar (desktop)
Three columns. The first is exactly the width of the Margin (`30vw`, or `28vw` when the Thread is pulled out) and holds the brand and the **activity ticker**; a hairline closes it. The search field begins at that seam, so its left edge always meets the Margin's right edge. The third column holds Browse · Drafts (badge = working copies) · Inbox (badge = unread) · Me · ?.

**Activity ticker.** A recessed strip inset in the first column, on the ground colour with a hairline, so it reads as its own instrument rather than as loose text beside the logo. One line of the newest eight things anyone did, cycling every 4.2 seconds with a short slide and a brief accent tint as the new line arrives: a pulse dot, a kind glyph, `Aria Voss · commented on · The Hippie Trail · 1d`, and position dots. Live beacons sort first and read "now". Hovering pauses it, a hidden tab pauses it, and clicking opens the thing (comments open on the Comments tab). It only rebuilds when its item changes, so ordinary re-renders never restart the animation. Below 1100px the verb and dots drop; below 900px the name drops. It is desktop only; the phone shows the map instead.
Search results group Maps / Stories / Atlases / People / Places; a question (ends with `?` or starts how/what/where/which/why/who/when) shows one row "Ask Earthly: …" that opens `/ask`. Enter on a question does the same. In a lens the placeholder reads "Search spots in Global skate spots… or ask" and results are scoped to the atlas.

### 4.2 Lens bar
Only when `in=` is set. Emblem, atlas title, `N spots · door policy · by author`, the rule sentence "Lists show only this atlas. New spots belong here.", About, Share app link, **Leave ×**. Phone: a 34px bar under the search field with emblem, title, Leave.

### 4.3 Margin
One object. Header grammar shared by every panel (§6). Tabs: **Details · Comments (N) · Thread**. When the Thread is pulled out to the right column the tabs are Details · Comments with the hint "Thread is on the right". Glass toggle ◐ in every header; phone adds × (§13).

### 4.4 Thread column
At `≥ 1100px` the Thread is a right-hand column by default (`threadSide=true`); **Dock** returns it to a tab; **Pull out** from the tab does the reverse. Below 1100px it is always a tab.

### 4.5 Canvas overlays
Tool pill (§4.5a), zoom column (top right), diff bar (bottom centre, only while a proposal is pending), feature popup, status line (zoom · lat, lon · n on the map · live · no basemap), Shelf strip (bottom).

### 4.5a The tool pill
Present only while a Map is in Edit or Propose. It opens with the map's name (`✎ Hippie Trail`, or `✎ proposing`) and then one group per job, separated by hairlines. One catalogue defines the groups; the pill, its menus, the overflow menu and the phone dock all render from it, so no surface can drift.

| Group | Contents |
| --- | --- |
| Draw | Point · Line · Area · Label · Arrow · **Shape ▾** (circle, square, rectangle, triangle, diamond) |
| Select | Select · Box select · Edit vertices · Edit in isolation |
| Change | Duplicate · Delete |
| History | Undo · Redo |
| **Geometry ▾** | *Combine:* boolean union, boolean difference, connect lines, dissolve lines, merge to multi-part, explode multi-part. *Reshape:* simplify…, split by drawn line, offset area…, parallel line…, line corridor…. *Derive:* area from drawn line, line at placed point, line by drawn line |
| Snap | Snapping toggle |
| **File ▾** | *Bring in:* GeoJSON / Shapefile, OpenStreetMap query, paste GeoJSON, table (CSV / Excel). *Take out:* GeoJSON, Shapefile, save this region offline |
| **More ▾** | *On the map:* measure, map callouts, look up a place by click. *This map:* map settings, style by attribute, feature properties. *Help:* keyboard shortcuts |

**Availability explains itself.** An action that cannot run is dimmed and states why in its own row: "Select two or more areas", "Select one multi-part feature", "Nothing to undo". This replaces silent disabling and is the same rule the command registry will use when the toolbar becomes real.

**Responsive.** The pill sizes itself from the canvas width, which is the viewport minus the open margins, not the window: at ≥ 940px all groups with labels on the draw tools; at ≥ 660px draw, history, Geometry and More, with the rest in an overflow **⋯** that lists them under their group names; below that draw and history only. The pill never grows past the canvas and scrolls horizontally as a last resort. On a phone the pill is replaced by the edit dock (§13), whose **More** menu carries the same catalogue.

**Dialogs** for parameterised operations (simplify, offset, parallel, corridor) share one shape: the selection summary, the parameter with its units, `Result: replace selected feature / create derived copy`, and a before-and-after size estimate.

### 4.6 Shelf
Chip per visible Map: swatch, ✎ when in Edit, title, ◉/○ visibility, ×. A pulsing chip means an AI run is working on that map. One **Live · N** chip for sightings and live positions. **Save this view** turns the Shelf into a personal Atlas (door policy Only me). Hovering a feature lights its chip; hovering a list row lights the chip and the layer.

## 5. Browse

Header (one row): eyebrow *Browse* or emblem + atlas title · filter chip `in …` · **On the map · N** · ◐ · (phone ×).
Tabs with counts: Maps · Stories · Atlases · Sightings · People. In a lens: *Spots · Stories · People* using the atlas noun. One **+** at the right end of the tabs creates whatever the active tab shows; hidden on People; label from 1180px; reads "New spot map" in a lens.
Tools row: filter box, sort Newest / Title / Author. Column-hint line.

Row anatomy: thumbnail 40×28 (SVG of the features), title, meta line `author · date · N features · size · #topic #topic`, counts line `♥ n · 💬 n · ⚡ n · ✎ n proposals` (proposals amber). Right side: primary action (○/◉ show on map, ⌖ frame for stories and atlases), then on hover ♡ 💬 ☆, then ⋯ (Share, Zap, Show on map, Edit | Propose + Fork, Delete | Report). Phone: primary + ⋯ only.

Scope rules: the filter chip (atlas or #topic) and the lens filter lists only. Neither touches the Shelf or publishing.

## 6. Object panels

### 6.1 Header grammar (all kinds)
```
◂ Back   KIND  [state pill]                              ◐  (×)
Title                                  (contenteditable while editing)
avatar Author · meta counts                 [primary actions, small]
♡ n  ⚡ n  💬 n  ☆ n  ↗ Share  [✎ n proposals]              ⋯
```
Four rows, then tabs. State pill: `v3 · 2026-09-01` / `draft · unpublished` / `✎ editing` / `✎ editing · fork` / `✎ proposing to Aria Voss`.

### 6.2 Primary actions matrix

| Kind | Owner, reading | Non-owner, reading | Editing | Proposing |
| --- | --- | --- | --- | --- |
| Map | Edit · Show on map / Remove from map | **Propose changes** ▾(Fork) · Show/Remove | Publish update ▾ · Done | Send proposal to X · Keep for later · Discard |
| Story | Edit | Propose an edit | Publish update ▾ · Done | Send proposal to X · Keep for later |
| Atlas | Edit · Add a map ▾ · Show all on map · Enter atlas | Add a map ▾ · Show all · Enter atlas | Publish update ▾ · Done | — |
| Sighting | — (social row only) | — | — | — |

### 6.3 Details sections, in order
Every section is a box with a header band (mono uppercase title, optional count or hint on the right). The description is an unboxed lead above them.

- **Map**: lead summary · *At a glance* (Features, Size, Version, Audience, Published, Author, Forked from) · *Features* (§6.4) · *Belonging* (Atlases with fit chips; Topics) · *Properties* (only when an atlas schema applies; from which atlas) · *Appears in N* · *Proposals N waiting* (amber band) · quiet trailing row: Discard draft / Delete map.
- **Story**: prose lead with reference chips (⌖ label; hover highlights, click flies) · *Proposals* · *Maps in this story N* (+ Reference a map while editing).
- **Atlas**: lead description · *Who can add maps here* (radio sentences while editing) · *Pinned by me/author N* · *Added by others N* · *Waiting for me N* (owner only, amber, Pin · accept).
- **Sighting**: photo + note lead · *When & where* (Seen, Expires, Position, By).
- **Person**: header + Maps · Stories · Atlases lists.

### 6.4 The Features list

The contents of a Map, in both modes, directly under *At a glance*.

- **Row**: expander, type glyph (● line ╱ area ⬠), name, then `4 points · 2 properties`. Clicking the name **focuses** it when reading (emphasised on the canvas, camera flies to it) and **selects** it when editing (the same selection the canvas and the AI scope use, so the two can never disagree).
- **Row actions**, revealed on hover and always visible on a phone. Reading: ⌖ zoom to · ⧉ copy GeoJSON · 💬 comment on this feature, which attaches its geometry to a comment and opens the Comments tab. Editing: ⌖ zoom to · ✎ rename · ⧉ duplicate · ⌫ delete · ↑ ↓ reorder, with Undo offered in the toast.
- **Expanded** shows the feature's properties as chips, editable in place while editing with **+ property**, and its coordinates (a point's position, or the vertex count and first vertex).
- **Tools**: a filter box over names and property values, and type chips with counts (`All 13 · ● 12 · ╱ 1`). Long lists cap at 12 rows with **Show all N**; the list scrolls within its box.
- **Bulk bar** appears while a selection exists: `2 selected · Zoom to · Duplicate · Delete · ×`. *Select all* sits in the section header.
- Clicking a feature on the canvas scrolls its row into view; hovering a row highlights the geometry.

## 7. Editing model

- **Working copy.** Edit creates or resumes one per object, persisted on device, with `publishChannel`/audience stored on it. Exactly one object is in Edit or Propose at a time. Starting a second asks *Finish with "X" first? Cancel · Discard draft · Keep draft & continue.*
- **Publish ▾**: Publish update (same address, v+1) is the default for anything already published; *Publish as new map* is the secondary item (maps only). Audience radio: Everyone · Circle: … · Nearby: …. Audience is per working copy and never global.
- **Done** keeps the draft and leaves Edit. **Discard** deletes the working copy. **Drafts** (top bar / Me) lists working copies with Resume and Discard; proposal drafts are labelled "proposal to X".
- **Fork** copies to a new address owned by you with `forkOf`; the original's Shelf chip is replaced by the fork.
- Title is edited in place in the header; summary/description in the lead textarea; Belongs to, Topics, Properties in their boxes.

## 8. Proposals (kind 37519)

- **Propose** opens a working copy in *proposing* mode. On the canvas the original stays published-grey; additions and modified features render as proposed ghosts; removed originals fade. Toolbar and Thread work; the Thread's send label is *Propose & send*.
- **Send proposal** replaces Publish: a dialog with the `+a ~m −r` summary and an optional message. Result: a proposal `{target, author, message, add[], modify[{id,name,props,coords}], remove[], body?}` with status `pending`.
- **Author's view**: *Proposals* box on Details with author, date, status pill, message, counts, **Preview on map** (ghosts on their own map), **Accept & publish**, **Decline**, **Discuss** (jumps to Comments). Accept merges by feature id, bumps the version, sets `acceptedAs`, and credits the proposer. Decline leaves the proposer's copy untouched.
- **Proposer's view**: same box with status and **Withdraw** while pending. Browse rows show `✎ n proposals` on owned objects with pending items; the social row shows the same.
- Stories: same flow with `body` instead of features; summary reads "text changes".
- Open: what happens when the target has moved on since the proposal was made (rebase rule). Decide in §18.

## 9. Comments (NIP-22)

- Comments tab on Map, Story, Atlas, Sighting. Header: count, "visible to any Nostr client", sort Newest / Most liked. One level of replies. Each comment: avatar, name, time, optional ⌖ pin/line chip, text, ♡ n · Reply · Delete (own) / Report.
- **Composer** at the bottom (stays put): textarea, **Attach a place ▾** (Drop a pin · Draw a line · Use the selected feature), Post (⌘/Ctrl+Enter). While placing, an amber instruction chip; once attached, a green removable chip.
- Geometry renders green on the canvas while the Comments tab is open; hovering a comment highlights it; ⌖ flies to it. No Edit state is involved; a comment never changes the object.

## 10. Thread contract

- The Thread belongs to the object in the Margin. There is no unbound chat. Header: object title · state (`editing`, `proposing to X`, `read-only`, `read-only · concierge` on atlases you don't own) · safety level ▾ · Details toggle.
- **Send labels**: Send (in Edit/Propose) · Edit & send (owner, read-only) · Propose & send (non-owner) · Ask (atlas you don't own). Binding happens in the send gesture and in no other place.
- **Scope**: writes go to the object in Edit. Selected features show as `N features selected ×`; clearing widens to the whole map. `+ reference` adds read-only Maps/Stories; references never grant edit rights.
- **Proposals from the AI**: maps → ghosts + diff bar (`+a ~m −r · Apply · Discard · Review ▾ · Only changes`); stories → amber paragraph with reference chips and an Apply/Discard bar (visible from both Details and Thread); atlases → pins or description with the same bar.
- **Safety**: Apply automatically (with Undo toast) · Ask before changing (default) · Ask before every change (Review list open by default).
- Transcript shows one collapsed line per operation; the **Details** toggle reveals tool steps and timings. One run at a time; the target's Shelf chip pulses; navigating away never cancels.
- **Ask Earthly** (`/ask`): read-only concierge in the Margin with its own transcript and one write affordance, **Start a map from this**, which creates a Map in Edit and moves the transcript into its Thread.

## 11. Atlases

- Door policy as sentences: *Anyone* · *Anyone, if the map fits the schema* · *Only me*. `schemaFields: [{key,label,options}]` drive: the Properties form on maps, the fit chips, and the Waiting list. Fit chip text: `In X ✓` · `X · doesn't fit: missing "type"` · `X · closed, ask the owner`.
- Adding from either side: on a Map, Belonging → *Add to atlas…* (a Publish update if already published); on an Atlas, *Add a map ▾* → one of my maps / new map in this atlas (pre-fills Belongs to on a new working copy only). Accepting is pinning; Waiting = `c` present, `a` absent.
- **Lens**: Enter atlas / `/in/:id` sets `in=`, loads the atlas's maps onto the Shelf and frames them, scopes Browse and Search, renames the tabs with the atlas noun, makes + and New create maps that belong there, and overrides the accent with the atlas colour. Leave undoes all of it. The lens never changes audience, never hides what was already on the Shelf, never edits belonging on anything you did not create inside it.

## 11a. Circles and Nearby: audiences with a page

An audience is where a record can be *read*. It is never a lens, a filter, or a destination in the top-level navigation; it lives under **Me** and on the Publish ▾ menu.

- **Me › Circles** lists the user's circles (members, maps, join requests waiting). **Me › Nearby sessions** lists sessions (connected / total peers, host). Both have *New* / *Join with invite* (circles) and *Host a session* / *Scan to join* (nearby).
- **Circle page** `/circle/:id`: header with `🔒` and member count, actions *Invite* and *New map here*. Tabs **Details · Chat**. Details: lead description · *At a glance* (members, encryption, since, your role) · *Shared in this circle* (maps and stories whose audience is this circle) · *Waiting to join* (admins; Approve rotates the key) · *Members* (admins can remove; removal rotates the key) · *Invite* (link, QR, rotate; an invite lets someone ask, an admin approves) · Leave. Chat is the MLS conversation with map references and "share my live location here".
- **Nearby page** `/nearby/:id`: lead · *At a glance* (host, started, transport, sharing on/off) · *Peers* with connection state (host can revoke) · *Shared in this session* with the note that records go online under each author's key when a phone reconnects · *Invite a phone* (QR, link) · End / Leave.
- **Everywhere else** a private record shows `🔒 Circle: Alpine rescue` or `⇄ Nearby: Saturday survey` as a state pill in its header, as a prefix in its list meta, and as a lock on its Shelf chip. Browse only lists private records the user can read. Opening a circle or session puts its shared maps on the Shelf.
- **New map here** on a circle or session opens a working copy with that audience preselected. Audience remains a property of the working copy, changed only through Publish ▾.

## 11b. Live

- **Share live location** lives under **Me** and in the phone's **+**. Starting it shows the **live bar** under the top bar (phone: under the search field) for as long as it runs: `● You are live · 4 min · 2 watching · link only` with *Public / Link only ▾*, *Share link*, *Details*, **Stop**. The bar is the only owner of the state; Stop removes the beacon and its last position.
- **Live page** `/live/:id` for any beacon: state pill `● live · 3 s ago` or `stale · 11 min`, actions *Follow* (camera follows; panning stops following), *Share*, and *Stop* for your own. Details: who, since, position, watching, discovery, audience. A stale beacon stays where it was and says so.
- **Discovery** is per beacon: *Link only* (default) or *Public* (appears on the Live layer for everyone). Audience can also be a circle or a session, in which case only its members see it.
- The **Live chip** on the Shelf counts sightings plus the beacons the user is allowed to see; tapping a live dot opens its page. Your own dot is accent-coloured; stale ones grey.

## 11c. Stories: blocks, inline references, and views

A Story body is a list of **blocks**. A paragraph is prose and nothing else; it never owns a camera.

### References are inline
Per `SPEC.md` §2.4 a reference is written in the sentence, not listed beside it, and has four forms: a dataset (`nostr:naddr…`), a feature inside one (`nostr:naddr…#featureId`), a coordinate (`geo:lat,lon`), and an OpenStreetMap element. Inline mentions mirror to `a` tags (§4.1); the body stays authoritative for the fine-grained selector.

- **A reference is a pill, never a link.** It sits inline in the sentence as a small bordered chip in the UI face, with its type glyph leading: ⌖ a feature, ▤ a dataset (dashed border), ◎ a coordinate and ◈ an OpenStreetMap element (both neutral). Ordinary Markdown links keep underlined running text, so the two can never be mistaken for each other: one navigates away, the other points at the map.
- Hovering emphasises the feature on the canvas without moving the camera; clicking flies to it and opens its popup. A dataset reference puts the map on the Shelf. A coordinate drops one temporary pin.
- References are live pointers. When a feature id no longer resolves, the pill turns dashed and amber with a ⚠ and a struck label, explaining why on hover, and nothing is silently substituted.
- Authoring: select the words, press **⌖ reference**, then click the feature on the canvas. That is the spec's crosshair pick, applied to a text selection.

### A view is a block
Map state lives in its own block, positioned in the body. Where it sits is when it happens.

```ts
{ type: 'view', id, title, caption?, display: 'cue' | 'figure' | 'both',
  camera?: { center: [lon, lat]; zoom }, layers?: Record<coordinate, { visible: boolean }> }
```

- **`cue`** renders as a quiet stage direction with its number, title and a summary ("shows December 1916 · hides November 1914 · ⌖ moves the camera"), and drives the big canvas.
- **`figure`** renders as a static map in the flow, drawn from the visible layers clipped to its camera, with a caption. It does not move the canvas. This is the embedded-static-map case.
- **`both`** does both: the figure in the text is a thumbnail of what the canvas is showing.
- Views accumulate in reading order. The effective state at block *i* is the opening state with every driving view at or before *i* applied, and the camera is the last one set.
- There are **no anchors and no scene array**. A view moves with the text because it is in the text, so inserting or deleting blocks needs no index arithmetic and nothing can be orphaned.

### Reading
- **▶ Present** steps the driving views in document order with a bar (‹ Next ›), scrolling each into view. This is the primary way to read a story map.
- **◎ Follow text** is a toggle, not a requirement. When on, the map takes the state of the topmost block in view and only acts when that state actually changes. Off, the map stays where the reader left it and only Present, a view click, or a reference moves it.
- Clicking any block applies its effective state explicitly.

### Serialization
A view is a Markdown link, optionally wrapping a pre-rendered image, so other clients degrade gracefully:

```markdown
[![The line freezes](https://blossom.earthly.city/ab12.png)](nostr:naddr1…?view=4.4,49.6,6.2&on=front-1914)
```

A plain Markdown client shows the picture and a link; Earthly reads the camera and layers from the query. A `cue` is the same link without the image. `presentation` in the content JSON therefore shrinks to the opening state only: `initialView`, `layerOrder`, `layers`. The sequence lives in the body, which is the same body-is-authoritative rule the spec already applies to references.

### Atlas
An Atlas keeps a plain `MapPresentationV1` as its default view, restricted to its pinned lane. It has no body, so it has no views.

## 11d. Inbox

- **Inbox** in the top bar (badge = unread) and under Me. Rows: glyph for kind (✎ proposal, 💬 reply, @ mention, ◈ atlas arrival, 👤 join request, ✓ accepted, + follow), avatar, "*Name* did what to *thing*", time, unread dot. Tapping opens the target with the right tab (comments, chat) and marks it read. *Mark all read*.
- Sources: proposals received / accepted / declined, replies to your comments, mentions, maps arriving in atlases you own (Waiting), circle join requests, follows. Derived client-side from the same events; no notification kind is published.

## 12. Canvas

Basemap: MapLibre GL with OpenFreeMap Liberty. Features as one GeoJSON source with `promoteId`; layers fill / line / proposed line (dashed) / point / proposed point / labels (focused or working map, zoom ≥ 3.5) / sightings; live positions as pulsing markers. Camera fit uses the canvas column only, padding 40px, bottom padding half the viewport on phones; refit after the grid transition. Container resize → `map.resize()`.

Interactions: hover → feature-state + chip; click → select (in Edit, ctrl/shift multi) or popup (Open map · Select · Close); tools: point (tap), line/area (tap, double-tap or Enter to finish), label (tap → text). Undo/redo per working copy. Backspace deletes the selection.

## 13. Phone shell (`≤ 760px`)

- Bottom bar: **Map** (bare map; becomes **⌄ Just map** whenever a sheet is open) · **Search** (Browse at full height) · **+** (Sighting here · Share live location · New map [in atlas] · Import file) · **Me**.
- The Margin is a bottom sheet with detents peek (96px; 62px while editing) / half / full. Drag the handle or tap it to cycle. Dismiss with × in the header, *Just map*, or dragging below peek. Dismissing clears the focus, keeps the map's chip on the Shelf, keeps any draft. Phones start on the bare map.
- Top: search field and Shelf chips (lens bar between them when in a lens).
- **Editing a map** is its own composition: the bottom bar becomes the **edit dock** (Point · Line · Area · Label | Undo · More · Ask · **Done**; while drawing: Finish · n · Undo point · Cancel). The sheet collapses to a one-line peek (✎ title · n features · Publish ▾). A **status line** replaces search and Shelf: name, hint for the current state, **Exit**. Selecting raises a strip above the dock: *N selected · Move · Rename · Delete · ×*; Move means "tap the new place". Done and Exit both keep the draft.
- Hover-only affordances (row social actions, chip hover) do not exist; ⋯ menus carry them.

## 14. Glass

◐ in every header and Me → Panels. Margin, sheet, menus, top and bottom bars become 55–78% surface with 10–14px blur. Default on for phones, remembered per device.

## 15. Code mapping

What each sketch surface replaces in `src/`. Keep list is unchanged from the audit (GeoEditor core, Authoring facade, tool registry and gates, sandbox, nostr runtime, relay, MLS runtime, Tauri services, `SHARE_ROUTES`, `tags.ts`).

| Sketch | Replaces | Home |
| --- | --- | --- |
| Router (§2) | `stance` + `viewMode` + `sidebarView` + `mobileTab`, `SIDEBAR_VIEW_MODES` (19), `MobilePanelTab` (18) | `useRouting.ts`; one `RouteState {kind,id,edit,on,live,in}` |
| Margin + header grammar | `AppSidebar.tsx`, Inspector, entity panels, `WorkspaceDraftNavigator`, `CurrentDestinationPill` | new `Margin.tsx` with one `ObjectHeader` and per-kind `Details` |
| Working copy (§7) | draft + workspace + edit state slices; `GeoEditorWorkspace`, `kind: 'scratch'` | one `workingCopies` slice keyed by object id, `mode: 'edit' \| 'propose'` |
| Publish ▾ | destination pill, `authoringDestination.ts` presentation | `PublishMenu.tsx`; `publishChannel` stays on the working copy |
| Thread (§10) | `ChatPanel` as a peer, `BindingChip`, "New map / Use current edit", `targetWorkspaceId` | Thread bound by route: `key(kind,id)`; store keeps sessions per object |
| Shelf | `MapStackPanel`, aggregate sightings/beacons layers | `ShelfStrip.tsx`; `on=` in the URL as today's stack param |
| Atlas + lens (§11) | `MapContextEditorPanel`, contexts list, browse scope, `TAXONOMY NONE OPEN` chips | `AtlasPanel.tsx`, `LensBar.tsx`, `lens` in route state |
| Browse (§5) | dataset/story/context/sighting/beacon panels and `GeoDatasetsPanel` | `Browse.tsx` + `EntityRow` |
| Comments (§9) | `CommentsPanel`, `CommentAnnotationPopup`, `useCommentGeometry` | `CommentsTab.tsx`; keep the annotation geometry model |
| Proposals (§8) | `ProposalDialog`, kind-37519 proposal machinery | `ProposalsBox.tsx`, `beginPropose`, `acceptProposal` |
| Phone shell (§13) | `MobilePanel`, `MobileToolMenu`, `MobileMapActions`, `mobileSheetPresentation` | `MobileShell.tsx` as a second composition root; `EditDock.tsx` |
| Canvas | `useMapLayers` render gate, `RenderingManager` layers for stack | one feature source with `state` property; `LayerManager` maps states to paint |

`GeoEditorView.tsx` stays the desktop composition root but loses routing reconciliation, sidebar orchestration, destination logic, and chat binding.

## 16. Protocol additions (spec v2.1)

Adds, never reshapes. No `modelVersion` bump.

1. `title`, `summary`, `image`, `published_at` tags on 37515, 37520, 37518; `features`, `size` on 37515. Client renders a PNG thumbnail on publish to Blossom.
2. Atlas: `noun`, `color`, `emblem`, `schemaFields` in content. Accepted = `c` on the map **and** `a` on the atlas; Waiting = `c` without `a`. Fit is computed client-side and never published.
3. Comments: kind 1111 with `K` = the target kind; optional geometry in a `geo` tag (`point` or `line` with WGS84 coords) for annotations.
4. Proposals: 37519 content = `{message, add, modify, remove}` for maps or `{message, body}` for stories, `a` tag → target, `e` → target version. Rebase rule pending (§18).
5. `["l","ai-assisted","earthly"]` under `["L","earthly"]` when a Thread contributed geometry.
6. Relay write policy: profiles, Earthly kinds, kind 1111/7/9735 that reference an Earthly event, relay lists. Reject the rest.
7. **MapPresentationV1**, an embedded value in the content of 37520 (Story) and 37518 (Atlas), never an event kind:
   ```ts
   interface MapPresentationV1 { version: 1; initialView?: { center: [lon, lat]; zoom: number; bearing?: number; pitch?: number }; layerOrder?: NostrCoordinate[]; layers?: Record<NostrCoordinate, { visible?: boolean; pinnedEvent?: string }> }
   // Stories carry no scene array: views are blocks in the Markdown body (§11c).
   ```
   Invariants: Story `layerOrder`/`layers`/scene layers ⊆ the story's `a` references; Atlas presentation ⊆ its pinned `a` lane (foreign `c` never enters it); missing presentation means today's behaviour; camera is published intent, never transient state; `anchor` indexes the body blocks and clients clamp it. **Scene semantics:** `layers` in a scene is a delta; the effective state at block *i* is `presentation.layers` with every scene whose `anchor ≤ i` applied in anchor order, and the view is the last scene `view` at or before *i* (else `initialView`). A scene with neither `layers` nor `view` is dropped on publish. Snapshot datasets (one map per date) are ordinary Maps; the story, not the map, carries time. Legend, `opacityMultiplier`, style overrides and filters are deferred until a concrete need; if style overrides arrive they live on the containing Story/Atlas, keep the source event immutable, and are attributed "data by A · presentation by B".
8. **Audience** is not a tag: Circle records are MLS application messages, Nearby records travel over the local node. The `🔒`/`⇄` pills are derived from where a record came from. A public copy of a private record is a new publish with a new address, never a flag flip.
9. **Live** stays 37521 with NIP-40 expiry per position; discovery `public` publishes to relays under the user's key, `link only` publishes under a throwaway key whose npub is in the link; circle/session audiences use those transports.
10. **Notifications** are derived client-side; nothing new on the wire.

## 17. Build order and acceptance

0. **No UI**: relay policy; tags of §16.1 written and read; Android benchmark on the reference device. *Accepted when Browse rows render titles without fetching content.*
1. **Router + Margin + header + Browse.** Old routes still resolve. *Accepted when every entity kind opens from a list into the Margin with the four-row header and boxed sections, and the old rail, stance tab, and pill are gone.*
2. **Working copy + Publish ▾ + Drafts.** *Accepted when only one thing can be in Edit, Publish update is the default, and audience is per working copy.*
3. **Thread in the Margin/column.** BindingChip and the binding modal deleted. *Accepted when a read-only map's Thread sends with "Edit & send", ghosts render, Apply lands in the working copy.*
4. **Shelf strip + Live chip + Save this view.** MapStackPanel deleted.
5. **Comments tab + annotations; Proposals both sides.**
6. **Atlas page, lens, Properties form.** Contexts panel deleted.
7. **Phone shell**: sheet, dismissal, + chooser, edit dock.
8. **Spec v2.1** wire changes as they become needed by 1–6 (most are needed by 1).

## 18. Decisions log and open questions

Decided (in chat, 2026-09-02/03):
- Atlases stay; the open-attach lane stays; no NIP-51 shelf kind; Story and Atlas are separate nouns.
- Margins are `30vw`, or `28vw + map + 28vw` with the Thread out; Thread column from 1100px.
- No corner rounding; compact spacing; lists not tiles; one + per Browse tab; New/Browse header is one row.
- Propose is the primary verb on things you don't own; Fork is behind ▾.
- Comments are a tab; annotations are green and need no Edit state.
- Phones start on the bare map; sheet dismissal by ×, Just map, or drag; editing swaps the nav for the edit dock.
- Glass panels default on for phones.
- Real basemap is OpenFreeMap; the artifact falls back to a graticule.

Sketched since (2026-09-03): Circles and Nearby pages, Live bar and page, story block editing with
per-paragraph layers/camera/references, the Inbox, MapPresentationV1, the full toolbar catalogue,
the Features list, the top-bar ticker.

**Still missing, in the order the build needs them.**

*Blocks a build step:*
1. **Sign-in and identity.** No account, signer choice (extension, remote, ephemeral), profile editing, or signed-out state anywhere. Every write in the sketch assumes "You". Needed before step 2.
2. **Version history.** Accepted proposals and Publish update both mint versions, but there is no way to see them, diff two, or restore one. Needed by step 5, since proposals produce versions.
3. **Publish reality.** No relay list, no per-relay success or failure, no outbox for a phone that is offline, no size warning before a large map is published. Step 2 ships publishing without them today.
4. **Empty and error states.** Nothing is drawn for: no results, no network, a relay that rejects, a blob that will not resolve, a map that fails to load, a first-run account with nothing at all. The sketch always has data.

*Design gaps in what is already sketched:*
5. **Per-feature styling.** Properties are editable, but colour, width, icon and the data-driven "style by attribute" from the toolbar have no UI, and the GeoLibre legend idea has nowhere to live.
6. **Map settings.** Basemap choice, projection, labels, and the offline saved regions all sit behind one stub menu item.
7. **Search depth.** One flat list, no geo filters (near me, in this view, bbox), no saved searches, and the relay's NIP-50 grammar is not exposed.
8. **Import flows.** Import is a menu item; the CSV column-mapping step, the OSM query builder, and drag-and-drop onto the canvas are undrawn.
9. **Moderation and safety.** Report exists as a menu item with no flow; there is no mute, no block, and no owner view of what was reported in an atlas.
10. **Accessibility pass.** Keyboard traversal of the Shelf, canvas and features list, focus order after route changes, and a screen-reader account of map state are unexamined.

*Open questions, unchanged:*
11. Closed Atlas: are Waiting maps visible to visitors or only the owner?
12. Is a Thread ever publishable, or is "How this was made" a human-edited Story section?
13. Is one thing in Edit at a time too strict for compare-and-merge?
14. Thumbnails: client on publish or relay-side job?
15. Reference Android device and frame budget; the benchmark is still unrun.
16. Proposal rebase when the target moved on: re-apply by feature id and flag conflicts, or ask the proposer to update?
17. Story scroll choreography: click and step only for now, per the GeoLibre notes.
