# A Map with a Margin — implementation spec

Status: **build contract**, 2026-09-03. Supersedes the discussion in
[`FROM-SCRATCH-UX-AUDIT-2026-09.md`](FROM-SCRATCH-UX-AUDIT-2026-09.md) wherever the two differ.
The reference behaviour is the clickable sketch in
[`sketch-map-with-a-margin/`](sketch-map-with-a-margin/README.md); when this document is silent,
the sketch decides. This milestone does not migrate the Nostr protocol, event kinds, tags, or
comments. The one serialized-data change is the embedded `MapPresentationV1` application value
defined in §16, including its parser and writer.

The sketch's emoji, Unicode glyphs, and ASCII strings are compact labels for behaviours, not an
icon set. Production keeps and reuses Earthly's existing icon components and toolbar icons.

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

States of a thing you are authoring: **draft** (unpublished, never published), **editing**, **proposing to X**, **published · date**.

Words that must not appear in UI: workspace, context, stance, destination, unattached, inspector, map stack, edit state, conversation (use Thread).

## 2. Routes

Hash routes in the sketch are illustrative; the application uses path routes with the same entity
and query grammar. A client-only, code-based TanStack Router owns application navigation, route
matching, search parsing, and browser history. Bun continues to own HTTP/API/static delivery and
server-generated OG metadata; TanStack Start, SSR, and file-route code generation are out of scope.

| Route | Margin shows | Notes |
| --- | --- | --- |
| `/` | Browse (phone: nothing, bare map) | |
| `/browse/:kind` | Browse tab `maps` `stories` `atlases` `sightings` `people` | |
| `/map/:id` `/story/:id` `/atlas/:id` `/sighting/:id` `/person/:id` | The object, read-only | `:id` is the naddr / npub the app already uses |
| `/map/:id/edit` `/story/:id/edit` `/atlas/:id/edit` | The object in Edit (owner) or Propose (non-owner) | Entering `/edit` on a non-owned thing means Propose, never Fork |
| `/ask` | Ask Earthly (read-only concierge) | |
| `/read/:id` | The canonical editorial reader for a Story (§11f) | Primary shared/OG URL; the browser stays on this path |
| `/shelf` | What is on the map | |
| `/in/:atlas` | Enters the Atlas lens, then redirects to `/browse/maps?in=:atlas` | The shareable "mini-app" link |
| `/circle/:id` `/nearby/:id` | The audience's page (§11a); its shared maps join the Shelf | Reachable from Me, Publish ▾ pills, and lock badges |
| `/live/:id` | One beacon (§11b); Live chip on, camera on it | From the live bar, a live dot, or a share link |
| `/inbox` | Notifications (§11d) | Badge in the top bar and under Me |
| `/me/circles` `/me/nearby` | Lists under Me | |

Query: `on=a,b,c` visible Shelf maps · `live=1` Live chip on · `in=:atlas` active lens. All three survive navigation; `replaceState` when they change without a route change.

`/story/:id` remains the Story object in the app Margin; `/read/:id` is not an alias for it. Existing
legacy aliases and comment/deep-link routes continue to resolve during the rewrite. Compatibility
helpers may bridge old callers while the work is being developed, but the migration ships as one
cutover: there is no partial rollout, feature flag, or supported mixed old/new shell. There must be
only one browser-history owner at every point. Direct requests to `/read/:id` receive the built app shell with Story-specific
title, canonical, and OG metadata from Bun; Bun does not redirect that page to a hash or `/story`
clone. The route-local `on=` value is excluded from the canonical URL and OG cache identity.

Opening a Map adds it to the Shelf and frames it. Opening a Story adds its maps and frames them. Opening an Atlas does not touch the Shelf (Show all on map does). Opening a Sighting turns the Live chip on and frames it. Back is browser back.

## 3. Layout tokens

| Token | Value |
| --- | --- |
| Margin width, Thread docked | `30vw` |
| Margin and Thread column, Thread pulled out | `28vw` each, map between; only at `≥ 1100px` |
| Phone breakpoint | `≤ 767px` (aligned with the existing `useIsMobile()` / `md` boundary) |
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

Unscoped desktop Browse starts directly with the entity tabs, without a separate *Browse* eyebrow row. Active atlas scope keeps its meaningful picker/filter and clear action. On phones, the title/resize/transparency/close rail leads directly into the tabs; there is no separate **On the map · N** row.
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
Four compact rows, then one Details / Comments / Thread tab row. There is no outer Shelf / Inspect / Thread navigation or Inspect / Map selector above an object. On phones, the resize handle stays separate; transparency and close belong to the object header. A conditional Resume menu preserves access to other retained work without repeating the current object's title. State pill: `published · 2026-09-01` / `draft · unpublished` / `✎ editing` / `✎ editing · fork` / `✎ proposing to Aria Voss`.

### 6.2 Primary actions matrix

| Kind | Owner, reading | Non-owner, reading | Editing | Proposing |
| --- | --- | --- | --- | --- |
| Map | Edit · Show on map / Remove from map | **Propose changes** ▾(Fork) · Show/Remove | Publish update ▾ · Done | Send proposal to X · Keep for later · Discard |
| Story | Edit | Propose an edit | Publish update ▾ · Done | Send proposal to X · Keep for later |
| Atlas | Edit · Add a map ▾ · Show all on map · Enter atlas | Add a map ▾ · Show all · Enter atlas | Publish update ▾ · Done | — |
| Sighting | — (social row only) | — | — | — |

### 6.3 Details sections, in order
Every section is a box with a header band (mono uppercase title, optional count or hint on the right). The description is an unboxed lead above them.

- **Map**: lead summary · *At a glance* (Features, Size, Audience, Published, Author, Forked from) · *Features* (§6.4) · *Belonging* (Atlases with fit chips; Topics) · *Properties* (only when an atlas schema applies; from which atlas) · *Appears in N* · *Proposals N waiting* (amber band) · quiet trailing row: Discard draft / Delete map.
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
- **Publish ▾**: Publish update (same replaceable address) is the default for anything already published; *Publish as new map* is the secondary item (maps only). Audience radio: Everyone · Circle: … · Nearby: …. Audience is per working copy and never global. There is no Versions/history surface for parameterized replaceable events above kind 30000 in this milestone.
- **Done** keeps the draft and leaves Edit. **Discard** deletes the working copy. **Drafts** (top bar / Me) lists working copies with Resume and Discard; proposal drafts are labelled "proposal to X".
- **Fork** copies to a new address owned by you with `forkOf`; the original's Shelf chip is replaced by the fork.
- **Intent is chosen before editing.** Propose changes is the primary entry on another author's public Map, with Fork in its adjoining menu. Both create or resume local drafts; neither publishes on entry. Fork and proposal drafts have separate local identities and preserve their intent and source across reloads. Forks use the local `/edit` route until publication; the original Map's `/edit` route means proposal. The final action follows the stored intent: Send proposal or Publish map. Circle/Nearby Maps retain their existing no-proposals restriction. This is local draft state only, not a protocol change.
- Title is edited in place in the header; summary/description in the lead textarea; Belongs to, Topics, Properties in their boxes.

## 8. Proposals (kind 37519)

- **Propose** opens a working copy in *proposing* mode. On the canvas the original stays published-grey; additions and modified features render as proposed ghosts; removed originals fade. Toolbar and Thread work; the Thread's send label is *Propose & send*.
- **Send proposal** replaces Publish: a dialog with the `+a ~m −r` summary and an optional message. Result: a proposal `{target, author, message, add[], modify[{id,name,props,coords}], remove[], body?}` with status `pending`.
- **Author's view**: *Proposals* box on Details with author, date, status pill, message, counts, **Preview on map** (ghosts on their own map), **Accept & publish**, **Decline**, **Discuss** (jumps to Comments). Accept merges by feature id into the current replaceable object, sets `acceptedAs`, and credits the proposer. Decline leaves the proposer's copy untouched.
- **Proposer's view**: same box with status and **Withdraw** while pending. Browse rows show `✎ n proposals` on owned objects with pending items; the social row shows the same.
- Stories: same flow with `body` instead of features; summary reads "text changes".
- Open: what happens when the target has moved on since the proposal was made (rebase rule). Decide in §18.

## 9. Comments (existing kind 37517)

- Comments tab on Map, Story, Atlas, Sighting. Header: count and sort Newest / Most liked. One level of replies. Each comment: avatar, name, time, optional ⌖ pin/line chip, text, ♡ n · Reply · Delete (own) / Report. Reading, writing, replies, and geometry continue through Earthly's current kind-37517 model; this rewrite does not migrate comments to kind 1111 or another protocol.
- **Composer** at the bottom (stays put): textarea, **Attach a place ▾** (Drop a pin · Draw a line · Use the selected feature), Post (⌘/Ctrl+Enter). While placing, an amber instruction chip; once attached, a green removable chip.
- The Comments tab inherits the containing sheet's transparency through the discussion, reply rows, formatting bar, and input itself. It starts with count/sort, not another Discussion/Comments heading; Map inspection also omits the social row already present in its object header. The discussion scrolls independently of the bottom composer, whose expanded controls remain scrollable on short sheets. Existing rich text, references, uploads, all geometry tools, and deeper reply data remain available.
- Reading pages and the unbounded editor discussion retain normal document flow, with the composer above the threads; the docked composer applies only to bounded object tabs.
- Geometry renders green on the canvas while the Comments tab is open; hovering a comment highlights it; ⌖ flies to it. No Edit state is involved; a comment never changes the object.
- Showing annotations during map loading preserves that visibility request and retries when the map is idle. Hiding an annotation or removing its parent cancels pending visibility; retries do not duplicate existing overlays.

## 10. Thread contract

- The Thread belongs to the object in the Margin. There is no unbound chat. Header: object title · state (`editing`, `proposing to X`, `read-only`, `read-only · concierge` on atlases you don't own) · safety level ▾ · Details toggle.
- An embedded Thread does not repeat the surrounding object's title. Its compact control row keeps the current safety state visible (including explicit Auto apply), while Thread settings initially collapse the safety selector, model/provider, screenshots, wallet, usage, and diagnostics. Standalone Threads retain their own title. Model failures and recovery actions remain visible outside the disclosure.
- A new, unpublished Map has no public address yet. Its Thread uses `/edit?tab=thread` and a stable local working-copy id (`map-draft:<id>`); closing it returns to `/edit`. Different local Maps never share a Thread or unsent composer. Opening or switching tabs does not bind an AI target; the first **Send** binds that retained Map without creating a second working copy. Desktop and phone restore the same route and transcript after reload.
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
Per `SPEC.md` §2.4 a reference is written in the sentence, not listed beside it, and has four forms: a Map (`nostr:naddr…`), a feature inside one (`nostr:naddr…#featureId`), a coordinate (`geo:lat,lon`), and an OpenStreetMap element. Inline mentions mirror to `a` tags (§4.1); the body stays authoritative for the fine-grained selector.

- **A reference is a pill, never a link.** It sits inline in the sentence as a small bordered chip in the UI face, with its type glyph leading: ⌖ a feature, ▤ a Map (dashed border), ◎ a coordinate and ◈ an OpenStreetMap element (both neutral). Ordinary Markdown links keep underlined running text, so the two can never be mistaken for each other: one navigates away, the other points at the map.
- Hovering emphasises the feature on the canvas without moving the camera; clicking flies to it and opens its popup. A Map reference puts the map on the Shelf. A coordinate drops one temporary pin.
- References are live pointers. When a feature id no longer resolves, the pill turns dashed and amber with a ⚠ and a struck label, explaining why on hover, and nothing is silently substituted.
- Authoring: select the words, press **⌖ reference**, then click the feature on the canvas. That is the spec's crosshair pick, applied to a text selection.

### A view is a block
Map state lives in its own block, positioned in the body. Where it sits is when it happens.

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

- **`cue`** renders as a quiet stage direction with its number, title and a summary ("shows December 1916 · hides November 1914 · ⌖ moves the camera"), and drives the big canvas.
- **`figure`** renders an Earthly-generated live map figure in the flow, drawn from the visible layers clipped to its camera, with a caption. It does not move the main canvas and does not require an uploaded snapshot.
- **`both`** does both: the figure in the text is a thumbnail of what the canvas is showing.
- Views are sparse deltas and accumulate in reading order. The effective state at block *i* is the opening state with every driving view at or before *i* applied, and the camera is the last one set. A view may override visibility, opacity, or style of a base presentation layer by its stable layer id, but cannot retarget that layer's source or feature selector.
- There are **no anchors and no scene array**. A view moves with the text because it is in the text, so inserting or deleting blocks needs no index arithmetic and nothing can be orphaned.

### Reading
- **▶ Present** steps the driving views in document order with a bar (‹ Next ›), scrolling each into view. This is the primary way to read a story map.
- **◎ Follow text** is a toggle, not a requirement. When on, the map takes the state of the last driving block to cross the reading line near the top of the article viewport, holds it through intervening prose, and only acts when that stage changes. Off, the map stays where the reader left it and only Present, a driving view click, or a reference moves it.
- Clicking a driving block applies its effective state explicitly. Figure-only blocks keep their camera and layer changes independent of the main map and later driving views.

### Serialization
Views use Earthly's deterministic Markdown view-block codec. They are physical blocks in the Story
body, not ordinary links with camera/layer query parameters, and publishing a view does not upload a
Blossom image. The parser and writer preserve block order and the `StoryViewBlockV1` value; clients
that do not implement the extension may ignore the block without losing the surrounding prose. The
Story content's `presentation` value contains only the opening state. The sequence stays in the body,
which is the same body-is-authoritative rule the spec already applies to references.

### Atlas
An Atlas keeps a plain `MapPresentationV1` as its default view, restricted to its pinned lane. It has no body, so it has no views.

## 11f. The reading route

A shared story link opens here, not in the app. Half article, half live map, and two controls.

- **Layout.** The article occupies the left half at a 38rem measure, the map the right half, and the map is the same live canvas the app uses, so views, references and comment pins all work. On a phone the map takes the top 42% and the article scrolls beneath it.
- **Chrome is two buttons in the top left**, floating over the article on a soft gradient: the **Earthly mark**, which returns to the app, and a **pencil**, which is Edit for your own story and Propose an edit for anyone else's. There is no top bar, no Shelf, no Thread, no tabs, no lens bar. Everything else on screen is the article.
- **Typography is editorial.** A kicker naming the piece ("4-part map story · 5 maps"), the title in the display face, a serif dek, then a byline rule with author, date, reading time, and a quiet note that the map follows as you read. The body is serif at a comfortable measure; figures, tables, quotes and callouts get more room than in the Margin.
- **The map follows the reading position** by default here, since that is the whole point of the route. View figures still render in the flow and remain clickable, and reference pills still fly the map.
- **Comments sit under the article**, not in a tab: a heading with the count, one line saying anyone with a Nostr account can reply and that a reply can point at a place, the composer, then the threads with their geometry chips. It is the same data and the same actions as the Margin's Comments tab, laid out for reading.
- **The footer** lists the maps used, with authors and feature counts, and the react, zap, favourite and share row. Share offers a **reading link** first.
- Entry points: the **▤ Read** button on a Story in the Margin, the **▤** action on a Story row in Browse, and any shared story URL.

## 11d. Inbox

- **Inbox** in the top bar (badge = unread) and under Me. Rows: glyph for kind (✎ proposal, 💬 reply, @ mention, ◈ atlas arrival, 👤 join request, ✓ accepted, + follow), avatar, "*Name* did what to *thing*", time, unread dot. Tapping opens the target with the right tab (comments, chat) and marks it read. *Mark all read*.
- Sources: proposals received / accepted / declined, replies to your comments, mentions, maps arriving in atlases you own (Waiting), circle join requests, follows. Derived client-side from the same events; no notification kind is published.

## 11e. Empty and error states

Every one of these uses the same shape: a mark, a headline that says what is true, one sentence that explains it, and one or two ways out. None of them blames the reader, and none is a spinner with no exit.

| State | What it says |
| --- | --- |
| **A brand new account** | The first screen a real person sees. "Nothing here yet, and that is the point." Earthly starts empty; draw a map, import a file, or look at what other people made. Not an error, an invitation. |
| **No results for a filter** | Names the query, says whether a scope filter may be hiding matches, and offers to clear the filter or leave the atlas. |
| **An empty atlas** | "Nobody has put anything here. You could be the first," with Add the first one. |
| **Loading** | Skeleton rows in the shape of the real ones, so the layout does not jump when they arrive. |
| **Offline** | A bar under the top bar: "Offline. Showing what is on this device · 1 waiting to publish", with What is waiting and Try again. Lists still work from cache; nothing is hidden. |
| **A relay rejected a write** | A bar and a dialog listing every relay and its answer, e.g. `relay.damus.io — blocked: pubkey not allowed`. It states the important fact first: the event is signed, stored on this device, and published as long as one relay took it. Retry the third, Leave it queued, Manage relays. |
| **External geometry will not load** | A map whose features live in a blob: the Features list explains that the map keeps 2.4 MB outside the event at a named address, that the server did not answer, and that the map itself is fine. Its Shelf chip turns amber with a ⚠, and it draws nothing rather than drawing wrong. |
| **An unresolved reference** | The pill turns dashed amber with a struck label and says why (§11c). |

These are hard to reach on purpose, so the sketch makes them reachable: **Me → Simulate a problem** toggles each one.

## 12. Canvas

Basemap: MapLibre GL with OpenFreeMap Liberty. Features as one GeoJSON source with `promoteId`; layers fill / line / proposed line (dashed) / point / proposed point / labels (focused or working map, zoom ≥ 3.5) / sightings; live positions as pulsing markers. Camera fit uses the canvas column only, padding 40px, bottom padding half the viewport on phones; refit after the grid transition. Container resize → `map.resize()`.

Interactions: hover → feature-state + chip; click → select (in Edit, ctrl/shift multi) or popup (Open map · Select · Close); tools: point (tap), line/area (tap, double-tap or Enter to finish), label (tap → text). Undo/redo per working copy. Backspace deletes the selection.

## 13. Phone shell (`≤ 760px`)

- Bottom bar: **Map** (bare map; becomes **⌄ Just map** whenever a sheet is open) · **Browse** (catalog sheet initially at 50% of the viewport) · **+** (Sighting here · Share live location · New map [in atlas] · Import file) · **Me**.
- The Margin is a bottom sheet with detents peek (96px; 62px while editing) / half / full. Drag the handle or tap it to cycle. Dismiss with × in the header, *Just map*, or dragging below peek. Dismissing clears the focus, keeps the map's chip on the Shelf, keeps any draft. Phones start on the bare map.
- Transparency carries through the list frame and rows; selection and hover remain legible overlays. The opaque setting restores the solid surface.
- During drawing, drag the draft-summary handle up to the half/full sheet to access the same Map editor as desktop: metadata, geometry properties/style/actions, Atlas attachment, references, and draft discard. Collapse it to continue drawing; this never creates a second draft or publishes. The drawing status banner yields to the expanded editor, while drawing tools remain in the dock.
- Top: search field and Shelf chips (lens bar between them when in a lens).
- **Editing a map** is its own composition: the bottom bar becomes the **edit dock** (Point · Line · Area · Label | Undo · More · Ask · **Done**; while drawing: Finish · n · Undo point · Cancel). The sheet collapses to a one-line peek (✎ title · n features · Publish ▾). A **status line** replaces search and Shelf: name, hint for the current state, **Exit**. Selecting raises a strip above the dock: *N selected · Move · Rename · Delete · ×*; Move means "tap the new place". Done and Exit both keep the draft.
- Hover-only affordances (row social actions, chip hover) do not exist; ⋯ menus carry them.

## 14. Glass

◐ in every header and Me → Panels. Margin, sheet, menus, top and bottom bars become 55–78% surface with 10–14px blur. Default on for phones, remembered per device.

## 15. Code mapping

What each sketch surface replaces in `src/`. Keep list is unchanged from the audit (GeoEditor core, Authoring facade, tool registry and gates, sandbox, nostr runtime, relay, MLS runtime, Tauri services, `SHARE_ROUTES`, `tags.ts`).

| Sketch | Replaces | Home |
| --- | --- | --- |
| Router (§2) | `stance` + `viewMode` + `sidebarView` + `mobileTab`, `SIDEBAR_VIEW_MODES` (19), `MobilePanelTab` (18) | client-only TanStack route tree plus a temporary `useRouting.ts` compatibility facade; one `RouteState {kind,id,edit,on,live,in}` |
| Margin + header grammar | `AppSidebar.tsx`, Inspector, entity panels, `WorkspaceDraftNavigator`, `CurrentDestinationPill` | new `Margin.tsx` with one `ObjectHeader` and per-kind `Details` |
| Working copy (§7) | draft + workspace + edit state slices; `GeoEditorWorkspace`, `kind: 'scratch'` | one `workingCopies` slice keyed by object id, `mode: 'edit' \| 'propose'` |
| Publish ▾ | destination pill, `authoringDestination.ts` presentation | `PublishMenu.tsx`; `publishChannel` stays on the working copy |
| Thread (§10) | `ChatPanel` as a peer, `BindingChip`, "New map / Use current edit", `targetWorkspaceId` | Thread bound by route: `key(kind,id)`; store keeps sessions per object |
| Shelf | `MapStackPanel`, aggregate sightings/beacons layers | `ShelfStrip.tsx` for always-visible chrome; retained `MapStackPanel` inside `/shelf` for detailed controls; `on=` in the URL |
| Atlas + lens (§11) | `MapContextEditorPanel`, contexts list, browse scope, `TAXONOMY NONE OPEN` chips | `AtlasPanel.tsx`, `LensBar.tsx`, `lens` in route state |
| Browse (§5) | dataset/story/context/sighting/beacon panels and `GeoDatasetsPanel` | `Browse.tsx` + `EntityRow` |
| Comments (§9) | `CommentsPanel`, `CommentAnnotationPopup`, `useCommentGeometry` | `CommentsTab.tsx`; keep the annotation geometry model |
| Proposals (§8) | `ProposalDialog`, kind-37519 proposal machinery | `ProposalsBox.tsx`, `beginPropose`, `acceptProposal` |
| Phone shell (§13) | `MobilePanel`, `MobileToolMenu`, `MobileMapActions`, `mobileSheetPresentation` | `MobileShell.tsx` as a second composition root; `EditDock.tsx` |
| Canvas | `useMapLayers` render gate, `RenderingManager` layers for stack | one feature source with `state` property; `LayerManager` maps states to paint |

`GeoEditorView.tsx` stays the desktop composition root but loses routing reconciliation, sidebar orchestration, destination logic, and chat binding.

## 16. Embedded presentation contract (no protocol migration)

This milestone does not add or migrate event kinds, tags, relay policy, audiences, proposals, or
comments. In particular, comments remain kind 37517 and there is no event-history/version scheme for
the parameterized replaceable kinds above 30000. Existing readers and writers keep their current
wire behaviour.

The sole serialized-data addition is `MapPresentationV1`, an optional embedded JSON value in the
existing content of kind 37520 (Story) and kind 37518 (Atlas). Its `version: 1` discriminates this
value's parser/writer schema; it is not an event version, a protocol version, or a Versions UI.

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

`layers` is ordered bottom-to-top. It contains layer *instances*, rather than a record keyed by
coordinate, so one foreign Map can be used more than once with different feature selectors or
presentation. `id` is stable and unique inside the containing Story or Atlas. `source` must be an
exact kind-37515 coordinate and always resolves the latest replaceable event; there is no
`pinnedEvent`. Missing `featureIds` means the whole Map. Missing `visible` and
`opacityMultiplier` mean `true` and `1`; opacity is clamped to `[0, 1]` and multiplies the source
feature's own fill/stroke opacity.

Style overrides use the bounded declarative fields above, reuse Earthly's current style vocabulary,
and never mutate the referenced Map. Unsafe executable styles, arbitrary CSS/network assets, and
content fields such as feature names or descriptions are not presentation overrides. The UI labels
the roles when they differ: “data by A · presentation by B”. A legend, if added later, is derived
from effective styles rather than serialized independently.

Reference boundaries are strict:

- A Story layer source must be authorized by a reference in its body. A whole-Map mention permits a
  selective `featureIds` subset; feature-only mentions permit only those cited ids. A missing id is
  shown as unresolved and never widens silently to the whole Map.
- An Atlas presentation may use only Maps in its owner's accepted/curated `a` lane. Foreign `c`
  contributions remain discoverable but never enter the canonical presentation automatically.
- Missing or unrecognized presentation metadata falls back to today's rendering. Parsing and
  writing are pure and preserve unknown presentation versions during unrelated edits.
- `initialView` is explicit published intent, never an incidental pan or zoom.

Story view blocks are defined in §11c. They are cumulative sparse overrides of base layer instances
and may set a camera, but cannot change a layer's source or feature selector. There is no scene
array, anchor, static Blossom snapshot, or independently serialized legend.

The URL query `on=` is a route-local ambient overlay, never Story/Atlas presentation state and never
silently persisted. If it names a source already in the Story, it is a temporary visibility override;
otherwise Earthly synthesizes a temporary whole-Map layer using the Map author's style. Inline view
blocks cannot mutate ambient layers. Persisting one requires an explicit “Add to Story” action that
first adds an authoritative body reference and then a presentation layer.

## 17. Build order and acceptance

September 5 finishing-pass implementation and measured verification are recorded in
[REDESIGN-FINISHING-CHECKLIST.md](REDESIGN-FINISHING-CHECKLIST.md). That checkpoint does not
waive the wider acceptance requirements or the outstanding repository type/native-device gates.

The numbered items below are implementation order inside one migration, not separately releasable
slices. The rewrite is accepted and shipped only after every item passes and the temporary
compatibility layout/routing paths have been removed.

0. **Foundation:** pure `MapPresentationV1` parser/writer/reducer, code-based TanStack route tree with a compatibility facade, and Bun's metadata-enriched app shell for `/read/:id`. *Accepted when malformed presentation data falls back safely, valid data round-trips, old routes still resolve, and a direct production `/read/:id` response contains both Story OG metadata and the application module script without redirecting.*
1. **Margin + header + Browse + editorial reader.** *Accepted when every entity kind opens from a list into the Margin with the four-row header and boxed sections, `/story/:id` stays in that shell, `/read/:id` renders the full reader, and the old rail, stance tab, and pill are gone.*
2. **Working copy + Publish ▾ + Drafts.** *Accepted when only one thing can be in Edit, Publish update is the default, and audience is per working copy.*
3. **Thread in the Margin/column.** BindingChip and the binding modal deleted. *Accepted when a read-only map's Thread sends with "Edit & send", ghosts render, Apply lands in the working copy.*
4. **Shelf strip + Live chip + Save this view.** Reuse `MapStackPanel` as the detailed `/shelf`
   Margin surface; delete only its old floating desktop mounting path and rename visible Map Stack
   copy to Shelf / On the map.
5. **Comments tab + annotations; Proposals both sides.**
6. **Atlas page, lens, Properties form.** Contexts panel deleted.
7. **Phone shell**: sheet, dismissal, + chooser, edit dock.

Performance benchmarks are deliberately deferred until the rewritten shell and rendering path exist;
they are not an acceptance gate for these implementation slices.

## 18. Decisions log and open questions

Decided (in chat, 2026-09-02/03):
- Atlases stay; the open-attach lane stays; no NIP-51 shelf kind; Story and Atlas are separate nouns.
- No protocol/event-kind/tag migration in this milestone; comments remain kind 37517.
- No Versions/history surface or event-version scheme for parameterized replaceable kinds above 30000.
- `MapPresentationV1.version` is only an embedded JSON schema discriminator. Its ordered layer instances support foreign Map coordinates, feature subsets, immutable style/opacity overrides, and an initial camera; references always follow the latest replaceable Map event.
- Story views are inline body blocks with cameras and cumulative sparse overrides. There are no scenes, anchors, or uploaded static snapshots, and `on=` remains ambient route state.
- Client-only code-based TanStack Router owns in-app routing; Bun keeps HTTP/API/static/OG ownership. `/read/:id` is the canonical shared reader and `/story/:id` stays in the Margin.
- Existing icons and toolbar components are preserved; the sketch's symbols are illustrative.
- The migration ships as one complete cutover; temporary adapters are development scaffolding only,
  not a partial rollout strategy.
- Benchmarks are deferred.
- Margins are `30vw`, or `28vw + map + 28vw` with the Thread out; Thread column from 1100px.
- No corner rounding; compact spacing; lists not tiles; one + per Browse tab; New/Browse header is one row.
- Propose is the primary verb on things you don't own; Fork is behind ▾.
- Comments are a tab; annotations are green and need no Edit state.
- Phones start on the bare map; sheet dismissal by ×, Just map, or drag; editing swaps the nav for the edit dock.
- Glass panels default on for phones.
- Real basemap is OpenFreeMap; the artifact falls back to a graticule.

Sketched since (2026-09-03): Circles and Nearby pages, Live bar and page, Story block editing with
inline views/layers/camera/references, the Inbox, MapPresentationV1, the full toolbar catalogue,
the Features list, the top-bar ticker.

**Still missing, in the order the build needs them.**

*Blocks a build step:*
1. **Sign-in and identity.** No account, signer choice (extension, remote, ephemeral), profile editing, or signed-out state anywhere. Every write in the sketch assumes "You". Needed before step 2.
2. **Publish reality, beyond the failure case.** The relay list, the outbox queue and the size warning before a large map goes out are described but not drawn; only the rejection dialog and the offline bar exist.

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
15. Proposal rebase when the target moved on: re-apply by feature id and flag conflicts, or ask the proposer to update?
16. Story scroll choreography beyond explicit click/step and the reader's opt-in follow mode.

## 19. Implementation verification checkpoint — 2026-09-03

This is an in-progress verification record, not approval for a partial rollout.

The latest integration pass covers:

- Persistent identity onboarding when signing in changes the active account, and separate Inbox versus Sync & delivery surfaces.
- Local Map Threads at `/edit?tab=thread`, one stable session per working copy, binding only on Send, unsent prompts retained across in-page navigation, saved sessions restored on reload, and phone Thread → Edit navigation before the first send. Unsent composer text remains memory-only and is not restored after a page reload.
- The Thread header's three safety levels, provider/model controls, and expandable diagnostics on both layouts. The desktop Thread no longer mounts invisibly beneath the phone composition.
- A React external-store snapshot regression during new-Map creation: the route composition now selects the primitive working-copy id, not a freshly allocated target object.
- Atlas presentation feature-picker wiring and route-tab types used by phone restoration.

Verified together with the repository AI suite: `smoke`, `thread-draft-routing`, `chat-surface`, `chat-run-guard`, `chat-sequential-edit-regression`, and `chat-story-target-gate`: **38 passed, 6 intentional platform skips, 0 failures**. The deterministic provider runs through the real Thread, tool dispatch, safety gate, editor, and local persistence paths.

Production build, AI-suite typecheck, and `git diff --check` pass. Focused Atlas authoring, route ownership, retained inspection, mobile interaction, ChatPanel, and chat-store unit suites pass when run in isolated groups.

Remaining release gates:

- Migrate the older E2E scenarios/tasks that still exercise retired standalone-chat binding and sidebar controls, then run the complete suite. The focused green run does not replace those scenarios.
- Finish the full §17 feature-preservation/acceptance audit, including published-object Thread transitions, both sides of proposals, reader/presentation interactions, and the remaining compatibility cleanup.
- The repository-wide strict TypeScript check is still red (434 diagnostics in the latest run); do not treat the build or focused typechecks as a green full typecheck. Separate existing typing debt from migration regressions before acceptance.
- The monolithic Bun test run also needs test-isolation cleanup; shared module mocks contaminate later suites, while the focused migration groups pass independently.

Protocol migrations, comment migration, event versioning, partial release flags, and benchmarks remain outside this milestone's agreed scope.

### Sketch-alignment follow-up — 2026-09-04

- Drafts are reached from the top bar or Me; the obsolete draft navigator above entity catalogs is removed.
- Me is an anchored account popover on desktop and phone. Opening it preserves the current route; choosing Profile or another destination navigates explicitly. Existing identity, settings, theme, live-location, and discovery actions remain available.
- Phone Browse initially opens the half-height (50% viewport) catalog sheet and can expand to full height. Explicit Browse routes, reload, and Back restore the half-height sheet; `/` returns to the bare map. Place search remains available in the map controls.
- Browse gives the saved vertical space to the list: no standalone desktop eyebrow and no phone On-the-map count row. Atlas scope and Shelf controls remain available.
- Phone Create uses a near-full-width menu with generous touch rows, short descriptions, and the existing Map/Atlas/Story/Sighting/Live beacon icons and actions.
- Desktop map controls clear the Shelf, status, and compact attribution. Short canvases scroll the control stack without squeezing or removing buttons; opening Thread does not change canvas-relative placement.
- Catalog rows use compact geometry previews and metadata. Opening a row shows its geometry and inspects it; the separate visibility control does not navigate. Social, edit/proposal, and other actions remain available in More.
- Map inspection uses a persistent object header followed by Details/Comments/Thread and boxed At a glance, Features, Belonging, Properties, and Appears in sections. Features retain filtering, expansion, zoom, and comment attachments. No event-version UI is restored from the sketch.
- Phone object tabs open the actual route-bound Thread inside the same compact header, and Details returns to that object. Shelf composition controls remain available via Me even though the redundant outer tab has gone. Proposal/Fork is chosen at entry and remains explicit in saved drafts and publishing controls.
- Reload restores the selected object/Thread and the retained Map's actual geometry and metadata, not only its saved identifiers. A local hydration marker protects saved drafts from empty startup mirrors; normal live edits are not reloaded. Map edit routes open the desktop editor, and Resume keeps each retained editor's contents and audience.
- Phone Map editing uses a status header, draft summary with Publish, and Point/Line/Area/Label/Undo/More/Ask/Done dock. Active drawings expose Finish, Undo point, and Cancel; Done retains completed draft geometry. The existing extended tool catalog remains in More. Publish also remains available in expanded Map details.
- Desktop tools are retained on an opaque toolbar surface, and ticker glyphs/text share a centerline. Existing icons are retained instead of sketch emoji/ASCII stand-ins.

The new `margin-browse-contract`, `mobile-drawing-chrome`, and `mobile-object-workspace` browser scenarios cover these interactions using the real application and local data. Responsive and Discover checks now follow the Browse/Me contracts. The delayed-AI editor contract also verifies that Create clears the previous Thread route, independent Map drafts keep their own Threads, and background Story writes remain correctly named and resumable without replacing the visible Map. This follow-up does not supersede the remaining release gates above.

### Comments and Thread follow-up — 2026-09-04

Comments now share sheet transparency through the editor and replies, omit duplicate headings/actions in Map inspection, and retain separate discussion/composer scrolling in bounded tabs. Thread settings collapse behind one compact control row; the embedded object title is not repeated and the active safety level remains visible. Existing icons, editor controls, and comment protocol are retained.

Verification: 44 focused unit tests pass. The Comments browser contract passes on desktop and phone, including 320/390px half/full sheets in glass/opaque modes, sorting, replies, attachment tools, and annotation restoration after map movement. Compact Thread controls and model-error recovery pass browser checks. Production build and AI-suite typecheck pass; the full TypeScript output remains identical to the existing 434-diagnostic baseline.

The reported Map-route maximum-update-depth error remains **unreproduced**, not proven fixed: the exact reported Map at 464×977 passes authenticated tab/dropdown/reload checks, and the new six-case desktop/phone route-stability regression passes. Further triggering steps are needed if the error persists.

### Story view authoring and WW1 fixture — 2026-09-04

- Story view blocks have manual cue/figure/both selection, captions, camera capture/numeric editing, per-stable-layer visibility/opacity/style changes, inheritance resets, and undoable up/down movement among prose. Insertion preserves selected prose; invalid style input preserves the last valid value. Opening layers supply sources and feature selections; inline views remain sparse rendering deltas.
- Unpublished Story previews use a local draft identity and the current body/snapshot. Both inline figures and Apply view resolve actual source geometry before publication, rather than relying on a published Article. Figure resolution stays scoped to each authorized layer instance, even when several instances share a foreign source.
- Only the visible Story editor can claim the draft presentation; retained/background AI drafts do not displace an Atlas or Map. Explicit mobile editor reveals are separate from background writes. Discarding or replacing draft content invalidates its applied preview, without deleting unrelated map data.
- The Reader exposes an ordered timeline and Present/Previous/Next navigation through driving blocks. Follow text holds its stage through prose without repeatedly taking back a manually moved camera. Figure-only changes are isolated from later cues. Figures share the real presentation canvas; there is no static-image upload path. Deferred scrolling survives the final Next button becoming disabled.
- The existing AI `write_story_draft` tool accepts opening `presentation` and physical view fences in `markdown` atomically. Both prompt profiles document the contract; Story reads return raw presentation and view diagnostics. New AI writes reject invalid views, unauthorized layers, and source/feature-selector retargeting while retaining existing approval gates and untouched future data. This adds no automatic publication or event/protocol migration.
- `bun run seed:ww1` adds five synthetic foreign-source Maps and one Story on the local development relay only. The example has four chronological driving views, one independent comparison figure, nine layer instances, selective battle references, and contrasting styles/opacities/cameras. A repeat seed preserves identical events and rejects differing demo addresses by default. See [WW1 Story demo](WW1-STORY-DEMO.md) for links and authoring instructions.

Focused coverage includes real editor document transactions and save/reload, shared codec/reducer behavior, safe seeding, and deterministic AI execution from advertised schema through approval, dispatch, persistence, and serialized readback. The desktop/phone `story-view-blocks` and `story-manual-view-authoring` scenarios exercise actual canvases and authoring controls without publishing. The seeded Reader also loads in a fresh anonymous browser directly from the local relay, not only from injected test data.

This is a bounded feature verification, not completion of the remaining milestone release gates above. AI verification uses deterministic tool calls, not a paid live-model quality benchmark.

### Story pencil entry — 2026-09-04

The Reader pencil and the Story's Propose an edit action open the normal, route-backed Story editor directly. Owners edit in place; non-owners prepare a proposal with Save draft and Send proposal, never a separate narrative modal or an implicit fork. Reloading `/story/:id/edit` restores the same editing surface.

The existing proposal format remains Markdown-only: narrative and inline Story views are editable, while cover details and the opening presentation are read-only. Unsupported changes already present in a retained draft are shown with an explicit restore action, not silently discarded. Sending uses the existing proposal factory and original Story target; only the author's later acceptance updates the Story.
