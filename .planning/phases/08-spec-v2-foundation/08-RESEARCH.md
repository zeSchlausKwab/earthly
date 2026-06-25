# Phase 8: Spec v2 + Foundation - Research

**Researched:** 2026-06-25
**Domain:** Nostr event-class modeling (Factory+Cast), shared tag-helper extraction, off-thread untrusted-schema validation (Web Worker + Ajv), in-content version discrimination, NIP-40 expiry, NIP-32 `L`/`l` taxonomy
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Assign `TEMPORAL_SIGHTING_KIND = 37522` **now** in `kinds.ts` and SPEC v2. Block is contiguous: **37520 Article · 37521 Beacon · 37522 Sighting** (Group stays 37518 slimmed; Dataset 37515 / Comment 37517 / Proposal 37519 unchanged).
- **D-02:** Phase 11 may still pivot Sighting *representation* (dedicated kind vs 37515+property) — the **number is reserved** regardless, so Foundation seams (tags.ts, discriminator) can reference it. SPEC v2 documents it as the assigned-and-recommended dedicated kind, with a note that Phase 11 confirms representation.
- **D-03:** **Silent drop.** New-model events carry an in-content `modelVersion` discriminator. On read, an event whose `modelVersion` is **absent or unrecognized** is classified legacy/inert and **never enters the render set** — no chip, no placeholder, no user-facing noise.
- **D-04:** Clean-break stance: legacy 37518 is treated as "no longer exists" from the UX's point of view. No migration, no back-compat rendering. (Detection keys off the discriminator; for 37518 specifically, legacy = missing v2 discriminator / missing slimmed `governance` shape.)
- **D-05:** Phase 8 ships the NIP-32 paired-emit helper (`["L", ns]` + `["l", value, ns]`) **and** a starter controlled vocabulary — not helper-only.
- **D-06:** Namespace = flat **`earthly`** (not reverse-DNS `org.earthly.*`, not per-axis). `["L", "earthly"]` / `["l", <value>, "earthly"]`.
- **D-07:** Starter vocab axis = **feature category** — a small controlled set (`natural`, `infrastructure`, `amenity`, `route`, `boundary`) that a schema-Group can later enforce on attachments. Freeform `t` hashtags remain available and must not double-encode what `L`/`l` governs.

### Claude's Discretion (resolved defaults — user opted not to discuss)

- **SPEC.md v2 form:** rewrite the existing 421-line `SPEC.md` **in place** (clean break); v1 stays in git history. No parallel/versioned spec file.
- **`tags.ts` migration blast radius:** extract the shared helpers **and** migrate the two existing shipped kinds (`geo-event/helpers.ts`, `map-context/helpers.ts`) to consume `tags.ts` — they become the first consumers (no lingering copy-paste). Keep the diff to the shipped surface tight.
- **Schema worker hardening:** Web Worker, hard timeout-kill (≤100ms), compile-once per schema-hash cache, reject external/recursive `$ref`, cap byte-size/depth/nesting before compile, Ajv `$data` **off**, draft-2020-12 dialect pinned (`ajv/dist/2020`).
- **`modelVersion` shape/placement:** in-content field; exact key + value scheme is planner/research detail, constrained only by D-03 (absence/mismatch ⇒ skip) and the requirement that it round-trips through Factory+Cast.
- **NIP-40 expiry filter:** single shared `isExpired` wrapper over `applesauce-core/helpers/expiration`, client-filters `expiration < now` at all read paths regardless of relay GC.

### Deferred Ideas (OUT OF SCOPE)

- **Dev-visible legacy logging** (`console.debug('skipped legacy 37518 …')`) — pure silent drop preferred.
- **SPEC.md versioned/parallel form** — rejected in favor of in-place rewrite.
- **Per-axis / reverse-DNS taxonomy namespaces** — flat `earthly` chosen.
- **Group governance ladder, NO-MOD MINIMUM, schema-authoring UI** — Phase 9.
- **Sighting representation final call** — Phase 11 (number 37522 reserved regardless).
- **Beacon lifecycle (replaceable+NIP-40 vs ephemeral)** — Phase 12.
- **Per-kind authoring UI for any of the four kinds** — Phases 9–13. Phase 8 is foundation/scaffolding only.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPEC-01 | SPEC.md v2 documents the split entity model (Story ~37520, slimmed Group 37518, Live Beacon ~37521, Temporal Sighting 37522), final kind numbers, replacing overloaded 37518 "context". | In-place SPEC.md rewrite (421 lines today). Kind block + `L`/`l`/`t`/`c`/`a` usage + `modelVersion` contract + governance-ladder placeholder documented. Section map in `## Code Examples`. |
| SPEC-02 | Each new kind has Factory+Cast scaffolding (`helpers.ts`/`cast.ts`/`factory.ts`/`index.ts`) consuming one shared `tags.ts` for `bbox`/`g`/`L`/`l`/`t`/`c`/`a` — no copy-pasted tag logic. | `map-context/{cast,factory,helpers}.ts` is the proven 4× template (`Standard Stack`, `Pattern 1`). `tags.ts` extraction from `geo-event/helpers.ts` + `map-context/helpers.ts` (`Pattern 2`). Casting contract = official `EventCast`/`castEvent`. |
| SPEC-03 | Every new-model event carries an in-content version discriminator; client defensively parses so legacy 37518 events are recognized and skipped, not mis-rendered/crashing. | `modelVersion` in-content field; `is<Entity>()` type guard widened to gate on discriminator; defensive `JSON.parse` already in `getMapContextContent`. `Pattern 3`, Pitfall 1. |
| SPEC-04 | Group schema + geometry validation runs off the main thread in a Web Worker, hard timeout-kill, schema-hash–cached, restricted dialect (no `$data`, no external `$ref`, size/depth capped). | New `src/lib/validation/schemaWorker.ts`; reuses the v1.1 `quickjsWorker.ts` host-watchdog + `terminate()` harness and the `workerAssets.ts` registration pattern. `Pattern 4`, Pitfall 2. **The worker registration wiring is the #1 gotcha — see Common Pitfalls.** |
| SPEC-05 | NIP-40 expiration is shared infrastructure — client always filters expired events on read regardless of relay GC. | `isExpired` wrapper over `applesauce-core/helpers/expiration` (`isExpired`/`getExpirationTimestamp` confirmed in installed dist). `Pattern 5`, Pitfall 3. |
| TAX-01 | NIP-32 `L`/`l` controlled-vocabulary labels with correct namespace pairing; schema Group can enforce allowed `l`-set; freeform `t` hashtags remain — three-way `L`/`l`·`t`·`c` split. | Paired-emit helper in `tags.ts` (`["L","earthly"]` + `["l",val,"earthly"]`); starter vocab const (D-07); `t`/`L`-`l` disjointness rule. `Pattern 6`, Pitfall 4. |
</phase_requirements>

## Summary

Phase 8 is **foundation plumbing, not product**: it stands up the six shared seams that Phases 9–13 inherit, plus Factory+Cast scaffolding for the three net-new kinds, and rewrites SPEC.md to v2. There is **zero greenfield design and zero new dependency** — every capability is already installed and proven in production. The Factory+Cast house pattern exists 4× in `src/lib/nostr/`; the off-thread-timeout-kill worker harness exists in `src/features/chat/sandbox/transport/quickjsWorker.ts`; Ajv-2020 validation exists in `src/lib/context/validation.ts`; `applesauce-core/helpers/expiration` ships `isExpired`. The work is **extraction, mirroring, and hardening** of code that already works.

The single highest-leverage correctness target is the **schema worker (SPEC-04)**. It is the one piece that introduces a genuinely new trust boundary — an Ajv schema authored by a stranger and fetched from a relay is untrusted executable code (ReDoS `pattern`, recursive `$ref`). Phase 8 must land it as a hardened, off-thread, timeout-killed, size/depth-capped, `$data`-off, `$ref`-rejecting worker with a typed call interface — but **not** wire it into any Group pipeline (that is Phase 9). The second non-obvious risk is purely mechanical: this codebase's Web Workers do **not** spawn via the idiomatic `new Worker(new URL(...))` form; a new worker must be registered in `src/lib/workers/workerAssets.ts` **and** added as an entrypoint in `build.ts` **and** served by the dev route in `src/index.ts`, or it silently fails to load in dev/prod (this exact omission caused a Phase 4 UAT blocker).

The remaining five seams are low-risk refactors/wrappers: `kinds.ts` gets three constants; `tags.ts` extracts the `bbox`/`g`/`L`/`l`/`t`/`c`/`a` getters/setters currently copy-pasted between `geo-event` and `map-context` (and migrates both to consume it); the `modelVersion` discriminator is a content field plus a guard-tightening; `isExpired` is a one-line wrapper; the NIP-32 helper is a 2–3-string-tag pair builder plus a frozen starter-vocab array. All are prime pure-function unit-test targets — the Validation Architecture below specifies exactly which seams are sampled and how.

**Primary recommendation:** Build the six seams as independent, individually-testable modules in this order — `kinds.ts` → `tags.ts` (+migrate two consumers) → `modelVersion` discriminator + defensive parse → `isExpired` wrapper → NIP-32 `L`/`l` helper + starter vocab → `schemaWorker.ts` (the one that needs the worker-registration wiring) — then the three Factory+Cast scaffolds, then the SPEC.md v2 rewrite last (it documents what the code now is). Do **not** wire any seam into a Group/Story/Beacon/Sighting pipeline; ship typed interfaces only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Kind constants (`ARTICLE/LIVE_BEACON/TEMPORAL_SIGHTING_KIND`) | Nostr event layer (`src/lib/nostr/kinds.ts`) | — | Single existing constant module; pure additive. |
| Shared tag read/write (`tags.ts`) | Nostr event layer | — | Pure functions over `NostrEvent.tags`; no UI, no relay, no worker. |
| Factory+Cast scaffolding (3 new kinds) | Nostr event layer (`src/lib/nostr/<entity>/`) | — | Read (`cast.ts`/`EventCast`) + write (`factory.ts`/`EventFactory`) views over raw events. No render, no hook (hooks are later phases). |
| `modelVersion` discriminator + defensive parse | Nostr event layer (per-kind `helpers.ts` type guard) | — | Content-shape gate; lives in the `is<Entity>()` guard so nothing downstream sees a legacy event. |
| Schema validation (off-thread) | Worker thread (`src/lib/validation/schemaWorker.ts`) | Build/serve infra (`workerAssets.ts`, `build.ts`, `src/index.ts`) | Untrusted CPU-bound compute must leave the main thread; worker artifact must be registered + served. |
| NIP-40 `isExpired` filter | Nostr event layer (`src/lib/nostr/` wrapper) | Read hooks (later phases consume) | Pure predicate over a tag + local clock; applied at read-time by callers. |
| NIP-32 `L`/`l` paired emit + vocab | Nostr event layer (`tags.ts` writer + vocab const) | Schema layer (Phase 9 enforces) | Tag construction is a write helper; enforcement is a later-phase schema concern. |
| SPEC.md v2 | Documentation | — | Describes the above; no runtime tier. |

## Standard Stack

> **All libraries already installed. Zero additions to `package.json`. This phase adds NO runtime dependency.** Verified against `package.json` + installed `node_modules/.../dist/*.d.ts` (see Package Legitimacy Audit).

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-core` | 6.1.0 | `EventCast`/`castEvent` (casting contract), `EventFactory` (writes), `helpers/event` (`getTagValue`, `KnownEvent`), `helpers/expiration` (`isExpired`), `helpers/tags` (`ensureNamedValueTag`, `processTags`), `helpers/cache` (`getOrComputeCachedValue`) | Already the read/write seam for 37515/37517/37518/37519. Maintainer-mandated casting contract. `[VERIFIED: node_modules/applesauce-core/dist/casts/cast.d.ts, helpers/expiration.d.ts, helpers/tags.d.ts]` |
| `ajv` (via `ajv/dist/2020`) | 8.20.0 | draft-2020-12 JSON-Schema validation inside the worker | Already used at `src/lib/context/validation.ts:26` (`new Ajv2020({allErrors:true,strict:false,validateSchema:true})`). 8.20.0 includes CVE-2025-69873 ReDoS fix (8.18.0) + prototype-pollution fix (8.19.0). `[VERIFIED: src/lib/context/validation.ts, package.json]` |
| `ajv-formats` | 3.0.1 | `format` keyword support for author schemas | Paired with Ajv-2020, already imported in `validation.ts`. `[VERIFIED: src/lib/context/validation.ts]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/lib/worldGeohash.ts` | in-repo | `g`-tag geohash (precision 5–7) on entity centroid | When `tags.ts` writes a `g` tag; reuse `lonLatToWorldGeohash(precision, lon, lat)`. `[VERIFIED: src/lib/worldGeohash.ts]` |
| `@turf/turf` | 7.3.5 | `turf.centroid` for the geohash input; geometry-type checks | Centroid for `g`; not heavily used in Phase 8 (no geometry authoring here). `[VERIFIED: package.json]` |
| `src/lib/nostr/dTag.ts` (`generateShortDTag`) | in-repo | Fresh `d` for new entities | Factory `create()` for each new kind, mirroring `map-context/factory.ts:36`. `[VERIFIED: src/lib/nostr/map-context/factory.ts]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ajv/dist/2020` | `@cfworker/json-schema`, `djv` | Smaller bundle but loses draft-2020-12 keyword completeness; Ajv already bundled and battle-tested for untrusted schemas. Not worth a swap. `[CITED: .planning/research/STACK.md]` |
| in-repo `worldGeohash.ts` | `ngeohash` | Only needed for geohash *neighbor* queries (not in scope). Adding it duplicates working code. `[CITED: .planning/research/STACK.md]` |
| hand-rolled `L`/`l` tag pair | a NIP-32 helper library | None exists or is needed; the tags are 2–3 strings. `[CITED: .planning/research/STACK.md]` |

**Installation:**
```bash
# Nothing required. This phase adds ZERO runtime dependencies.
```

## Package Legitimacy Audit

> No external packages are installed in this phase. All libraries are pre-existing, in-production dependencies; no `npm install` runs. Audit covers the libraries the phase *consumes* for completeness.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| applesauce-core@6.1.0 | npm | mature | in-prod | github.com/hzrd149/applesauce | OK | Pre-installed; no action |
| ajv@8.20.0 | npm | 9+ yrs | 200M+/wk | github.com/ajv-validator/ajv | OK | Pre-installed; no action |
| ajv-formats@3.0.1 | npm | mature | 20M+/wk | github.com/ajv-validator/ajv-formats | OK | Pre-installed; no action |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         SPEC.md v2  (documents the whole split — written LAST)
                                  │ describes
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  src/lib/nostr/kinds.ts   ── ARTICLE_KIND 37520 · LIVE_BEACON_KIND 37521   │
│                              · TEMPORAL_SIGHTING_KIND 37522 (additive)     │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ imported by
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  src/lib/nostr/tags.ts  (NEW shared)                                       │
│   read:  getBbox · getGeohash · getHashtags(t) · getLabels(L/l) ·          │
│          getContextRefs(c) · getReferencedAddresses(a)                     │
│   write: setBbox · setGeohash · setHashtags · setLabels(paired L/l) ·      │
│          setContextRefs · setReferencedAddresses                          │
│   vocab: FEATURE_CATEGORY_VOCAB = [natural,infrastructure,amenity,         │
│          route,boundary]  +  EARTHLY_LABEL_NAMESPACE = 'earthly'           │
└───┬───────────────┬───────────────┬───────────────────────────────────────┘
    │ migrated to    │ migrated to    │ consumed by (NEW scaffolds)
    ▼                ▼                ▼
geo-event/        map-context/    article/  live-beacon/  temporal-sighting/
helpers.ts        helpers.ts      └─ helpers.ts (modelVersion guard) ────────┐
(first consumer)  (first consumer)   cast.ts (EventCast)  factory.ts         │
                                     index.ts (barrel)                       │
                                                                             │
   ┌─────────────────────────────────────────────────────────────────┐     │
   │  modelVersion discriminator  (in-content field)                  │◄────┘
   │   is<Entity>(e):  kind match  AND  content.modelVersion === MV    │
   │   legacy 37518 (absent MV) ⇒ guard returns false ⇒ never rendered │
   └─────────────────────────────────────────────────────────────────┘

   ┌─────────────────────────┐        ┌──────────────────────────────────────┐
   │  isExpired(event)        │        │  src/lib/validation/schemaWorker.ts  │
   │  wraps applesauce-core/  │        │  (NEW Web Worker — typed iface only) │
   │  helpers/expiration      │        │  ┌────────────────────────────────┐  │
   │  → callers filter at     │        │  │ main thread: validateSchema(   │  │
   │    read (Phases 11,12)   │        │  │   schemaHash, schema, data)    │  │
   └─────────────────────────┘        │  │   → post to worker             │  │
                                      │  │   → host setTimeout watchdog   │  │
   WORKER WIRING (gotcha):            │  │   → on overrun: worker.        │  │
   workerAssets.ts  (register id)     │  │     terminate() + fail-closed  │  │
   build.ts         (entrypoint)      │  ├────────────────────────────────┤  │
   src/index.ts     (dev /workers/)   │  │ worker: Ajv2020 ($data OFF,    │  │
                                      │  │  reject $ref, cap size/depth,  │  │
                                      │  │  compile-once per schemaHash)  │  │
                                      │  └────────────────────────────────┘  │
                                      └──────────────────────────────────────┘
   (Phase 9 wires the worker into the Group validate-on-fetch pipeline;
    Phase 8 ships the worker + interface, NOT the wiring.)
```

### Recommended Project Structure
```
src/lib/nostr/
├── kinds.ts                 # MODIFIED: +3 constants (37520/37521/37522)
├── tags.ts                  # NEW: shared bbox/g/L/l/t/c/a read+write + vocab const
├── modelVersion.ts          # NEW (or fold into tags.ts/helpers): MV constant + parse guard
├── expiry.ts                # NEW: isExpired wrapper over applesauce expiration (or fold into tags.ts)
├── geo-event/helpers.ts     # MODIFIED: consume tags.ts (first consumer, drop copy-paste)
├── map-context/helpers.ts   # MODIFIED: consume tags.ts (first consumer, drop copy-paste)
├── article/                 # NEW ~37520 scaffold: cast.ts factory.ts helpers.ts index.ts
├── live-beacon/             # NEW ~37521 scaffold: cast.ts factory.ts helpers.ts index.ts
└── temporal-sighting/       # NEW 37522 scaffold: cast.ts factory.ts helpers.ts index.ts

src/lib/validation/
└── schemaWorker.ts          # NEW: main-thread client + worker module (off-thread Ajv)
src/lib/workers/
└── workerAssets.ts          # MODIFIED: register the schema worker id + servedName + sourcePath
build.ts                     # MODIFIED: add schema worker as an explicit build entrypoint
src/index.ts                 # MODIFIED: (already generic) /workers/:name route serves it

SPEC.md                      # MODIFIED IN PLACE: v2 rewrite (LAST)
```

### Pattern 1: Factory + Cast per kind (the repo's universal Nostr seam)
**What:** Every kind has (a) `helpers.ts` — pure cached tag/content getters + an `is<Entity>()` type guard + the `<Entity>Event = KnownEvent<typeof KIND>` type; (b) `cast.ts` — an `EventCast<…>` subclass with typed getters over a raw event, throwing in the constructor if the guard fails; (c) `factory.ts` — an `EventFactory<typeof KIND>` subclass with `static create()` / `static modify()` + fluent tag setters; (d) `index.ts` — barrel re-export.
**When to use:** All three new kinds, identically. Non-negotiable house style; mirror `map-context/` exactly.
**Example:**
```typescript
// Source: src/lib/nostr/map-context/cast.ts (the template to mirror)
import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'

export class LiveBeacon extends EventCast<LiveBeaconEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isLiveBeacon(event)) throw new Error('Event is not a LiveBeacon (kind 37521)')
    super(event, store)
  }
  get dTag() { return getEntityId(this.event) }
  get expiresAt() { return getExpirationTimestamp(this.event) } // NIP-40
  rawEvent() { return this.event }
}
```
> **Casting contract (maintainer-mandated):** new classes MUST extend `EventCast` and be consumed via `castEvent()`/`castEventStream()`/`castTimelineStream()`; reads via `eventStore.replaceable()`; writes via `EventFactory` blueprints. `map-context/cast.ts:5` already imports `EventCast` from `applesauce-core/casts` — mirror it verbatim. Reference: https://applesauce.build/apps/casting/events.html

### Pattern 2: `tags.ts` extraction — the only new abstraction
**What:** Today `getBoundingBox`/`getGeohash`/`getHashtags`/`getContextReferencesOnContext`/`getContextReferencedAddresses` are copy-pasted between `geo-event/helpers.ts` and `map-context/helpers.ts`. Extract a single generic implementation per tag into `tags.ts` (read + write), then re-export/delegate from both existing helpers (the discretion decision: migrate both shipped consumers now).
**When to use:** Once, in Phase 8, while touching all consumers. Do **not** over-abstract beyond tag read/write — content shapes stay per-kind.
**Example (the shape to generalize, from the two existing helpers):**
```typescript
// Source: src/lib/nostr/map-context/helpers.ts:94 (bbox) + :112 (t) + :124 (c) + :132 (a)
export function getBbox(event: NostrEvent): GeoBoundingBox | undefined {
  const raw = getTagValue(event, 'bbox')
  if (!raw) return undefined
  const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()))
  return parts.length === 4 && !parts.some(Number.isNaN) ? (parts as GeoBoundingBox) : undefined
}
export function getHashtags(event: NostrEvent): string[] {       // `t`
  return event.tags.filter((t) => t[0] === 't' && typeof t[1] === 'string').map((t) => t[1] as string)
}
export function getContextRefs(event: NostrEvent): string[] {    // `c`
  return event.tags.filter((t) => t[0] === 'c' && t[1]).map((t) => t[1] as string)
}
export function getReferencedAddresses(event: NostrEvent): string[] { // `a`
  return event.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1] as string)
}
```
Writers mirror `map-context/factory.ts:66-121` (`bbox`/`hashtags`/`contextReferences`/`referencedAddresses` setters: filter-out-then-append). The `g` writer uses `lonLatToWorldGeohash`.

### Pattern 3: `modelVersion` discriminator + defensive parse (SPEC-03)
**What:** Define one `MODEL_VERSION` constant (e.g. content field `modelVersion: 'earthly/2'` — exact string is planner detail). Each new kind's `create()` factory writes it into content; each kind's `is<Entity>()` guard requires the kind match **and** a recognized `modelVersion`. Legacy 37518 (absent/unrecognized `modelVersion`) fails the guard, so it never reaches a cast and never enters any render set (silent drop, D-03).
**When to use:** All new-model events. The 37518 Group case is special: the slimmed Group is *also* 37518, so its guard distinguishes new-Group (has `modelVersion` + slimmed `governance` shape) from legacy-context (neither). Phase 8 ships the contract + guard helper; Phase 9 builds the slimmed Group on top.
**Example:**
```typescript
// Source: derived from src/lib/nostr/map-context/helpers.ts:67 (existing guard) + :75 (defensive JSON.parse)
export const MODEL_VERSION = 'earthly/2'
export function hasCurrentModelVersion(event: NostrEvent): boolean {
  try {
    const c = JSON.parse(event.content) as { modelVersion?: unknown }
    return c?.modelVersion === MODEL_VERSION
  } catch { return false }            // unparseable ⇒ legacy/inert ⇒ skipped
}
export function isLiveBeacon(event: NostrEvent): event is LiveBeaconEvent {
  return event.kind === LIVE_BEACON_KIND
    && getTagValue(event, 'd') !== undefined
    && hasCurrentModelVersion(event)   // legacy/absent MV ⇒ false ⇒ never rendered
}
```
**Anti-pattern guarded:** never `throw` on a legacy/foreign-relay event during a list map — the guard must return `false`, not raise. The existing `getMapContextContent` already swallows parse errors (`helpers.ts:81`); preserve that discipline.

### Pattern 4: Off-thread schema validation worker (SPEC-04)
**What:** Move Ajv compile+validate off the main thread into `src/lib/validation/schemaWorker.ts`, hardened against an untrusted relay-authored schema. Reuse the v1.1 host-watchdog shape from `quickjsWorker.ts`: a main-thread client posts `{schemaHash, schema, data}`; a host `setTimeout` watchdog (≤100ms + slack) `terminate()`s the worker on overrun and resolves a fail-closed `"could not validate"` result; a fresh worker is lazily recreated. Inside the worker: one `Ajv2020` instance with `$data` **off**, `validateSchema:true`; reject any schema containing `$ref`; cap byte-size / nesting depth / keyword count **before** `compile`; compile-once and cache the compiled validator keyed by `schemaHash`.
**When to use:** Ship the worker + typed `validateSchema()` interface in Phase 8. Do **not** wire it into a Group pipeline — that is Phase 9 (`validation.ts::validateDatasetForContext` migrates onto it there). Keep a synchronous in-thread fast-path fallback for `bun test`/SSR where `Worker` is unavailable (mirror `quickjsWorker.ts`'s `runSandboxCode` fallback) so the hardening is unit-testable without a live Worker.
**⚠️ Worker registration is mandatory and non-obvious (see Common Pitfalls):**
```typescript
// Source: src/lib/workers/workerAssets.ts:44 — add one entry:
export const WORKER_ASSETS = {
  /* …sandbox, ingest, geoJsonParse, optimize… */
  schema: {
    servedName: 'schema.worker.js',
    sourcePath: 'src/lib/validation/schema.worker.ts',
  },
} as const satisfies Record<string, WorkerAsset>
// Then: build.ts adds it as an entrypoint (build.ts:259+), and src/index.ts serves it
// via the generic /workers/:name route (index.ts:406) — both already iterate WORKER_ASSETS.
```
```typescript
// Worker-side hardening (the safe-subset gate, run BEFORE ajv.compile):
function rejectUnsafeSchema(schema: unknown): void {
  const json = JSON.stringify(schema)
  if (json.length > MAX_SCHEMA_BYTES) throw new Error('schema too large')
  if (/"\$ref"|"\$dynamicRef"/.test(json)) throw new Error('$ref not allowed')
  if (depthOf(schema) > MAX_DEPTH) throw new Error('schema too deep')
}
const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true }) // $data OFF (default)
```

### Pattern 5: Shared NIP-40 `isExpired` filter (SPEC-05)
**What:** A one-function wrapper over `applesauce-core/helpers/expiration` so every read path has a single import to filter on. The library already provides `isExpired(event)` and `getExpirationTimestamp(event)` (`[VERIFIED: node_modules/applesauce-core/dist/helpers/expiration.d.ts]`).
**When to use:** Phase 8 ships the wrapper; Phases 11 (Sighting) and 12 (Beacon) call it at every read. No relay GC is trusted.
```typescript
// Source: node_modules/applesauce-core/dist/helpers/expiration.d.ts (isExpired present)
import { isExpired as coreIsExpired } from 'applesauce-core/helpers/expiration'
export function isExpired(event: NostrEvent): boolean { return coreIsExpired(event) }
// Optional convenience: const dropExpired = <T extends NostrEvent>(es: T[]) => es.filter((e) => !isExpired(e))
```
> Wrapping (vs. importing the lib directly everywhere) is the locked discretion default — it gives one seam to add UTC-clock-skew handling or telemetry later.

### Pattern 6: NIP-32 `L`/`l` paired emit + starter vocab (TAX-01)
**What:** A single writer that emits `["L","earthly"]` **and** one `["l", value, "earthly"]` per label, from one call — so an `l` is never published without its matching `L` (the NIP-32 mark-pairing requirement). Plus a frozen `FEATURE_CATEGORY_VOCAB` starter set. `t` hashtags stay separate and must not encode a value already governed by `L`/`l`.
```typescript
// Source: NIP-32 (L = namespace, l = label+mark); applesauce helpers/tags::ensureNamedValueTag
export const EARTHLY_LABEL_NAMESPACE = 'earthly'                       // D-06: flat namespace
export const FEATURE_CATEGORY_VOCAB = [
  'natural', 'infrastructure', 'amenity', 'route', 'boundary',        // D-07
] as const
export function setLabels(tags: string[][], values: string[]): string[][] {
  const cleaned = tags.filter((t) => t[0] !== 'L' && t[0] !== 'l')    // replace existing
  if (values.length === 0) return cleaned
  return [
    ...cleaned,
    ['L', EARTHLY_LABEL_NAMESPACE],                                   // exactly one L
    ...values.map((v) => ['l', v, EARTHLY_LABEL_NAMESPACE]),          // each l carries the mark
  ]
}
export function getLabels(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === 'l' && t[2] === EARTHLY_LABEL_NAMESPACE)
    .map((t) => t[1] as string)
}
```
**Disjointness rule (TAX-01):** document in SPEC v2 and enforce in the helper that a `t` value MUST NOT duplicate an `l` value — `L`/`l` = controlled/enforceable; `t` = freeform discovery; `c` = entity-backed attach. Three axes, no overlap.

### Anti-Patterns to Avoid
- **Adding an `entityType` content field to 37518 instead of separate kinds** — re-introduces the discriminated-union bloat this whole milestone removes. Use one kind per role. `[CITED: .planning/research/ARCHITECTURE.md Anti-Pattern 1]`
- **Re-implementing tag getters per new kind** — exactly what `tags.ts` exists to prevent. `[CITED: .planning/research/ARCHITECTURE.md Anti-Pattern 2]`
- **Running the untrusted Group schema on the main thread** — never; it is attacker-authored code. `[CITED: PITFALLS Pitfall 2]`
- **`throw`ing on a legacy/unrecognized event in a list map** — the guard returns `false`; raising crashes the viewer (the exact SPEC-03 failure mode).
- **Spawning the worker via `new Worker(new URL('./x.worker.ts', import.meta.url))`** — does not work in this app's dev or prod bundling (documented in `workerAssets.ts`); use the registry + `workerUrl()`.
- **Wiring any seam into a per-kind UI/pipeline in Phase 8** — scope is foundation + scaffolding only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NIP-40 expiry check | Manual `expiration`-tag parse + `Date.now()` compare | `applesauce-core/helpers/expiration::isExpired` (wrapped) | Edge cases (tag absent, non-numeric) already handled; one source of truth. |
| Off-thread timeout-kill | A fresh `new Worker` per call + ad-hoc terminate | The `quickjsWorker.ts` warm-worker + host-watchdog harness shape | Per-call worker spawn caused a Phase 4 OOM runaway; the warm-pool + watchdog pattern is proven. |
| Worker URL resolution | `new Worker(new URL(...))` | `workerAssets.ts` registry + `workerUrl(id)` | The idiomatic form silently 404s→`index.html` in both dev and prod here. |
| draft-2020-12 validation | A custom validator / regex schema check | `ajv/dist/2020` (already configured in `validation.ts`) | Full keyword support + the ReDoS/proto-pollution patches; reuse the existing instance config. |
| naddr/coordinate parse (later phases) | Regex on `nostr:naddr…` | `applesauce-core/helpers/pointers` | Handles `nevent`/relay-hints; the old `map-context.ts` regex misses cases. (Not Phase 8 work, but seed `tags.ts`/SPEC accordingly.) |
| geohash | `ngeohash` | `src/lib/worldGeohash.ts` | Already encodes/decodes precision-parameterized; no new dep. |

**Key insight:** In this codebase the two genuinely hard problems (untrusted-schema isolation, worker bundling) are *already solved* — the failure mode is re-solving them differently. Mirror `quickjsWorker.ts` and `workerAssets.ts` exactly rather than inventing.

## Runtime State Inventory

> Phase 8 is additive (new constants/modules/scaffolds) plus an in-place doc rewrite and a refactor of two existing helpers. It is **not** a rename/migration of stored data. There is no data migration (clean-break, D-04). Still, two append-only-substrate realities matter:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Legacy kind-37518 "context" events persist on relays/caches forever (no global delete). v1.2 treats them as seed/test only. | **No migration.** Code action = the `modelVersion` guard (SPEC-03) so they fail every new guard and never render. |
| Live service config | None — Phase 8 publishes no new events and changes no relay config. The Khatru relay already indexes `#c`/`#a`/`#d`; `#L`/`#l` indexing is a Phase 9+ concern (verify when taxonomy queries ship). | None this phase. |
| OS-registered state | None — no schedulers, daemons, or OS registrations touched. | None. |
| Secrets/env vars | None — no new env vars; no secrets. `RELAY_URL`/`SERVER_PUBKEY`/`CLIENT_KEY` unchanged. | None. |
| Build artifacts | **NEW** worker artifact `dist/workers/schema.worker.js` must be emitted by `build.ts` and served (dev: on-demand `/workers/:name`; prod: copied to `dist/`). Forgetting this = the worker 404s at runtime. | Add the worker to `workerAssets.ts` + `build.ts` entrypoints (see Pattern 4). |

**Nothing found in OS-registered / secrets categories:** verified — Phase 8 has no runtime side effects beyond the new worker bundle and additive code.

## Common Pitfalls

### Pitfall 1: Worker silently fails to load (the #1 mechanical gotcha)
**What goes wrong:** A new worker spawned via `new Worker(new URL('./schema.worker.ts', import.meta.url), {type:'module'})` resolves to a `file://` URL in dev (cross-origin error) and to a non-existent path served as `index.html` in prod — the worker never runs, validation silently no-ops.
**Why it happens:** Bun's bundler does not auto-emit worker chunks from that form (Bun #7534/#7901/#16869) and the dev server substitutes the source `file://` path (Bun #17705). This caused a Phase 4 UAT blocker.
**How to avoid:** Register the worker in `src/lib/workers/workerAssets.ts`, add it as an explicit entrypoint in `build.ts`, spawn via `new Worker(workerUrl('schema'), {type:'module'})`. The dev route `/workers/:name` (`src/index.ts:406`) and the prod copy step already iterate `WORKER_ASSETS`, so registration is the only new step.
**Warning signs:** Validation always returns the fallback result; `/workers/schema.worker.js` returns HTML; no error in console because the fallback path swallows it.

### Pitfall 2: Untrusted schema as a DoS vector (SPEC-04 core threat)
**What goes wrong:** A relay-fetched Group schema with `^(a+)+$` ReDoS `pattern`, recursive `$ref`, or multi-MB nesting freezes/OOMs every viewer's tab when validated.
**Why it happens:** JSON-Schema "just validates" — the schema is treated as data, not as stranger-authored executable code.
**How to avoid:** Off-thread + hard timeout-kill (≤100ms) + fail-closed; reject `$ref`/`$dynamicRef`; cap byte-size/depth/keyword-count before `compile`; `$data` off; `validateSchema:true`; compile-once per `schemaHash`. (Phase 8 builds the guarded worker; Phase 9 feeds real Group schemas through it.)
**Warning signs:** Opening a specific Group freezes the UI; validate time grows superlinearly with input length.

### Pitfall 3: NIP-40 expiry is advisory, not enforced
**What goes wrong:** A non-compliant relay keeps serving an expired Sighting/Beacon; without a client filter it stays on the map forever.
**Why it happens:** Devs assume `expiration` tag ⇒ relay deletes. It is a hint; enforcement is the client's job against its own clock.
**How to avoid:** The shared `isExpired` wrapper, applied at every read path (Phases 11/12). Compare UTC epoch seconds only.
**Warning signs:** Expired events visible via one relay but not another; "current" query returns past events.

### Pitfall 4: NIP-32 unpaired `l` / double-encoding
**What goes wrong:** An `l` published without a matching `L` silently lands in the `ugc` namespace, breaking controlled-vocab queries; or the same concept is encoded as both `t` and `l`, recreating the overlap the milestone removes.
**Why it happens:** The mark-pairing requirement is easy to miss; the `t` vs `L`/`l` boundary blurs.
**How to avoid:** Emit `L`+`l` as a validated pair from one helper (Pattern 6); document and enforce `t`∩`l` = ∅. Flat `earthly` namespace (D-06) is the locked choice — note in SPEC v2 that this trades cross-app collision-resistance for simplicity (a deliberate, owner-approved tradeoff vs. reverse-DNS).
**Warning signs:** Labels appearing under `ugc`; the same category as both a `t` and an `l`.

### Pitfall 5: `d`-tag lineage breakage in scaffolds
**What goes wrong:** A factory `create()` that regenerates `d` on edit forks the entity; reusing a `d` across two entities overwrites one.
**Why it happens:** `d` generation wired into create then accidentally re-run on modify; the split multiplies create/edit surfaces.
**How to avoid:** Mirror `map-context/factory.ts` — `create()` calls `generateShortDTag()` only if no `d` exists (`factory.ts:34`); `modify()` preserves the existing template (`factory.ts:42`). Phase 8 scaffolds set the contract; later phases' authoring UIs verify it.
**Warning signs:** Editing creates a duplicate; comments detach after edit.

## Code Examples

### SPEC.md v2 — recommended section map (SPEC-01)
The current 421-line SPEC.md is plain-prose with `N Title` headers and `Tag Example Notes` tables (no `#` markdown headers, no kind-37518 split). The v2 rewrite (in place) should cover, in order:
```
1  GeoJSON Data Event (kind 37515)            — UNCHANGED semantics, keep
2  Geo Comment (kind 37517)                   — note K/k widening coming in Phase 13
3  Group / Topic (kind 37518, SLIMMED)        — modelVersion discriminator; governance ladder
                                                 placeholder (open|schema|closed, defined Phase 9);
                                                 c-attach + pinned-a two-lane; legacy-37518 clean break
4  Story / Article (kind 37520)               — NIP-23 metadata; inline naddr→a mirror (Phase 10)
5  Live Beacon (kind 37521)                   — replaceable + NIP-40 expiration (lifecycle Phase 12)
6  Temporal Sighting (kind 37522)             — NIP-52 start/end; NIP-40 expiry; representation
                                                 note (D-02: number assigned, repr confirmed Phase 11)
7  Tag vocabulary                             — bbox·g·t·L/l·c·a usage; the three-way L/l·t·c split;
                                                 earthly namespace (D-06); FEATURE_CATEGORY_VOCAB (D-07)
8  modelVersion discriminator + clean break   — absence/mismatch ⇒ legacy/inert/skipped (D-03/D-04)
9  Schema governance dialect                  — draft-2020-12 pinned; no $data; no external $ref;
                                                 size/depth caps; schema-hash (enforced Phase 9)
10 Expiration (NIP-40)                         — advisory; client always filters on read (SPEC-05)
```
Keep kinds 37516 (collection) and 34444 (map layer) sections if present; they are unchanged.

### Factory scaffold (mirror map-context, new kind)
```typescript
// Source: src/lib/nostr/map-context/factory.ts (template) — per new kind
export class TemporalSightingFactory extends EventFactory<typeof TEMPORAL_SIGHTING_KIND> {
  static create(content: Partial<SightingContent> = {}): TemporalSightingFactory {
    return new TemporalSightingFactory((resolve) => {
      const tpl = blankEventTemplate(TEMPORAL_SIGHTING_KIND)
      tpl.content = JSON.stringify({ modelVersion: MODEL_VERSION, ...content })   // SPEC-03
      if (!tpl.tags.some((t) => t[0] === 'd')) tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]
      resolve(tpl)
    })
  }
  static modify(event: TemporalSightingEvent): TemporalSightingFactory {          // preserves d
    return new TemporalSightingFactory((resolve) => resolve(toEventTemplate(event)))
  }
  // tag setters delegate to tags.ts (setBbox/setGeohash/setHashtags/setLabels/...)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overloaded kind-37518 "context" (taxonomy + validation + two reference directions in one discriminated union) | Four role-specific kinds (37520 Story / 37518 slimmed Group / 37521 Beacon / 37522 Sighting) | v1.2 (this milestone) | Relay kind-filters work per role; no content-discriminator branching. |
| Tag getters copy-pasted between `geo-event` and `map-context` | One shared `tags.ts` | Phase 8 | No drift across 6 kinds. |
| Ajv compiled per-validation on the main thread (`validation.ts`) | Off-thread, compile-once-per-hash, timeout-killed worker | Phase 8 (worker) → Phase 9 (wired) | Untrusted schema can't freeze the tab. |
| `t`-tag carrying both freeform + pseudo-taxonomy | `L`/`l` controlled + `t` freeform + `c` attach (disjoint) | Phase 8 (TAX-01) | Controlled vocab is queryable; no double-encode. |

**Deprecated/outdated:**
- Legacy 37518 content shape: superseded by slimmed Group + `modelVersion`; recognized-and-skipped, never migrated.
- Hand-rolled `nostr:(naddr1[a-z0-9]+)` regex in `map-context.ts`: prefer `applesauce-core/helpers/pointers` (relevant Phase 10, but don't re-introduce the regex in `tags.ts`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `modelVersion` value `'earthly/2'` is illustrative; exact key/value is planner detail (CONTEXT marks it discretion, constrained only by "absence/mismatch ⇒ skip" + "round-trips through Factory+Cast"). | Pattern 3 | Low — any stable, recognizable value satisfies D-03; pick one and document in SPEC v2 §8. |
| A2 | Schema-worker timeout = ≤100ms + slack (mirrors `quickjsWorker.ts` `WATCHDOG_SLACK_MS=500`); CONTEXT says "≤100ms". Exact slack is tunable. | Pattern 4 | Low — too tight risks false fail-closed on a large valid schema; start at 100ms in-VM + 500ms wall-clock slack like the sandbox. |
| A3 | Folding `isExpired`/`modelVersion` into `tags.ts` vs. separate files (`expiry.ts`/`modelVersion.ts`) is a structure choice, not a behavior choice. | Project Structure | None — pure organizational; either passes the same tests. |
| A4 | Phase 8 ships the schema worker with a typed interface but no Group wiring; the synchronous fallback (for `bun test`/SSR) is the path the Validation Architecture tests exercise. | Pattern 4 | Low — matches the established `quickjsWorker.ts` fallback so the hardening is testable without a live Worker. |
| A5 | SPEC v2 documents `governance: open\|schema\|closed` as a *placeholder* shape (Phase 9 defines the enum + backward-compat). | SPEC section map | Low — Phase 9 owns the enum; Phase 8 only reserves the field name in the spec so the discriminator can key off it. |

**If this table is empty:** it is not — but every entry is LOW risk and inside an explicitly-granted discretion area. No locked decision is assumed.

## Open Questions

1. **Exact `modelVersion` string + placement key**
   - What we know: in-content field; absence/mismatch ⇒ skip; must round-trip Factory+Cast (D-03 + discretion).
   - What's unclear: literal value (`'earthly/2'`? `2`? `{model:'earthly',v:2}`?) and whether it doubles as the 37518-slimmed-Group legacy discriminator.
   - Recommendation: pick a single string constant (`MODEL_VERSION`), write it in every new-kind `create()`, and for 37518 require it AND the slimmed `governance` field. Document in SPEC v2 §8. Resolve at plan time, not in code review.

2. **Should `tags.ts` migration touch `geo-event/factory.ts` writers too, or only the read helpers?**
   - What we know: discretion says migrate both `geo-event/helpers.ts` and `map-context/helpers.ts` to consume `tags.ts`; keep the diff tight.
   - What's unclear: whether the *factory* setters (bbox/hashtags/etc.) also centralize into `tags.ts`, or stay per-factory.
   - Recommendation: centralize read getters now (clear win, low risk); centralize write setters only if they're byte-identical across the two factories — otherwise keep per-factory to avoid a wide diff on shipped code. Planner decides per the "tight diff" constraint.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | all build/test | ✓ | per project | — |
| `applesauce-core` (casts, helpers/expiration, helpers/tags) | SPEC-02/05, TAX-01 | ✓ | 6.1.0 | — |
| `ajv` / `ajv-formats` | SPEC-04 worker | ✓ | 8.20.0 / 3.0.1 | — |
| Web Worker API | SPEC-04 (prod/dev) | ✓ (browser) / ✗ (bun test, SSR) | — | Synchronous in-thread `runSchemaValidation` fallback (mirrors `quickjsWorker.ts`) — keeps hardening unit-testable |
| `src/lib/workers/` registration infra | SPEC-04 wiring | ✓ | in-repo | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `Worker` is absent under `bun test`/SSR — the synchronous fallback path makes the schema-hardening logic testable there (required for the Validation Architecture below).

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is REQUIRED and is the source the Nyquist VALIDATION.md is generated from. Every claim below is grounded in the locked decisions and the proven test seams in this repo (`bun test`; existing suites under `src/**/.test.ts`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun test` (Bun's built-in runner — `bun:test`) |
| Config file | none — Bun auto-discovers `*.test.ts` (no jest/vitest config) |
| Quick run command | `bun test src/lib/nostr/ src/lib/validation/` |
| Full suite command | `bun test` |
| Existing precedent | `src/features/chat/sandbox/transport/wasmReuse.test.ts` (worker timeout proof), `src/lib/test-fixtures/geo.test.ts`, `src/features/geo-editor/commands.test.ts` |

The phase gates (per MEMORY tsc baseline note): `bun test` + `bun run build` + `biome` must be green. `tsc --noEmit` has a ~305-error pre-existing baseline and is **not** a gate — do not regress it but do not block on it.

### Phase Requirements → Test Map
| Req ID | Behavior (the observable seam) | Test Type | Automated Command | File Exists? |
|--------|--------------------------------|-----------|-------------------|-------------|
| SPEC-01 | SPEC.md v2 contains a section per kind (37515/37518/37520/37521/37522), the kind numbers, the `modelVersion` clause, and the `L/l·t·c` split. Assert presence by grepping the doc from a test (or a doc-lint test asserting required headings/strings). | doc-assertion (string presence) | `bun test src/lib/nostr/spec.doc.test.ts` | ❌ Wave 0 |
| SPEC-02 | Each new kind: `is<Entity>()` guard accepts a well-formed event and rejects wrong-kind; `<Entity>Factory.create()` produces an event with a `d` tag + `modelVersion` content; `cast` exposes typed getters; **all tag reads route through `tags.ts`** (assert `geo-event`/`map-context` round-trip a bbox/t/c/a identically via the shared helper). | unit (round-trip) | `bun test src/lib/nostr/tags.test.ts src/lib/nostr/article src/lib/nostr/live-beacon src/lib/nostr/temporal-sighting` | ❌ Wave 0 |
| SPEC-03 | A legacy-shaped 37518 event (no `modelVersion`, no slimmed `governance`) → `isGroup()`/`hasCurrentModelVersion()` returns `false` and **does not throw**; a malformed-JSON-content event also returns `false` without throwing; a new-model event returns `true`. Assert the event is excluded from a `filter(guard)` render set. | unit (guard + defensive parse) | `bun test src/lib/nostr/modelVersion.test.ts` | ❌ Wave 0 |
| SPEC-04 | (a) A ReDoS `pattern` schema (`^(a+)+$` over a long input) and a recursive/`$ref` schema and an oversized/deep schema each **fail-closed within the timeout** rather than hanging — assert the call resolves to a "could not validate" result in < (timeout+slack) wall-clock. (b) `$ref` is rejected before compile. (c) A valid schema compiles once and a second call with the same `schemaHash` reuses the cached validator (assert compile invoked once — spy/counter). (d) `$data` is off. Exercise via the **synchronous fallback** path (no live Worker under `bun test`). | unit (hardening) + timing-bounded | `bun test src/lib/validation/schemaWorker.test.ts` | ❌ Wave 0 |
| SPEC-05 | `isExpired(event)` returns `true` for `expiration < now`, `false` for future expiry and for no-expiration; a `dropExpired([...])` helper removes only expired events. Assert against a fixed clock (UTC epoch seconds), not local time. | unit (predicate) | `bun test src/lib/nostr/expiry.test.ts` | ❌ Wave 0 |
| TAX-01 | `setLabels(tags, ['natural','route'])` emits exactly one `["L","earthly"]` and one `["l",v,"earthly"]` per value (paired, marked); `setLabels(tags, [])` removes all `L`/`l`; `getLabels` reads back only `earthly`-namespaced `l` values; a round-trip (`setLabels`→`getLabels`) is stable; assert a `t` value equal to an `l` value is rejected/flagged (disjointness). | unit (pairing + round-trip + disjointness) | `bun test src/lib/nostr/tags.test.ts` | ❌ Wave 0 |

### Sampling Rate (the Nyquist seams)
- **Per task commit:** `bun test src/lib/nostr/ src/lib/validation/` (the six-seam unit suites — fast, < a few seconds).
- **Per wave merge:** `bun test` (full suite) + `bun run build` (proves the schema worker actually bundles + the `workerAssets.ts`/`build.ts` wiring is correct — a build that omits the worker entrypoint is a real, catchable failure here) + `biome`.
- **Phase gate:** full suite green + `bun run build` green + `biome` clean before `/gsd-verify-work`. The build step is load-bearing: it is the only automated check that the new worker is registered and emitted (Pitfall 1).

The correctness-measurement points (where each requirement becomes observable):
1. **Pure tag functions** (`tags.ts`) — round-trip read/write equality; the single sample point for SPEC-02 + TAX-01.
2. **Guard functions** (`is<Entity>`/`hasCurrentModelVersion`) — boolean truth table over {new, legacy, malformed} events; the sample point for SPEC-03.
3. **Worker hardening, synchronous fallback** — timing-bounded + verdict assertions over {ReDoS, `$ref`, oversized, valid, repeat-hash} schemas; the sample point for SPEC-04. (Live-Worker behavior is proven separately by `bun run build` emitting the artifact.)
4. **Expiry predicate** against a fixed clock — the sample point for SPEC-05.
5. **Doc-string presence** in SPEC.md — the sample point for SPEC-01.

### Wave 0 Gaps
- [ ] `src/lib/nostr/tags.test.ts` — covers SPEC-02 (tag round-trips, shared-helper equality across geo-event/map-context) + TAX-01 (`L`/`l` pairing, vocab, disjointness)
- [ ] `src/lib/nostr/modelVersion.test.ts` — covers SPEC-03 (guard truth table + defensive parse, no-throw)
- [ ] `src/lib/nostr/expiry.test.ts` — covers SPEC-05 (`isExpired`/`dropExpired` against a fixed UTC clock)
- [ ] `src/lib/validation/schemaWorker.test.ts` — covers SPEC-04 (ReDoS/`$ref`/oversized fail-closed within timeout via sync fallback; compile-once-per-hash; `$data` off)
- [ ] `src/lib/nostr/article/*.test.ts`, `live-beacon/*.test.ts`, `temporal-sighting/*.test.ts` — covers SPEC-02 (per-kind guard + `create()` `d`+`modelVersion` + cast getters)
- [ ] `src/lib/nostr/spec.doc.test.ts` — covers SPEC-01 (required headings/kind-numbers/clauses present in SPEC.md)
- [ ] No framework install needed — `bun test` is built-in.

## Project Constraints (from CLAUDE.md)

- **Runtime: Bun, never Node.** Use `bun test` (not jest/vitest), `bun build`, `Bun.file`, `bun:sqlite`, built-in `WebSocket`/`Worker`. Bun auto-loads `.env`.
- **State:** Zustand for local UI; Nostr events for shared/persistent state. (Phase 8 touches neither beyond event classes.)
- **Lint/format:** Biome (`bun run lint` / `lint:fix`) — not ESLint/Prettier. Must be clean at the gate.
- **Type-safe throughout:** TypeScript strict; new event classes fully typed via `KnownEvent<typeof KIND>`.
- **Feature-based structure; manager/hook patterns** — but Phase 8 stays in `src/lib/nostr/` + `src/lib/validation/`; no feature panels (those are Phases 9–13).
- **File references** in any docs use `file_path:line_number`.
- **Applesauce migration state (MEMORY):** the app is fully migrated to applesauce; only *seed scripts* remain on NDK. New code uses applesauce casts/factories. The maintainer mandates official `EventCast`/`castEvent`/`EventFactory` — not hand-rolled wrappers.

## Security Domain

> `security_enforcement: true`, ASVS Level 1, block-on `high`. The one new attack surface this phase introduces is the untrusted-schema worker.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added (Nostr signing unchanged). |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | The Group schema is untrusted input: off-thread Ajv, `$data` off, reject `$ref`, cap size/depth/keyword-count before compile, `validateSchema:true`. Legacy/malformed events: defensive parse (no-throw guard, SPEC-03). |
| V6 Cryptography | no (consumes only) | NIP-32/40 tags are plaintext; signing is applesauce's job — never hand-roll. |

### Known Threat Patterns for {Nostr event-class + browser JSON-Schema}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ReDoS via untrusted `pattern` (CVE-2025-69873 class) | Denial of Service | Off-thread + hard timeout-kill + fail-closed; `$data` off (ajv 8.20.0 patched); cap input/string length expectations. |
| Recursive/external `$ref` resolver blowup | Denial of Service | Reject any `$ref`/`$dynamicRef` before compile; spec already bans external `$ref`. |
| Oversized/deeply-nested schema OOM | Denial of Service | Byte-size + depth + keyword-count caps before `ajv.compile`. |
| Legacy/foreign-relay malformed 37518 event | Tampering / DoS (crash) | Defensive `JSON.parse` guard returns `false`, never throws (SPEC-03); event excluded from render set. |
| Prototype pollution via `format`+`$data` | Tampering | `$data` off; ajv 8.19.0+ patched; `format` as annotation by default. |
| Worker never loads → validation silently no-ops (fail-open) | Spoofing of safety guarantee | Registration via `workerAssets.ts` + `build.ts`; `bun run build` gate proves emission; fallback is fail-*closed*, not fail-open. |

## Sources

### Primary (HIGH confidence)
- `src/lib/nostr/map-context/{cast,factory,helpers}.ts` — Factory+Cast template, defensive `JSON.parse`, `d`-lineage discipline `[VERIFIED: codebase]`
- `src/lib/nostr/geo-event/helpers.ts` — the second copy-paste source for `tags.ts` extraction `[VERIFIED: codebase]`
- `src/lib/nostr/kinds.ts` — existing constant block (37515/37517/37518/37519/34444) `[VERIFIED: codebase]`
- `src/lib/context/validation.ts` — Ajv2020 config to reuse in the worker `[VERIFIED: codebase]`
- `src/features/chat/sandbox/transport/quickjsWorker.ts` + `src/lib/workers/workerAssets.ts` + `build.ts` + `src/index.ts` — the worker host-watchdog harness + the mandatory registration/serving wiring `[VERIFIED: codebase]`
- `node_modules/applesauce-core/dist/{casts/cast.d.ts, helpers/expiration.d.ts, helpers/tags.d.ts}` — `castEvent`, `isExpired`/`getExpirationTimestamp`, `ensureNamedValueTag` confirmed in installed dist `[VERIFIED: node_modules]`
- `.planning/research/{SUMMARY,STACK,ARCHITECTURE,PITFALLS}.md` — milestone research (zero-new-deps, patterns, pitfalls) `[CITED]`
- `.planning/{REQUIREMENTS.md, ROADMAP.md}` + `08-CONTEXT.md` — requirements, success criteria, locked decisions `[CITED]`

### Secondary (MEDIUM confidence)
- NIP-32 (`L`/`l` mark-pairing), NIP-40 (expiration advisory), NIP-23/52 (later-phase tag conventions) — protocol semantics `[CITED: nips.nostr.com]`
- CVE-2025-69873 / ajv.js.org security — ReDoS class + fix version `[CITED]`

### Tertiary (LOW confidence)
- None — every Phase-8 claim is grounded in the codebase or the milestone research files.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against installed `node_modules` dist + `package.json`; zero new deps.
- Architecture: HIGH — every pattern mirrors an existing module read directly from the codebase.
- Pitfalls: HIGH — worker-wiring gotcha and schema-DoS confirmed against in-repo code + CVE.
- Validation Architecture: HIGH — `bun test` precedent + fallback-testability proven by `quickjsWorker.ts`.

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable — all decisions locked, zero new deps, no fast-moving externals)
