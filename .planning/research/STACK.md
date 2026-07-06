# Stack Research

**Domain:** Nostr geo-entity event modeling (parameterized-replaceable kinds, JSON-Schema governance, live/temporal events, NIP-32/19/27 taxonomy & addressing) for the v1.2 Geo Entity Model Split
**Researched:** 2026-06-23
**Confidence:** HIGH

## Headline Finding (read this first)

**The v1.2 entity split needs essentially zero new runtime dependencies.** Every capability the milestone calls for is already covered by libraries that ship in `package.json` today and are already used in production code:

| New capability | Already-installed library that covers it | Evidence in repo |
|----------------|------------------------------------------|------------------|
| Schema-enforced Group rung (JSON Schema draft 2020-12 in browser) | `ajv@8.20.0` via `ajv/dist/2020` + `ajv-formats@3.0.1` | `src/lib/context/validation.ts:1` already does exactly this |
| naddr parse/encode, `a`-tag mirroring, NIP-19/21/27 | `applesauce-core@6.1.0` `helpers/pointers` (re-exports `nostr-tools/nip19`) | `getContentPointers`, `naddrEncode`, `getReplaceableAddressForEvent` present in dist |
| Parameterized-replaceable events, EventFactory/Cast | `applesauce-core@6.1.0` factories + casts | already the read/write pattern for 37515/37517/37518/37519 |
| NIP-40 expiration (Beacon/Sighting lifecycle) | `applesauce-core@6.1.0` `helpers/expiration` | `getExpirationTimestamp`, `isExpired` present in dist |
| Tag construction (NIP-32 `L`/`l`, NIP-52 `start`/`end`, `c`) | `applesauce-core@6.1.0` `helpers/tags` + `helpers/time` | `processTags`, `ensureNamedValueTag`, `unixNow` present in dist |
| Geohash encode/decode/bbox | hand-rolled `src/lib/worldGeohash.ts` (no dep) | full encoder + decoder + centroid already there |
| Geometry constraint helpers (turf) | `@turf/turf@7.3.5` | already used for v1.1 geometry work |

The work in v1.2 is **modeling and wiring**, not dependency selection. The most valuable output of this research is the **"What NOT to Add"** table — this is a scope-creep-prone milestone (four new entity kinds, a taxonomy system, real-time transport) where the obvious instinct is to reach for `ngeohash`, `nostr-tools` direct, a NIP-52 calendar lib, an rxjs live-query lib, etc. None are needed.

## Recommended Stack

### Core Technologies (all already installed — do not re-add)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `ajv` (`ajv/dist/2020` entry) | `8.20.0` (current latest 8.x) | Browser JSON Schema draft 2020-12 validation for the Group `schema` rung | Already in the tree and already used at `src/lib/context/validation.ts`. `8.20.0` is the latest 8.x and includes the ReDoS fix (8.18.0, CVE-2025-69873) and prototype-pollution fix (8.19.0). Ajv is the only mature validator with full 2020-12 keyword support (`prefixItems`, `$dynamicRef`) that compiles to fast functions and bundles cleanly under Bun. |
| `ajv-formats` | `3.0.1` (current) | `date`, `email`, `uri`, etc. format keywords for schemas | Pairs with Ajv; already imported. Required so author-supplied schemas can use `format`. |
| `applesauce-core` | `6.1.0` | Event factories/casts, addressing pointers, expiration, tag helpers | The established Nostr layer. Every helper the milestone needs (`pointers`, `expiration`, `tags`, `time`) is a subpath import already shipping in the installed dist. Reuse, do not hand-roll. |
| `@turf/turf` | `7.3.5` | Geometry-type/validity checks for `geometryConstraints` | Already used in v1.1 geometry optimization. `turf.getType`, `turf.booleanValid`, `turf.bbox`, `turf.centroid` cover the geometry-constraint and bbox/geohash-centroid needs. |
| `geojson` (types) | `0.5.0` | RFC 7946 TypeScript types | Already a dependency; used in `validation.ts`. |

### Supporting Libraries (all already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nostr-tools` (transitive, via applesauce) | `2.18.2` / `2.19.x` | `nip19` naddr encode/decode primitive | Prefer the `applesauce-core/helpers/pointers` re-exports over importing `nostr-tools/nip19` directly, so you stay on the version applesauce pins. Direct import already happens once at `src/lib/nostr/map-context.ts` (`require('nostr-tools')` for naddr decode) — fine, but `applesauce-core/helpers/pointers` is the cleaner seam going forward. |
| `date-fns` | `4.4.0` | Human-facing relative/absolute time formatting for Sightings/Beacons | Display only. Temporal *tags* are unix seconds via `unixNow()`; `date-fns` is for the UI. |
| `src/lib/worldGeohash.ts` | n/a (in-repo) | Geohash encode/decode/bbox/centroid | Already correct base32 geohash. Reuse for the `g` tag on new kinds. See judgment note below. |

### Applesauce-core helpers to reuse (the integration map)

These are the specific subpath imports to wire into the four new entity classes. They are present in `node_modules/applesauce-core/dist/helpers/` in the installed `6.1.0` build (verified by inspecting the `.d.ts` files):

| Need | Import | Helper(s) |
|------|--------|-----------|
| Story Markdown → mirrored `a` tags | `applesauce-core/helpers/pointers` | `getContentPointers(content)` returns every `nostr:naddr/nevent/...` pointer in a string — feed it the Markdown body, keep the `naddr` ones, encode each to an `a` coordinate. |
| naddr ↔ coordinate | `applesauce-core/helpers/pointers` | `naddrEncode`, `decodeAddressPointer`, `getAddressPointerFromATag`, `getReplaceableAddressForEvent`, `getReplaceableAddressFromPointer`, `normalizeToAddressPointer` |
| `c` attach tag parse | `applesauce-core/helpers/pointers` | `parseReplaceableAddress` / `getAddressPointerFromATag` (a `c` value is the same `<kind>:<pubkey>:<d>` shape as an `a` value) |
| NIP-40 Beacon/Sighting expiry | `applesauce-core/helpers/expiration` | `getExpirationTimestamp(event)`, `isExpired(event)` — filter expired Beacons/Sightings on fetch with these instead of hand-comparing timestamps. |
| NIP-32 `L`/`l` and NIP-52 `start`/`end` tag writes | `applesauce-core/helpers/tags` + `helpers/time` | `ensureNamedValueTag`, `processTags`, `unixNow`. There is **no** dedicated NIP-32 or NIP-52 helper in applesauce — these tags are trivial (`["L", ns]`, `["l", value, ns]`, `["start", unix]`, `["end", unix]`); construct them by hand using these tag utilities. |
| Pointer equality / dedup of refs | `applesauce-core/helpers/pointers` | `isAddressPointerSame`, `eventMatchesPointer`, `mergeAddressPointers` |

### Development Tools (no change)

| Tool | Purpose | Notes |
|------|---------|-------|
| Biome `2.4.14` | lint/format | unchanged |
| `bun test` | unit tests | new entity classes + schema validation + `getContentPointers` mirroring are prime unit-test targets (pure functions) |
| Bun bundler (`build.ts`) | bundling | Ajv `8.x` bundles fine under Bun; `8.18.0+` added tree-shaking, so the 2020 entry won't drag the whole library. Already proven by the shipped `validation.ts`. |

## Installation

```bash
# Nothing required. Every recommended library is already in package.json.
# This milestone adds ZERO runtime dependencies.
```

Confirm-only (versions already satisfied):
- `ajv@8.20.0`, `ajv-formats@3.0.1` — present.
- `applesauce-core@6.1.0` — present; `helpers/pointers`, `helpers/expiration`, `helpers/tags`, `helpers/time` are subpaths of the same package, no new install.
- `@turf/turf@7.3.5`, `geojson@0.5.0`, `date-fns@4.4.0` — present.

## Topic-by-topic findings (answering the brief)

### 1. Client-side JSON Schema validator for the schema-enforced Group rung — SOLVED, already in use

- **Library:** `ajv@8.20.0` imported as `ajv/dist/2020` (the draft 2020-12 build), plus `ajv-formats@3.0.1`. Exactly the pattern at `src/lib/context/validation.ts:26` (`new Ajv2020({ allErrors: true, strict: false, validateSchema: true })`).
- **Draft 2020-12:** fully supported by the `/dist/2020` entry (all keywords incl. `prefixItems`, `$dynamicRef`). You cannot mix 2020-12 and older drafts in one instance — fine here, the spec mandates 2020-12.
- **Bundle size / Bun:** Ajv `8.18.0+` added tree-shaking; the 2020 entry is the standard browser path and already ships in the production bundle. No Bun-specific issues.
- **Version currency:** `8.20.0` is the **latest** 8.x (released alongside 8.19.0 on 2024-04-24). There is no newer major line in production use. No upgrade needed.
- **Security / DoS (this matters — Group schemas are author-supplied, fetched from relays, i.e. untrusted):**
  - **CVE-2025-69873 (ReDoS via `$data`):** affects ajv ≤8.17.1. Fixed in **8.18.0**. Installed `8.20.0` is patched. **Additionally, the app never enables `$data`** (default off, and `validation.ts` does not set it) — the attack surface is closed twice over. Do NOT enable `$data` for the Group rung.
  - **Prototype pollution via `format` + `$data`:** fixed in 8.19.0; installed `8.20.0` is patched.
  - **General untrusted-schema DoS:** `pattern`/`format` on large strings can still be slow even without `$data`. Mitigations to carry into v1.2 (these are spec/requirements decisions, flag for PITFALLS): (a) keep `strict:false` as today but rely on Ajv's `validateSchema:true` to validate author schemas against the 2020-12 meta-schema before compiling (already on in `validation.ts`); (b) cap input string sizes / expect `maxLength` in schemas; (c) compile each context schema once and cache the validator (the current code compiles per-validation — a perf note, not a correctness bug); (d) the spec already bans external `$ref` in v1 ("no external `$ref`"), which removes the SSRF/remote-fetch class entirely — keep that ban.
  - **Geometry constraints** (`geometryConstraints.allowedTypes`) are NOT Ajv's job — they're a simple `allowedTypes.includes(feature.geometry.type)` check, exactly as `validation.ts:276` already does. Use `@turf/turf` `getType`/`booleanValid` if you want validity (self-intersection) checks beyond type.

### 2. Applesauce-core helpers to reuse vs hand-roll

- **Parameterized-replaceable events:** reuse the existing EventFactory + Cast pattern (already how 37515/37518/37519 are modeled). New kinds 37520/37521/Sighting follow the same blueprint. `getReplaceableAddressForEvent` / `getAddressPointerForEvent` give you the `a`/coordinate for any addressable event.
- **NIP-19/21/27 + naddr:** **reuse `applesauce-core/helpers/pointers`** — it re-exports `nostr-tools/nip19` (`naddrEncode`, `decode`) and adds higher-level helpers (`getContentPointers`, `decodeAddressPointer`, `getAddressPointerFromATag`, `normalizeToAddressPointer`). This is the single most reusable piece for the Story kind: `getContentPointers(markdown)` does the inline-`naddr`-extraction the spec calls for, so the Markdown→`a`-tag mirror is a library call, not a hand-rolled regex. (The current `map-context.ts` hand-rolls a regex `nostr:(naddr1[a-z0-9]+)` — v1.2 should migrate Story mirroring to `getContentPointers` for correctness on `nevent`/relay-hint cases.)
- **NIP-32 labeling (`L`/`l`):** **hand-roll the tags** — no applesauce helper exists. They're `["L", "<namespace>"]` + `["l", "<value>", "<namespace>"]`. Build with `ensureNamedValueTag`/`processTags` from `helpers/tags`. Do NOT add a library for this.
- **NIP-52 calendar (time-bound Sighting):** **hand-roll the tags** — no applesauce helper, and you do NOT need full NIP-52 calendar semantics. The Sighting is "NIP-52-flavored," meaning borrow `["start", "<unix>"]` / `["end", "<unix>"]` (and optionally `["g", geohash]`) conventions, not implement kind 31922/31923 calendar events. Use `unixNow()` from `helpers/time`.
- **NIP-72-style addressing:** the `c`-tag attach model is already a `<kind>:<pubkey>:<d>` coordinate — same shape as NIP-72 community `a`/`c` references. Reuse `parseReplaceableAddress`/`getAddressPointerFromATag`. No NIP-72 library exists or is needed (the milestone explicitly defers NIP-72 *moderation*).

### 3. Real-time / Live Beacon transport — decision input (a phase-research item per PROJECT.md)

PROJECT.md marks "Beacon lifecycle (replaceable vs ephemeral)" as open for phase-level research. Library implication is small; the choice is a protocol/relay decision, not a dependency decision:

| Option | Mechanism | Library impact | Tradeoff |
|--------|-----------|----------------|----------|
| **Parameterized-replaceable (recommended default)** | Re-publish kind ~37521 with the same `d`; relay keeps only latest | **None** — existing factory/cast + applesauce-relay handle it. `EventStore` already de-dupes replaceables to latest. | Simple, queryable, survives reconnect. Churn = one stored event per beacon (relay overwrites). Best fit for "shareable/public updating position point." |
| **+ NIP-40 expiration** | Add `["expiration", unix]` so stale beacons self-clean | **None** — `helpers/expiration` (`isExpired`) already installed; filter on fetch. | Recommended to combine with replaceable: a beacon that stops updating expires instead of lingering. |
| **Ephemeral (kind 2xxxx)** | Relay relays but does not store | **None** library-wise, but applesauce subscription/`EventStore` handling differs (not persisted, no replay) | Lowest storage, but no last-known-position on reconnect — bad UX for "where is X now." Avoid as the primary path. |

**Recommendation for requirements/roadmap:** Live Beacon = **parameterized-replaceable kind + NIP-40 `expiration` tag**, both already fully supported by the installed applesauce stack. No new transport library, no websocket library, no rxjs add-on (applesauce already exposes rxjs observables). The "real-time" feel comes from the existing `applesauce-relay` subscription stream, not a new transport. Flag the replaceable-churn rate and the visibility model for phase research, but the **stack answer is "nothing to add."**

### 4. Geohash / temporal indexing helpers

- **Geohash:** **reuse `src/lib/worldGeohash.ts`** (in-repo, dependency-free, correct base32 encoder/decoder/bbox/centroid). It already powers PMTiles chunk lookup. The `g` tag on new kinds = `lonLatToWorldGeohash(precision, lon, lat)` on the entity centroid (compute centroid with `turf.centroid`).
  - **Judgment note (flag for PITFALLS, low severity):** SPEC §1.2 recommends geohash precision **5–7**. `worldGeohash.ts` is parameterized by precision, so it covers this — but its function is named/used for *PMTiles world-chunk* lookup. For entity `g` tags, just call it with precision 5–7; do not add a second geohash library. If a future need arises for geohash *neighbor* queries (proximity search expanding to adjacent cells), `worldGeohash.ts` lacks neighbor computation — but the milestone does not require it, so do NOT add `ngeohash` now.
- **Temporal:** unix-seconds tags (`start`/`end`/`expiration`) via `unixNow()` (applesauce `helpers/time`) for writes; `date-fns@4.4.0` (already installed) for human-facing display. No temporal-index library needed — relay-side filtering is by `since`/`until` on `created_at` and by tag, which the Go/Khatru relay already does.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ajv/dist/2020` (already installed) | `@cfworker/json-schema`, `djv`, `hyperjump-validator` | Only if you needed a smaller bundle and could drop draft-2020-12 keyword completeness. Not worth a swap — Ajv is already in the bundle and battle-tested for untrusted schemas. |
| `applesauce-core/helpers/pointers` | direct `nostr-tools/nip19` import | If you ever drop applesauce. While on applesauce, the helper layer keeps you on the pinned `nostr-tools` version and adds `getContentPointers`/`a`-tag parsers you'd otherwise re-implement. |
| in-repo `worldGeohash.ts` | `ngeohash` (`0.6.x`), `latlon-geohash` | Only if you need geohash **neighbors/adjacency** for proximity expansion (not in v1.2 scope). |
| replaceable + NIP-40 for Beacon | ephemeral events; a custom WebSocket channel | Ephemeral only if you explicitly never want last-known-position persistence. Custom WS = never (re-implements the relay). |
| hand-rolled `L`/`l`, `start`/`end` tags | a NIP-32 / NIP-52 helper library | Never — no such library is needed; the tags are 2–3 strings each. |

## What NOT to Use (scope-creep guard — the most important table here)

| Avoid adding | Why | Use Instead |
|--------------|-----|-------------|
| `ngeohash` / `latlon-geohash` / any geohash npm package | `src/lib/worldGeohash.ts` already encodes/decodes/bboxes geohashes dependency-free and is precision-parameterized for the spec's 5–7 range. Adding one duplicates working code. | `src/lib/worldGeohash.ts` + `turf.centroid` |
| A standalone `nostr-tools` direct dependency in `package.json` | It's already transitive via applesauce, and `applesauce-core/helpers/pointers` re-exports the nip19 surface plus higher-level helpers. A direct dep risks a version split from applesauce's pin. | `applesauce-core/helpers/pointers` |
| Any NIP-52 "calendar events" library / full 31922/31923 modeling | Sighting is "NIP-52-*flavored*" — it borrows `start`/`end` tag conventions, not the calendar-event kinds. Full NIP-52 is out of scope. | `["start"/"end", unixNow()]` tags via `helpers/tags` |
| Any NIP-72 community/moderation library | PROJECT.md explicitly **defers NIP-72 human moderation/approval + role lists** to a later milestone; the `c` attach coordinate is just a replaceable address. | `parseReplaceableAddress` / `getAddressPointerFromATag` |
| A real-time/websocket/live-query transport lib (e.g. a bespoke WS client, an rxjs add-on) | `applesauce-relay` already streams subscriptions as rxjs observables and `EventStore` already collapses replaceables to latest. The Beacon's "live" behavior is replaceable-event re-publish, not a new channel. | existing `applesauce-relay` subscriptions |
| A separate JSON Schema *meta-schema*/draft library | Ajv 2020 ships the 2020-12 meta-schema; `validateSchema:true` already validates author schemas against it. | existing Ajv config |
| Enabling Ajv's `$data` option for Group schemas | Opens CVE-2025-69873 ReDoS class and prototype-pollution surface on untrusted, relay-fetched schemas; not needed for the Group rung's property/geometry constraints. | leave `$data` off (default); keep the spec's "no external `$ref`" ban |
| A diff library for Story propose-edit | Story reuses **kind 37519** which carries a full-replacement FeatureCollection (not a diff) — per SPEC §10. No diff dependency. | existing 37519 proposal machinery |
| A Markdown parser swap for Story narrative | TipTap (already installed) is the editor; `getContentPointers` extracts the refs. No new Markdown lib. | existing TipTap + `getContentPointers` |
| `nostr-idb` / new cache layer for new kinds | New kinds slot into the existing `EventStore`/`persistEventsToCache` path. | existing applesauce cache |

## Stack Patterns by Variant

**If the Group rung is `open` (no schema):**
- No Ajv compile. Only `geometryConstraints.allowedTypes` check (a `.includes`) if present, else accept all.
- Use `worldGeohash` + `turf.bbox` for discovery tags only.

**If the Group rung is `schema` (validation/required):**
- Compile the author schema once with the existing `Ajv2020` instance (`strict:false`, `validateSchema:true`, **no `$data`**) and **cache the compiled validator per context** (current `validation.ts` recompiles per call — make it cache in v1.2).
- Filter-invalid-on-fetch by running each attached dataset's features through the validator + geometry-type gate, exactly as `validateDatasetForContext` already does.

**If the entity is a Live Beacon:**
- Parameterized-replaceable kind ~37521, same `d` per beacon lineage, re-published on move.
- Add `["expiration", unixNow()+ttl]`; filter with `isExpired` on read.
- `g` tag = `lonLatToWorldGeohash(6, lon, lat)` of the point; `bbox` optional/degenerate.

**If the entity is a Temporal Sighting:**
- Dedicated kind (recommended over a property-on-37518) with `["start", unix]` (+ optional `["end", unix]`) and optionally `["expiration", unix]` for auto-expiry (PROJECT.md flags "dedicated kind vs property + NIP-40" for phase research — the stack supports both with zero new deps).
- `t`/`L`/`l` for taxonomy, `g`/`bbox` for location.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ajv@8.20.0` | `ajv-formats@3.0.1` | Matched pair, already installed and working in `validation.ts`. `ajv-formats@3` targets ajv 8. |
| `ajv@8.20.0` | Bun bundler | Tree-shaking since 8.18.0; `/dist/2020` browser entry bundles cleanly (proven in current production build). |
| `applesauce-core@6.1.0` | `nostr-tools@2.18–2.19` | applesauce pins `nostr-tools ~2.19`; `helpers/pointers` re-exports from it. Importing nip19 via the helper avoids a version split. (Note: contextvm pins `nostr-tools ~2.18.2` — already coexisting; stay on the applesauce helper to avoid pinning a third copy.) |
| `applesauce-core@6.1.0` | `applesauce-relay@6.0.3`, `applesauce-react@6.0.0`, `applesauce-loaders@6.1.0` | Already aligned on the 6.x line. New kinds add no version pressure. |
| `@turf/turf@7.3.5` | `geojson@0.5.0` types | Already co-used in v1.1 geometry work. |

## Sources

- Repo inspection (HIGH) — `package.json`, `src/lib/context/validation.ts` (Ajv2020 already in use), `src/lib/worldGeohash.ts` (geohash already implemented), `bun.lock` (resolved versions), and the installed `node_modules/applesauce-core/dist/helpers/*.d.ts` (`pointers`, `expiration`, `tags`, `time`) — verified the helper surfaces directly from the installed build.
- [ajv releases](https://github.com/ajv-validator/ajv/releases) (HIGH) — confirmed `8.20.0` is latest 8.x (2024-04-24), 8.18.0 ReDoS fix, 8.19.0 prototype-pollution fix.
- [Ajv 2020-12 support](https://github.com/ajv-validator/ajv) + [ajv.js.org JSON Schema](https://ajv.js.org/json-schema.html) (HIGH) — full draft 2020-12 keyword support via the 2020 entry; cannot mix drafts in one instance.
- [CVE-2025-69873 advisory](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) + [Ajv security considerations](https://ajv.js.org/security.html) (HIGH) — ReDoS requires `$data`; fixed 8.18.0; general untrusted-schema slow-validation guidance.
- SPEC.md + .planning/PROJECT.md (HIGH) — entity model, governance ladder, no external `$ref` in v1, NIP-72 deferral, Beacon/Sighting open questions.

---
*Stack research for: Nostr geo-entity event modeling (v1.2 Geo Entity Model Split)*
*Researched: 2026-06-23*
