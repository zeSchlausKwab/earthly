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
| **Circle** | MLS group | An audience. Appears only as an audience option, never as a place. |
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

Query: `on=a,b,c` visible Shelf maps · `live=1` Live chip on · `in=:atlas` active lens. All three survive navigation; `replaceState` when they change without a route change.

Opening a Map adds it to the Shelf and frames it. Opening a Story adds its maps and frames them. Opening an Atlas does not touch the Shelf (Show all on map does). Opening a Sighting turns the Live chip on and frames it. Back is browser back.

## 3. Layout tokens

| Token | Value |
| --- | --- |
| Margin width, Thread docked | `30vw` |
| Margin and Thread column, Thread pulled out | `28vw` each, map between; only at `≥ 1100px` |
| Phone breakpoint | `≤ 760px` |
| Top bar / Lens bar / Shelf strip | 46 / 38 / 42 px |
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
Brand · Search field (centre, max 720px) · Browse · Drafts (badge = count of working copies) · Me · ?.
Search results group Maps / Stories / Atlases / People / Places; a question (ends with `?` or starts how/what/where/which/why/who/when) shows one row "Ask Earthly: …" that opens `/ask`. Enter on a question does the same. In a lens the placeholder reads "Search spots in Global skate spots… or ask" and results are scoped to the atlas.

### 4.2 Lens bar
Only when `in=` is set. Emblem, atlas title, `N spots · door policy · by author`, the rule sentence "Lists show only this atlas. New spots belong here.", About, Share app link, **Leave ×**. Phone: a 34px bar under the search field with emblem, title, Leave.

### 4.3 Margin
One object. Header grammar shared by every panel (§6). Tabs: **Details · Comments (N) · Thread**. When the Thread is pulled out to the right column the tabs are Details · Comments with the hint "Thread is on the right". Glass toggle ◐ in every header; phone adds × (§13).

### 4.4 Thread column
At `≥ 1100px` the Thread is a right-hand column by default (`threadSide=true`); **Dock** returns it to a tab; **Pull out** from the tab does the reverse. Below 1100px it is always a tab.

### 4.5 Canvas overlays
Tool pill (top centre, only while a Map is in Edit or Propose; icon + label from 1180px, icons below), zoom column (top right), diff bar (bottom centre, only while a proposal is pending), feature popup, status line (zoom · lat, lon · n on the map · live · no basemap), Shelf strip (bottom).

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

- **Map**: lead summary · *At a glance* (Features, Size, Version, Audience, Published, Author, Forked from) · *Belonging* (Atlases with fit chips; Topics) · *Properties* (only when an atlas schema applies; from which atlas) · *Appears in N* · *Proposals N waiting* (amber band) · quiet trailing row: Discard draft / Delete map.
- **Story**: prose lead with reference chips (⌖ label; hover highlights, click flies) · *Proposals* · *Maps in this story N* (+ Reference a map while editing).
- **Atlas**: lead description · *Who can add maps here* (radio sentences while editing) · *Pinned by me/author N* · *Added by others N* · *Waiting for me N* (owner only, amber, Pin · accept).
- **Sighting**: photo + note lead · *When & where* (Seen, Expires, Position, By).
- **Person**: header + Maps · Stories · Atlases lists.

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

Open:
1. Closed Atlas: are Waiting maps visible to visitors or only the owner?
2. Is a Thread ever publishable, or is "How this was made" a human-edited Story section?
3. Is one thing in Edit at a time too strict for compare-and-merge?
4. Thumbnails: client on publish or relay-side job?
5. Reference Android device and frame budget.
6. Proposal rebase: when the target version changed after a proposal was made, do we re-apply by feature id and flag conflicts, or require the proposer to update?
7. Notifications: proposals, replies, and follows need an inbox surface; not designed.
8. Not yet sketched and needed before build steps 2–7: Story reference insertion from the map, per-feature properties, version history, Circles/Nearby pages, Live banner with Stop, sign-in.
