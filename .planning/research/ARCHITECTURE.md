# Architecture Research

**Domain:** Nostr-based collaborative GeoJSON mapping — kind-37518 "context" split into role-specific geo entity kinds (Story/Article, slimmed Group, Live Beacon, Temporal Sighting)
**Researched:** 2026-06-23
**Confidence:** HIGH (grounded in the actual codebase; applesauce + MapLibre patterns read directly from `src/lib/nostr/` and `src/features/geo-editor/`)

> This file answers "how do the new entity kinds integrate with the existing applesauce Factory+Cast / EventStore architecture and the MapLibre editor?" It is opinionated and codebase-specific. Every pattern below mirrors an existing one in `src/lib/nostr/{geo-event,map-context,geo-comment,geo-proposal}/`.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  AUTHORING UI (React 19)  — per-kind create/edit/comment/attach panels │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Article  │ │  Group   │ │ Beacon   │ │ Sighting │ │ Dataset  │     │
│  │ editor   │ │ editor   │ │ editor   │ │ editor   │ │ (37515)  │     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘     │
├───────┼────────────┼────────────┼────────────┼────────────┼──────────┤
│  READ HOOKS  (src/lib/hooks, src/lib/nostr/hooks.ts)                  │
│   useArticles · useGroups · useLiveBeacons · useSightings  (kind-typed │
│   wrappers around useTimelineWithEose + castEvent)                     │
├──────────────────────────────────────────────────────────────────────┤
│  ENTITY MODULES  (src/lib/nostr/<entity>/)  — Factory + Cast + helpers │
│   factory.ts (write) · cast.ts (read view) · helpers.ts (pure tag fns) │
│   shared: src/lib/nostr/tags.ts (bbox/g/L/l/t/c/a) [NEW]               │
├──────────────────────────────────────────────────────────────────────┤
│  APPLESAUCE CORE SINGLETONS  (src/lib/nostr/index.ts)                  │
│   EventStore (dedup + replaceable + #tag index) · RelayPool · accounts │
│   · NostrIDB cache · createEventLoaderForStore · publish()             │
├──────────────────────────────────────────────────────────────────────┤
│  MAP RENDER  (src/features/geo-editor/)                                │
│   GeoEditor + LayerManager (GeoJSONSource.setData) · Authoring API     │
│   (createAuthoring) is the ONLY geometry-write seam                    │
└──────────────────────────────────────────────────────────────────────┘
        ↑ reads/writes                              ↑ relay traffic
   Nostr relay (Khatru/Go)  ←  publish() / pool.req(filters)
```

### Component Responsibilities

| Component | Responsibility | Existing analogue to copy |
|-----------|----------------|---------------------------|
| `<entity>/helpers.ts` | Pure, cached tag/content getters + `is<Entity>()` type guard + `<Entity>Event` type | `map-context/helpers.ts` |
| `<entity>/cast.ts` | Read-only `EventCast` view; raw-event proxies + typed getters | `map-context/cast.ts` |
| `<entity>/factory.ts` | `EventFactory` write builder (`create`/`modify`/`update`) + `delete<Entity>()` | `geo-event/factory.ts`, `map-context/factory.ts` |
| `<entity>/index.ts` | Barrel re-export of cast+factory+helpers | `map-context/index.ts` |
| `use<Entity>()` hook | Kind-typed wrapper around `useTimelineWithEose` + `castEvent` | `useGeoDatasets` / `useMapContexts` |
| `tags.ts` (NEW) | Shared tag read/write helpers (`bbox`, `g`, `L`/`l`, `t`, `c`, `a`) so every kind shares one implementation | extract from `geo-event/helpers.ts` + `map-context/helpers.ts` |
| Authoring API (`createAuthoring`) | Sole geometry-mutation seam into the map | `src/features/geo-editor/api/authoring.ts` (unchanged) |
| LayerManager | `addSource`/`setData` for live + static geometry | `core/managers/LayerManager.ts` |

---

## Recommended Project Structure

```
src/lib/nostr/
├── index.ts                # singletons (UNCHANGED)
├── kinds.ts                # MODIFIED: add ARTICLE_KIND, LIVE_BEACON_KIND, TEMPORAL_SIGHTING_KIND; keep GROUP_KIND=37518
├── tags.ts                 # NEW: shared bbox/g/L/l/t/c/a read+write helpers
├── geo-event/              # 37515 dataset — UNCHANGED (source of `c`/`a` push attachment)
├── article/                # NEW ~37520 — pull/curate/closed (Story/Article)
│   ├── cast.ts  factory.ts  helpers.ts  index.ts
├── group/                  # 37518 RENAMED from map-context/ — slimmed push/attach + governance
│   ├── cast.ts  factory.ts  helpers.ts  index.ts
├── live-beacon/            # NEW ~37521 — real-time position
│   ├── cast.ts  factory.ts  helpers.ts  index.ts
├── temporal-sighting/      # NEW — NIP-52-flavored time-bound observation
│   ├── cast.ts  factory.ts  helpers.ts  index.ts
├── geo-comment/            # 37517 — MODIFIED only to widen K/k root-scope kinds
└── geo-proposal/           # 37519 — UNCHANGED (Article reuses it for propose-edit)

src/lib/context/            # the two-lane + validation logic; minimally:
├── validation.ts           # MODIFIED: schema/geometry validation moves to a shared off-thread validator
├── references.ts           # REUSED: curated-lane (inline naddr → `a`) for Article + Group pinned refs
└── scope.ts                # REUSED: foreign-lane (`c` attach discovery) for Group

src/lib/validation/         # NEW
└── schemaWorker.ts         # NEW: Ajv compile+validate off main thread (Web Worker)

src/features/
├── articles/               # NEW: ArticleEditorPanel, ArticleViewPanel (Markdown + inline naddr)
├── groups/                 # RENAMED from features/contexts/: GroupEditorPanel, GroupViewPanel (two-lane)
├── beacons/                # NEW: BeaconPublishControl, LiveBeaconLayer (moving point)
├── sightings/              # NEW: SightingEditorPanel, SightingMarker
└── geo-editor/             # MODIFIED: LayerManager gains a live-source; routing gains focusTypes
```

### Structure Rationale

- **One folder per kind, same four files.** The repo already proves this shape four times (`geo-event`, `map-context`, `geo-comment`, `geo-proposal`). New kinds slot in identically; the solo maintainer gets zero new mental model. Matches "amend, don't replace" — leaves stay, you add siblings.
- **`tags.ts` extraction is the only new abstraction.** Today `bbox`/`g`/`c`/`a` getters are copy-pasted between `geo-event/helpers.ts` and `map-context/helpers.ts`. Four more kinds would multiply that duplication; extract once now while touching all of them. Do NOT over-abstract beyond tag read/write — content shapes stay per-kind.
- **`group/` is a rename of `map-context/`, not a rewrite.** The 37518 cast/factory/helpers are ~90% of what the slimmed Group needs. Renaming preserves git history and honors "amend." Strip the curate-lane responsibility (inline-naddr → `referencedAddresses`) out to `article/`; keep the `c`-attach + governance content fields.

---

## Architectural Patterns

### Pattern 1: Factory + Cast per kind (the repo's universal Nostr seam)

**What:** Every kind has (a) a `helpers.ts` of pure cached tag getters + a type guard, (b) a `cast.ts` `EventCast` subclass exposing typed getters over a raw `NostrEvent`, (c) a `factory.ts` `EventFactory` subclass with a fluent builder ending in `.sign(signer)`, then `publish()`. Reads cast; writes factory. Nothing else touches raw tags.

**When to use:** Always, for all four new kinds. Non-negotiable house style.

**Trade-offs:** Boilerplate-heavy (four files × four kinds) but uniform and trivially reviewable. Cached-symbol getters (`getOrComputeCachedValue`) keep repeated reads cheap.

**Example (Live Beacon, abbreviated — mirrors `map-context/cast.ts`):**
```typescript
// live-beacon/helpers.ts
export type LiveBeaconEvent = KnownEvent<typeof LIVE_BEACON_KIND>
export function isLiveBeacon(e: NostrEvent): e is LiveBeaconEvent {
  return e.kind === LIVE_BEACON_KIND && getTagValue(e, 'd') !== undefined
}
export function getBeaconPosition(e: NostrEvent): [number, number] | undefined { /* parse `g`/content */ }

// live-beacon/cast.ts
export class LiveBeacon extends EventCast<LiveBeaconEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isLiveBeacon(event)) throw new Error('not a LiveBeacon')
    super(event, store)
  }
  get position() { return getBeaconPosition(this.event) }
  get expiresAt() { return getExpiry(this.event) } // NIP-40
}

// live-beacon/factory.ts
export class LiveBeaconFactory extends EventFactory<typeof LIVE_BEACON_KIND> {
  static update(prev: LiveBeaconEvent, pos: [number, number]): LiveBeaconFactory { /* reuse d, set g + content */ }
}
```

### Pattern 2: Reference DIRECTION as two distinct EventStore queries

**What:** The whole milestone is "split the kind along reference direction." That axis maps cleanly onto two query shapes the EventStore already supports via tag-indexed filters (`#a`, `#c`).

**Pull / curate (Article → datasets), the lane the Article OWNS:**
- Author writes inline `nostr:naddr…` in Markdown; on publish, mirror each to an `a` tag (existing `referencedAddresses()` builder in `map-context/factory.ts` does exactly this).
- Read = resolve the Article's OWN `a` tags to datasets. **No relay query for discovery** — the addresses are in-event. Resolution is `getArticleReferencedAddresses(event)` → `eventStore.getReplaceable(kind, pubkey, d)` per coordinate (or a single `useGeoDatasets` filter `{ '#d':[...], authors:[...] }`). This is `references.ts::resolveContextReferences` / `getContextReferencedDatasets` reused verbatim.
- Subscription: load the Article (one replaceable), then a bounded batch-load of its referenced coordinates. Closed by construction — nobody else can add to it.

**Push / attach (datasets → Group), the lane the Group DISCOVERS:**
- Foreign datasets carry `["c","37518:<group-pubkey>:<d>"]` pointing AT the group (existing `geo-event/factory.ts::contextReferences()`).
- Read = query the relay for everything pointing at the group: `pool.req(relays, { kinds:[37515], '#c':[groupCoordinate] })`. This is the **attach-discovery** subscription. The EventStore indexes `#c`, so `eventStore.timeline({ '#c':[coord], kinds:[37515] })` re-renders reactively. This is `scope.ts::getDirectContextDatasets` (the `allowForeignAttachments` branch) reused.
- Gating: Group's `allowForeignAttachments` / governance flag decides whether the foreign lane is honored (already implemented).

**When to use:** Article = pull only. Group = push only (+ optional pinned/"canonical" refs which are just a small pull lane reusing the same `a`-tag resolver). The clean split means each kind runs ONE lane, not both — that is the bloat being removed from 37518.

**Trade-offs:** Pull is cheap/bounded/offline-resolvable but the curator must edit to add. Push is open/live/relay-dependent but needs the attach-discovery subscription and governance filtering. They are different subscription lifetimes — keep them in separate hooks.

**Example:**
```typescript
// Article curated lane — bounded, in-event, no discovery query
const article = useArticle(naddr)                       // one replaceable
const refs = article?.referencedAddresses ?? []         // mirrored `a` tags
const { events: datasets } = useGeoDatasets(
  refs.length ? [{ '#d': dTagsOf(refs), authors: authorsOf(refs) }] : null
)

// Group attach lane — open discovery, reactive on relay
const groupCoord = group.contextCoordinate
const { events: attached } = useGeoDatasets(
  group.allowForeignAttachments ? [{ '#c': [groupCoord] }] : []
)
```

### Pattern 3: Validation as a pipeline filter at two seams (off-thread)

**What:** Group schema/geometry validation is the only heavy compute. It sits at exactly two seams:
- **validate-on-fetch (read):** after the attach-discovery query returns foreign datasets, run each through the Group's schema before it enters the strict "map lane." This is `validation.ts::validateDatasetForContext` + `MapContextViewPanel`'s `mapLaneDatasets` filter — already implemented, currently synchronous on the main thread.
- **validate-on-create (write):** when authoring/attaching into a `schema`-governed Group, validate before publish; surface errors in the editor; offer `getContextRequiredPropertyDefaults` (already exists) to pre-fill.

**Keep it off the main thread / bounded:** Today Ajv compiles + validates synchronously in `validateDatasetForContext` (`src/lib/context/validation.ts`), fine for a handful of datasets but a jank risk under the open-attach lane (potentially many foreign datasets). Move the validator into a Web Worker (`src/lib/validation/schemaWorker.ts`), mirroring the v1.1 off-thread pattern (ingest workers + QuickJS sandbox). Bound it: compile the schema once per Group (cache by `schema-hash`), validate datasets in batches with an idle-yield, and cap eager validation (validate the visible/in-bbox lane first, lazy-validate the rest). Return `ContextValidationResult` unchanged so callers don't move. Keep a synchronous fast-path for ≤N datasets to avoid worker latency on the common small case.

**When to use:** Group only (Article is closed/no-schema; Beacon/Sighting carry no dataset schema). validate-on-fetch is required for `strict` filter mode; validate-on-create is a UX guardrail.

**Trade-offs:** Worker hop adds async + serialization; worth it once foreign-attach counts grow.

```typescript
// read seam (strict map lane) — validation.ts behavior, now via worker
const valid = await validateBatch(group.schema, foreignDatasets)  // worker, cached by schema-hash
const mapLane = filterMode === 'strict' ? valid.filter(v => v.status==='valid') : foreignDatasets

// write seam (attach into schema group)
const result = await validateBatch(group.schema, [editorAsDataset])
if (group.governance==='schema' && result[0].status!=='valid') blockPublishWithErrors(result[0].errors)
```

### Pattern 4: Live Beacon transport — parameterized-replaceable updated in place (RECOMMENDED), NIP-40 expiry, ephemeral as an option

**What:** Three transports were on the table. Recommendation: **parameterized-replaceable (addressable) event updated in place, with a NIP-40 `expiration` tag** — a hybrid that leans replaceable.

- **Replaceable-in-place (CHOSEN):** Beacon is `~37521`, parameterized-replaceable, fixed `d` per beacon lineage. Each position update republishes the same `(kind,pubkey,d)`; the EventStore's replaceable handling auto-collapses to the latest version — the exact mechanism `useGeoDatasets`/`useMapContexts` already rely on. Followers `pool.req({ kinds:[37521], '#d':[id] })` (or `authors`) and the store emits the newest position. A NIP-40 `expiration` tag makes a stale beacon self-expire (relays drop it; client treats expired as "offline"). Persistence across reload is free via NostrIDB cache.
  - **Why over ephemeral (20000–29999):** ephemeral events are not stored by relays or the EventStore, so a follower who subscribes mid-stream sees nothing until the next tick, there is no "last known position" on reload, and the existing replaceable/cast/cache machinery does not apply — you'd build a parallel transient path.
  - **Why a touch of hybrid:** for very high-frequency tracking you may emit *ephemeral* interpolation ticks between *replaceable* checkpoints (checkpoint every N seconds to the addressable event for durability/late-joiners; stream ephemerals in between for smoothness). Ship checkpoint-only first; add ephemeral interpolation only if motion looks choppy.

- **Subscription model for live followers:** one `pool.req` per followed beacon, or one filter with `authors:[...]` / `'#d':[...]` for many. The reactive `eventStore.timeline` re-emits on every replace — no manual polling. Throttle publish rate client-side (e.g. ≥3–5 s between updates) to respect relay write limits; throttle render with `requestAnimationFrame`.

- **How MapLibre renders a moving point:** a dedicated `GeoJSONSource` whose `setData()` is called with the new point on each store emit — exactly how LayerManager already drives `SOURCE_CURSOR`/selection sources (`safeGetGeoJSONSource(id).setData(fc)`). Add a `beacons` source + a `circle`/`symbol` layer (LayerManager already builds both layer types). For smooth motion, tween between the last and new coordinate over the update interval with `requestAnimationFrame` and `setData` each frame; MapLibre repaints the circle at the new lng/lat. No new map subsystem — one more source/layer pair in LayerManager.

**When to use:** Beacon kind only. Sightings are static (one observation), so they are plain replaceable points, no live transport.

**Trade-offs:** Replaceable churns event versions on the relay (mitigated by throttle + NIP-40 expiry GC). Ephemeral would avoid storage churn but loses durability/late-join/reload — net worse for this product.

---

## Data Flow

### Read flow (per kind — identical to existing dataset/context reads)

```
component mounts
   ↓  use<Entity>(filters)
useTimelineWithEose(filters)               // src/lib/nostr/hooks.ts
   ↓ queryCache(filters) → eventStore.add  // instant hydrate from IndexedDB
   ↓ pool.req(relays, filters)             // relay subscription
   ↓ mapEventsToStore(eventStore)          // dedup + replaceable collapse
eventStore.timeline(filters)  (reactive)
   ↓ .map(e => castEvent(e, <Entity>, eventStore))
typed casts → panel render / map source.setData
```

### Reference-direction flows (the milestone's core)

1. **Article (pull):** load Article replaceable → read its `a` tags → batch-load referenced datasets by coordinate → render in curated lane + map. Self-contained, bounded, works offline from cache.
2. **Group (push):** load Group replaceable → if `allowForeignAttachments`, open `{ kinds:[37515], '#c':[groupCoord] }` discovery sub → validate-on-fetch through worker → strict/warn/off filter → map lane. Plus optional pinned `a`-refs via the same pull resolver as Article.
3. **Beacon (live):** publish replaceable position updates (throttled, `expiration` tag) → followers' `eventStore.timeline({kinds:[37521],…})` re-emits latest → LayerManager `beacons` source `setData()` per tick (tweened).
4. **Sighting (temporal):** publish replaceable point with NIP-52 time fields (+ optional NIP-40 expiry) → render as a time-badged marker; filter by time window client-side.

### State management

```
EventStore (single instance, src/lib/nostr/index.ts)
   ↑ pool.req → mapEventsToStore (subscriptions add)
   ↑ publish() → eventStore.add (own writes)
   ↓ timeline/getReplaceable (reactive reads via use$)
Zustand editor store  ← geometry mirror only (features, viewContext→viewGroup, filter mode)
   ↓ Authoring API (createAuthoring) is the ONLY geometry write into GeoEditor
```

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| Single user / few entities | Synchronous Ajv validation fine; replaceable beacons trivially cheap; no worker needed |
| Busy Group (many foreign `c` attachments) | Move validation to the worker (Pattern 3); bbox-bound the attach-discovery filter (`#c` + viewport); lazy-validate off-screen datasets |
| Many concurrent beacons | One multiplexed filter (`authors`/`#d` arrays) instead of N subscriptions; throttle publish; NIP-40 GC; ephemeral interpolation only if needed |

### Scaling priorities

1. **First bottleneck:** main-thread Ajv validation under the open-attach lane → off-thread worker + schema-hash compile cache.
2. **Second bottleneck:** beacon publish/relay write churn → client-side throttle + NIP-40 expiry; multiplex follower subscriptions.

---

## Anti-Patterns

### Anti-Pattern 1: Keeping the discriminated-union "context" and adding a `type` field
**What people do:** Add `entityType` inside 37518 content instead of separate kinds.
**Why it's wrong:** That is precisely the two-orthogonal-axes bloat the milestone exists to delete; relay-level kind filters stop working; one cast/factory grows conditionals.
**Do this instead:** One kind per reference-direction role; governance stays a content object inside Group only.

### Anti-Pattern 2: Reimplementing tag getters / casts per new kind
**What people do:** Copy `getContextBoundingBox`, `getContextHashtags`, etc. into each new helpers file.
**Why it's wrong:** Four kinds × duplicated `bbox/g/L/l/t/c/a` = drift and review burden, against "amend don't replace."
**Do this instead:** Extract shared tag read/write into `src/lib/nostr/tags.ts`; per-kind helpers handle only content shape + type guard.

### Anti-Pattern 3: Beacon via ephemeral-only events
**What people do:** Use 20000-range ephemeral events for live position to "avoid relay churn."
**Why it's wrong:** No durable last-known position, late-joiners see nothing, no reload persistence, bypasses the entire EventStore/cast/cache stack.
**Do this instead:** Parameterized-replaceable updated in place + NIP-40 expiry; reuse the existing replaceable machinery.

### Anti-Pattern 4: Writing geometry to the map outside `createAuthoring`
**What people do:** Have a beacon/sighting panel call `editor.setFeatures`/`map.addSource` directly.
**Why it's wrong:** Breaks the single-mutation-seam invariant (`boundary.test.ts` enforces it) and the safe-editing gate.
**Do this instead:** Live/transient render layers (beacon source) are LayerManager-owned *display* layers, not editor features; persistent geometry routes through the Authoring API.

---

## Integration Points

### Internal boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Read hooks ↔ EventStore | `useTimelineWithEose` → `pool.req` → `mapEventsToStore` → `eventStore.timeline` | Reuse as-is; new hooks differ only in `kinds` + cast class |
| Entity factory ↔ relay | `EntityFactory.create()…sign(signer)` → `publish(event, {routing})` | Same publish seam; Beacon updates use `routing:'outbox'` + throttle |
| Curated lane ↔ EventStore | inline naddr → `a` tags → `getReplaceable` per coord | `references.ts` reused for Article + Group pinned refs |
| Attach lane ↔ relay | `{ kinds:[37515], '#c':[groupCoord] }` discovery sub | `scope.ts` reused; gated by `allowForeignAttachments` |
| Validation ↔ UI | `validateDatasetForContext` (→ worker) returns `ContextValidationResult` | Result type unchanged; only execution moves off-thread |
| Beacon/Sighting ↔ map | LayerManager `source.setData()` per store emit | New `beacons` source/layer; mirrors `SOURCE_CURSOR` pattern |
| Comments ↔ new kinds | 37517 `K`/`k` root-scope widened to new kinds | `geo-comment` minimal change; reactions (kind 7) need no change |

### External services

| Service | Integration pattern | Notes |
|---------|---------------------|-------|
| Khatru relay | `pool.req` (read) / `pool.publish` (write); must index `#c`,`#a`,`#L`,`#l`,`#d` | Verify relay honors NIP-40 expiration GC for beacons |
| NostrIDB cache | `persistEventsToCache` + `queryCache` | Free durable last-known beacon position + offline curated lanes |
| MapLibre GL | `GeoJSONSource.setData` via LayerManager | Moving-point = one source, tweened with rAF |

---

## Suggested Build Order (dependency-aware)

Honors "spec → event classes → read/render → authoring UI per kind" and "amend don't replace."

```
0. SPEC v2  (SPEC.md rewrite)                    [blocks everything]
   - assign kinds (37520 Article, 37521 Beacon, ~Sighting), define L/l/t/c/a usage,
     Group governance ladder, Beacon transport (replaceable + NIP-40), Sighting time fields.

1. FOUNDATION (parallel-safe, low risk)
   1a. kinds.ts constants                                    [indep]
   1b. tags.ts shared helper extraction (bbox/g/L/l/t/c/a)   [indep, refactor existing]
   1c. validation worker (move Ajv off-thread)               [indep, refactor existing]

2. GROUP (37518 slim)  — do FIRST among kinds: it is a rename/refactor of existing map-context,
   lowest risk, and exercises the push/attach lane + governance + validation seams the others reuse.
   group/{helpers,cast,factory,index} (renamed) → useGroups → GroupViewPanel two-lane → GroupEditorPanel

3. ARTICLE (~37520)  — depends on tags.ts + references.ts (pull lane) + 37519 proposals (reuse).
   Independent of Group. article/* → useArticles → ArticleViewPanel (Markdown+naddr) → ArticleEditorPanel.

4. SIGHTING (~temporal)  — depends on tags.ts only. Simplest entity (static point + time fields).
   Fully independent; can run parallel to Article. temporal-sighting/* → useSightings → SightingMarker/Panel.

5. BEACON (~37521)  — depends on tags.ts + a NEW LayerManager live source. Most novel (live transport).
   Independent of Article/Group/Sighting; sequence last so map-render work doesn't block schema work.
   live-beacon/* → useLiveBeacons → LayerManager beacons source → BeaconPublishControl.

6. CROSS-CUTTING (after kinds land)
   - geo-comment K/k widening for all new kinds; reactions verified.
   - routing focusTypes (article|group|beacon|sighting) in useRouting.
   - taxonomy L/l authoring + t discovery surfaces.
```

**Independent vs sequential:**
- **Sequential prereqs:** Spec (0) → Foundation (1) → everything. Group (2) is the recommended first kind because it is a refactor that validates the shared seams.
- **Independent of each other:** Article (3), Sighting (4), Beacon (5) share no runtime dependency once Foundation lands — any order or parallel plans. Article additionally reuses 37519 (already shipped). Beacon alone needs new map-render work.

---

## Sources

- `src/lib/nostr/index.ts`, `hooks.ts`, `kinds.ts` — applesauce singletons, `useTimelineWithEose`, publish seam (codebase, HIGH)
- `src/lib/nostr/{geo-event,map-context}/{cast,factory,helpers}.ts` — Factory+Cast house pattern (codebase, HIGH)
- `src/lib/context/{validation,references,scope}.ts` + `src/components/info-panel/MapContextViewPanel.tsx` — two-lane (curate vs attach) + validation seams (codebase, HIGH)
- `src/features/geo-editor/core/managers/LayerManager.ts`, `api/authoring.ts` — GeoJSONSource.setData render path + single mutation seam (codebase, HIGH)
- `node_modules/applesauce-core/dist/event-store/event-store.d.ts` — `getReplaceable`/`getTimeline`/`getByFilters`/`removeByFilters` surface (library types, HIGH)
- `.planning/PROJECT.md`, `SPEC.md` — target entity model, constraints, current 37518 two-lane spec (HIGH)
- NIP-40 (expiration), NIP-52 (time-based), NIP-32 (L/l labeling) — protocol conventions for beacon expiry, sighting time, taxonomy (MEDIUM — confirm relay support in spec phase)

---
*Architecture research for: Nostr geo entity model split (v1.2)*
*Researched: 2026-06-23*
