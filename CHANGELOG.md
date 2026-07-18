# Changelog

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
