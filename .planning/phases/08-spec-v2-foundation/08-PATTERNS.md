# Phase 8: Spec v2 + Foundation - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 22 (3 modify + ~19 create, incl. 3 four-file scaffolds)
**Analogs found:** 21 / 22 (only SPEC.md has no code analog; it is a doc rewrite)

This phase is extraction + mirroring + hardening of code that already works. Every new file has a strong in-repo analog. There is zero greenfield design and zero new dependency.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/nostr/kinds.ts` (MODIFY) | config (constants) | n/a | self (existing block) | exact |
| `src/lib/nostr/tags.ts` (CREATE) | utility (pure tag fns) | transform | `map-context/helpers.ts` + `geo-event/helpers.ts` | exact (extraction source) |
| `src/lib/nostr/geo-event/helpers.ts` (MODIFY) | utility | transform | self (becomes first consumer of tags.ts) | exact |
| `src/lib/nostr/map-context/helpers.ts` (MODIFY) | utility | transform | self (becomes first consumer of tags.ts) | exact |
| `src/lib/nostr/article/helpers.ts` (CREATE) | model (helpers+guard) | transform | `map-context/helpers.ts` | exact |
| `src/lib/nostr/article/cast.ts` (CREATE) | model (read view) | request-response | `map-context/cast.ts` | exact |
| `src/lib/nostr/article/factory.ts` (CREATE) | model (write view) | event-driven | `map-context/factory.ts` | exact |
| `src/lib/nostr/article/index.ts` (CREATE) | utility (barrel) | n/a | `map-context/index.ts` | exact |
| `src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts` (CREATE) | model | transform/event-driven | `map-context/{helpers,cast,factory,index}.ts` | exact |
| `src/lib/nostr/temporal-sighting/{helpers,cast,factory,index}.ts` (CREATE) | model | transform/event-driven | `map-context/{helpers,cast,factory,index}.ts` | exact |
| `src/lib/nostr/modelVersion.ts` (CREATE; or fold into tags.ts) | utility (guard) | transform | `map-context/helpers.ts:67` (guard) + `:75` (defensive parse) | exact |
| `src/lib/nostr/expiry.ts` (CREATE; or fold into tags.ts) | utility (predicate) | transform | `applesauce-core/helpers/expiration` | exact (wrap) |
| `src/lib/validation/schemaWorker.ts` (CREATE — client) | service | request-response | `quickjsWorker.ts` | exact (host-watchdog harness) |
| `src/lib/validation/schema.worker.ts` (CREATE — worker module) | worker | batch (CPU) | `validation.ts` (Ajv config) + sandbox.worker pattern | role-match |
| `src/lib/workers/workerAssets.ts` (MODIFY) | config (registry) | n/a | self (WORKER_ASSETS map) | exact |
| `build.ts` (MODIFY) | config (build) | n/a | self (already iterates WORKER_ASSETS) | exact — **no change likely needed** |
| `src/index.ts` (MODIFY) | route (dev serve) | request-response | self (already iterates WORKER_ASSETS) | exact — **no change likely needed** |
| `SPEC.md` (REWRITE) | documentation | n/a | self (v1, 421 lines) | n/a |

> **Build/serve wiring note (load-bearing correction to the research's file list):** both `build.ts:270` and `src/index.ts:341` already loop over `Object.keys(WORKER_ASSETS)` generically. Adding the schema worker therefore requires **only** a new entry in `workerAssets.ts:45`. `build.ts` and `src/index.ts` do **not** need per-worker edits — they pick the new entry up automatically. The planner should treat workerAssets.ts as the single wiring touchpoint and verify (via `bun run build`) that the artifact emits, rather than hand-editing build.ts/index.ts.

---

## Pattern Assignments

### `src/lib/nostr/kinds.ts` (config, MODIFY)

**Analog:** self — append to the existing constant block.

Existing block (`kinds.ts:9-21`) defines `GEO_EVENT_KIND=37515`, `GEO_COMMENT_KIND=37517`, `MAP_CONTEXT_KIND=37518`, `GEO_EDIT_PROPOSAL_KIND=37519`, `MAP_LAYER_SET_KIND=34444`. Mirror that exact doc-comment + `export const` style and add the contiguous block (D-01):

```typescript
/** Story / Article Event - NIP-23-style long-form geo narrative (parameterized replaceable) */
export const ARTICLE_KIND = 37520
/** Live Beacon Event - replaceable presence/position with NIP-40 expiration */
export const LIVE_BEACON_KIND = 37521
/** Temporal Sighting Event - NIP-52 time-bounded observation with NIP-40 expiry */
export const TEMPORAL_SIGHTING_KIND = 37522
```

---

### `src/lib/nostr/tags.ts` (utility, CREATE — the only new abstraction)

**Analog:** `map-context/helpers.ts` (read getters) + `map-context/factory.ts` (write setters). These getter bodies are byte-near-identical between `map-context/helpers.ts` and `geo-event/helpers.ts` (both have `getBoundingBox`, `getHashtags`, context-ref getters) — that duplication is exactly what `tags.ts` removes.

**Read getter shape to generalize** (`map-context/helpers.ts:94-138`):

```typescript
export function getContextBoundingBox(event: NostrEvent): GeoBoundingBox | undefined {
  return getOrComputeCachedValue(event, BoundingBoxSymbol, () => {
    const raw = getTagValue(event, 'bbox')
    if (!raw) return undefined
    const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()))
    if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) return undefined
    return parts as GeoBoundingBox
  })
}
export function getContextHashtags(event: NostrEvent): string[] {          // `t`
  return getOrComputeCachedValue(event, HashtagsSymbol, () =>
    event.tags.filter((tag) => tag[0] === 't' && typeof tag[1] === 'string').map((tag) => tag[1] as string))
}
export function getContextReferencesOnContext(event: NostrEvent): string[] {  // `c`
  return ...event.tags.filter((tag) => tag[0] === 'c' && typeof tag[1] === 'string' && tag[1])...
}
export function getContextReferencedAddresses(event: NostrEvent): string[] {  // `a`
  return ...event.tags.filter((tag) => tag[0] === 'a' && typeof tag[1] === 'string' && tag[1])...
}
```

> The `getOrComputeCachedValue(event, Symbol, …)` memo pattern (`map-context/helpers.ts:76,95,113`) is the house caching discipline — generic tags.ts getters should keep it, but note the Symbol must be per-tag-kind (one shared symbol per tag name), not per-entity-kind. `g` getter uses `getTagValue(event, 'g')`; `g` writer uses `lonLatToWorldGeohash` from `src/lib/worldGeohash.ts`.

**Write setter shape** (`map-context/factory.ts:66-121` — filter-out-then-append):

```typescript
bbox(box) {
  return this.modifyPublicTags((tags) => {
    const filtered = tags.filter((t) => t[0] !== 'bbox')
    return box ? [...filtered, ['bbox', box.join(',')]] : filtered
  })
}
hashtags(values) {
  return this.modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== 't'), ...values.map((v) => ['t', v])])
}
referencedAddresses(values) {
  return this.modifyPublicTags((tags) => [...tags.filter((t) => t[0] !== 'a'), ...values.filter(Boolean).map((v) => ['a', v])])
}
```

> Open question O-2 (research): centralize **read getters** now (clear win); centralize write setters into tags.ts only if byte-identical across the two factories — otherwise keep per-factory to honor the "tight diff" constraint. tags.ts should export pure `string[][] -> string[][]` transformers the factories can delegate to.

**NIP-32 `L`/`l` paired-emit + starter vocab** (TAX-01, no analog — new pure functions, shape per RESEARCH Pattern 6):

```typescript
export const EARTHLY_LABEL_NAMESPACE = 'earthly'                         // D-06 flat namespace
export const FEATURE_CATEGORY_VOCAB = ['natural','infrastructure','amenity','route','boundary'] as const  // D-07
export function setLabels(tags: string[][], values: string[]): string[][] {
  const cleaned = tags.filter((t) => t[0] !== 'L' && t[0] !== 'l')        // replace existing pair
  if (values.length === 0) return cleaned
  return [...cleaned, ['L', EARTHLY_LABEL_NAMESPACE], ...values.map((v) => ['l', v, EARTHLY_LABEL_NAMESPACE])]
}
export function getLabels(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === 'l' && t[2] === EARTHLY_LABEL_NAMESPACE).map((t) => t[1] as string)
}
```
Disjointness rule (`t` ∩ `l` = ∅) is flagged/enforced here and documented in SPEC v2 §7.

---

### `src/lib/nostr/{article,live-beacon,temporal-sighting}/cast.ts` (model, CREATE)

**Analog:** `map-context/cast.ts` (mirror verbatim — the maintainer-mandated `EventCast` casting contract is already established here).

**Imports + class + guard-throw** (`map-context/cast.ts:5-27`):

```typescript
import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers'
import { /* per-entity getters */, isLiveBeacon, type LiveBeaconEvent } from './helpers'

export class LiveBeacon extends EventCast<LiveBeaconEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isLiveBeacon(event)) throw new Error('Event is not a LiveBeacon (kind 37521)')
    super(event, store)
  }
  // raw-event proxies (cast.ts:30-44): get kind/pubkey/tags/content/created_at
  get dTag() { return getEntityId(this.event) }
  rawEvent() { return this.event }
}
```

Each new cast mirrors the typed getter set (`cast.ts:46-86`: dTag, content, boundingBox, hashtags, contextReferences, referencedAddresses) plus entity-specific getters (Beacon/Sighting add `get expiresAt() { return getExpirationTimestamp(this.event) }`). Consume via `castEvent()`/`castEventStream()` per https://applesauce.build/apps/casting/events.html.

---

### `src/lib/nostr/{article,live-beacon,temporal-sighting}/factory.ts` (model, CREATE)

**Analog:** `map-context/factory.ts` (mirror exactly, incl. `d`-lineage discipline — Pitfall 5).

**create/modify + modelVersion injection** (`map-context/factory.ts:28-47`, plus SPEC-03 content write):

```typescript
export class TemporalSightingFactory extends EventFactory<typeof TEMPORAL_SIGHTING_KIND> {
  static create(content: Partial<SightingContent> = {}): TemporalSightingFactory {
    return new TemporalSightingFactory((resolve) => {
      const tpl = blankEventTemplate(TEMPORAL_SIGHTING_KIND)
      tpl.content = JSON.stringify({ modelVersion: MODEL_VERSION, ...content })   // SPEC-03
      if (!tpl.tags.some((t) => t[0] === 'd')) tpl.tags = [...tpl.tags, ['d', generateShortDTag()]]  // factory.ts:34
      resolve(tpl)
    })
  }
  static modify(event: TemporalSightingEvent): TemporalSightingFactory {          // preserves d (factory.ts:42)
    if (!isTemporalSighting(event)) throw new Error('…modify: event is not kind 37522')
    return new TemporalSightingFactory((resolve) => resolve(toEventTemplate(event)))
  }
  // tag setters delegate to tags.ts (setBbox/setGeohash/setHashtags/setLabels/setReferencedAddresses)
}
```

> **`d`-lineage rule (factory.ts:34-46):** `create()` generates `d` only if none exists; `modify()` reuses `toEventTemplate(event)` and never regenerates `d`. Do not re-run `generateShortDTag()` on modify (forks the entity). The `DeleteFactory.fromEvents` helper (`map-context/factory.ts:124-134`) is the delete-pattern analog if a per-kind delete is added.

---

### `src/lib/nostr/{entity}/helpers.ts` + `modelVersion.ts` (model/utility, CREATE)

**Analog:** `map-context/helpers.ts:67` (guard) + `:75-85` (defensive `JSON.parse`).

**The defensive-parse discipline to preserve** (`map-context/helpers.ts:75-85` — swallows parse errors, never throws):

```typescript
export function getMapContextContent(event: NostrEvent): MapContextContent {
  return getOrComputeCachedValue(event, ContextContentSymbol, () => {
    if (!event.content) return { ...DEFAULT_CONTEXT_CONTENT }
    try {
      const parsed = JSON.parse(event.content) as Partial<MapContextContent>
      return { ...DEFAULT_CONTEXT_CONTENT, ...parsed }
    } catch { return { ...DEFAULT_CONTEXT_CONTENT } }   // never throws on legacy/foreign event
  })
}
```

**modelVersion discriminator + widened guard** (SPEC-03, derived from `helpers.ts:67`+`:75`):

```typescript
export const MODEL_VERSION = 'earthly/2'                 // exact value: planner detail (A1)
export function hasCurrentModelVersion(event: NostrEvent): boolean {
  try { return (JSON.parse(event.content) as { modelVersion?: unknown })?.modelVersion === MODEL_VERSION }
  catch { return false }                                  // unparseable ⇒ legacy/inert ⇒ skipped
}
export function isLiveBeacon(event: NostrEvent): event is LiveBeaconEvent {
  return event.kind === LIVE_BEACON_KIND
    && getTagValue(event, 'd') !== undefined
    && hasCurrentModelVersion(event)                       // legacy/absent MV ⇒ false ⇒ never rendered
}
```

> **Anti-pattern guard (D-03/Pitfall, SPEC-03 failure mode):** the guard returns `false` — it MUST NOT `throw` during a list `filter(guard)`/`map`. The 37518 slimmed-Group case is special: new-Group requires `modelVersion` AND the slimmed `governance` shape; legacy-context has neither. Entity type = `KnownEvent<typeof KIND>` (`map-context/helpers.ts:18`).

---

### `src/lib/nostr/expiry.ts` (utility, CREATE — NIP-40 wrapper)

**Analog:** `applesauce-core/helpers/expiration` (confirmed: `isExpired` at `expiration.d.ts:6`, `getExpirationTimestamp` at `:4`). One-line wrapper per RESEARCH Pattern 5:

```typescript
import { isExpired as coreIsExpired } from 'applesauce-core/helpers/expiration'
import type { NostrEvent } from 'applesauce-core/helpers'
export function isExpired(event: NostrEvent): boolean { return coreIsExpired(event) }
export const dropExpired = <T extends NostrEvent>(es: T[]): T[] => es.filter((e) => !isExpired(e))
```
Compare UTC epoch seconds only (Pitfall 3). Ships the seam; Phases 11/12 call it at read paths.

---

### `src/lib/validation/schema.worker.ts` (worker module, CREATE)

**Analog:** Ajv config from `src/lib/context/validation.ts:26-31`; off-thread pattern from the sandbox worker. The worker module must export a **pure** `runSchemaValidation(...)` engine (mirroring `sandbox.worker.ts`'s exported `runSandboxCode`) so the client can drive it synchronously under `bun test`.

**Ajv-2020 instance to reuse** (`validation.ts:1-2,26-31`):

```typescript
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true })  // $data OFF (default)
addFormats(ajv)
```

**Hardening gate run BEFORE `ajv.compile`** (new — Pitfall 2, RESEARCH Pattern 4):

```typescript
function rejectUnsafeSchema(schema: unknown): void {
  const json = JSON.stringify(schema)
  if (json.length > MAX_SCHEMA_BYTES) throw new Error('schema too large')
  if (/"\$ref"|"\$dynamicRef"/.test(json)) throw new Error('$ref not allowed')
  if (depthOf(schema) > MAX_DEPTH) throw new Error('schema too deep')
}
// compile-once + cache keyed by schemaHash (mirror validation.ts's compile-then-validate, :233-289)
```

> The existing `validateDatasetForContext` (`validation.ts:202-322`) is the compile-then-`validate(properties)` flow to keep — but it compiles **on the main thread per validation**; the worker hardens + moves it off-thread + caches by `schemaHash`. Phase 8 ships the worker + interface only; does NOT wire it into a Group pipeline (Phase 9 migrates `validateDatasetForContext` onto it).

---

### `src/lib/validation/schemaWorker.ts` (service/client, CREATE)

**Analog:** `src/features/chat/sandbox/transport/quickjsWorker.ts` — the host-watchdog + warm-worker + `terminate()` + synchronous-fallback harness. Mirror its exact shape.

**Spawn via the registry (NOT `new Worker(new URL(...))`)** (`quickjsWorker.ts:35,88`):

```typescript
import { workerUrl } from '@/lib/workers/workerAssets'
const worker = new Worker(workerUrl('schema'), { type: 'module' })   // origin-rooted, dev+prod safe
```

**Host wall-clock watchdog → terminate + fail-closed** (`quickjsWorker.ts:39,149-156`):

```typescript
export const WATCHDOG_SLACK_MS = 500   // wall-clock slack on top of the in-VM deadline
const watchdog = setTimeout(() => {
  disposeWarmWorker(`schema validation exceeded ${deadlineMs}ms and was terminated.`)
  settle({ id, ok: false, error: 'could not validate' })   // FAIL-CLOSED, never fail-open
}, deadlineMs + WATCHDOG_SLACK_MS)
```

**Synchronous fallback when `Worker` is undefined** (`quickjsWorker.ts:131-134` — the path `bun test` exercises):

```typescript
if (typeof Worker === 'undefined') {
  const result = await runSchemaValidation(request)   // drive the pure engine directly
  return { id, ...result }
}
```

> `disposeWarmWorker` (`quickjsWorker.ts:64-79`) tears down + fails all in-flight runs once on kill/load-error (no re-spawn storm); `onerror` (`:97-106`) fails closed. Timeout: ≤100ms in-VM + 500ms wall-clock slack (A2). The fallback path is what the SPEC-04 unit tests assert against (ReDoS/`$ref`/oversized fail-closed; compile-once-per-hash; `$data` off).

---

### `src/lib/workers/workerAssets.ts` (config, MODIFY — the #1 gotcha, Pitfall 1)

**Analog:** self — add one entry to `WORKER_ASSETS` (`workerAssets.ts:45-62`):

```typescript
export const WORKER_ASSETS = {
  sandbox: { servedName: 'sandbox.worker.js', sourcePath: 'src/features/chat/sandbox/transport/sandbox.worker.ts' },
  ingest: { ... }, geoJsonParse: { ... }, optimize: { ... },
  schema: {                                                       // ← NEW
    servedName: 'schema.worker.js',
    sourcePath: 'src/lib/validation/schema.worker.ts',
  },
} as const satisfies Record<string, WorkerAsset>
```

> This is the ONLY wiring edit. `build.ts:270` and `src/index.ts:341` already iterate `Object.keys(WORKER_ASSETS)` — they emit/serve the new worker automatically. `bun run build` is the gate that proves the artifact emitted (a missing entrypoint = silent fail-open, the exact Phase 4 UAT blocker documented at `workerAssets.ts:1-31`).

---

### `SPEC.md` (documentation, REWRITE in place — LAST)

No code analog. Rewrite the current 421-line plain-prose spec to v2 using the section map in RESEARCH `## Code Examples` (10 sections: 37515 unchanged → 37517 → slimmed 37518 → 37520 Story → 37521 Beacon → 37522 Sighting → tag vocabulary/`L·l`-`t`-`c` split → modelVersion clean-break → schema dialect → NIP-40 expiry). Keep 37516/34444 sections if present. Use `file_path:line_number` references per CLAUDE.md. The doc-presence test (`spec.doc.test.ts`) asserts each kind number + the `modelVersion` clause + the three-way split string are present.

---

## Shared Patterns

### Defensive JSON.parse (applies to: every new helpers.ts guard + modelVersion.ts)
**Source:** `src/lib/nostr/map-context/helpers.ts:75-85`
Always wrap `JSON.parse(event.content)` in try/catch returning a default/`false` — never throw on a legacy or foreign-relay event inside a list map. This is the SPEC-03 correctness contract.

### EventCast read-view contract (applies to: all 3 new cast.ts)
**Source:** `src/lib/nostr/map-context/cast.ts:5,23-27`
Extend `EventCast<TEvent>` from `applesauce-core/casts`; constructor throws via the `is<Entity>()` guard; consume via `castEvent()`. Maintainer-mandated, already established 4×.

### EventFactory write contract + d-lineage (applies to: all 3 new factory.ts)
**Source:** `src/lib/nostr/map-context/factory.ts:28-47`
`create()` from `blankEventTemplate(KIND)`, generate `d` only if absent; `modify()` from `toEventTemplate(event)`, never regenerate `d`. Inject `modelVersion` into content on create.

### Cached pure getter (applies to: tags.ts getters, all helpers.ts content getters)
**Source:** `src/lib/nostr/map-context/helpers.ts:76,95,113` — `getOrComputeCachedValue(event, Symbol.for(...), () => …)`.

### Worker registration → workerUrl spawn (applies to: schemaWorker.ts + workerAssets.ts)
**Source:** `src/lib/workers/workerAssets.ts:75` (`workerUrl`) + `quickjsWorker.ts:88` (spawn). Never `new Worker(new URL('./x.worker.ts', import.meta.url))` — silently 404s in dev and prod here.

### Off-thread fail-closed watchdog (applies to: schemaWorker.ts)
**Source:** `src/features/chat/sandbox/transport/quickjsWorker.ts:64-79,149-156` — terminate on overrun, fail-closed, lazy recreate, synchronous fallback for `bun test`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `SPEC.md` | documentation | n/a | Doc rewrite; v1 self is the only reference (git history is the archive). No code analog. |

The NIP-32 `setLabels`/`FEATURE_CATEGORY_VOCAB` helper and the Ajv hardening `rejectUnsafeSchema` gate are net-new logic with no exact in-repo predecessor, but each has a near-analog (tag filter-append shape; `validation.ts` Ajv config) and is fully specified in RESEARCH Patterns 4 & 6 — treat as guided-new, not analog-less.

## Metadata

**Analog search scope:** `src/lib/nostr/{kinds,map-context,geo-event}`, `src/lib/context/validation.ts`, `src/lib/workers/workerAssets.ts`, `src/features/chat/sandbox/transport/quickjsWorker.ts`, `build.ts`, `src/index.ts`, `node_modules/applesauce-core/dist/helpers/expiration.d.ts`
**Files scanned:** 9 (full reads) + targeted greps
**Pattern extraction date:** 2026-06-25
