# Earthly from scratch: a UI/UX and protocol audit

Date: 2026-09-02
Status: discussion document, not an implementation plan
Method: code reading (`CONTEXT.md`, `SPEC.md`, `docs/architecture/*`, the editor/chat/routing stores, the three reference screenshots in `docs/`) plus a live sample of `wss://relay.earthly.city` taken today.

The question posed: if a bold UI/UX person and a Nostr protocol developer sat down for an afternoon and were allowed to start over, what would they come out with? Below is that conversation, condensed. Part 1 is what they saw. Part 2 is the diagnosis. Part 3 is the redesign. Part 4 is the protocol half. Part 5 is the mobile decision. Part 6 is what to keep, what to kill, and in what order.

---

## Part 1 — What we saw

### 1.1 The app carries more concepts than it has users

Counted from the code, not estimated:

| Surface | Count | Where |
| --- | --- | --- |
| Sidebar view modes | 19 | `useRouting.ts` `SIDEBAR_VIEW_MODES` |
| Mobile panel tabs | 18 | `store/types.ts` `MobilePanelTab` |
| Top-level stances | 3 (browse / focus / author) | `stanceSlice.ts` |
| Publish destination kinds | 5 (public-unattached, public-context, private-group, field-session, unresolved) | `authoringDestination.ts` |
| Retained "thing I am working on" concepts | 6: local draft, workspace, edit state, conversation, Map Stack entry, Inspector subject | `CONTEXT.md` |
| Entity kinds with their own list, editor, route, and share path | 5 (Dataset, Story, Group/Context, Sighting, Beacon) plus Comments, Proposals, Posts, Private groups, Field sessions | `SHARE_ROUTES`, `AppSidebar.tsx` |
| Icons in the left rail | 12 | screenshot `docs/image_web.png` |

The strongest single piece of evidence is `CONTEXT.md` itself. It is a 150-line glossary the team had to write to keep the app's own nouns from colliding. It has an **Avoided terms** section. It states that "workspace" is "overloaded across local drafts, MLS groups, field sessions, and AI chat." When a product needs a glossary to explain the difference between an edit state, a workspace, a draft, and a conversation, the glossary is the bug report.

### 1.2 Internal state leaks onto the screen

From the screenshots:

- The Contexts list shows chips reading `TAXONOMY`, `NONE`, `OPEN`, `CLOSED`. Those are the raw values of `contextUse`, `validationMode`, and the attachment policy. No user knows what a "taxonomy / none / open" context is.
- The chat header shows `ctx(model) 262,144`, `Reasoning (46 lines)`, `Tool Result (61 lines)`, `get_editor_state · 1 tool call(s)`, and a safety setting labelled `Just accept`. This is a developer console rendered as the primary conversation.
- The Map Stack shows `Sightings layer · suggested` and `Live beacons layer · suggested` on a relay with six sightings and zero beacons.
- The top bar reads `3/3 · BROWSE · Public · Unattached · File`. Four different state machines share one row.
- On a phone, the first thing in the top-left corner is `Public · Unattached`. "Unattached" is a word from the group-attachment lane of the spec. On a 390px screen it is the largest text on the map.

### 1.3 The chat cannot be used until the user answers a question they did not ask

`ChatPanel.tsx:172`: "Choose New map or Use current edit before sending." A conversation is a separate object with a `targetWorkspaceId`, and the user must bind it before the first prompt is allowed. The design rationale in `CONTEXT.md` is sound (never edit something the user did not point at), but the mechanism puts the burden on the person: they must understand that a chat is a thing, that an edit is a thing, and that the two need to be joined. The `BindingChip` ("Untitled draft · 0 features") is the visible seam of that join.

### 1.4 The Map Stack, the Inspector, the sidebar list, and the route disagree about what "on screen" means

The Map Stack says what is drawn. The Inspector says what is being read. The sidebar list says what is being browsed. The route (`/story/naddr`) says what was opened. A Context can set a browse scope that filters lists without changing the map, or be added to the stack without being inspected. Every one of these is defensible in isolation. Together they mean the user has to hold four cursors in their head.

### 1.5 What people actually publish on earthly.city

Live sample, today, from `wss://relay.earthly.city` (limit 1000 per kind):

| Kind | What | Events | Authors | First → last |
| --- | --- | --- | --- | --- |
| 37515 | Map (dataset) | 32 | 7 | 2023-11 → 2026-09-01 |
| 37520 | Story | 13 | 4 | 2026-07-12 → 2026-09-01 |
| 37522 | Sighting | 6 | 4 | 2026-07 → 2026-08-30 |
| 37517 | Comment | 1 | 1 | one, text "Like heart in not reactive" |
| 37518 | Group / Context | 1 | 1 | seeded, legacy v1 shape (`contextUse: taxonomy`) |
| 37521 | Beacon | 0 | – | – |
| 37519 | Proposal | 0 | – | – |
| 1 / 7 / 1111 / 30078 | Generic Nostr traffic from Amethyst, Damus, Primal, Nostur, Wisp, nym | 500+ each | 100–480 | last 48 h |

What the maps are: *China's Belt and Road Initiative*, *Submarine Cables (9 regional maps)*, *World Enclaves & Exclaves*, *Major Disputed Territories*, *World's Largest Resource Deposits*, *West Berlin Transit Corridors 1949–1990*, *Hokkaido–Russian Far East: a counterfactual*, *Kyushu under Chinese Rule (fictional)*, *Pax Silica vs WAICO* (published twice), *World's 100 Largest Cities*, *BRICS and Western equivalents*, *The European Fire Line Moved North — August 2026*, *2026 Nepal–China border flash floods*, *Major Nuclear Bunkers*, *The Hippie Trail*.

Every Story references one or two of those maps. Sizes run 20–350 KB. Almost no map carries a `t` tag (only the seeded cable set). No user has used the `c` attach lane. Two maps were published twice with different `d` tags (Pax Silica, Rufino), which reads as "I meant to update and made a new one."

**What earthly.city looks like today, in one sentence:** one person and an AI make an explanatory thematic map and write an essay around it, on a desktop. That is a real genre and the UI should serve it well.

It is a snapshot of early usage, not a ceiling. Open attachment (other people's maps joining a shared topic), private circles, sightings, and live positions are deliberate use cases that have not had their moment yet. The redesign below designs for them explicitly rather than deducing their absence from a 32-map sample. What the sample *does* justify is ordering: make the map-and-essay path effortless first, and make belonging simple enough that the first person who wants it succeeds.

Two more things the sample shows:

- The relay is an open firehose. Kind 1 notes from a dozen other clients, `nym-vouches` app data, and 481 distinct pubkeys reacting in the last day. This pollutes "recent", search, and disk (see the 2026-06 disk-full incident).
- Names live inside 300 KB content blobs. To print a list of map titles, a client has to download and parse every FeatureCollection. Stories have no `title` tag either.

---

## Part 2 — Diagnosis: five confusions with one root

### 2.1 Container confusion
Local draft, workspace, edit state, conversation, Map Stack entry, Inspector subject. Six nouns for "the thing I am working on or looking at." A person wants one: *this map*.

### 2.2 Where-it-goes confusion
The destination pill folds three orthogonal ideas into one label:

- **Audience** — who can read it (everyone, a private circle, a nearby session)
- **Belonging** — what it is filed under (a context / group / topic)
- **Filter** — what I am currently browsing (the browse scope)

`Public · Unattached` is audience plus belonging, and it silently changes with the route. Each of the three ideas has a natural home elsewhere, and none of them belongs in a permanent pill.

### 2.3 Context confusion
"Context" means, in this codebase, at least: the Group/Topic entity (kind 37518), a browse scope, a `c` attachment on a dataset, the AI's request context (`ctx(model)`), and React context. The word is unrecoverable as a user-facing term. The entity behind it is sound: a place that maps can belong to, with a curated lane (the owner pins: `a`) and an open lane (others attach: `c`, gated by a door policy). The confusion is not the two lanes. It is that *belonging* got fused into the destination pill and into a browse scope, so "which topic this map is filed under" and "who can read this" and "what am I looking at" all changed together when the route changed.

### 2.4 AI target confusion
The chat is a peer of the map rather than a property of it. A free-floating conversation has to be *bound* to an edit. This is why "New map / Use current edit" exists, why the BindingChip exists, and why the user asks "how do I assign what the AI edits?" The answer should be: you don't; you open a map and talk to it.

### 2.5 Mode confusion
Stance (browse/focus/author), view mode, sidebar view, mobile tab, Inspector subject, and Map Stack visibility are six parallel state machines that each partially answer "what is the app doing right now." Every transition has to be reconciled against the other five, which is why `GeoEditorView.tsx` is 5,600 lines.

### The root
All five come from the same decision: **Earthly was built as a workbench of panels around a map, and every capability got its own panel, noun, and route.** The alternative is to build it as *a map with a margin*: one canvas, one panel that always shows exactly one object, and one conversation that belongs to that object.

---

## Part 3 — The redesign: a map with a margin

### 3.1 Three surfaces, six nouns, two verbs

**Surfaces**

- **Canvas.** The map. Full bleed on every device.
- **Margin.** One panel. It shows exactly one object at a time: a Map, a Story, a Place, a Person, or the Shelf. Its back button is browser back. On desktop it is a 380px column; on mobile it is a bottom sheet with three detents (peek, half, full).
- **Thread.** The conversation that belongs to the Map currently in the Margin. It is a tab of the Margin, not a separate panel. On desktop it may be pulled out to the right side as a second column; that is layout, not a different object.

**Nouns (user-facing vocabulary, everything else is internal)**

| Noun | Kind | What a person understands |
| --- | --- | --- |
| **Map** | 37515 | Features you drew, imported, or generated. Has a title, a thumbnail, topics, and its own Thread. |
| **Story** | 37520 | Writing that puts maps together. Prose first; the maps it references come along. |
| **Atlas** | 37518 | A place maps belong to. The owner pins maps and sets a door policy; anyone may add their own map to an open atlas. This is today's Group/Context, renamed and given one home. |
| **Sighting** | 37522 | Something seen at a place and time. The mobile "+" button. |
| **Live** | 37521 | An action ("share my live location"), not a navigation destination. |
| **Circle** | MLS private group | An *audience*. Appears only inside the "Who can see this" control, never as a place you go. |

Story and Atlas are deliberately two nouns. A Story is *writing* that pulls maps in. An Atlas is a *place* that maps push themselves into. People understand "I wrote about these maps" and "my map belongs in that atlas" as different acts, and the wire already models them as `a` versus `c`.

Gone as user-facing nouns: Context, Group, Workspace, Edit state, Conversation, Map Stack, Inspector, Stance, Destination, Field session (renamed to "Nearby", also an audience), Posts/Shoutbox (deferred, see Part 6).

**Verbs**

- **Open** — put an object in the Margin and its geometry on the Canvas. Read-only.
- **Edit** — turn the Map in the Margin into your working copy (or a fork, if it isn't yours). Exactly one Map can be in Edit at a time. It wears a pencil.

That is the whole mode system. There is no browse/focus/author. The URL is the object. `/map/naddr` is Open; `/map/naddr/edit` is Edit; `?on=` lists what else is on the Shelf.

### 3.2 The Shelf replaces the Map Stack

The Map Stack panel becomes a **chip strip** along the bottom of the Canvas (top on mobile, under the search field). One chip per Map currently drawn. Tap a chip to Open it in the Margin; the eye toggles visibility; × removes it. The chip wearing the pencil is the Map being edited. Sightings and Live collapse into a single **Live** chip that is off by default and shows a count when something is nearby or recent.

Opening a Story or an Atlas fills the Shelf with its maps. "Save this view" turns the current Shelf into a personal Atlas, which is how a view becomes shareable without a new object type.

### 3.3 Where-it-goes, split into three places

- **Audience** lives on the **Publish button**, as a split button: `Publish to Everyone ▾` → Everyone / Circle: Alpine rescue / Nearby: Saturday survey. It is stored on the working copy. Changing it is explicit and per-map. There is no global pill.
- **Belonging** lives in the Map's details, in one field called **Belongs to**: zero or more Atlases (written as `c` tags on publish), plus **Topics** (`t` hashtags and controlled `l` labels). Underneath, read-only, **Appears in** lists the Stories that reference the Map. Belonging is a property of the Map, edited where the Map is edited, and never shown as a global state.
- **Filter** lives in the **Search field**, as a removable chip: `Browsing in Roman ruins`, `#submarine-cables`, or `near Vienna`. It only ever affects lists. It never affects the Canvas or what will be published.

### 3.3a Atlases: the open-attach lane, given one home

The lane stays exactly as specified (`SPEC.md §3.3`). What changes is that it has one place in the UI and one vocabulary.

- **An Atlas is a page.** Opening it puts it in the Margin like a Story: description, owner, door policy, then two lists: **Pinned** (the `a` lane) and **Added by others** (the `c` lane, filtered by the door policy). "Show all on map" fills the Shelf. Being in an Atlas sets the Search filter chip, nothing else.
- **Door policy is a sentence, not an enum.** `open · schema · closed` becomes "Who can add maps here: *Anyone* / *Anyone, if the map fits the schema* / *Only me*." The schema builder stays behind the middle option. Chips like `TAXONOMY NONE OPEN` disappear.
- **Adding is done from either side, always explicitly.** From a Map: **Belongs to → Add to atlas…** (picker; if the Map is already published, this is a **Publish update**). From an Atlas: **Add a map** → *one of my maps* or *new map in this atlas*, which opens a working copy with Belongs to pre-filled. The route suggests belonging for a *new* working copy only; it never rewrites an existing one. That is the `CONTEXT.md` rule, kept.
- **Fit is shown on the Map, where the author can act on it.** Each Belongs-to chip carries a state: `In Roman ruins ✓`, `Roman ruins · doesn't fit: missing "period"`, or `Roman ruins · closed, ask the owner`. Validation stays advisory unless the atlas says otherwise, as today.
- **Accepting is pinning.** In a closed or schema atlas, the owner accepts a foreign map by pinning it. The `a` lane already expresses approval; no new status kind is needed. The owner sees a **Waiting** list of maps that carry the `c` tag but are not yet pinned.
- **The owner's AI works on the Atlas.** Open the Atlas, open its Thread. Because an Atlas has no geometry, this Thread is a concierge over the collection: "which maps lack descriptions", "translate the Arabic names across the pinned maps". It opens the owner's own maps in Edit one at a time, and for other people's maps it drafts **proposals** (kind 37519) that appear as ghosts to the original author. This is the "curator cleans up a convoluted context" story from `PROJECT.md`, with visible scope at every step.

### 3.3b The Atlas lens: one atlas as the whole app

Niche communities do not want "a mapping app that also has skate spots." They want *the skate-spot app*. The Atlas is how Earthly gives them one without forking the product.

**Enter** an Atlas and it becomes a lens over everything:

- **Lists show only this atlas.** Browse tabs become *Spots · Stories · People* (the atlas supplies the noun). Search is scoped the same way; its placeholder says so.
- **New maps belong here.** The + button reads "New spot map in Global skate spots." The working copy opens with Belongs to pre-filled and visible, still removable. Existing drafts are never retargeted, which keeps the rule that made the old destination pill safe.
- **The schema becomes a form.** An atlas with a schema gives every map inside it a Properties section: *Surface: marble · Type: plaza*. Fit-state chips and the Waiting list follow from the same fields, so "doesn't fit" always names the missing field.
- **The Shelf loads the atlas.** Entering frames all of its maps; the Live chip and the rest of the canvas are unchanged.
- **The Thread knows where it is.** Prompt suggestions and the model's context carry the atlas and its schema: "add a spot at the next plaza east of here."
- **It is visibly a mode, and one tap to leave.** A lens bar under the top bar names the atlas, states the rule ("Lists show only this atlas. New spots belong here."), and offers *About*, *Share app link*, and *Leave*. On a phone the bar sits under the search field. The atlas may set an accent colour and an emblem, so the app is lightly skinned while you are inside. Nothing else changes.
- **The lens is a URL.** `/in/global-skate-spots` enters it. A community can hand that link around as *their app*; it opens on the atlas's own list with the atlas's own + button.

What the lens deliberately does *not* do: it never changes the audience (who can read a map), never hides what you already have on the Shelf, and never silently edits belonging on anything you did not create inside it.

### 3.4 The editing model: every Map has one working copy

- Open a published Map → you read it.
- Press **Edit** → if it's yours, Earthly creates (or resumes) *your working copy*. If it isn't yours, the button says **Fork** and the working copy is a new Map with lineage to the original.
- The working copy persists on the device. Navigating away does not lose it. The one list for unfinished work is **Drafts** (under the account menu and as a badge on the Shelf chip). There are no scratch workspaces and no retained edit states as concepts; there are Maps that have a working copy and Maps that don't.
- **Publish** on a working copy of your own Map defaults to **Publish update** (same `d`, new version). **Publish as new map** is a secondary item in the menu. This fixes the double-publish pattern seen in the relay sample.
- Only one Map is in Edit at a time. Pressing Edit on a second Map asks: "Finish with *Hippie Trail* first? Keep draft / Discard / Cancel." Its draft is kept by default.

### 3.4a Reactions, comments, favourites, sharing: where they live

- **On the object, in one row.** Under the title of any Map, Story, Atlas or Sighting sits one social row: ♥ react · ⚡ zap · 💬 comments · ★ favourite · ↗ share · ⋯ more. It is the same row everywhere. Counts are mono digits next to the icons.
- **In lists, as counts first and actions on hover.** A list row shows `♥ 4 · 💬 3 · ⚡ 2` under its meta line. Hovering (or focusing) the row reveals ♥ 💬 ☆; a ⋯ menu holds Share, Zap, Show on map, Edit or Propose or Fork, Delete or Report. On a phone there is no hover, so rows keep only the primary action and ⋯.
- **One + per list.** The Browse tabs carry a single + at their right end that creates whatever the active tab shows. No row of four buttons; the header is one compact line: where you are, what is on the map, glass toggle.
- **Comments are a tab, not a section.** Details · Comments · Thread. Comments are NIP-22 replies, threaded one level, sortable by newest or most liked, with a composer at the bottom that stays put.
- **A comment can point at a place.** *Attach a place ▾* → drop a pin, draw a line, or use the selected feature. The geometry renders in the comment colour (green) on the canvas while the Comments tab is open; hovering a comment highlights its geometry and ⌖ flies to it. This is today's comment-with-annotation flow, kept, and it needs no Edit state because a comment never changes the map.

### 3.4b Proposing instead of forking

When you want the original author to adopt your changes:

- On a Map or Story you don't own, the primary button is **Propose changes** (Fork sits behind its ▾). Propose opens a working copy in a distinct *proposing to Aria Voss* state: their map stays grey, your additions and edits are dashed amber ghosts, and the toolbar and Thread work as usual ("Propose & send").
- **Send proposal** replaces Publish. A short message goes with it. The result is a kind 37519 event: a diff plus the message, addressed to the author.
- **The author sees it under Proposals** on their Map's Details, with the proposer's name, message, and `+a ~m −r` counts. *Preview on map* shows the ghosts on their own map. **Accept & publish** merges the changes into their next version and credits the proposer; **Decline** leaves the proposer's copy untouched; **Discuss** jumps to Comments.
- **The proposer sees status** on the same Map: pending, accepted (with the version it landed in), or declined. They can withdraw while pending. A kept proposal draft appears in Drafts labelled as a proposal.
- Rows in Browse show `✎ 1 proposal` in amber on your own maps that have something waiting.

### 3.5 The AI model: the Thread lives in the Map's margin

This is the answer to "how does the user assign what the AI edits" and "how do they know what is being edited."

- **There is no unbound chat.** The Thread is a tab in the Margin of the Map that is Open. Its header is the Map's title plus its state: `Hippie Trail · editing` or `Hippie Trail · read-only`. If the Map is read-only, the composer's send button reads **Edit & send** and puts the Map into Edit before the first tool call; if it isn't yours, **Fork & send**. That is the entire binding step, and it happens in the same gesture as sending.
- **A global Ask exists, but it is a concierge.** With no Map open, the search field accepts a question. The answer is read-only (find, measure, explain, geocode). Its only write affordance is a button: **Start a map from this**. That creates a new Map, opens it in Edit, and moves the conversation into its Thread.
- **Scope is selection.** The AI's writes go to the Map in Edit, period. If features are selected, the composer shows a scope chip: `12 features selected ×`. The model receives the selection; the user sees the scope; clearing the chip widens it back to the whole Map. Nothing else in the app changes what the AI may touch.
- **References are drag-in, read-only.** Other Maps and Stories can be dragged from the Shelf or Search into the composer as reference chips. The spec already says references never grant edit rights. Keep that.
- **Changes are shown on the Canvas, not described in the transcript.** AI-proposed geometry renders as ghosted, dashed, amber features. A diff bar sits on the Canvas: `+80 · ~3 · −0 · Apply · Discard · Show only changes`. Accepting is a Canvas gesture. The transcript shows one collapsed line per operation ("Drew 8 corridors and 72 nodes"). Reasoning, tool calls, token counts, and `ctx(model)` move to a **Details** drawer that is closed by default and remembered per user.
- **Three geometry states, one rule.** On the Canvas, geometry is either *published* (solid, muted), *your working copy* (solid, saturated; its chip wears the pencil), or *proposed* (dashed amber ghost). Every feature belongs to a chip on the Shelf; hover a feature and its chip lights up. The chip with the pencil is what's being edited. That one rule replaces the BindingChip, the destination pill, the stance label, and the "which draft is active" navigator.
- **One run at a time, shown where it happens.** The pencil chip pulses while the AI works. Navigating to another Map does not cancel the run; the pulsing chip is how you find your way back.

### 3.6 Desktop layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Search maps, stories, places, people…      ]        [Drafts 2] [Me] │
├────────────────────┬─────────────────────────────────────────────────┤
│ MARGIN             │  CANVAS                                         │
│ ◂ back             │                    [tool pill: ● ╱ ⬠ T  ↶ ↷ ⋯]  │
│ ┌ Map · Story ──┐  │                    (only while a Map is in Edit) │
│ │ Hippie Trail  │  │                                                 │
│ │ by Schlaus    │  │                                                 │
│ │ Edit ▾  Share │  │                                                 │
│ └───────────────┘  │                                                 │
│ [Details] [Thread] │                                                 │
│  …                 │   ┌ diff bar (only while a proposal is pending) │
│                    │   │ +80 · ~3 · −0   Apply   Discard   Changes   │
│                    ├─────────────────────────────────────────────────┤
│                    │ SHELF  [✎ Hippie Trail] [BRI ●] [Cables ○] [Live] │
└────────────────────┴─────────────────────────────────────────────────┘
```

Everything that used to be a rail icon (settings, wallet, delivery/outbox, help, circles, nearby sessions, profile) lives under **Me**. The drawing toolbar exists only while a Map is in Edit. The 12-icon rail, the stance tab, the destination pill, the File menu, and the floating Map Stack are gone.

### 3.7 Mobile layout

```
┌──────────────────────────────┐
│ [Search…]        (Live 3)    │
│ SHELF [✎ Hippie Trail] [BRI] │
│                              │
│           CANVAS             │
│                              │
│                              │
│ ┌──────── sheet ──────────┐  │  ← peek detent: title + Edit/Done
│ │ Hippie Trail · read-only│  │
│ │ [Details] [Thread]      │  │
│ └─────────────────────────┘  │
│  Map     Search    +     Me  │
└──────────────────────────────┘
```

Four destinations. **+** opens a chooser: *Sighting here*, *Share live location*, *New map* (pin-only editing), *Import file*. Editing on mobile is deliberately shallow: add and move points, edit properties, and the Thread. Lines and polygons can be drawn but not vertex-edited. That is a product statement, not a limitation to apologise for; see Part 5.

**Editing on a phone is its own composition.** When a Map enters Edit on a phone, the shell changes rather than shrinking:

- The bottom nav is replaced by an **edit dock** at the thumb: Point · Line · Area · Label, then Undo, More, Ask, and a prominent **Done**. While drawing, the dock becomes *Finish · Undo point · Cancel*.
- The sheet collapses to a one-line **peek**: pencil, title, feature count, and Publish. Pull it up for Details, Comments, or the Thread.
- The search field and Shelf chips give way to a **status line**: the map's name, a hint for the current tool ("Tap the map to add a point", "Tap corners, then Finish"), and an **Exit** button.
- Tapping a feature raises a **contextual strip** above the dock: *N selected · Move · Rename · Delete*. Move means "tap where it should go".
- Nothing locks you in. Done and Exit both keep the draft and restore the nav; Escape-equivalents (× on the strip, Cancel on the dock) leave the tool without leaving Edit.

### 3.8 First run and discovery

The culture is "someone shared a story with me." The landing for an anonymous visitor should therefore be a **gallery of Story and Map thumbnails**, not a dialog over an empty map. That needs an `image` tag on Maps and Stories (Part 4). Opening a Story puts its prose in the Margin and its Maps on the Shelf, exactly as today.

---

## Part 4 — The protocol half

The Nostr developer's constraint: change the spec only where the UI above cannot be built honestly without it, and prefer existing NIPs over Earthly kinds so other clients can participate.

### 4.1 Give Maps and Stories tag-level metadata
Add to 37515 and 37520: `["title", …]`, `["summary", …]`, `["image", <blossom url>]`, `["published_at", …]` (NIP-23 conventions). Add to 37515: `["features", "<count>"]`, `["size", "<bytes>"]`. Clients can then render lists, cards, OG previews, and the landing gallery without fetching 300 KB blobs. The publisher renders a static PNG thumbnail on publish and uploads it to Blossom. This is the single highest-leverage change for discovery on both desktop and mobile.

### 4.2 Keep 37518 and both lanes; rename, and make the states legible on the wire
- Kind 37518 stays as the Atlas. The `a` pinned lane, the `c` attach lane, and the `governance` ladder are unchanged. The one event in the wild is legacy-shaped and already skipped by the v2 gate.
- Give the Atlas the same tag-level metadata as Maps and Stories (`title`, `summary`, `image`, `bbox` is already there) so atlas cards and the landing gallery render without parsing content.
- **Acceptance is expressed by pinning.** A foreign map that carries `c` and is also present in the owner's `a` lane is *accepted*. Clients can compute the Waiting list (`c` present, `a` absent) without a new kind. Write this down in §3.3 so other clients agree.
- **Fit results stay client-side.** Schema validation remains a validate-on-fetch computation; do not publish validation verdicts as events. The state chips in §3.3a are derived.
- **"Save this view" writes a personal Atlas.** No NIP-51 set kind is needed; an Atlas with only pins and no door policy beyond "Only me" is the shareable Shelf.
- Freeform `t` and controlled `L`/`l` keep their roles from §7 and are what a Topic search page runs on; they do not replace `c`.

### 4.3 Comments move to NIP-22 kind 1111
`SPEC.md §2` already uses NIP-22 threading tags on kind 37517. The relay already holds 500 kind-1111 comments from other clients. Adopting kind 1111 with `K=37515` / `K=37520` lets any Nostr client that understands NIP-22 read and reply to Earthly comments. Reactions stay kind 7. Zaps stay 9735. The custom kind buys nothing and costs interoperability.

### 4.4 Lineage and updates
Keep 37515 addressable. Make **Publish update** the default so `d` is reused, and keep `v` plus a previous-version `e` pointer (`SPEC.md §15`). Fork writes a new `d` with `["fork", "<a-coordinate>"]` (or reuse the `a` pointer with a `fork` marker) so the original author sees forks in "Appears in".

### 4.5 Honest provenance
The culture is AI-made maps. Say so on the wire: `["l", "ai-assisted", "earthly"]` under the existing `L earthly` namespace, set automatically when a Thread contributed geometry. Readers can filter for or against it; the app can render a small "made with help" mark. Optionally the Story gets a "How this was made" section generated from the Thread (prompts and sources), published only on explicit user action, never automatically.

### 4.6 Relay hygiene as a UX feature
`relay.earthly.city` should accept: profiles (0), Earthly kinds (37515, 37519, 37520, 37521, 37522, 3000x shelves), comments/reactions/zaps that reference an Earthly event, and relay-list/NIP-65 metadata. Everything else is rejected at write time. This fixes discovery quality, search relevance, "recent" lists, and the disk. It is the cheapest change in this document and should ship first.

### 4.7 Sightings, Live, Circles, Nearby: unchanged on the wire
37521 and 37522 are fine as specified. MLS circles and field sessions keep their transport. The only change is presentation: they become audiences and actions, not destinations.

---

## Part 5 — Native Android or reconceived mobile shell?

**Recommendation: do not build a native Android app now. Re-conceive the mobile shell instead, inside the existing Tauri build.**

Why:

1. **The mobile job is different from the desktop job, not smaller.** The relay sample shows authoring is a desktop activity. On a phone people will *read* a shared Story, *drop* a Sighting, *share* a live position, *look at* a saved region on a hike, and *join* a nearby session. None of those needs vertex editing. A responsive collapse of the desktop workbench (18 tabs, sheet with Stack/Edit/Chat) is the wrong shape for those jobs; a native rewrite of that same shape would be the wrong shape in Kotlin.
2. **A native app forks four runtimes.** The GeoEditor, the applesauce Nostr runtime, the MLS private-workspace runtime, and the AI tool loop with its QuickJS sandbox would all need Android twins, and the safety gates around AI mutation would have to be re-proven. That is the entire project's risk surface, duplicated.
3. **The things native buys are already reachable through Tauri plugins.** Background location for Live, foreground service for LAN sharing (already built), deep links (built), durable outbox in SQLite (built), saved regions (built). The remaining gap is WebView rendering performance of MapLibre on low-end devices and gesture fidelity. Measure that on a target device before deciding; it is a benchmark, not a belief.
4. **Seven authors.** A second client is a maintenance commitment that the current community cannot yet justify.

What to do instead:

- Build the mobile shell in Part 3.7 as a *separate composition root* (`MobileShell.tsx`) that reuses the same stores, editor, and Thread, but does not try to be the desktop layout at 390px. Four destinations, one sheet, a shallow editing surface.
- Make **Sighting** and **Live** first-class on mobile: the + button, camera attach, "here" as default location, one-tap share.
- Treat offline regions and Nearby as the mobile-only depth, since they already exist and the desktop has no equivalent.
- Set explicit triggers to revisit native: sustained mobile authors per week above a number the team picks; a measured MapLibre frame budget miss on the reference device; or a required OS capability Tauri cannot reach.

---

## Part 6 — Keep, kill, order

### Keep (these are good and deep)
- `GeoEditor` core and managers; the `Authoring` facade; the tool registry and safety gates; the QuickJS sandbox; the applesauce Nostr runtime and relay router; the Go relay with NIP-50 geo grammar; the MLS runtime; the Tauri outbox, saved regions, local node, and pairing flow; `SHARE_ROUTES` dispatch; NIP-40 expiry; the `L`/`l` · `t` tag discipline in `tags.ts`.
- The *rules* in `CONTEXT.md` about never auto-retargeting or auto-publishing. They survive; only the objects they protect get fewer.

### Kill or merge (user-facing)
| Today | Becomes |
| --- | --- |
| stance + viewMode + sidebarView + mobileTab | One router: `/{map,story,sighting,place,person}/{id}[/edit]?on=…` |
| Destination pill | Audience on the Publish split button, per working copy |
| Context browse scope | Filter chip in Search, lists only |
| Context attachment (`c`) in the destination pill | **Belongs to** field on the Map, with fit-state chips; `c` tags unchanged |
| Map Stack panel | Shelf chip strip; Live chip |
| Inspector + entity panels + Workspace/Draft navigator | The Margin, one object; Drafts under Me |
| Chat panel as a peer + BindingChip + New map / Use current edit | Thread tab in the Margin; Edit & send / Fork & send; selection scope chip |
| 12-icon rail, File menu, floating toolbar in view mode | Search, Me, tool pill only while in Edit |
| Contexts / Groups list and editor, `TAXONOMY NONE OPEN` chips | Atlas page in the Margin: Pinned, Added by others, Waiting; door policy as a sentence |
| Custom comment kind 37517 | NIP-22 kind 1111 |
| Posts / Shoutbox | Deferred until there is an audience; a Topic page for a city is the same thing |

### Order
0. **Week 1, no UI change:** relay write policy (4.6); `title` / `summary` / `image` / `features` / `size` tags written on publish and read in lists (4.1); rename user-facing "Context" to "Atlas" and drop the raw `TAXONOMY NONE OPEN` chips for the door-policy sentence. Measure MapLibre on the reference Android device.
1. **The Margin.** Replace AppSidebar, the Inspector, the entity panels, and the chat column with one Margin showing one object, with Details and Thread tabs. Keep the old routes working via `SHARE_ROUTES`.
2. **Working copy + Publish control.** Collapse draft / workspace / edit state into "this Map has a working copy." Publish split button with audience. Publish update as default.
3. **Thread-in-margin + ghost diffs.** Remove BindingChip and the binding modal; Edit & send / Fork & send; selection scope chip; Canvas diff bar; Details drawer for tool chatter.
4. **Shelf.** Chip strip replaces the Map Stack panel; Live chip replaces the two aggregate layers.
5. **Mobile shell.** Separate composition root, four destinations, sheet detents, + chooser.
6. **Atlas page + Belongs to.** Rename 37518 to Atlas in the UI; Atlas page in the Margin with Pinned / Added by others / Waiting; Belongs to field with fit-state chips; accept-by-pin; door policy as a sentence. Comments to 1111 and the provenance label ride along as the spec v2.1 additions (no clean break needed: nothing changes shape).

Each step leaves the app shippable. Steps 1–4 are the ones that answer the questions in the brief; 5 and 6 are the ones that make Earthly a place where other people's maps can belong somewhere, and where a phone is a reason to open it.

---

## Open questions the two of them did not settle

1. Should a closed Atlas show "Waiting" maps to visitors, or only to the owner? (Discoverability of unaccepted work versus the owner's editorial control.)
2. Should the Thread ever be publishable, or is "How this was made" always a human-edited Story section?
3. Is one Map in Edit at a time too strict for the "compare two maps and merge" workflow, or does Fork-then-reference cover it?
4. Who owns the thumbnail render: the client on publish, or a server job the relay operator runs?
5. What is the reference Android device and frame budget that would flip the native decision?
