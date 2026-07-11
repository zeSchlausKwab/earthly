# Earthly UI/UX audit

Date: 2026-07-10  
Target: `http://localhost:3000`  
Viewports: desktop 1440×900, mobile 390×844

Expanded verification: 2026-07-11, using the repository-owned `ai-suite` across all 20 primary
desktop/mobile panels, five viewport sizes from 320×568 to 1440×900, and the first 35 keyboard
focus stops on desktop and mobile. No application fixes or refactors were made during this pass.

## Executive verdict

Earthly is a capable collaborative GIS/Nostr workbench, but the interface currently presents its internal concepts before it presents a clear user promise. A new user can infer that the app contains a map, datasets, social posts, live locations, editing tools, AI, a wallet, relays, and Nostr identities—but not which one thing they should do first or how those concepts fit together.

The product reads as an expert tool or development playground rather than an approachable collaborative mapping app. The strongest visual asset is the map-first canvas. The weakest part is the first-session experience: the tour is desktop-specific, jargon-heavy, and partially disconnected from the UI; once dismissed, almost no product explanation remains.

Overall score: **11/24**

| Pillar | Score | Assessment |
|---|---:|---|
| Copywriting | 2/4 | Descriptive, but too technical and inconsistent. It explains implementation terms before user outcomes. |
| Visuals | 2/4 | Coherent utilitarian system, but dominated by small icons, weak hierarchy, and developer-looking data. |
| Color | 3/4 | Amber accent and light/dark themes are consistent. Some muted small text is borderline low contrast. |
| Typography | 1/4 | Much of the desktop UI is 9–11 px; no semantic headings are rendered in the tested states. |
| Spacing | 2/4 | Efficient for experts, cramped for new users. Mobile touch targets are frequently too small. |
| Experience design | 1/4 | Onboarding, terminology, navigation labels, signed-out states, and a creation route contain serious issues. |

## What the app appears to be

A concise product explanation that matches the implemented capabilities would be:

> Earthly is a shared map workspace where people can explore community geographic data, add observations and datasets, and publish or discuss them through Nostr.

The current first-run copy instead leads with decentralization, key pairs, event kinds, PMTiles, Blossom, GeoJSON, NIP-07, NIP-46, and schema rules. Those details are valuable later, but they obscure the core loop:

1. Find something on the map.
2. Add or edit geographic information.
3. Organize it into a shared map.
4. Publish and collaborate.

## Critical findings

### P1 — Fix before broader usability testing

#### 1. The mobile onboarding tour does not teach the mobile UI

Nine of the eleven mobile tour steps had no visible target. The tour describes the desktop sidebar, toolbar, login controls, My Entities, Help panel, and AI Chat while mobile uses a bottom dock and sheet switcher. Users read instructions for controls they cannot see.

Desktop also has a missing target for the AI Chat step. The collaboration step highlights Help, which is unrelated to comments or collaboration.

Recommendation: build separate desktop and mobile tours, or replace the element-by-element tour with a responsive three-step outcome tour. Every step should require a valid visible target in automated tests.

#### 2. Creating a Dataset routes to `/beacons`

On a clean mobile session, selecting **Create → Dataset** correctly opened an Untitled draft editor but changed the URL to `/beacons`.

The likely cause is the shared `startCreate` cleanup: it calls `handleCloseBeaconControl()`, and that close handler always calls `navigateToView('beacons')` even when no beacon control is open. This makes the URL and current task disagree.

Recommendation: make close handlers idempotent and navigation-free unless their corresponding editor is actually active; add a test for every Create menu item and its resulting route/stance.

#### 3. Signed-out states are dead ends

Mobile **You → Profile** says “Sign in to view your profile” but provides no sign-in action. Desktop Wallet similarly says “Please log in to view your wallet” with no button. The tour tells mobile users to sign in using desktop sidebar controls that do not exist on mobile.

Recommendation: every signed-out state should include one primary **Sign in or create identity** button, a short explanation, and an optional “Why do I need a Nostr identity?” link.

#### 4. Tour instructions contradict the tour controls

Step 1 says “Press Done to skip,” but the first step shows Next, Back, and an unlabeled close icon—no Done button. The final step says “New Dataset in the toolbar,” although mobile creation is in the central + menu. It also tells mobile users to restart from Help “in the sidebar.”

Recommendation: use viewport-specific copy and label the close control **Skip tour**. Avoid instructions tied to a specific placement unless that placement is stable.

#### 5. Settings overflows its own panel

The desktop Settings panel contains a horizontally scrolling tab row with truncated labels, a visible bottom horizontal scrollbar, and clipped card content such as “Geo and web tools.” This makes configuration feel broken and hides options.

Recommendation: use a vertical settings navigation or two-column layout at this panel width. Content cards must wrap and never require horizontal scrolling.

The breakpoint sweep exposed a more severe version of the same defect. At 768 px—the first desktop
layout width—the active Settings tab panel is only about **94 px wide**. It reaches roughly 158 px at
1024 px and 262 px at 1440 px. The shell assigns the entire sidebar `25vw` with no useful minimum;
the navigation rail and panel chrome consume much of that allocation. At 768 px, Chat Settings grows
to roughly 2050 px tall as its content wraps through the narrow column.

#### 6. Mobile navigation state and the URL disagree

All ten mobile destinations were reachable, but every selection continued to expose `/` in the URL.
Contexts, Stories, Profile, Posts, Wallet, Settings, and Help therefore have no canonical mobile
navigation state. Reloading after selecting Contexts returned to the default surface instead of
restoring Contexts.

The direct cause is duplicated navigation architecture: desktop choices call `navigateToView`, while
`handleDockSelect` and the mobile panel's `selectPanel` only mutate `mobilePanelTab` and sheet snap
state. The visible page, browser history, analytics, bookmarks, and shareable URL can all describe
different destinations.

Recommendation: route every top-level destination through one navigation primitive on both
viewports, then derive the active mobile tab from the route. Add Back, Forward, reload, and direct-link
checks for every destination.

#### 7. Map markers bury the mobile keyboard navigation

The mobile tab order starts at the map canvas, then enters a long sequence of individual Sighting
photo-marker buttons. After **35 Tab presses**, focus still had not reached Explore or any bottom-dock
navigation. The sampled marker buttons were also positioned partly above the viewport at about
`y = -13 px`, making the focus movement difficult to perceive.

The direct cause is that every portal rendered by `EntityPinBubbles` is a native button in document
order before the dock. A data-rich map can therefore add dozens or hundreds of focus stops ahead of
the primary navigation.

Recommendation: put a skip link and primary navigation before map entities, expose map results
through a managed list or roving-tabindex pattern, and keep only the currently selected marker in the
ordinary tab order.

### P2 — High-value comprehension and consistency fixes

#### 8. The product vocabulary is inconsistent

- Desktop and navigation use **Stories**; mobile Create uses **Article**.
- Desktop uses **My Entities**; mobile uses **Profile** and **You**.
- Desktop uses **City Posts**; mobile uses **Posts**.
- The tour says **New Dataset**; the editor opens an **Untitled draft**.
- The UI uses **Map Stack**, while most users will expect **Layers**.

Recommendation: publish a small terminology contract and use one label per concept. Suggested user-facing vocabulary:

| Current terms | Suggested term |
|---|---|
| Story / Article | Story |
| My Entities / Workspace | Your work |
| Map Stack | Map layers |
| Map Context | Community map, with “Context” as an advanced/technical term |
| City Posts / Posts | Local posts |

#### 9. Mobile destination labels do not match their content

**Activity** opens Beacons, not an activity feed. **Map** is implemented as the Sightings sheet destination rather than a pure map state. **Explore** defaults to Datasets even though the switcher’s Explore group contains Sightings, Beacons, and Stories while Datasets sits under Workspace.

Recommendation: align label and destination. If Activity is specifically live location, call it **Live**. Tapping Map should collapse the sheet and give the map ownership of the screen.

#### 10. Populated lists still look empty or synthetic

The Datasets list leads with names such as `H7CunzX6je9aCRia3AZ7j`; Context rows repeatedly truncate to “Vienn a…”. This prevents scanning and makes the app look like seed data or hashes rather than meaningful maps.

Recommendation: require or derive human-readable display names. Show opaque identifiers only as secondary metadata. Give cards a useful one-line description, geographic extent, feature count, and author.

#### 11. Controls are too small and too numerous

On the initial mobile screen, 15 of 20 interactive targets were below 44×44 px. Across the expanded
panel sweep, each mobile destination exposed between 17 and 59 undersized controls, depending on list
density. Map controls are 32×32; list actions and New actions are often 24×24. The desktop Datasets
surface exposed 272 visible controls in the DOM, with Contexts, Stories, and Sightings each above 220.

Recommendation: use at least 44×44 mobile hit areas even when the icon stays 20–24 px. Move advanced map controls (3D, globe, fullscreen, popup modes, theme) into a More menu. Keep search, location, layers, and one creation action immediately visible.

#### 12. Typography and accessibility hierarchy are weak

The desktop initial view contained 50 visible text fragments below 12 px and 66 below 14 px. Muted
10–12 px labels measured around 4.46:1 contrast, just below the 4.5:1 normal-text target. Datasets,
Contexts, Stories, Sightings, Beacons, Profile, Posts, and Wallet exposed no semantic heading on either
viewport. Settings begins at `h3`; Help begins at `h4`.

The expanded scan also identified repeated unnamed compact Zap buttons in Dataset, Context, Story,
and Sighting rows, plus an unnamed refresh button in Posts. Disabled controls still need an accessible
name: their disabled state does not make them irrelevant to screen-reader users.

Recommendation: set 12 px as a hard minimum for secondary desktop metadata and 14 px for mobile body/UI text; add semantic headings to panels; label every icon action, including disabled actions; audit keyboard focus and screen-reader order.

#### 13. The desktop hierarchy is an “icon wall”

The main screen simultaneously exposes a left icon rail, context filter, identity controls, entity list, per-row social actions, Map Stack, top toolbar, map controls, footer telemetry, and hidden/off-canvas AI Chat. Almost every affordance has similar visual weight.

Recommendation: use progressive disclosure. Keep a clear primary level—Browse, Map layers, Create, Account—and move specialist operations into contextual menus or an advanced mode. Preserve the compact expert layout as an optional density setting.

#### 14. Empty states explain the absence but not the next step

Beacons has a useful **Share live location** CTA, but Profile, Wallet, and City Posts do not consistently offer the action needed to resolve the empty state. City Posts says “Be the first to post!” without a visible create action.

Recommendation: standardize empty states as: title, one-sentence explanation, primary action, optional secondary help link.

#### 15. Posts contains contradictory and hidden navigation copy

The default Announcements category deliberately hides the post form for non-developers, yet its empty
state says **“No posts yet. Be the first to post!”** The promised action is impossible on that tab.
On mobile, the descriptive tab labels are hidden at the `sm` breakpoint, leaving only `📢`, `✨`, `👋`,
and `🐛`; users must guess that these mean Announcements, Feature Requests, Greetings, and Bug Reports.

Recommendation: give Announcements a read-only empty state, keep category names visible on mobile,
and give the refresh icon an accessible name. Empty-state copy should be derived from the permissions
and actions actually available in that category.

## Recommended first-session redesign

Replace the current 11-step mandatory-feeling tour with a small welcome card over the map:

**Explore and build shared maps**  
Browse community map data, add observations or datasets, and publish when you are ready.

- **Explore nearby** — opens a useful scoped view with real named content.
- **Add something to the map** — starts a guided choice between Sighting, Dataset, and Story.
- **How Earthly and Nostr work** — optional explanation of identity, decentralization, and publishing.

After the user chooses an outcome, teach only the next control in context. Introduce Nostr identity at the first action that actually requires signing, not before map exploration.

## Suggested navigation model

Desktop:

- **Explore:** Sightings, Live, Stories, Datasets, Community maps
- **Map layers:** everything currently in Map Stack
- **Create:** Sighting, Dataset, Story, Community map, Live beacon
- **Community:** Local posts, comments, proposals
- **You:** Sign in, Your work, Wallet, Settings
- **Help:** About Earthly, shortcuts, replay onboarding

Mobile bottom dock:

- **Map** — always collapses the sheet
- **Explore** — searchable entity browser
- **Create** — outcome-oriented create menu
- **Live** — beacons/live location
- **You** — sign in and personal workspace

## What is already working well

- The map-first layout is appropriate for the product.
- Light and dark themes are visually consistent.
- The amber accent gives selected and primary actions a recognizable identity.
- The mobile sheet and central Create control are strong structural choices.
- The Beacons empty state demonstrates the right pattern: explain the state and provide a direct action.
- Repeated browser-health sweeps found no page exceptions, failed HTTP requests, error responses,
  horizontal document overflow, or basic theme-switching failures. Some mobile sweeps intermittently
  logged a 503 WebSocket handshake from the public Damus relay. The app remained functional, so this
  is recorded as an external-dependency/resilience observation rather than a confirmed Earthly defect.

## Prioritized implementation order

1. Fix Create routing and make editor close handlers navigation-safe.
2. Route mobile destinations through the same canonical router as desktop.
3. Replace or split the tour by viewport; repair all targets and contradictory copy.
4. Repair mobile keyboard order so primary navigation precedes map entities.
5. Add sign-in/create-identity CTAs to every signed-out state.
6. Fix the 768–1024 px desktop shell and Settings panel width.
7. Standardize terminology and rename Activity to Live if it remains beacon-specific.
8. Correct Posts permissions copy, visible mobile tab labels, and refresh labeling.
9. Establish human-readable entity names and richer list summaries.
10. Reduce control density and enlarge mobile hit areas.
11. Raise minimum type sizes, add headings/labels, and run a full accessibility pass.
12. Add a persistent, concise product explanation in Help/About and a lightweight first-session welcome card.

## Test coverage performed

Final automated outcome: the regular group completed **32 project/scenario combinations** with 10
ordinary passes, 14 expected-failure reproductions, and 8 intentional viewport skips. The audit group
completed 5 evidence sweeps with 1 intentional viewport skip. There were no unexpected failures or
unexpected passes.

- First-run tour: all 11 steps on desktop and mobile
- Post-tour desktop navigation: Datasets, Contexts, Stories, Sightings, Beacons, My Entities, City Posts, Wallet, Settings, Help
- Post-tour mobile navigation: Map, Explore, Create, Activity, You, panel switcher
- Clean mobile Create → Dataset flow
- Light/dark theme switch
- Console errors and failed network requests
- Horizontal overflow, semantic headings, accessible labels, text size/contrast sampling, and touch target sizes
- Canonical route behavior for all ten primary destinations on both viewports
- First 35 keyboard focus stops on desktop and mobile
- Responsive Settings/layout sweep at 320, 390, 768, 1024, and 1440 px widths
- Browser console, uncaught exception, failed-request, and HTTP error monitoring across the panel sweep
- Narrow expected-failure reproductions for each verified routing, focus-order, labeling, and copy defect
- Seeded NIP-07 sign-in through the real UI control and fresh local identity creation

Not covered: authenticated publishing, wallet transactions, a genuine third-party browser extension
(the suite uses a deterministic local NIP-07 adapter), remote signer login, live GPS permission flow,
destructive actions, or AI message submission.
