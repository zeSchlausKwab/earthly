# Phase 9: Group / Topic (37518 slimmed) - Research

**Researched:** 2026-06-25
**Domain:** Nostr parameterized-replaceable entity authoring/viewing; untrusted-schema validation pipeline; trust-minimized two-lane UX (NO-MOD MINIMUM)
**Confidence:** HIGH (this is a rename/refactor of shipped code consuming Phase-8 seams; nearly every claim is grounded in code read this session)

## Summary

Phase 9 is overwhelmingly a **refactor-and-wire** phase, not a greenfield build. The Group entity is `map-context/` (kind 37518), already shipped as a 4-file Factory+Cast module, slimmed to a single `governance: 'open' | 'schema' | 'closed'` enum and re-pointed at the Phase-8 shared seams (`tags.ts`, `modelVersion.ts`, the off-thread `schemaWorker.ts`, the NIP-32 `L`/`l` helper). The two genuinely *new* surfaces are (1) the validate-on-fetch wiring of contributed datasets through the hardened worker, and (2) the NO-MOD MINIMUM UX contract (curated-default two-lane render, local mute, foreign-lane cap/sort, per-coordinate signature+kind validation, one-click owner escape to `closed`). Both are mandated to ship in *this* phase, never after.

All three open research notes resolve cleanly against the live codebase. **O-01 (trust-sort):** no NIP-02 contact-list source is currently used anywhere in app code — recommendation is to ship **newest-first only** for Phase 9 and treat follows-boost as a documented follow-up (applesauce-core *does* ship `ContactsModel`/`getContacts` so the follow-up is cheap, but do not over-build a trust model now). **O-02 (governance shape):** the concrete content interface is grounded below — `governance` replaces the `contextUse`/`validationMode`/`allowForeignAttachments` triad; under clean-break those legacy fields are simply *absent*; `geometryConstraints`/`schema` coexist with `governance: 'schema'`. **O-03 (schema-hash):** an existing helper `computeChecksum()` (`src/lib/nostr/geo-event/helpers.ts:182`) already computes SHA-256-hex of a string via `crypto.subtle.digest('SHA-256', …)` — reuse it over a canonicalized (sorted-key) JSON serialization of the schema.

**Primary recommendation:** Refactor `map-context/` → `group/` in place (rename + slim), wire validation through Phase-8 `validateSchema()` for both write-side warn and read-side filter, build the two-lane `GroupViewPanel` with curated-default + collapsed/capped foreign lane + local-mute (Zustand persisted store) + signature/kind validation per `c` coordinate, and ship trust-sort as **newest-first** with a noted follow-up. Zero new dependencies.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Group event read/write (37518) | `src/lib/nostr/group/` (cast/factory/helpers) | shared `tags.ts` | Per-kind module pattern proven 4×; tag I/O delegates to the one shared seam (no copy-paste) |
| Governance content serialization | `group/factory.ts` `create()`/`modify()` + `group/helpers.ts` content getter | `modelVersion.ts` | Content shape + the `modelVersion` discriminator are authored/parsed in the per-kind module |
| Schema validation (untrusted) | `src/lib/validation/schemaWorker.ts` (Phase 8, off-thread) | `group/` pipeline calls it | Stranger-authored schema is hostile input — MUST run off the main thread; the worker already exists |
| Attach discovery (`c`-lane) | EventStore subscription `{kinds:[37515],'#c':[coord]}` via `hooks.ts`/`useGroups` | `src/lib/context/scope.ts` (informs shape) | Read path; relay query + EventStore dedup, surfaced as casts |
| Curated lane (`a`-refs) | `group/` `referencedAddresses` + view panel | `src/lib/context/references.ts`/`displayOrdering.ts` | Author-controlled pins resolved from the event's `a` tags |
| Foreign-lane cap/sort + signature/kind validation | `GroupViewPanel` (presentation) | `verifyEvent` (nostr-tools) / cast guards | A trust/render concern; validation gates each coordinate before render |
| Local mute set (device-local, global) | Zustand persisted store (new `useMuteStore`) | `localStorage`/IndexedDB persist middleware | Per-device UI state — matches the established persisted-store pattern (`chat/store.ts:966`) |
| Attach action + inline warnings | Contributor's dataset publish/edit flow (`usePublishing`/publish dialog) | `validateSchema()` | The `c` tag is written on the *dataset*, not the Group; warnings render inline in that dialog |
| Comment / react on a Group | existing `geo-comment/` (37517) + kind 7 | — | GROUP-07 is incremental reuse; full K/k widening is Phase 13 |

## Standard Stack

### Core (all already installed — ZERO new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `applesauce-core` | 6.1.0 | EventStore, `EventCast`/`castEvent`, `EventFactory`, helpers | App fully migrated NDK→applesauce; maintainer mandates official casting [VERIFIED: codebase grep, node_modules] |
| `applesauce-react` | (installed) | `useActiveAccount`, `use$` reactive hooks | Established account/signer + reactive read pattern [VERIFIED: src/features/contexts/MapContextEditorPanel.tsx:1] |
| `ajv` | 8.20.0 (via `ajv/dist/2020`) | draft-2020-12 JSON-Schema validation | Already used in `schema.worker.ts` and `context/validation.ts`; dialect pinned [VERIFIED: src/lib/validation/schema.worker.ts:34] |
| `ajv-formats` | (installed) | `format` keyword support | Already wired into both validators [VERIFIED: schema.worker.ts:35] |
| `zustand` | (installed) | Local UI state incl. persisted stores | Established persisted-store pattern (`chat/store.ts:966` uses `persist(...)`) [VERIFIED: codebase grep] |
| `rxjs` | (installed) | Observable timeline reads | Underlies `useTimeline`/`use$` [VERIFIED: src/lib/nostr/hooks.ts:13] |
| `nostr-tools` | (installed) | `verifyEvent` for per-coordinate signature validation; `Filter` types | Standard signature verification primitive for GROUP-08 |

### Supporting (existing app modules to consume / refactor)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/nostr/tags.ts` | Shared `bbox`/`g`/`t`/`c`/`a`/`L`/`l` read+write seam | All Group tag I/O — never re-implement getters/setters |
| `src/lib/nostr/modelVersion.ts` | `MODEL_VERSION='earthly/2'`, `hasCurrentModelVersion()` | `isGroup` guard + `create()` discriminator injection |
| `src/lib/validation/schemaWorker.ts` | `validateSchema(schema, data, {schemaHash})` typed off-thread call | Both write-warn and read-filter validation |
| `src/lib/nostr/geo-event/helpers.ts:182` `computeChecksum()` | SHA-256-hex of a string | schema-hash compute/verify (O-03) |
| `src/lib/nostr/entityFactory.ts` `EntityFactory` | Shared base: `modelVersion` injection, `d` lineage, flexible `sign()` | `GroupFactory extends EntityFactory` (mirror `ArticleFactory`) |
| `src/lib/nostr/hooks.ts` `useTimelineWithEose` | subscribe→EventStore→reactive timeline + EOSE + IndexedDB hydrate | `useGroups` and the `#c` attach subscription |
| `src/lib/context/{scope,references,displayOrdering}.ts` | Two-lane resolution helpers (legacy, `allowForeignAttachments`-keyed) | Inform the new lane logic; rewrite the `allowForeignAttachments` branch to the governance enum |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Newest-first foreign-lane sort | NIP-02 follows-boost trust-sort | No follows source is used in app today; building one now over-scopes (CONTEXT O-01 says fall back) |
| Local-only mute (Zustand persist) | NIP-51 encrypted mute list | NIP-51 requires sign-in + relay round-trips; D-10 locks local-only |
| Reuse `computeChecksum` for schema-hash | `applesauce` hash helper | None ships a content hash; `computeChecksum` is the established SHA-256-hex helper |
| Refactor `map-context/` in place | Build `group/` fresh | ~90% carries over; clean-break content shape makes in-place rename lowest-risk (Discretion default) |

**Installation:**
```bash
# None. Phase 9 adds ZERO dependencies (confirmed against .planning/research/STACK.md and node_modules).
```

**Version verification:** All packages already present in `node_modules` and exercised by shipped Phase-8 code. `ajv/dist/2020` + `ajv-formats` confirmed imported at `src/lib/validation/schema.worker.ts:34-35`. `applesauce-*` family (core/react/actions/loaders/relay/signers/...) confirmed installed via `ls node_modules`. [VERIFIED: node_modules]

## Package Legitimacy Audit

> No external packages are installed in this phase — all dependencies are pre-existing and exercised by shipped code. The legitimacy gate is therefore **N/A** for new installs.

| Package | Registry | Status | Verdict | Disposition |
|---------|----------|--------|---------|-------------|
| (none) | — | no new installs | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         GROUP AUTHORING (owner)
GroupEditorPanel ──governance radio (open|schema|closed)──┐
   │  schema tab (D-04: visual builder | raw-JSON advanced)│
   │            │                                          │
   │   compile draft-2020-12 schema                        │
   │            │                                          │
   │   computeChecksum(canonicalize(schema)) ── schema-hash│
   ▼            ▼                                          ▼
GroupFactory.create/modify(content{name,description,governance,
   geometryConstraints?,schema?,modelVersion}) .schemaHash(...).labels(...)
   │  .sign(signer) ──► publish(event,{routing:'outbox'}) ──► relay (37518)
   │
   └───────────────────────────────────────────────────────────────────┐
                                                                         ▼
CONTRIBUTOR ATTACH (any user)                                   GROUP VIEW (any viewer)
dataset publish/edit dialog                              GroupViewPanel
   │  pick Group → write ["c", groupCoord] on the 37515    │ subscribe {kinds:[37518]} → cast → isGroup gate
   │  if schema Group: validateSchema(schema,data,         │
   │      {schemaHash}) INLINE warn (never block) D-05/06  │ ┌─ CURATED lane (a-refs)  ── default, expanded, privileged
   ▼                                                       │ │     resolve each a-coord → cast → render
publish 37515 with c-tag (valid standalone regardless)    │ │
   │                                                       │ └─ FOREIGN lane (collapsed "Community contributions (N)")
   └──────────────► relay ◄────────────────────────────── │     subscribe {kinds:[37515],'#c':[groupCoord]}
                                                           │       for each event:
                                                           │         verifyEvent(sig) + kind===37515 ──► drop if invalid
                                                           │         drop if author in local mute set
                                                           │         governance:'schema' → validateSchema (off/warn/strict)
                                                           │         sort newest-first ; cap 50 ; "load more"
                                                           │     reason chip on every hidden/flagged item
                                                           │
                                                           └─ owner-only "Lock down → closed" button (D-02)
                                                                  confirm → GroupFactory.modify(governance:'closed').sign.publish
```

### Recommended Project Structure
```
src/lib/nostr/group/          # renamed from map-context/ (cast/factory/helpers/index)
├── helpers.ts                # GroupContent interface, isGroup guard, content getter, schema-hash getter
├── cast.ts                   # class Group extends EventCast (mirror MapContext cast)
├── factory.ts                # GroupFactory extends EntityFactory (mirror ArticleFactory)
└── index.ts                  # barrel

src/lib/hooks/useGroups.ts    # subscribe 37518 → cast (mirror useMapContexts)
src/lib/group/                # (optional) lane resolution rewritten from context/{scope,references,displayOrdering}
src/lib/mute/useMuteStore.ts  # Zustand persist: device-local, global per-contributor mute set
src/features/groups/          # GroupEditorPanel (from MapContextEditorPanel), groups-columns
src/components/info-panel/GroupViewPanel.tsx  # two-lane render (from MapContextViewPanel)
```

### Pattern 1: Per-kind Factory+Cast mirroring the Phase-8 scaffolds
**What:** A Group module identical in shape to `article/` — `EventCast` read view, `EntityFactory` blueprint write, content getter with defensive `JSON.parse`, `isGroup` guard gating on `kind===37518 && d-tag && hasCurrentModelVersion`.
**When to use:** The entire `group/` module.
**Example:**
```typescript
// Source: src/lib/nostr/article/helpers.ts:49 (mirror) + map-context/helpers.ts (slim)
export function isGroup(event: NostrEvent): event is GroupEvent {
  return event.kind === MAP_CONTEXT_KIND          // 37518
    && getTagValue(event, 'd') !== undefined
    && hasCurrentModelVersion(event)               // SPEC-03 clean-break gate
}
```
Note: the existing `isMapContext` gates only on `kind + d` (no `modelVersion`). The slimmed `isGroup` MUST add `hasCurrentModelVersion` so legacy 37518 "context" events silently drop (§8). [VERIFIED: src/lib/nostr/map-context/helpers.ts:60, article/helpers.ts:49]

### Pattern 2: create() injects + re-asserts modelVersion (clean-break discriminator)
**What:** Strip any caller-supplied `modelVersion`, then re-assert `MODEL_VERSION` last so it can never be overridden.
**Example:**
```typescript
// Source: src/lib/nostr/article/factory.ts:38-43
const { modelVersion: _ignored, ...rest } = content
tpl.content = JSON.stringify({ ...DEFAULT_GROUP_CONTENT, ...rest, modelVersion: MODEL_VERSION })
```

### Pattern 3: Off-thread validation call (write-warn AND read-filter)
**What:** Call `validateSchema(schema, data, { schemaHash })` for both the inline publish-time warning and the read-time foreign-lane filter. Returns `{ ok: boolean, error?: string }`, fails closed.
**Example:**
```typescript
// Source: src/lib/validation/schemaWorker.ts:133
const verdict = await validateSchema(group.content.schema, datasetProperties, { schemaHash })
// write-side: verdict.ok === false → show actionable warning, allow "publish anyway" (D-06)
// read-side strict: verdict.ok === false → hide + reason chip; warn: show + badge; off: show all (D-09)
```
**Important nuance:** The Phase-8 worker validates one `data` instance against the schema and returns a *boolean* verdict (`ok`), not per-rule errors. CONTEXT D-06 requires **per-rule** messages ("property `name` required", "geometry Polygon not allowed"). The worker's `runSchemaValidation` discards `validate.errors`. **The planner must decide:** either (a) extend the worker's response shape to carry the structured `validate.errors` array (preferred — keeps validation off-thread), or (b) keep a *display-only* in-thread re-validation against the same pinned dialect purely to derive human messages (the legacy `context/validation.ts` already produces `ContextValidationIssue[]` with `path`/`message`). Option (a) is cleaner and avoids a second validator path; flag as an explicit task. [VERIFIED: src/lib/validation/schema.worker.ts:154-164, src/lib/context/validation.ts:288-300]

### Pattern 4: Subscribe→EventStore→reactive read (the attach discovery)
**What:** `useTimelineWithEose` issues `pool.req`, ingests into the EventStore (auto-dedup + replaceable), and returns a reactive timeline + EOSE flag with IndexedDB hydration.
**Example:**
```typescript
// Source: src/lib/hooks/useGeoDatasets.ts:27 (mirror) + hooks.ts:102
const { events, eose } = useTimelineWithEose([{ '#c': [groupCoordinate] }].map(f => ({ ...f, kinds: [GEO_EVENT_KIND] })))
const attachments = useMemo(() => events.map(e => castEvent(e, GeoDataset, eventStore)), [events])
```

### Pattern 5: Local persisted Zustand store for the mute set
**What:** A device-local, app-global set of muted contributor pubkeys, persisted via zustand `persist` middleware (localStorage). No signing, no publish, instant (D-10/D-11).
**Example:**
```typescript
// Source pattern: src/features/chat/store.ts:966 (persist(...))
export const useMuteStore = create(persist<{ muted: string[]; mute: (pk: string) => void; unmute: (pk: string) => void }>(
  (set) => ({ muted: [], mute: (pk) => set(s => ({ muted: [...new Set([...s.muted, pk])] })), unmute: (pk) => set(s => ({ muted: s.muted.filter(x => x !== pk) })) }),
  { name: 'earthly-muted-contributors' },
))
```

### Anti-Patterns to Avoid
- **Validating an untrusted Group schema on the main thread.** A ReDoS/OOM schema freezes every viewer's tab. ALWAYS go through `validateSchema()` (Pitfall 2). The legacy in-thread `context/validation.ts` `ajv.compile` path MUST NOT be used for the read/write governance pipeline.
- **Re-implementing tag getters/setters in `group/`.** Delegate to `tags.ts` (the whole point of the Phase-8 extraction).
- **Regenerating `d` on edit.** Use `GroupFactory.modify()` which preserves the `d` (Pitfall 9 — comments/reactions detach if the address forks).
- **Co-equal curated/foreign tabs.** D-08 mandates curated-first hierarchy (collapsed foreign section) to encode the NO-MOD trust posture.
- **Rendering a `c` coordinate before validating it.** GROUP-08 requires signature- AND kind-validation of every foreign coordinate before render.
- **Skipping schema-hash verification** because it's "optional" (Pitfall 10 — divergent/forged schema, silent filtering).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Untrusted-schema validation | A new in-thread ajv loop | `validateSchema()` (Phase 8) | Hardened: timeout-kill, $ref reject, size/depth caps, fail-closed, compile-once cache |
| SHA-256 of schema | A new crypto helper | `computeChecksum()` (geo-event/helpers.ts:182) | Already SHA-256-hex via `crypto.subtle`; one canonical hashing path |
| Tag read/write | Per-kind getters | `tags.ts` getters/setters | Single seam, proven no-drift, caching discipline |
| Event subscribe + dedup + replaceable | Manual `pool.req` plumbing | `useTimelineWithEose`/`useTimeline` | Handles EOSE, IndexedDB hydrate, EventStore dedup |
| Signature verification | Manual schnorr | nostr-tools `verifyEvent` | Standard, audited |
| modelVersion gate | Manual content parse | `hasCurrentModelVersion()` | Never-throws defensive parse already shipped |
| d-tag lineage | Manual d generation on edit | `EntityFactory` create/modify | One enforced rule (create=fresh d, modify=preserve) |
| Mute persistence | Custom localStorage glue | zustand `persist` middleware | Established pattern (`chat/store.ts`) |

**Key insight:** Phase 8 deliberately shipped every hard primitive (hardened validator, tag seam, discriminator, lineage base, expiry filter). Phase 9's job is to *wire*, not to *invent*. Any new custom crypto/validation/tag code is a red flag.

## Runtime State Inventory

> This is a rename/refactor phase (`map-context/` → `group/`, slimmed content). Runtime-state audit:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Legacy kind-37518 "context" events on relays (seed/test only per REQUIREMENTS "Out of scope"). They carry `contextUse`/`validationMode`/`allowForeignAttachments` and **no** `modelVersion`. | **None — clean break.** `isGroup` gates on `hasCurrentModelVersion`; legacy events silently drop (SPEC §8 / Phase-8 D-03). No migration. |
| Live service config | None — no external service stores the renamed module name; Group config lives entirely in signed Nostr events. | None. |
| OS-registered state | None — pure frontend refactor (Bun/React). No Task Scheduler / pm2 / launchd references to `map-context`. | None — verified by grep (no OS-registration references in repo). |
| Secrets/env vars | None reference `map-context`/`group`. The schema worker artifact is referenced by name `'schema'` via `workerUrl('schema')` (`workerAssets.ts`), unaffected by the Group rename. | None. |
| Build artifacts | Import paths: any code importing from `@/lib/nostr/map-context` must be updated to `@/lib/nostr/group`. The `MAP_CONTEXT_KIND = 37518` constant name stays (SPEC keeps `kinds.ts:15` as `MAP_CONTEXT_KIND`). `dist/workers/schema.worker.js` emitted by `bun run build` is unchanged. | Code edit: update all import sites; run `bun run build` to re-emit. Keep `MAP_CONTEXT_KIND` constant name (SPEC §3 references it). |

**Canonical question — after every file is updated, what runtime systems still hold the old string?** Only relay-stored legacy 37518 events, and those are *intentionally* invisible via the clean-break discriminator. Nothing else persists the module name.

## Common Pitfalls

### Pitfall 1: Schema-DoS via untrusted Group-owner schema (HIGHEST SEVERITY)
**What goes wrong:** A Group owner (or impersonator) ships a ReDoS `pattern`, recursive/huge `$ref`, or deeply-nested schema; every *viewer* who opens the Group runs it against attached datasets on the fetch path and their tab freezes/OOMs.
**Why it happens:** JSON-Schema is treated as data, not as stranger-authored executable code.
**How to avoid:** Route ALL governance validation through the Phase-8 `validateSchema()` (off-thread, timeout-kill, `$ref` rejected pre-compile, 64KB/depth-12/4096-keyword caps, `$data` off, fail-closed, compile-once per schema-hash). Never use the in-thread `context/validation.ts` for the governance pipeline.
**Warning signs:** Opening a specific Group pegs CPU; validate time grows superlinearly with dataset size.

### Pitfall 2: NO-MOD MINIMUM gap — open Group unusable/untrustworthy
**What goes wrong:** An open Group with no moderator drowns in spam attachments; viewers can't tell canon from noise.
**How to avoid (GROUP-08, all required in Phase 9):** curated `a`-lane is the privileged *default* (expanded); foreign `c`-lane is collapsed/opt-in/capped(50)/sorted; every `c` coordinate signature- AND kind-validated before render; viewer local-mute drops a contributor app-wide; owner one-click flip to `closed`. Every hidden item shows a legible reason.
**Warning signs:** Foreign lane shown co-equal to curated; unvalidated coordinates rendered; no mute affordance.

### Pitfall 3: schema-hash integrity ignored / divergent client interpretation
**What goes wrong:** Two clients validate the same dataset against the same schema and disagree (dialect defaults, `format` assertion-vs-annotation), so a dataset is valid in one client and filtered in another.
**How to avoid:** Pin draft-2020-12 + one validator config (already done in `schema.worker.ts`). Compute `schema-hash = computeChecksum(canonicalize(schema))` on author side; on viewer side, when a `schema-hash` tag is present, verify it matches the inline schema before validating — mismatch ⇒ "do not validate / show warning," never silently use a different schema. Make every filter outcome legible (which rule failed).
**Canonicalization note (O-03):** `JSON.stringify` is key-order-dependent; serialize with **recursively sorted object keys** before hashing so author and viewer produce identical hashes. Provide a small `canonicalizeSchema(obj)` (sort keys deep) → `computeChecksum(JSON.stringify(...))`.

### Pitfall 4: d-tag instability forks the entity
**What goes wrong:** Editing a Group regenerates `d` → new lineage → comments/reactions `a`-tagged to the old coordinate detach.
**How to avoid:** `GroupFactory.modify(event)` (preserves `d` via `toEventTemplate`); `create()` generates `d` only if absent. Test that edit preserves the address.

### Pitfall 5: per-rule warning messages vs the worker's boolean verdict
**What goes wrong:** D-06 requires actionable per-rule messages, but `validateSchema()` returns only `{ ok }`.
**How to avoid:** Extend the worker response to carry `errors` (preferred), OR derive display messages from the existing `ContextValidationIssue[]` shape — but keep the *gating* decision on the off-thread `ok`. Do not regress to in-thread gating.

## Code Examples

### Concrete governance content interface (O-02 — planner target)
```typescript
// Grounds: src/lib/nostr/map-context/helpers.ts:35-55 (existing) + modelVersion.ts:19
// Slimmed for Phase 9 — clean break drops contextUse/validationMode/allowForeignAttachments.
export type GroupGovernance = 'open' | 'schema' | 'closed'

export interface GroupGeometryConstraints {
  allowedTypes: GroupGeometryType[]   // reuse MAP_CONTEXT_GEOMETRY_TYPES set
}

export interface GroupContent {
  modelVersion?: string               // re-asserted to MODEL_VERSION by create() (SPEC-03)
  name: string
  description?: string                // Markdown (GROUP-06 narrative)
  descriptionFormat?: 'markdown'
  governance: GroupGovernance         // replaces contextUse/validationMode/allowForeignAttachments
  geometryConstraints?: GroupGeometryConstraints   // present when governance:'schema'
  schema?: Record<string, unknown>    // draft-2020-12 JSON Schema; present when governance:'schema'
  image?: string
  // references[] dropped from content — curated lane is the `a` tag (SPEC §3.3), not content
}

export const DEFAULT_GROUP_CONTENT: GroupContent = {
  name: '',
  descriptionFormat: 'markdown',
  governance: 'open',
}
```
- **Field coexistence:** `geometryConstraints` and `schema` are meaningful only under `governance: 'schema'`; for `open`/`closed` they SHOULD be absent (the editor strips them when the radio leaves `schema`).
- **Legacy fields:** `contextUse` / `validationMode` / `allowForeignAttachments` are **absent** under clean-break — not migrated, not defaulted. The content getter merges over `DEFAULT_GROUP_CONTENT` only.
- **schema-hash:** stays a tag (`["schema-hash","sha256:…"]`), written via the factory's `schemaHash(...)` setter (already exists in `map-context/factory.ts:101`), not a content field.

### schema-hash compute + verify (O-03)
```typescript
// Source: src/lib/nostr/geo-event/helpers.ts:182 (computeChecksum) — reuse, do not re-implement.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort()
      .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]))
  }
  return value
}
// author: const hash = `sha256:${await computeChecksum(JSON.stringify(canonicalize(schema)))}`
// viewer: verify getContextSchemaHash(event) === `sha256:${await computeChecksum(JSON.stringify(canonicalize(group.content.schema)))}`
```

### Per-coordinate signature + kind validation before render (GROUP-08)
```typescript
// Source pattern: nostr-tools verifyEvent + cast guard
import { verifyEvent } from 'nostr-tools'
// for each foreign attachment event resolved from a `c` coordinate:
if (event.kind !== GEO_EVENT_KIND) continue          // kind-validate (37515)
if (!verifyEvent(event)) continue                    // signature-validate
if (mutedSet.has(event.pubkey)) continue             // local mute (D-10/11)
// then governance:'schema' → validateSchema gate (off/warn/strict per D-09)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `contextUse`/`validationMode`/`allowForeignAttachments` triad in content | single `governance: open\|schema\|closed` enum | Phase 9 (this) | Simpler, testable governance ladder; clean break (no migration) |
| In-thread `ajv.compile` in `context/validation.ts` | off-thread hardened `validateSchema()` worker | Phase 8 shipped, Phase 9 wires | Untrusted schema can no longer freeze the tab |
| Per-kind copy-pasted tag getters | shared `tags.ts` seam | Phase 8 | No drift across 6 kinds |
| Legacy 37518 rendered as "context" | clean-break silent drop via `modelVersion` | Phase 8 | Legacy events disappear from UX |

**Deprecated/outdated:**
- `src/lib/context/validation.ts` in-thread validation — keep only if reused for display-message derivation (Pitfall 5 option b); never for gating.
- `getEffectiveContextUse`/`getEffectiveContextValidationMode`/`defaultContextFilterMode` (`context/validation.ts:37-57`) — keyed off the removed `allowForeignAttachments`/`contextUse`; rewrite to the governance enum (`closed`→no foreign lane; `schema`→strict default; `open`→off default but capped/curated-first).
- `context/scope.ts` `allowForeignAttachments` branch (`scope.ts:35`, `:48`) — rewrite to `governance !== 'closed'`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Foreign-lane trust-sort ships as **newest-first** for Phase 9 (no follows source used in app); follows-boost deferred | O-01 / Standard Stack | Low — explicitly sanctioned by CONTEXT O-01 fallback; follow-up uses available `ContactsModel` |
| A2 | `MAP_CONTEXT_KIND` constant name (37518) is retained; only the module folder/types rename to `group` | Runtime State / helpers | Low — SPEC §3 still references `kinds.ts:15` as `MAP_CONTEXT_KIND` [CITED: SPEC.md:194] |
| A3 | The worker response should be extended to carry per-rule `errors` for D-06 (vs in-thread display re-validation) | Pattern 3 / Pitfall 5 | Medium — affects task count; planner must pick option (a) or (b) explicitly |
| A4 | `descriptionFormat: 'markdown'` narrative is rendered with an existing Markdown renderer (TipTap/markdown already in app for Stories/comments) | content interface | Low — Markdown rendering already exists in the app (rich-text editor) |
| A5 | Foreign-lane cap = 50 visible + "load more" paginate | D-07 | Low — locked by CONTEXT D-07 |

## Open Questions

1. **Per-rule validation messages off-thread vs in-thread (A3)**
   - What we know: worker returns boolean `ok`; legacy `context/validation.ts` returns `ContextValidationIssue[]`.
   - What's unclear: whether to extend the worker response shape or keep an in-thread display-only validator.
   - Recommendation: extend the worker response to include `errors` (keeps single validation path, stays off-thread). Add as an explicit Plan task.

2. **Curated-ref "bless a contribution" promotion mechanics (D-03a)**
   - What we know: promote a foreign attachment to the curated lane = add its coordinate to the Group's `a` tags via `GroupFactory.modify(...).referencedAddresses([...])`.
   - What's unclear: whether promotion also writes a `["p", contributorPubkey]` credit tag.
   - Recommendation: just add the `a` ref (matches SPEC §3.3); no `p` credit unless UX needs it.

3. **GROUP-07 comment/react root coordinate for 37518**
   - What we know: K/k widening is Phase 13; GROUP-07 reuses 37517 + kind 7.
   - What's unclear: whether a 37518-rooted comment needs the K/k value set to "37518" now or waits for Phase 13.
   - Recommendation: wire comment/react against the Group coordinate using the existing `geo-comment` path; if the existing K/k enum hard-rejects 37518, scope a minimal local allowance and note the full widening stays Phase 13.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | runtime, test, build | ✓ | (project) | — |
| Web Worker + http(s) origin | off-thread schema validation in browser | ✓ (browser); ✗ in `bun test` | — | `bun test` drives the pure engine synchronously (already handled by `hasSpawnableWorker()`) |
| `crypto.subtle` | schema-hash (computeChecksum) | ✓ (browser/Bun) | — | `computeChecksum` returns `undefined` if absent (guarded) |
| Relay (Khatru) | publish/subscribe 37518 + `#c` queries | ✓ (`bun relay`) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Web Worker under `bun test` → synchronous pure-engine path (intentional; keeps validation proofs automated).

## Validation Architecture

> nyquist_validation = true (confirmed `.planning/config.json`). Section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun's built-in test runner (`bun test`) |
| Config file | none (Bun runner; tests colocated `*.test.ts`) |
| Quick run command | `bun test src/lib/nostr/group` |
| Full suite command | `bun test` |

Gates per MEMORY (`project_tsc_baseline`): `bun test` + `bun run build` + `biome check` are the authoritative gates (tsc has ~305 pre-existing errors; not a gate).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GROUP-01 | Group create/modify serializes `governance` enum + name/description; `isGroup` gate (kind+d+modelVersion); legacy 37518 drops | unit | `bun test src/lib/nostr/group/group.test.ts` | ❌ Wave 0 |
| GROUP-02 | `c`-tag write on dataset; attach-discovery filter `{kinds:[37515],'#c':[coord]}` selects it; appears in foreign lane | unit + integration | `bun test src/lib/group/attach.test.ts` | ❌ Wave 0 |
| GROUP-03 | visual builder → draft-2020-12 schema compiles; raw-JSON path feeds same validator; schema round-trips through content | unit | `bun test src/features/groups/schemaBuilder.test.ts` | ❌ Wave 0 |
| GROUP-04 | schema-Group attach: validateSchema warn surfaces; publish NEVER blocked (valid standalone 37515 always publishes) | unit | `bun test src/lib/group/warnNotBlock.test.ts` | ❌ Wave 0 |
| GROUP-05 | filter-on-fetch off/warn/strict: strict hides non-conforming, warn shows+badge, off shows all; reason present | unit | `bun test src/lib/group/filterModes.test.ts` | ❌ Wave 0 |
| GROUP-06 | curated `a`-refs pin + Markdown narrative round-trip; promote-foreign-to-curated adds `a` ref | unit | `bun test src/lib/nostr/group/curated.test.ts` | ❌ Wave 0 |
| GROUP-07 | comment (37517) + react (kind 7) against a Group coordinate | unit | `bun test src/lib/group/social.test.ts` | ❌ Wave 0 |
| GROUP-08 | NO-MOD: foreign coord signature+kind validated before render; muted author dropped; cap=50; sort newest-first; flip-to-closed republishes governance:'closed'; reason chips | unit | `bun test src/lib/group/noModMinimum.test.ts` | ❌ Wave 0 |
| (O-03) | schema-hash compute is canonical (key-order-independent); verify rejects mismatch | unit | `bun test src/lib/group/schemaHash.test.ts` | ❌ Wave 0 |
| (Pitfall 1) | DoS schema (ReDoS/`$ref`/oversized) → validateSchema fails closed within budget | unit (reuses) | `bun test src/lib/validation/schemaWorker.test.ts` | ✅ exists (Phase 8) |

### Sampling Rate
- **Per task commit:** `bun test src/lib/nostr/group src/lib/group` (quick)
- **Per wave merge:** `bun test` + `bun run build` + `biome check .`
- **Phase gate:** full suite green + build green + biome clean before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/nostr/group/group.test.ts` — GROUP-01 governance serialization + isGroup gate
- [ ] `src/lib/group/attach.test.ts` — GROUP-02 `c`-discovery
- [ ] `src/lib/group/warnNotBlock.test.ts` — GROUP-04 never-block invariant
- [ ] `src/lib/group/filterModes.test.ts` — GROUP-05 off/warn/strict
- [ ] `src/lib/group/noModMinimum.test.ts` — GROUP-08 signature/kind/mute/cap/sort/escape
- [ ] `src/lib/group/schemaHash.test.ts` — O-03 canonical hash + verify
- [ ] `src/features/groups/schemaBuilder.test.ts` — GROUP-03 builder→schema compile
- [ ] `src/lib/mute/useMuteStore.test.ts` — mute set persist/global behavior
- Framework install: none needed (Bun runner present).

## Security Domain

> security_enforcement = true (confirmed `.planning/config.json`).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Nostr key auth via applesauce signer; not built here |
| V3 Session Management | no | n/a (stateless event signing) |
| V4 Access Control | yes | Governance ladder + owner-only escape; client-side only (relays generic; no relay-side enforcement by design) |
| V5 Input Validation | **yes** | Untrusted Group schema + untrusted attachments → off-thread hardened ajv (`validateSchema`); per-coordinate signature+kind validation |
| V6 Cryptography | yes | schema-hash via `computeChecksum` (SHA-256, `crypto.subtle`); event signature verify via nostr-tools `verifyEvent` — never hand-roll |
| V12 Files/Resources | partial | schema byte/depth/keyword caps (DoS) already in worker |

### Known Threat Patterns for Nostr GeoJSON client (this phase)
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious Group schema (ReDoS/$ref/OOM) | Denial of Service | Off-thread `validateSchema` with timeout-kill, $ref reject, size/depth/keyword caps, fail-closed (Phase 8) |
| Forged/divergent schema vs schema-hash | Tampering | Verify `schema-hash` before validating; canonicalized SHA-256; pinned dialect+validator |
| Spoofed foreign attachment (bad sig / wrong kind) | Spoofing | `verifyEvent` + kind===37515 gate before render (GROUP-08) |
| Spam flood in open Group | Denial of Service (UX) | NO-MOD MINIMUM: curated-default, capped/collapsed foreign lane, local mute, owner flip-to-closed |
| XSS via Markdown narrative/description | Tampering/Elevation | Render through the app's existing sanitized Markdown path (no raw HTML — matches Story NIP-23 stance) |

## Sources

### Primary (HIGH confidence)
- Codebase (read this session): `src/lib/nostr/map-context/{helpers,cast,factory,index}.ts`, `tags.ts`, `modelVersion.ts`, `entityFactory.ts`, `article/{helpers,factory}.ts`, `validation/{schemaWorker,schema.worker}.ts`, `context/{validation,scope}.ts`, `geo-event/helpers.ts:182`, `hooks.ts`, `hooks/useGeoDatasets.ts` — VERIFIED grounding for all patterns/interfaces.
- `SPEC.md` v2 §3 (Group), §7 (taxonomy), §8 (modelVersion), §9 (schema dialect) — CITED.
- `.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md` (D-01..D-12, O-01..O-03) — authoritative decisions.
- `.planning/phases/08-spec-v2-foundation/08-CONTEXT.md` — Phase-8 seam contracts.
- `.planning/research/{PITFALLS,SUMMARY}.md` — pitfalls 2/3/9/10 (severity + mitigations).
- `node_modules/applesauce-core/dist/{helpers/contacts,models/contacts,casts/cast}.d.ts`, `applesauce-actions/dist/actions/mute.d.ts` — API surface for follow-up trust-sort + mute.

### Secondary (MEDIUM confidence)
- `.claude/skills/{applesauce-core,nostr}/SKILL.md` — pattern reinforcement (note: applesauce-core skill examples are partly generic/Svelte; the codebase is the authoritative casting reference).

### Tertiary (LOW confidence)
- none required — phase is fully grounded in shipped code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all confirmed in node_modules and shipped Phase-8 code.
- Architecture: HIGH — direct mirror of `article/`/`map-context/` modules + Phase-8 seams read this session.
- Governance content shape (O-02): HIGH — grounded in existing `MapContextContent` + clean-break policy.
- schema-hash (O-03): HIGH — `computeChecksum` located and read; canonicalization gap flagged.
- Trust-sort (O-01): HIGH (the *finding* — no follows source in app); recommendation = newest-first fallback per CONTEXT.
- Per-rule message wiring (A3): MEDIUM — requires a planner decision (extend worker vs in-thread display).

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable — internal refactor; no fast-moving external dependency)
