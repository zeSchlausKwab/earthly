# Changelog

## [0.0.8] - 2026-07-27

- Fixed successful Lightning zap dialogs disappearing before users could see confirmation.
- Added Nostr Wallet Connect wallets with pasted or camera-scanned NIP-47 connection QR codes and
  direct payment of zap invoices from Earthly.
- Added direct NIP-61 nutzaps from compatible NIP-60 Cashu wallets when recipients advertise a
  supported mint and nutzap key.
- Restored immediate like and unlike feedback across Contexts, Datasets, Stories, Sightings,
  Private groups, Live Beacons, comments, and shoutbox posts.

## [0.0.7] - 2026-07-26

- Fixed remembered Nostr identities being lost when Android stopped and cold-started the app by
  adding an app-private durable account-session mirror that restores before the interface mounts.
- Made login, logout, account switching, and account removal wait for native session persistence
  while keeping “Stay logged in” disabled accounts memory-only.
- Redesigned the Connect to Nostr dialog with a wider desktop layout, more generous spacing,
  responsive mobile choices, safe text wrapping, and bounded scrolling on short screens.

## [0.0.6] - 2026-07-25

- Fixed Private-group join-request checks so they no longer wait behind background message sync,
  keep unrelated controls usable, and show clear progress, empty-result, and error feedback.
- Improved AI-generated maps with semantic icons for imported places, quieter travel-time overlays,
  and stronger guidance for readable labels and points of interest.
- Expanded the product tour with a manually drafted Beira cyclone-response map and an AI-assisted
  Porto home-search map.

## [0.0.5] - 2026-07-24

- Added a guided product tour with real desktop and mobile films for map authoring, private
  collaboration, AI-assisted research, offline drawing, public proposals, and map-backed Stories.
- Added native app download paths throughout the tour and every web-only capability gate, including
  Field sessions, saved regions, the embedded local node, and durable delivery.
- Added an Apple-silicon macOS DMG preview to the GitHub release alongside the signed Android
  artifacts.
- Added multi-step rectangle, circle, triangle, and arrow drawing; visible scaling controls;
  larger line arrowheads; centered line labels; and correctly rendered dashed lines.
- Added deletion flows for Private groups and Field sessions, plus clearer chat configuration and
  compact model, provider, tool, and token details.
- Improved AI-generated maps, geographic research fallbacks, and Overpass query handling.

## [0.0.4] - 2026-07-21

- Replaced the unreliable third-party web-search dependency with federated Wikipedia, Wikidata,
  and Earthly-hosted SearXNG search that retains useful partial results during provider outages.
- Added full-text Wikipedia research alongside exact-title and nearby-article lookup.
- Hardened AI URL reading against local-network access, unsafe redirects, oversized responses, and
  abusive concurrent traffic.
- Updated the generated ContextVM client and removed a first-call connection race that could cause
  intermittent MCP timeouts.

## [0.0.3] - 2026-07-20

- Redesigned the mobile authoring shell so Menu and AI chat remain available while drawing, with
  the active draft and panel position restored when returning to the map.
- Added a compact centered destination badge, a cleaner place-search surface, non-overlapping map
  guidance, actionable location-permission recovery, and accurate inspect/create/edit panel titles.
- Simplified mobile Sighting capture with persistent primary actions and progressive disclosure for
  advanced choices while preserving the complete editing workflow.
- Separated ordinary AI conversations from Dataset authoring, clarified conversation and task
  transitions, and made AI-generated geometry enter the normal recoverable Dataset draft lifecycle.
- Expanded deterministic mobile and deep-editor journey coverage for drawing recovery, comments,
  annotations, proposals, AI-assisted authoring, and switching safely between unrelated tasks.

## [0.0.2] - 2026-07-18

- Fixed Private-group invitation buttons becoming permanently disabled in the Android app.
- Private-group administrators can now create signed invitation links and QR codes from local MLS
  state even while the Cordn coordinator is slow or temporarily offline.
- Added hard deadlines and actionable feedback for stalled Cordn and Android clipboard operations.

## [0.0.1] - 2026-07-16

Earthly's first Android release includes:

- touch-first creation and editing of GeoJSON points, lines, and polygons;
- Nostr-native datasets, contexts, comments, proposals, reactions, and profiles;
- MLS-encrypted Private groups with membership, chat, and collaborative geometry;
- nearby-only Field sessions with signed invitations, approval, scoped relay access, chat, and
  collaborative datasets over a shared Wi-Fi network or hotspot;
- an embedded relay and Blossom service, without requiring a companion Android app;
- saved PMTiles regions, local-first rendering, resumable verified downloads, integrity repair,
  cleanup, and one-time mirroring from an approved nearby device;
- Android QR scanning, invite links, NIP-46 signer handoff, Lightning wallet intents, and redacted
  diagnostics sharing;
- a redesigned mobile menu, map-aware inspection drawer, safe-area handling, and touch drawing
  guidance.

The general workflow of authoring arbitrary public records offline and deciding later whether to
publish them globally is intentionally deferred. Field-session records in `0.0.1` remain nearby-only.
