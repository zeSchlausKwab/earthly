---
title: Map Stack ↔ Entity Layer Unification
status: draft
type: design-spec
created: 2026-07-02
scope: cross-cutting (candidate Phase 13 / new slice)
supersedes_hack: "commit 66a155e (beacon-extras merge in GeoEditorView) — replaced by stack membership"
---

# Map Stack ↔ Entity Layer Unification

> Make ephemeral entity layers (Live Beacons, Temporal Sightings) first-class Map
> Stack citizens so the app's core invariant — **"what's on the Map Stack is
> visible"** — holds for *every* entity type, not just datasets/contexts.

---

## 1. Problem

The Map Stack is the app's single model for map visibility. But two entity types
bypass it entirely:

| Entity | Visibility model today |
|--------|------------------------|
| Dataset (geoevent) | Map Stack entry (`entityType: 'dataset'`) — on stack ⇒ visible |
| Context (mapcontext) | Map Stack entry (`entityType: 'context'`) |
| Comment / proposal / draft / ai-result | Map Stack entries |
| Story-linked datasets | Map Stack entries (`source: 'story'`) |
| **Sighting (37522)** | **Always-on ambient layer** — `useMapLayers` renders `useSightings()` unconditionally. NOT on the stack. |
| **Beacon (37521)** | **Always-on ambient layer** — `useMapLayers` renders `useBeacons()` (discovery) unconditionally. NOT on the stack. |

Consequences of the inconsistency:
- Sightings/beacons render whether or not anything is on the stack — the invariant
  "on the stack = visible" is false for them.
- No way to toggle the sightings/beacons layer, or to isolate a single one, through
  the same UI as everything else.
- The beacon share-link/inspect flow had to **side-channel** the viewed/routed beacon
  into the layer (commit `66a155e`, `extraMapBeacons` merge in `GeoEditorView`) because
  there was no "put this beacon on the stack" path. That hack should be **deleted** by
  this work.

Grounding (current code):
- `MapStackEntryType = 'dataset' | 'context' | 'comment' | 'proposal' | 'draft' | 'ai-result'`
  (`store/types.ts:72`). No `sighting`/`beacon`.
- `MapStackEntry` already has `visible`, `pinned`, and **`isolated`** ("only this
  entry renders — bypass all others"; mutually exclusive across entries —
  `mapStackSlice.ts:82`, `store/types.ts:100`).
- `useMapLayers` builds sighting/beacon sources from the `visibleSightings` /
  `visibleBeacons` props (`buildSightingSource` :271, `buildBeaconSource` :360), fed
  unconditionally from the subscriptions in `GeoEditorView`.

---

## 2. Decisions (locked)

1. **Spec before build.** This changes how beacons/sightings render; it is NOT bolted
   on mid-UAT. (Phase 12 beacon UAT is paused with 2 tests outstanding.)
2. **Deep-link landing defaults to SOLO.** Opening a sighting/beacon share link (or a
   `/…/:naddr` deep link) adds it to the stack as **`isolated: true`** — only that
   entity renders, everything else is bypassed until cleared. This is the focused
   "look at this one thing you were sent" view.
3. **Otherwise: consistent with existing entities.** A single sighting/beacon gets an
   **"Add to map stack"** action exactly like datasets/contexts/stories — added as a
   normal `visible`, non-isolated entry sitting *alongside* everything else. No bespoke
   semantics.
4. **Aggregate layer entries.** A general **"Sightings"** and **"Live beacons"** layer
   can be added/removed as a single Map Stack entry that toggles the whole
   subscription-driven layer (the original ask: "a general sightings layer that can be
   added or removed").

---

## 3. Design

### 3.1 New entry types

Extend `MapStackEntryType`:
```
| 'sighting'        // an individual sighting pinned to the stack (by naddr)
| 'beacon'          // an individual beacon pinned to the stack (by naddr)
| 'sighting-layer'  // the aggregate "Sightings" layer (entityKey: 'all')
| 'beacon-layer'    // the aggregate "Live beacons" layer (entityKey: 'all')
```
- Individual entries: `entityKey` = the entity naddr (or `dTag`), one entry per pinned
  entity. Reuse `isolated` for solo.
- Aggregate layer entries: a single entry (`entityKey: 'all'`) whose `visible` flag
  gates the entire subscription-driven layer.

### 3.2 Rendering gate (the core change)

`useMapLayers` stops rendering sightings/beacons unconditionally. Instead the caller
computes what to render from **stack membership**, mirroring how `visibleGeoEvents` is
already derived from the stack:

- **Aggregate layer visible** ⇒ render the full `useSightings()` / `useBeacons()`
  discovery set (today's behavior, now gated).
- **Individual entries** ⇒ render exactly those entities (resolved from the
  subscription or a targeted `{authors,#d}` fetch for a link-only/deep-linked one).
- **Isolation** ⇒ if any entry has `isolated: true`, render ONLY that entry's
  entity(ies) and suppress the aggregate layers + all other stack entries (the
  existing global isolation rule already does this for datasets/contexts —
  `mapStackSlice.ts:104`; extend the sighting/beacon source builders to honor it).

The `buildSightingSource` / `buildBeaconSource` de-dup (freshest-per-`{pubkey,d}`) and
`dropExpired` stay unchanged — they just receive a stack-derived input set.

### 3.3 Default behavior (preserve today's "it just works")

On cold-start Browse, auto-add the **`sighting-layer`** and **`beacon-layer`** entries
with `source: 'browse-default'` and `visible: true`. Net effect: sightings/beacons
still appear by default, but are now **removable/toggleable** from the Map Stack like
everything else. (`browse-default` already exists and is Clear-aware.)

### 3.4 Entry points (UI, consistent with existing entities)

- **"Add to map stack"** on `SightingViewPanel` / `BeaconViewPanel` and on the rail
  rows — same affordance datasets/contexts have (`onAddDatasetToMap`).
- **Deep-link / share-link open** → `addMapStackEntry({ entityType, entityKey: naddr,
  isolated: true, source: 'route', visible: true })`. This replaces the `66a155e`
  extras hack: the viewed beacon renders because it's isolated *on the stack*.
- **Aggregate layer** toggled from the Map Stack panel and/or a rail header ("Show
  Sightings layer").

### 3.5 What this deletes / simplifies

- `GeoEditorView`: remove `extraMapBeacons` state + the sync effect + the
  `beaconsForMap` merge (commit `66a155e`) — superseded by stack membership.
- `visibleBeacons` / `visibleSightings` props to `useMapLayers` become stack-derived.

---

## 4. Open questions

1. **Aggregate + individual overlap.** If the aggregate layer is ON and a user also
   "adds" one sighting individually, that entity is in both — the freshest-per-key
   de-dup already collapses it, but do we show a distinct pinned marker for the
   individual entry? (Proposed: no special marker; the individual entry just guarantees
   it stays when the aggregate layer is turned off.)
2. **Isolation vs aggregate layer.** When a deep-link lands isolated, the aggregate
   layers are suppressed (correct). On clearing isolation, do we restore the prior
   layer visibility, or leave the isolated entry as a normal entry? (Proposed: clearing
   isolation demotes it to a normal visible entry; prior layer state restored.)
3. **Expiry of pinned individual entries.** A pinned beacon/sighting that expires —
   drop the stack entry automatically (dropExpired parity) or leave a "ended" tombstone
   entry? (Proposed: auto-remove on expiry, matching the layer's dropExpired.)
4. **Ordering / grouping in the Map Stack panel.** Do aggregate layers pin to the top,
   above individual dataset/context entries?

---

## 5. Rough implementation plan (post-spec)

1. **Model:** extend `MapStackEntryType`; add layer-aware selectors
   (`visibleSightingsFromStack`, `visibleBeaconsFromStack`) mirroring `visibleGeoEvents`.
2. **Render gate:** `useMapLayers` consumes the stack-derived sets; honor `isolated`.
3. **Defaults:** cold-start `browse-default` layer entries; Clear semantics.
4. **UI:** "Add to map stack" on sighting/beacon view panels + rails; layer toggles in
   the Map Stack panel.
5. **Deep-link:** route/inspect → isolated stack entry; **delete the `66a155e` hack**.
6. **Tests:** stack-membership → render; isolation solo; aggregate toggle; expiry
   auto-remove; deep-link isolated-on-landing.

---

## 6. Touchpoints

- `src/features/geo-editor/store/types.ts` (`MapStackEntryType`, selectors)
- `src/features/geo-editor/store/mapStackSlice.ts` (isolation already global)
- `src/features/geo-editor/hooks/useMapLayers.ts` (`buildSightingSource`/`buildBeaconSource`, gating)
- `src/features/geo-editor/GeoEditorView.tsx` (derive stack sets; remove `extraMapBeacons`; deep-link → isolated entry)
- `src/components/info-panel/BeaconViewPanel.tsx` / `SightingViewPanel.tsx` ("Add to map stack")
- `src/components/BeaconsPanel.tsx` / `SightingsPanel*` (rail add + layer toggle)
- `src/components/MapStackPanel.tsx` (layer entries render/toggle)
