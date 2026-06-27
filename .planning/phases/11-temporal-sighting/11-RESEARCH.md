# Phase 11: Temporal Sighting - Research

**Researched:** 2026-06-27
**Domain:** Nostr kind-37522 authoring/reading UX (NIP-52 time-bound observation + NIP-40 expiry) on an existing applesauce data layer + MapLibre canvas
**Confidence:** HIGH (the entire phase is reuse/extension of code read in-session; nearly every claim is `[VERIFIED: codebase grep]`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Create mechanic: Map pin-drop → form.** "New Sighting" turns the cursor into a pin-drop; the user clicks the map to place the point, then a compact form opens in the right info panel (title / description / observation time / expiry / optional Group attach). Reuse GeoEditor point placement + the info-panel form/multiplexing pattern.
- **D-02 — Geometry scope: Point + optional small area.** Default a single point; user may optionally draw a small line/polygon. The current 37522 content interface has NO geometry field — placement is currently only `bbox`+`geohash` tags (lossy quantized centroid). The planner MUST add a geometry representation to `TemporalSightingContent` (GeoJSON Point by default, extensible to Line/Polygon) carrying precise coordinates, and keep `bbox`/`geohash` tags derived from it for discovery. Mirror how `geo-event` stores geometry.
- **D-03 — Observation time: Default "now", expandable.** Observation defaults to `start = now`, no `end`. An "adjust time" affordance reveals explicit `start` + optional `end` pickers. Observation time stored distinct from `created_at` (SIGHT-01).
- **D-06 — Observation-time cue: Yes, a subtle time cue on the map.** Encode observation state on the marker — "live now" (within start–end) highlighted, future ("upcoming") badged, past shown normally/dimmer. Keep subtle; reuse existing map-layer styling.
- **D-07 — Browse surface: Dedicated "Sightings" rail destination** in `AppSidebar` with a "New Sighting" button at top. Carry forward the Phase-10 `RAIL_DESTINATIONS` → browse-panel → open-in-info-panel pattern.
- **D-08 — Share surface: Deep-link route + OG card.** A `/sighting/:naddr` route (via `useRouting`) AND an open-graph social card (reuse `src/lib/og/`). **Coordinate with Phase 13** — if Phase 13 owns canonical route shape, scope this to the route + OG card and let Phase 13 generalize; flag at plan time.

### Claude's Discretion
- **D-04 — Expiry (NIP-40):** presets, independent of observation end ("fade after 1 day / 1 week / 1 month / never") plus a custom date. Pick a sensible default TTL. MUST be client-filtered on every read path via the shared `dropExpired`/`isExpired` seam regardless of relay GC (SIGHT-03).
- **D-05 — Marker + fade:** minimum bar — Sightings render with a distinct marker style and are removed by the client-side NIP-40 expiry filter at/after expiry. Gradual opacity-aging is a nice-to-have if cheap; hard expiry-filter removal is required.
- **`c`-attach UX during create (SIGHT-02):** reuse the Phase-9 D-05 pattern — a Group-picker that adds the `c` tag; for a schema Group, run the Phase-8 off-thread validator warn-not-block, never blocking a valid standalone publish.
- **Detail / view panel layout** — exact composition of the read view (title, description, observation time range, expiry countdown, comments/react mount).
- **Draft-save behavior** — local-first preferred (mirror the Story editor draft pattern).
- **Edit flow** — parameterized-replaceable in-place edit preserving the `d`-tag (`TemporalSightingFactory.modify` already preserves `d`).

### Deferred Ideas (OUT OF SCOPE)
- **AI paste→Sighting ingest** (SIGHT-05) — deferred.
- **Geoprivacy obscuring / coarse location** (SIGHT-06) — deferred.
- **Gradual opacity-aging toward expiry** — nice-to-have within D-05; ship only if cheap.
- **Full canonical entity-routing/addressing** — Phase 13 owns routing across all four kinds; the D-08 route here may be scoped to a thin route + OG card and generalized in Phase 13.
- **Live Beacon** (Phase 12); **cross-cutting comment-root widening + entity routing** (Phase 13); **NIP-72 moderation** (deferred milestone).
- **Editable/replaceable Sightings with version lineage** as a corrections model — per REQUIREMENTS Out of Scope, an observation is a point-in-time claim; corrections are new Sightings or comments. (In-place edit of one's own Sighting via the `d`-tag IS allowed — D-04/edit; this exclusion is about lineage-forking.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SIGHT-01 | Create a Sighting — single placed feature with title, description, observation time (NIP-52 `start`, optional `end`) distinct from publish time. | `TemporalSightingFactory.create/sighting` already takes `title`/`description`/`start`/`end`; planner adds a `geometry` content field (§Don't Hand-Roll, §Standard Stack). Create UX mirrors Story editor + GeoEditor `DrawPointMode`. |
| SIGHT-02 | Attach a Sighting to a Group/Topic via a `c` tag and see it land in the Group's contribution lane. | `TemporalSightingFactory.contextReferences()` already writes `c`; `GroupAttachField` is the exact reusable picker (read in §Code Examples). Lane discovery `{kinds, '#c':[coord]}` already exists from Phase 9. Pure mount. |
| SIGHT-03 | Sighting carries an expiry so stale sightings auto-fade (NIP-40, client-filtered at EVERY read path). | `expiry.ts` `dropExpired`/`isExpired` seam exists; `TemporalSightingFactory.expiration()` writes the tag; cast exposes `expiresAt`. Planner must apply `dropExpired` at every enumerated read path (§Common Pitfalls P-1). |
| SIGHT-04 | Comment on and react to a Sighting (reuse kind 37517 + kind 7). | `GeoCommentFactory.root` takes `rootKind` as a parameter (no allowlist) — genuinely a mount. Only `CommentsPanel`/`GeoSocialActions` target-union TYPE needs widening to include `TemporalSighting`. |
</phase_requirements>

## Summary

Phase 11 is a **reuse-and-extend** phase, not a build-from-scratch one. The kind-37522 data layer (`src/lib/nostr/temporal-sighting/{factory,cast,helpers,index}.ts`) already exists from Phase 8 with `title`/`description`/`start`/`end`/`modelVersion` content, a NIP-40 `expiration()` setter, `c`-attach via `contextReferences()`, `d`-preserving `modify()`, and tag delegation to the shared `tags.ts` seam. Three shared seams are also ready: `expiry.ts` (`dropExpired`/`isExpired`), the Phase-9 `c`-attach lane + `GroupAttachField`, and the Phase-9/10 comment+react mount whose `GeoCommentFactory.root` takes `rootKind` as a runtime parameter (so SIGHT-04 needs no NIP-22 allowlist change — only a TypeScript target-union widening).

The single genuine **data-layer gap** is geometry (D-02): `TemporalSightingContent` has no geometry field, so placement is currently only the lossy `bbox`/`g` tags. The planner must add a `geometry` field (GeoJSON Point default, `Point | LineString | Polygon`) to the content interface and derive `bbox`/`g` from it on publish — mirroring exactly how `geo-event/helpers.ts` (`computeBboxFor`/`computeGeohashFor` via `@turf/turf`) derives tags from a FeatureCollection. The applesauce casting contract (`EventCast` reads, `EntityFactory` writes) must stay intact; the content getter must stay defensive (never throw).

Everything else is UI assembly that **clones the Phase-10 Story spine almost 1:1**: a `SightingsPanel` browse rail (clone `StoriesPanel.tsx`), a `sightings` `WorkViewMode` in `AppSidebar`, a Sighting view + editor info-panel slot (clone `StoryViewPanel`/`StoryEditorPanel`), a `useSightings()` subscription hook (clone `useStories.ts`), a `/sighting/:naddr` route in `useRouting.ts` + server OG handler in `src/index.ts` + `fetchSightingOGData` in `src/lib/og/`, a local-first draft helper (clone `story/draft.ts`), and a distinct Sighting map layer with time-cue + expiry-aware styling. The map-first create flow (D-01) is the one departure from text-first Story: it hooks GeoEditor's existing `DrawPointMode` for pin-drop, then opens the form in the right info panel.

**Primary recommendation:** Treat Phase 11 as "Story Phase, three deltas": (1) add a `geometry` field to the 37522 content + derive bbox/g from it; (2) swap the text-first create entry for a map-first pin-drop → info-panel form; (3) add observation-time + NIP-40-expiry inputs and an expiry-aware/time-cue map layer. Everything else clones Phase 10 by name. Scope D-08 to a thin route + OG card and explicitly hand canonical addressing generalization to Phase 13.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 37522 geometry storage + bbox/g derivation | Data layer (`src/lib/nostr/temporal-sighting/`) | — | Content schema + tag derivation is a write-side factory concern; mirrors `geo-event`. |
| NIP-40 expiry filtering on read | Data layer seam (`expiry.ts`) applied at every UI read path | UI (Map/Browse/Detail/OG) | Filter is shared infra; each read path is the enforcement point (SIGHT-03 is a multi-site invariant, not one switch). |
| Map pin-drop placement | GeoEditor (`core/GeoEditor.ts` `DrawPointMode`) | GeoEditorView orchestration | Placement is a map-canvas interaction the editor already owns. |
| Create/edit form | Right info-panel (clone `StoryEditorPanel`) | Zustand store slice | Info-panel multiplexing is the established authoring surface. |
| Browse index | `SightingsPanel` + `AppSidebar` rail | `useSightings()` subscription | Rail-destination → browse-panel is the established discovery pattern (D-07). |
| `c`-attach to Group | `GroupAttachField` (reused) writing `contextReferences()` | Phase-8 off-thread schema worker | Attach + advisory validation already solved in Phase 9. |
| Comment/react | `CommentsPanel`/`GeoSocialActions` mount on the 37522 coordinate | `GeoCommentFactory` (rootKind param) | NIP-22/NIP-25 mount; no new infra. |
| Deep-link + OG card | `useRouting.ts` (client route) + `src/index.ts` route + `src/lib/og/` (server OG) | Phase 13 (generalization) | Thin route + OG card now; canonical addressing deferred. |

## Standard Stack

This phase adds **zero new dependencies** (consistent with the v1.2 milestone "zero new deps" note in MEMORY). Everything is already in `package.json` / `node_modules`.

### Core (already present — extend, do not add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-core` | (installed) | `EventCast`/`castEvent`/`EventFactory` + `getExpirationTimestamp` | Project casting discipline (PROJECT.md v1.2); already used by the 37522 scaffold. `[VERIFIED: codebase grep]` |
| `@turf/turf` | (installed) | `bbox()` / `centroid()` for deriving `bbox`/`g` from geometry | Already the bbox/geohash derivation tool in `geo-event/helpers.ts`. `[VERIFIED: codebase grep src/lib/nostr/geo-event/helpers.ts:9]` |
| `nostr-tools` | (installed) | `nip19.naddrEncode/decode` for `/sighting/:naddr` | Already used in `useRouting.ts` + `og/fetchEvent.ts`. `[VERIFIED: codebase grep]` |
| `maplibre-gl` | (installed) | Distinct Sighting marker layer (D-05/D-06) | Project map engine; LayerManager already manages layers. `[VERIFIED: CLAUDE.md + codebase]` |
| `geojson` (types) | (installed) | `Point | LineString | Polygon | Geometry` content typing (D-02) | Already imported across geo modules. `[VERIFIED: codebase grep src/lib/nostr/geo-event/helpers.ts:12]` |

### Supporting (already present)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | (installed) | Rail icon for the Sightings destination (e.g. `MapPin`/`Eye`/`Telescope`) | `AppSidebar` `RAIL_DESTINATIONS` icon field. `[VERIFIED: codebase grep AppSidebar imports BookOpen etc.]` |
| Radix UI primitives (`@/components/ui/*`) | (installed) | Popover/Command (Group picker), date/time inputs, Card/Badge rows | Reuse `GroupAttachField` + browse-panel primitives. `[VERIFIED: codebase]` |

**Date/time input:** check `src/components/ui/` for an existing calendar/date-picker before adding one. The Story metadata form used plain inputs; the seed uses raw epoch seconds. `[ASSUMED]` — confirm whether a reusable date-time picker primitive exists (see Open Questions Q-2).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Adding `geometry` to 37522 content | Reuse a 37515 dataset + temporal property | **Rejected at Phase 8** — kind 37522 is the settled representation (SPEC §6, CONTEXT line 26-30). Do not re-litigate. |
| Clone `StoriesPanel` | Generalize a shared `EntityBrowsePanel` now | Premature; Phase 13 is the generalization home. Clone-then-converge is the established v1.2 cadence. |

**Installation:** None. `[VERIFIED: zero-new-deps milestone constraint]`

**Version verification:** N/A — no new packages. All libraries above were observed imported in existing source this session.

## Package Legitimacy Audit

> Not applicable — this phase installs **no external packages**. All libraries used are already in the project's dependency tree and were observed imported in existing source files during this research session. No legitimacy gate required.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────── CREATE (D-01, map-first) ───────────────────────┐
                          │                                                                          │
  "New Sighting" button   │   GeoEditor                  Right Info Panel (SightingEditorPanel)      │
  (SightingsPanel top  ───┼─► DrawPointMode ──pin-drop──► title / description                        │
   OR rail New button)    │   (optional small-area      observation time (D-03: default now,          │
                          │    draw: Line/Polygon)        expandable start+optional end)              │
                          │        │                      NIP-40 expiry preset (D-04: 1d/1w/1m/never) │
                          │        │ coords               GroupAttachField (SIGHT-02, c-attach)        │
                          │        ▼                      └── off-thread schema warn-not-block         │
                          │   build geometry ──► TemporalSightingFactory.create()                      │
                          │                        .sighting({title,desc,start,end,geometry})          │
                          │                        .bbox(derived) .geohash(derived)                    │
                          │                        .expiration(ttl) .contextReferences([groupCoord])   │
                          │                        .sign(signer) ──► publish({routing:'outbox'})        │
                          └──────────────────────────────┬──────────────────────────────────────────┘
                                                         │ kind 37522 event to relay
                                                         ▼
   ┌──────────────────────────────── READ PATHS (ALL must dropExpired) ─────────────────────────────┐
   │                                                                                                  │
   │  useSightings() ──{kinds:[37522]}──► isTemporalSighting filter ──► castEvent(_, TemporalSighting)│
   │         │                                                                                        │
   │   ┌─────┴───────────┬──────────────────┬─────────────────────┬──────────────────────────┐       │
   │   ▼                 ▼                  ▼                     ▼                          ▼       │
   │  Map layer       SightingsPanel    SightingViewPanel     Group foreign lane         /sighting/  │
   │  (distinct       (browse rail,     (title/desc/time      ({kinds:[37522],            :naddr OG   │
   │   marker +       D-07)             range/expiry          '#c':[groupCoord]})         crawler     │
   │   time-cue       │ dropExpired     countdown +           │ dropExpired               (server     │
   │   D-06) ◄────────┘ here too        Comments+Social ◄──── here too                    fetch) ◄────┤
   │   dropExpired                       mount SIGHT-04                                    dropExpired │
   │   here                                                                               server-side │
   │                                                                                                  │
   └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

The load-bearing invariant the diagram encodes: **every fan-out read path independently applies `dropExpired`** — there is no single chokepoint, because subscriptions, the OG server fetch, and the map layer each enumerate events from different sources.

### Component Responsibilities
| File (new or extended) | Clone source | Responsibility |
|------------------------|--------------|----------------|
| `src/lib/nostr/temporal-sighting/helpers.ts` (extend) | — | Add `geometry?: Point|LineString|Polygon` to `TemporalSightingContent`; defensive parse stays. |
| `src/lib/nostr/temporal-sighting/factory.ts` (extend) | `geo-event/factory.ts` | Derive `bbox`/`g` from `geometry` on `create`/`sighting` (or a lifecycle service). |
| `src/lib/nostr/temporal-sighting/lifecycle.ts` (new, optional) | `story/lifecycle.ts` | `publishSighting`/`editSighting` single source-of-truth publish path; derive bbox/g from geometry every publish. |
| `src/lib/nostr/temporal-sighting/draft.ts` (new) | `story/draft.ts` | Local-first draft (per-device, pubkey-scoped, keyed by `d`). |
| `src/lib/hooks/useSightings.ts` (new) | `useStories.ts` | `{kinds:[37522]}` subscription, `isTemporalSighting`-filter-before-cast, **`dropExpired`**. |
| `src/components/SightingsPanel.tsx` (new) | `StoriesPanel.tsx` | Browse rail body + "New Sighting" button; **`dropExpired`** before render. |
| `src/components/info-panel/SightingViewPanel.tsx` (new) | `StoryViewPanel.tsx` | Read view; Comments + GeoSocialActions mount (SIGHT-04). |
| `src/components/info-panel/SightingEditorPanel.tsx` (new) | `StoryEditorPanel.tsx` | Create/edit form; time + expiry inputs; `GroupAttachField`. |
| `src/components/AppSidebar.tsx` (extend) | — | Add `'sightings'` to `WorkViewMode` + `RAIL_DESTINATIONS` + `renderWorkPanel` switch. |
| `src/features/geo-editor/hooks/useRouting.ts` (extend) | story route | Add `'sighting'` focusType + `/sighting/:naddr` parse + `buildRoutePath`. |
| `src/index.ts` (extend) | `handleStoryRoute` | `handleSightingRoute` + register `/sighting/:naddr` (+`/comment/:id`). |
| `src/lib/og/fetchEvent.ts` + `cache.ts` + `template.ts` + `index.ts` (extend) | story OG | `fetchSightingOGData`, `OGCacheType += 'sighting'`, `generateSightingOGHtml`. |
| Map layer (LayerManager / GeoEditorView map-stack) | story/dataset layer | Distinct Sighting marker source/layer + time-cue + expiry-aware styling (D-05/D-06). |
| `src/features/social/comments/CommentsPanel.tsx` + `GeoSocialActions.tsx` (extend type) | — | Widen `target` union from `GeoDataset|MapContext|Article` to add `TemporalSighting`. |

### Pattern 1: Derive `bbox`/`g` from geometry on every publish (D-02)
**What:** The factory/lifecycle re-derives `bbox` and `g` tags from the content `geometry` so the lossy tags never drift from the precise coords.
**When to use:** Every Sighting publish/edit.
**Example:**
```typescript
// Source: src/lib/nostr/geo-event/helpers.ts:155-179 (computeBboxFor / computeGeohashFor)
// Mirror for a single-geometry Sighting: wrap the geometry in a Feature/FeatureCollection
// (or feed turf a geometry) and reuse the exact derivation.
import { bbox, centroid } from '@turf/turf'
// turf accepts a Geometry directly:
const box = bbox(geometry) as [number, number, number, number]   // [w,s,e,n] → setBbox
const c = centroid(geometry)
const lonLat: [number, number] = [c.geometry.coordinates[0], c.geometry.coordinates[1]] // → setGeohash([lon,lat])
```
Then on the factory: `.sighting({ ..., geometry }).bbox(box).geohash(lonLat)`. The existing `setGeohash` (tags.ts:89) already takes a `[lon,lat]` centroid and clamps precision 5–7. `[VERIFIED: codebase grep]`

### Pattern 2: Clone-the-Story-spine for nav/browse/share
**What:** Every nav surface (rail tab, browse panel, view/editor panel, route, OG) has a Phase-10 twin named `Story*`; clone it to `Sighting*` substituting `TemporalSighting` for `Article`, kind 37522 for 37520, and `useSightings` for `useStories`.
**When to use:** D-07, D-08, detail/editor layout.
**Why:** Phase 10's tracker entries (REQUIREMENTS lines 122-127) prove this exact spine shipped and verified — lowest-risk path. The Story panels even document themselves as "structural twins" of the Group panels (`StoryViewPanel.tsx` header).

### Pattern 3: `rootKind` is parameterized — SIGHT-04 is a pure mount
**What:** `GeoCommentFactory.root({ kind, address, authorPubkey })` accepts the root kind as a runtime number (factory.ts:33,58 emit `['K', kindStr]`); there is no kind allowlist to widen for comment *creation*.
**When to use:** SIGHT-04.
**Implication:** Mount `CommentsPanel`/`GeoSocialActions` on the Sighting coordinate exactly as `StoryViewPanel` does on the Article coordinate. The only code change is widening the TS `target` union type (`GeoDataset | MapContext | Article` → `+ TemporalSighting`) in `CommentsPanel.tsx:20` and the `ReactableEvent` type behind `GeoSocialActions`. **The full NIP-22 `K`/`k` *read*-side root-kind widening across all four kinds remains Phase 13 (XCUT-01)** — Phase 11 only needs the Sighting's own comment thread to work end-to-end. `[VERIFIED: codebase grep]`

### Anti-Patterns to Avoid
- **Re-litigating the kind choice.** 37522 is settled (SPEC §6, Phase 8). Do not add a "37515 + temporal property" alternative.
- **Filtering expiry in one place.** `dropExpired` at the subscription only is insufficient — the OG server fetch (`og/fetchEvent.ts`) and any direct map-layer enumeration are separate read paths. See Pitfall P-1.
- **Casting unfiltered events.** `TemporalSighting` ctor THROWS on a non-37522/legacy/missing-modelVersion event (cast.ts:29-32). Always `isTemporalSighting`-filter before `castEvent` (mirror `useStories.ts:32`). One bad event otherwise crashes the whole timeline map.
- **Forking lineage on edit.** Use `TemporalSightingFactory.modify` (preserves `d`); do not generate a new `d` on edit (CONTEXT D-04/edit; SPEC §17.1).
- **Double-encoding `t`/`l`.** `setLabels` throws if a value already exists as a freeform `t` (tags.ts:182). Keep label/hashtag lanes disjoint if labels are exposed in the form.

### Recommended approach to "optional small area" (D-02)
Default the create flow to `DrawPointMode` (a single Point). Expose an optional "draw an area instead" affordance that switches GeoEditor to the existing line/polygon draw mode and stores the resulting geometry. The content `geometry` field is typed `Point | LineString | Polygon` so this is a storage no-op once the field exists. `bbox`/`g` derivation works identically for all three via turf. `[VERIFIED: GeoEditor has drawPointMode + line/polygon modes per CLAUDE.md managers]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| bbox/geohash from geometry | Custom bbox loop / geohash encoder | `@turf/turf` `bbox`/`centroid` + `setBbox`/`setGeohash` (tags.ts) | Already the exact derivation in `geo-event/helpers.ts`; `setGeohash` clamps precision 5–7 and handles NaN. |
| NIP-40 expiry read filter | New "is this stale" check | `expiry.ts` `dropExpired(events, unixNow())` | Shared SPEC-05 seam; wraps applesauce `getExpirationTimestamp`; UTC-epoch-seconds discipline already correct. |
| `c`-attach picker + advisory validation | New Group picker | `GroupAttachField` (geo-editor/components) | Off-thread warn-not-block schema validation + never-disable-publish invariant already solved (GROUP-04). |
| Comment thread + reactions | New comment UI / NIP-22 wiring | `CommentsPanel` + `GeoSocialActions` mount; `GeoCommentFactory.root({kind:37522,...})` | rootKind is a parameter; reactions via existing path. Proven on Groups + Stories. |
| Deep-link OG card | New crawler/template | `src/lib/og/` (`fetchEvent`/`cache`/`template`) + `isCrawler` in `src/index.ts` | Story OG is a line-for-line template; add a 'sighting' cache type + fetch fn + html fn. |
| Local draft persistence | New localStorage code | `story/draft.ts` pattern over `readScopedStorage`/`writeScopedStorage` | Pubkey-scoped, defensive-read, keyed by `d`; clone verbatim. |
| naddr encode/decode | Custom addressing | `nip19.naddrEncode`/`decodeNaddr` (og/fetchEvent.ts) | Already used for story/geoevent/context. |

**Key insight:** Phase 11 has exactly **one** net-new piece of logic (geometry field + its bbox/g derivation) and **one** net-new visual concern (the time-cue/expiry-aware map marker). Everything else is a named clone of code that shipped and was verified in Phase 9/10. Building anything else from scratch is a regression against the milestone's reuse discipline.

## Runtime State Inventory

> This is a greenfield-feature phase (new UI + one content-field extension), not a rename/refactor/migration. No stored data is being renamed and no live external state carries an old identifier. Per protocol, each category is answered explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — kind 37522 is a NEW addressable kind; no existing 37522 production data exists (seed/test only, built via factory). No migration of existing records. | None |
| Live service config | None — the Go relay (Khatru) handles 37522 as a generic addressable kind via existing `pool.req` filters; no relay-side filter change needed (confirmed CONTEXT line 28-30, ROADMAP line 154). | None |
| OS-registered state | None — no OS-level registration touches Sighting. | None |
| Secrets/env vars | None — no new secret/env var. OG route reuses existing `serverConfig.relayUrl`. | None |
| Build artifacts | None — no package rename; `bun run build` picks up new TS files automatically. | None |

**Adding a `geometry` field to `TemporalSightingContent` is backward-tolerant:** the defensive content getter (`getTemporalSightingContent`, helpers.ts:61) spreads over `DEFAULT_TEMPORAL_SIGHTING_CONTENT`, so a 37522 event without `geometry` (e.g. the current seed events) parses to `geometry: undefined` and renders from `bbox`/`g` tags as today — no crash, no migration. New events carry precise geometry. `[VERIFIED: codebase grep helpers.ts:61-71]`

## Common Pitfalls

### Pitfall P-1: Expiry filtered at only one read path (SIGHT-03 partial)
**What goes wrong:** `dropExpired` applied in `useSightings()` but not on the map layer enumeration, the Group foreign-lane list, the SightingViewPanel deep-link load, or the **server-side OG fetch** — so an expired Sighting still appears on the map, in a Group lane, or in a social share card.
**Why it happens:** SIGHT-03 is a multi-site invariant. There is no single chokepoint: subscriptions, `og/fetchEvent.ts` (raw WebSocket REQ, no cast, no filter), and any direct LayerManager source-data build each read events independently.
**How to avoid:** Enumerate EVERY read path in the plan (the diagram lists them) and add a verification step per path. The OG path is the easy miss — `fetchSightingOGData` must check `expiration` and return null/expired-state if past (it currently does no expiry check for stories because stories don't expire). Use `dropExpired(events, unixNow())` (UTC epoch seconds) everywhere; never `Date.now()` (ms) directly against the tag.
**Warning signs:** An expired seed Sighting (the seed sets `expiration(now()+ttl)`) still renders after its TTL in any surface.

### Pitfall P-2: Casting a legacy/foreign 37522 throws and kills the timeline
**What goes wrong:** Mapping `events.map(e => castEvent(e, TemporalSighting, store))` over an unfiltered timeline; one event missing `modelVersion` (or a forged 37522) makes the `TemporalSighting` ctor throw (cast.ts:29), crashing the entire list render.
**Why it happens:** SPEC-03 clean-break: the cast is strict by design; the filter is the defensive skip.
**How to avoid:** `events.filter(isTemporalSighting).map(...)` — mirror `useStories.ts:32` exactly.
**Warning signs:** A blank map/panel after a single bad relay event.

### Pitfall P-3: Three timestamps presented as equal-weight raw fields
**What goes wrong:** Exposing `created_at`, `start`/`end`, and `expiration` as three sibling epoch inputs confuses users (CONTEXT "specifics").
**Why it happens:** They genuinely coexist but mean different things (publish vs observation vs disappearance).
**How to avoid:** D-03 (observation collapses to "now" by default, expandable) and D-04 (expiry as friendly presets, not a raw epoch) keep them legible. `created_at` is never user-edited (it's the signed event's publish time).
**Warning signs:** A form with three date pickers and no hierarchy.

### Pitfall P-4: Expiry default that fights observation `end`
**What goes wrong:** Coupling NIP-40 `expiration` to observation `end` so a past-but-recent sighting vanishes immediately.
**Why it happens:** Conflating "when it happened" with "when it should disappear from the map."
**How to avoid:** D-04 makes expiry **independent** of observation end — presets model disappearance, not the event window. Pick a sensible default TTL (recommend a non-aggressive default like 1 month or "never", so a fresh observation doesn't auto-vanish; the seed uses 7–30 day TTLs as realistic examples). Decision to confirm: see Open Questions Q-1.

### Pitfall P-5: D-08 over-building canonical addressing now
**What goes wrong:** Implementing a full generalized entity-router for `/sighting/:naddr` that Phase 13 (XCUT-02) then has to unwind/reconcile.
**Why it happens:** The route work tempts a "do it properly for all kinds" refactor.
**How to avoid:** Scope to a thin `'sighting'` focusType clone of the `'story'` route + an OG card. Flag the Phase-13 overlap in the plan (CONTEXT D-08, ROADMAP Phase 13 owns XCUT-02). `useRouting`'s `focusType` union and `buildRoutePath` already accommodate per-kind additions.

## Code Examples

Verified patterns from in-session source reads:

### Sighting publish (extend factory chain — mirrors seed + story lifecycle)
```typescript
// Source: scripts/seed-entities.ts:428-434 (built-via-factory reference) + src/lib/nostr/temporal-sighting/factory.ts
// + bbox/g derived from geometry (NEW, per D-02), mirroring geo-event/helpers.ts:155-179
const box = bbox(geometry) as [number, number, number, number]
const c = centroid(geometry).geometry.coordinates
const signed = await TemporalSightingFactory
  .create({ title, description, start, end, geometry })   // geometry = NEW content field
  .bbox(box)
  .geohash([c[0], c[1]])
  .expiration(expiryTtl ? unixNow() + expiryTtl : undefined)  // D-04, independent of `end`
  .contextReferences(groupCoords)                              // SIGHT-02, optional
  .sign(signer)
await publish(signed, { routing: 'outbox' })   // mirrors story/lifecycle.ts:49
```

### Subscription with defensive filter + expiry drop (clone useStories)
```typescript
// Source: src/lib/hooks/useStories.ts:23-37 (clone) + src/lib/nostr/expiry.ts:28 (add)
export function useSightings(additionalFilters: Omit<Filter,'kinds'>[] = [{}]) {
  const filters = additionalFilters.map(f => ({ ...f, kinds: [TEMPORAL_SIGHTING_KIND] }))
  const { events, eose } = useTimelineWithEose(filters)
  const sightings = useMemo(
    () => dropExpired(events.filter(isTemporalSighting), unixNow())   // SIGHT-03 at the subscription
            .map(e => castEvent(e, TemporalSighting, eventStore)),
    [events],
  )
  return { events: sightings, eose }
}
```

### `c`-attach reuse (SIGHT-02) — wire GroupAttachField in the editor panel
```typescript
// Source: src/features/geo-editor/components/GroupAttachField.tsx (reuse verbatim)
// Sightings have a single feature; featureProperties is the sighting's own properties (often {}).
<GroupAttachField
  contextRefs={contextRefs}
  onContextRefsChange={setContextRefs}
  featureProperties={[sightingProperties ?? {}]}
  onPublish={handlePublishSighting}     // never disabled by validation verdict (GROUP-04)
  canPublish={hasPlacement && signerReady}
  publishLabel="Publish Sighting"
/>
```

### Comment + react mount (SIGHT-04) — clone StoryViewPanel mount
```typescript
// Source: src/components/info-panel/StoryViewPanel.tsx (CommentsPanel mount) — substitute the Sighting cast.
<CommentsPanel target={sighting /* TemporalSighting — widen the union type */} ... />
// GeoCommentFactory.root takes rootKind as a param (factory.ts:33,58) → kind 37522 needs no allowlist change.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overloaded kind-37518 "context" for everything | Dedicated kind 37522 Temporal Sighting | Phase 8 (v1.2 SPEC v2) | Sighting is first-class; this phase wraps it with UI. |
| Per-kind copy-pasted tag getters | Shared `tags.ts` seam (SPEC-02) | Phase 8 | Factory delegates bbox/g/c/a/L/l; do not inline tag writes. |
| Hand-rolled `EventCast`/wrapper classes | Official applesauce `EventCast`/`castEvent`/`EntityFactory` | Phase 8 (NDK→applesauce migration) | Use `castEvent(_, TemporalSighting, store)`; never hand-roll a wrapper (MEMORY: applesauce casting patterns feedback). |
| Hash routes `#/…` | Clean pathname routes (legacy hash upgraded on boot) | Round I (pre-v1.2) | `/sighting/:naddr` is a clean path; OG handler still redirects users to `/#/sightings/...` form like story. |

**Deprecated/outdated:**
- NDK-based event wrappers — fully migrated to applesauce in the app (MEMORY: NDK migration; only seed scripts remain on NDK, irrelevant here).
- `buildRouteHash` — `@deprecated` alias for `buildRoutePath` (useRouting.ts:264); use `buildRoutePath`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A reusable date/time picker primitive may not exist in `src/components/ui/`; plain inputs were used for Story metadata. | Standard Stack | Low — planner adds a lightweight datetime input; no external dep needed (native `<input type="datetime-local">`). |
| A2 | Default expiry TTL should be conservative (1 month or "never") so fresh observations don't auto-vanish. | Pitfall P-4 / D-04 | Low — D-04 is Claude's discretion; confirm in plan/discuss. Seed uses 7–30d as examples. |
| A3 | The Sighting map marker can reuse the existing dataset/story map-layer styling machinery with a distinct paint expression for time-cue/expiry. | Architecture / D-05/D-06 | Medium — exact LayerManager extension point not deep-read this session; planner should locate the Story/dataset point-layer source build before estimating. |
| A4 | `@turf/turf` `bbox`/`centroid` accept a bare `Geometry` (not only a Feature/FeatureCollection). | Code Examples / Pattern 1 | Low — turf accepts GeoJSON geometry; if not, wrap in a Feature. Verify at plan time. |
| A5 | Widening the `CommentsPanel`/`GeoSocialActions` `target` union to include `TemporalSighting` is the only type change for SIGHT-04 (no read-side K/k allowlist exists to widen). | Pattern 3 | Low — `GeoCommentFactory.root` is parameterized; confirmed. Read-side widening across all kinds is explicitly Phase 13. |

## Open Questions

1. **Default NIP-40 expiry TTL (D-04, Claude's discretion).**
   - What we know: presets 1d/1w/1m/never + custom; independent of observation `end`; seed uses 7–30d examples.
   - What's unclear: the default selection when the user doesn't choose.
   - Recommendation: default to **"1 month"** (or "never" for the "permanent landmark observation" framing) — conservative so a fresh sighting doesn't auto-vanish; surface clearly. Confirm in plan.

2. **Datetime input primitive.**
   - What we know: Story metadata used plain inputs; no calendar primitive confirmed in `src/components/ui/`.
   - What's unclear: whether a reusable date-time picker exists or `<input type="datetime-local">` is acceptable per the design system.
   - Recommendation: prefer native `datetime-local` (zero dep, Biome-clean); grep `src/components/ui/` for `calendar`/`date-picker` first.

3. **Map marker layer extension point (D-05/D-06).**
   - What we know: LayerManager (~630 lines) manages all map layers; dataset/story points render through it.
   - What's unclear: the precise source/paint hook to add a Sighting layer with a time-cue (live/upcoming/past) and expiry-aware opacity.
   - Recommendation: Wave-0 / first plan task should locate how the Story or dataset point layer is built and added (source id, paint expression) and clone it; the time-cue is a data-driven paint expression keyed on `start`/`end`/now.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | build/test/dev | ✓ | (project) | — |
| Go relay (Khatru) | live publish/read of 37522 | ✓ | (project) | seed events for UAT |
| `bun test` | Nyquist validation | ✓ | (project) | — |
| `bun run build` | gate | ✓ | (project) | — |
| Biome | lint gate | ✓ | (project) | — |
| `@turf/turf`, `maplibre-gl`, `applesauce-core`, `nostr-tools`, `geojson` | geometry/map/cast/addressing | ✓ | installed | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

37522 needs no relay-side change (generic addressable kind via existing `pool.req` filters — CONTEXT line 28-30). `[VERIFIED: ROADMAP line 154 + CONTEXT]`

## Validation Architecture

> `workflow.nyquist_validation: true` in `.planning/config.json` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test runner (`bun:test`) |
| Config file | none — Bun built-in; tests colocate as `*.test.ts` (e.g. `temporal-sighting.test.ts`) |
| Quick run command | `bun test src/lib/nostr/temporal-sighting` |
| Full suite command | `bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SIGHT-01 | Factory round-trips `title`/`desc`/`start`/`end`/**`geometry`**; bbox/g derived from geometry | unit | `bun test src/lib/nostr/temporal-sighting/temporal-sighting.test.ts` | ⚠️ exists, extend for geometry — Wave 0 |
| SIGHT-01 | `modify()` preserves `d` (no lineage fork) | unit | same | ⚠️ extend |
| SIGHT-01 | Defensive content getter: 37522 without `geometry` → `geometry: undefined`, no throw | unit | same | ❌ Wave 0 |
| SIGHT-02 | `contextReferences()` emits `c` tag for an attached Group coord | unit | same | ❌ Wave 0 |
| SIGHT-03 | `dropExpired` removes expired Sightings; non-expired kept; UTC-epoch comparison | unit | `bun test src/lib/nostr/expiry.test.ts` (extend) + a per-read-path test | ⚠️ expiry.test exists; add read-path coverage — Wave 0 |
| SIGHT-03 | `useSightings`/`SightingsPanel`/OG-fetch each filter expired | unit/integration | `bun test src/lib/hooks` + `src/lib/og` | ❌ Wave 0 |
| SIGHT-04 | `GeoCommentFactory.root({kind:37522})` emits `K`/`k` = 37522 | unit | `bun test src/lib/nostr/geo-comment` | ⚠️ extend |
| (observation state) | classify live-now / upcoming / past from `start`/`end`/now | unit | new `*.test.ts` for the time-cue classifier | ❌ Wave 0 |

**Needs UAT (manual):** map pin-drop placement (D-01), optional small-area draw (D-02), distinct marker + time-cue + fade rendering (D-05/D-06), Sightings rail discoverability (D-07), `/sighting/:naddr` share + OG card preview (D-08), Group-picker warn-not-block during create (SIGHT-02).

### Sampling Rate
- **Per task commit:** `bun test src/lib/nostr/temporal-sighting` (+ touched module)
- **Per wave merge:** `bun test`
- **Phase gate:** `bun test` green + `bun run build` green + `biome check .` clean before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Extend `temporal-sighting.test.ts` — geometry round-trip, bbox/g derivation, defensive geometry-absent parse, `c`-emit, `d`-preserve
- [ ] `expiry`/read-path test — assert each Sighting read path drops expired (subscription, panel, OG fetch)
- [ ] Observation-state classifier test (live/upcoming/past)
- [ ] (no framework install needed — Bun test is built in)

## Security Domain

> `security_enforcement: true`, ASVS Level 1, block_on `high` — section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Nostr signer (existing applesauce signer); no new auth surface. |
| V3 Session Management | no | — |
| V4 Access Control | no | Public Nostr events; ownership is signature-based (existing). |
| V5 Input Validation | **yes** | Defensive content parse already in helpers (never throws); sanitize Sighting `title`/`description` on render exactly as Story does (React auto-escapes text nodes; NO `dangerouslySetInnerHTML`). |
| V6 Cryptography | no | Event signing via existing signer; no hand-rolled crypto. |

### Known Threat Patterns for {kind-37522 UI on untrusted relay events}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged/legacy/malformed 37522 crashes timeline | Denial of Service | `isTemporalSighting`-filter before `castEvent` (SPEC-03 defensive skip); cast ctor throws by design. |
| Relay ignores NIP-40 GC; serves expired Sighting | Tampering/Spoofing of freshness | Client `dropExpired` at every read path (SIGHT-03) — never trust relay GC (SPEC §10). |
| Malicious `title`/`description` (XSS) | Tampering | Render as escaped React text (clone Story row/view — `StoriesPanel` notes "auto-escaped React text nodes — T-10-05"); no raw HTML sink. |
| Malicious inline content via comments | Tampering | Comments already route through the sanitized renderer (Phase 9/10 proven); mount unchanged. |
| Untrusted `schema` Group during `c`-attach | DoS (ReDoS/recursive schema) | Reuse `GroupAttachField` → off-thread hardened worker (SPEC-04 timeout-kill, restricted dialect); never the in-thread validator. |
| Crafted geometry (oversized/malformed) in content | DoS | turf bbox/centroid wrapped in try/catch returning undefined (mirror `computeBboxFor`/`computeGeohashFor`); cap geometry complexity for a "small area" (D-02 is small by design). |

**No new threat surface beyond Story/Group** — Phase 11 reuses the same sanitized render, off-thread validation, and defensive-skip seams already security-verified in Phases 8–10 (MEMORY: Phase 8 13/13 threats closed; Phase 9 schema-DoS fixed; Phase 10 threats_open:0). The one new-logic area (geometry parse) must reuse the geo-event try/catch derivation, not a fresh parser.

## Sources

### Primary (HIGH confidence) — in-session codebase reads
- `src/lib/nostr/temporal-sighting/{factory,cast,helpers,index}.ts` — the data layer being extended
- `src/lib/nostr/expiry.ts` + `tags.ts` + `geo-event/{helpers,factory}.ts` — shared seams + geometry derivation reference
- `src/lib/hooks/useStories.ts`, `src/components/StoriesPanel.tsx`, `src/components/info-panel/StoryViewPanel.tsx` — clone sources
- `src/lib/nostr/story/{lifecycle,draft}.ts` — lifecycle + draft clone sources
- `src/features/geo-editor/hooks/useRouting.ts`, `src/index.ts` (OG routes), `src/lib/og/{crawler,fetchEvent,index,cache,template}.ts` — nav/share clone sources
- `src/features/geo-editor/components/GroupAttachField.tsx` — `c`-attach reuse
- `src/features/social/comments/{CommentsPanel,GeoSocialActions}.tsx`, `src/lib/nostr/geo-comment/factory.ts` — comment/react mount + parameterized rootKind
- `src/components/AppSidebar.tsx` — rail destination integration
- `scripts/seed-entities.ts` §Temporal Sightings — factory-built fixture reference
- `SPEC.md` §6/§7/§8/§10/§17 — authoritative tag/expiry/modelVersion contracts
- `.planning/{ROADMAP,REQUIREMENTS}.md`, `11-CONTEXT.md` — scope + locked decisions

### Secondary (MEDIUM confidence)
- MEMORY phase-08/09/10 context notes — confirm reuse machinery shipped + security-verified

### Tertiary (LOW confidence)
- None — no WebSearch used; this phase is entirely internal codebase research.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; every library observed imported in existing source.
- Architecture: HIGH — the spine is a verified Phase-10 clone; only the geometry field + marker layer are net-new.
- Pitfalls: HIGH — expiry-multi-path and cast-before-filter are documented invariants in SPEC/existing code.
- Map marker extension point: MEDIUM — LayerManager paint-expression hook not deep-read (A3/Q3).

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable — internal codebase, no fast-moving external deps)
