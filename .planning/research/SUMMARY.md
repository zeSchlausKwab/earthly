# Project Research Summary

**Project:** Earthly v1.2 — Geo Entity Model Split
**Domain:** Nostr parameterized-replaceable event modeling, JSON-Schema governance, NIP-32/40/52 taxonomy and lifecycle
**Researched:** 2026-06-23
**Confidence:** HIGH

## Executive Summary

The v1.2 milestone fixes a specific architectural defect: kind 37518 currently varies along two orthogonal axes simultaneously (reference direction and governance), forcing the create flow and default UI to branch on a content discriminator. The fix is a clean entity split along reference direction — the axis that actually defines user intent. Story/Article (~37520) is curate-pull (the author owns the reference list via inline `nostr:naddr` mirrored to `a` tags); Group/Topic (37518 slimmed) is attach-push (contributors self-declare via `c` tags on their own datasets); Live Beacon (~37521) is a replaceable live-position point with NIP-40 expiry; Temporal Sighting is a time-bound observation borrowing NIP-52 `start`/`end` semantics. This is not a greenfield design — four existing entity classes in `src/lib/nostr/` already prove the Factory+Cast pattern; the four new kinds slot in identically. The Group kind is ~90% a rename of `map-context/`, not a rewrite.

The milestone requires zero new runtime dependencies. Every capability needed — draft-2020-12 JSON-Schema validation (ajv@8.20.0), naddr parse/encode and `a`-tag helpers (applesauce-core@6.1.0 `helpers/pointers`), NIP-40 expiry (applesauce-core `helpers/expiration`), NIP-32 `L`/`l` tag construction (applesauce-core `helpers/tags`), and geohash (in-repo `worldGeohash.ts`) — is already installed and in production use. The work is modeling and wiring, not dependency selection. The most important scope-creep guard: do not reach for `ngeohash`, NIP-52 calendar kinds, a NIP-72 library, rxjs add-ons, or a real-time websocket layer — none are needed.

The highest-severity new risk is treating the Group's JSON-Schema (authored by a stranger, fetched from a relay) as safe to run on the main thread. It is untrusted executable code: a hostile `pattern` keyword is an attacker-controlled regex (CVE-2025-69873 ReDoS class). The mitigation is the same harness the v1.1 code interpreter already proved: Web Worker with a hard timeout-kill, compile once per schema-hash, cap schema size/depth/nesting before compiling. This must land in the same phase as the Group's foreign-attach lane. The second hard constraint is the NO-MOD MINIMUM: since NIP-72 human moderation and WoT are deferred, the open Group must ship with a curated-default lane, per-viewer local mute, and a capped/collapsed foreign lane in the same phase as `c`-attach — not a follow-up.

## Key Findings

### Recommended Stack

All required libraries are already installed. Zero additions to `package.json`. The integration map: `ajv@8.20.0` (already used at `src/lib/context/validation.ts`) for Group schema validation; `applesauce-core@6.1.0` subpath helpers (`pointers`, `expiration`, `tags`, `time`) for naddr extraction, NIP-40 expiry, and tag construction; `@turf/turf@7.3.5` for geometry type/validity checks; `src/lib/worldGeohash.ts` (in-repo, dependency-free) for `g` tags on new kinds; `date-fns@4.4.0` for human-facing time display on Beacons and Sightings.

**Core technologies (all present — do not re-add):**
- `ajv@8.20.0` via `ajv/dist/2020`: draft-2020-12 JSON-Schema validation for Group governance — patched for CVE-2025-69873 ReDoS; keep `$data` off; no external `$ref`
- `applesauce-core@6.1.0` `helpers/pointers`: `getContentPointers(markdown)` extracts inline naddr refs for Article `a`-tag mirroring; `naddrEncode`/`decodeAddressPointer` for coordinate round-trips; `getAddressPointerFromATag` for `c`-coordinate resolution
- `applesauce-core@6.1.0` `helpers/expiration`: `isExpired(event)` / `getExpirationTimestamp(event)` — client-side filter for Beacons and Sightings; build once, use everywhere (NIP-40 is advisory, not a relay guarantee)
- `applesauce-core@6.1.0` `helpers/tags` + `helpers/time`: hand-roll `["L", ns]` / `["l", val, ns]` NIP-32 pairs and `["start"/"end", unixNow()]` NIP-52-flavored tags; no separate library exists or is needed
- `src/lib/worldGeohash.ts`: `g` tag on all four new kinds at precision 5-7 on the entity centroid (`turf.centroid`)

**Explicit non-additions (scope-creep guard):**
- No `ngeohash` / `latlon-geohash` (worldGeohash.ts already covers it)
- No NIP-52 calendar library (borrow only `start`/`end` tag conventions)
- No NIP-72 moderation library (c-coordinate is a plain replaceable address)
- No real-time websocket add-on (applesauce-relay subscriptions already stream as observables)
- Do NOT enable Ajv `$data` — closes the ReDoS/prototype-pollution attack surface twice

### Expected Features

The reference-direction axis is the UI-defining split. Pull/curate (Story) = author owns the reference list; push/attach (Group) = contributors self-declare. This drives two distinct EventStore query shapes that already exist in the codebase.

**Must have (v1.2 table stakes):**
- Story create/edit/read — NIP-23 metadata (`title`, `summary`, `image`, `published_at`) + Markdown body + inline geo-ref renderer (eye-toggle/fly-to reused from 37517 comment system)
- Story comment/react/propose-edit — reuse 37517 / kind-7 / 37519; 37519 payload generalized to "full replacement of target content" for Markdown Stories
- Group create/edit with explicit `governance: open|schema|closed` enum
- Group attach-push — `c`-tag foreign lane + validate-on-create warnings + filter-on-fetch viewer toggle (off/warn/strict)
- Group NO-MOD MINIMUM — curated lane privileged default; foreign lane collapsed/opt-in/capped/sorted; per-viewer local mute; signature+kind validation before render; one-click escape hatch to curated-only
- Live Beacon publish/update/stop — parameterized-replaceable ~37521, NIP-40 `expiration` tag, explicit "ended" terminal state, staleness age display, public/share link
- Temporal Sighting create — title/description/placed-feature + NIP-52 `start`/`end` + `c`-attach to Group + optional NIP-40 expiry
- NIP-32 `L`/`l` controlled taxonomy wired into Group schema; `t` retained for freeform discovery; no double-encoding

**Should have (differentiators):**
- Scroll-linked Story map camera — prose scroll drives map camera, the "story map" differentiator
- Schema-as-contract without human moderators — instant contribution with structural quality gate, no approval lag
- AI paste-to-Sighting ingest — v1.1 chat + geocode tools already exist; productize after manual Sighting form works
- Beacon driven by external data source / Authoring API (v1.1 code sandbox can publish beacon updates)

**Defer (v2+):**
- NIP-72 human moderation / approval / role lists — explicitly out of scope this milestone
- Web-of-trust + mute for spam at protocol level
- Encrypted/private beacons (NIP-17 gift-wrap per-viewer)
- Geoprivacy location obscuring for sensitive Sightings

### Architecture Approach

The existing Factory+Cast pattern (one `helpers.ts` + `cast.ts` + `factory.ts` + `index.ts` per kind) is already proven four times in `src/lib/nostr/`. The four new kinds slot in identically. `group/` is a rename of `map-context/` (not a rewrite — ~90% of cast/factory/helpers carries over). The only new abstraction is a shared `src/lib/nostr/tags.ts` extracting the `bbox`/`g`/`L`/`l`/`t`/`c`/`a` tag helpers currently copy-pasted between `geo-event/helpers.ts` and `map-context/helpers.ts` — necessary now because four more kinds would multiply that duplication.

The milestone's core data-flow axis maps onto two EventStore queries already supported: pull/curate reads the Article's own `a` tags and batch-loads referenced datasets by coordinate (bounded, offline-resolvable, no discovery query); attach/push opens a `{ kinds:[37515], '#c':[groupCoord] }` discovery subscription (open, relay-dependent, validated-on-fetch via worker). Live Beacon rendering follows the existing `GeoJSONSource.setData` pattern in LayerManager (a new `beacons` source/layer pair mirrors `SOURCE_CURSOR`), with `requestAnimationFrame` tweening between position updates. Schema validation must move off the main thread into a Web Worker with hard timeout-kill, reusing the v1.1 QuickJS-in-Worker harness shape.

**Major components:**
1. `src/lib/nostr/tags.ts` (NEW) — shared tag read/write helpers for all kinds; extraction from existing helpers, the foundation all entity phases consume
2. `src/lib/validation/schemaWorker.ts` (NEW) — off-thread Ajv compile+validate with timeout-kill; Group schema is untrusted input
3. `src/lib/nostr/group/` (RENAMED from `map-context/`) — slimmed 37518 Group; Factory+Cast+helpers; two-lane: `c`-attach discovery + optional pinned `a`-refs
4. `src/lib/nostr/article/` (NEW ~37520) — curate-pull Story; inline naddr to `a`-tag mirror via `getContentPointers`; 37519 proposal reuse
5. `src/lib/nostr/live-beacon/` (NEW ~37521) — replaceable position + NIP-40 expiry; seq tag for clock-skew guard; throttled publish
6. `src/lib/nostr/temporal-sighting/` (NEW) — NIP-52-flavored time-bound observation + optional NIP-40 auto-fade
7. `src/features/groups/`, `src/features/articles/`, `src/features/beacons/`, `src/features/sightings/` (NEW) — per-kind authoring + view panels
8. `LayerManager` (MODIFIED) — gains a live `beacons` GeoJSONSource for moving-point render

### Critical Pitfalls

1. **JSON-Schema as a DoS vector (schema run in-thread)** — A hostile Group owner ships a `^(a+)+$` ReDoS pattern or recursive `$ref` that freezes every viewer's tab. Mitigation: Web Worker with hard timeout-kill (50-100ms); compile once per schema-hash; reject `$ref` and cap byte-size/depth before compiling; keep Ajv `$data` off. Must be built in the same phase as foreign-attach, not bolted on after.

2. **Open Group unusable without the NO-MOD MINIMUM** — With NIP-72 and WoT deferred, `allowForeignAttachments=true` defaults to a free-for-all. Foreign `c` attachments are self-asserted; the Group owner did not consent. Mitigation: curated lane is the privileged default; foreign lane is collapsed/opt-in/capped/sorted; per-viewer local mute persists; `c` coordinate resolved and signature+kind validated before render; owner flips to `closed` in one click. This minimum MUST ship in the same phase as foreign-attach.

3. **Live-location privacy and safety failures** — Full-precision GPS tied to a long-lived pubkey; "stop sharing" on a no-delete substrate leaves the last position public forever; stale position shown identically to live. Mitigation: default OFF; explicit time-boxed sessions; terminal "ended" state on stop; honest staleness display (grey-out past threshold); kill-on-tab-close/unload; warn user that last point is permanently public; coarsen coordinates by default.

4. **Beacon replaceable-event overwrite race (clock skew + multi-relay)** — Device clock-ahead makes a stale fix win; two relays de-dup independently causing viewer flicker; two tabs race the same `d`. Mitigation: explicit monotonic `seq` tag in content; client de-dup by `(pubkey, d, max-seq)` across relays; clamp `created_at`; BroadcastChannel single-writer lock per beacon `d`; throttle publish rate.

5. **NIP-40 expiration is advisory, not enforced** — Non-compliant relays keep serving expired Sightings and Beacons forever. Mitigation: always client-filter `expiration < now` at read time regardless of relay behavior. Build this once as shared infra in Foundation; it applies to both Sighting and Beacon.

6. **Clean-break orphans (legacy 37518 events persist)** — Old-shape 37518 events live on foreign relays indefinitely; same kind number, two schemas by `created_at`. Mitigation: in-content `modelVersion` discriminator; defensive parse everywhere (unrecognized shape = skip/legacy, never crash); new `d` values for events where shape changes.

7. **Article `a`-tag / naddr drift** — Hand-maintaining `a` tags alongside Markdown prose creates two sources of truth that diverge on edits. Mitigation: single source of truth is the Markdown body; re-derive all `a` tags via `getContentPointers(markdown)` on every publish; validate each naddr (decode + kind-check + dedupe); surface authoring warnings for malformed refs.

## Implications for Roadmap

Based on combined research, the phase spine is: **Spec + Foundation** (blocks everything) then **Group** (first kind — refactor-dominant, validates shared seams) then **Article / Sighting / Beacon** (independent once Foundation lands) then **Cross-cutting** (comment widening, routing, taxonomy UI).

### Phase 1: Spec v2 + Foundation

**Rationale:** Every subsequent phase depends on kind constants, the shared `tags.ts` abstraction, the validation worker, the version discriminator, and the NIP-32/40 shared helpers. Building them first means no per-kind phase ships with copy-paste or an unguarded validator. Also resolves the clean-break pitfall (legacy 37518 orphans) and NIP-32 pairing correctness once for all phases.

**Delivers:**
- SPEC.md v2 rewrite — assign kind numbers (37520 Article, 37521 Beacon, Sighting TBD), define `L`/`l`/`t`/`c`/`a` usage, Group governance ladder, Beacon transport (replaceable + NIP-40), Sighting time fields
- `src/lib/nostr/kinds.ts` — add `ARTICLE_KIND`, `LIVE_BEACON_KIND`, `TEMPORAL_SIGHTING_KIND`
- `src/lib/nostr/tags.ts` — shared `bbox`/`g`/`L`/`l`/`t`/`c`/`a` read+write helpers extracted from `geo-event/helpers.ts` + `map-context/helpers.ts`
- `src/lib/validation/schemaWorker.ts` — off-thread Ajv instance, compile-once cache by schema-hash, timeout-kill, size/depth guards, `$ref` rejection
- In-content `modelVersion` discriminator definition + defensive-parse contract
- NIP-40 shared expiry filter (`isExpired` wrapper, consumed by both Beacon and Sighting phases)
- NIP-32 `["L", ns]` + `["l", val, ns]` paired-emit helper under `org.earthly.*` namespace

**Pitfalls addressed:** Pitfall 6 (clean-break orphans), Pitfall 7 (NIP-32 pairing + namespace), Pitfall 8 (`d`-tag lineage shared factory contract)

**Research flag:** SKIP research phase — all decisions are well-defined in the spec brief and research files.

---

### Phase 2: Group / Topic (37518 slimmed)

**Rationale:** Group is a rename/refactor of `map-context/` — lowest-risk first kind to ship. It exercises every shared seam (tags.ts, validation worker, `c`-attach discovery, curated `a` lane, governance ladder) the other three kinds also depend on. The NO-MOD MINIMUM and schema DoS guard — the two highest-severity pitfalls — both live here and must be built here, not deferred.

**Delivers:**
- `src/lib/nostr/group/` — cast/factory/helpers/index (renamed from `map-context/`)
- Slimmed content schema: explicit `governance: 'open' | 'schema' | 'closed'` enum
- `useGroups` hook
- Attach-discovery subscription `{ kinds:[37515], '#c':[groupCoord] }` via `scope.ts`
- Validation pipeline: validate-on-create (write-side) + validate-on-fetch via schema worker (read-side, strict/warn/off viewer toggle)
- NO-MOD MINIMUM: curated lane default + per-viewer local mute + foreign-lane cap/sort + coordinate resolve+signature-validate + owner one-click escape to closed
- `GroupViewPanel` two-lane render; `GroupEditorPanel` with schema authoring UI
- Comment/react with `K`/`k` widened to 37518
- `schema-hash` verification; draft-2020-12 dialect pinned; legible filter-reason display

**Pitfalls addressed:** Pitfall 1 (schema DoS — worker + timeout + guards), Pitfall 2 (NO-MOD MINIMUM), Pitfall 9 (schema-hash + divergent interpretation)

**Research flag:** NEEDS deeper research during planning. Resolve: `governance` enum backward-compat shape; schema-authoring UI for non-developer owners; `c`-coordinate cap number for the foreign lane.

---

### Phase 3: Story / Article (~37520)

**Rationale:** Article is the curate-pull flagship and the cleanest new kind — reuses 37519 proposals, the inline-ref renderer from the comment system, and `getContentPointers` for `a`-tag mirroring. No new map-render subsystem needed. Fully independent of Group, Beacon, and Sighting once Foundation lands.

**Delivers:**
- `src/lib/nostr/article/` — Factory+Cast+helpers for ~37520 (NIP-23 metadata tags)
- `useArticles` hook
- Inline naddr to `a`-tag mirror: `getContentPointers(markdown)` at publish; per-naddr decode + kind-check + dedupe; authoring warning for malformed refs
- 37519 propose-edit generalized: payload = "full replacement of target content" (works for Markdown body)
- `ArticleViewPanel` — Markdown render + inline geo-ref eye-toggle/fly-to; curated map lane from derived `a` tags
- `ArticleEditorPanel` — TipTap editor + naddr insertion + draft persistence
- Comment/react with `K`/`k` widened to ~37520

**Pitfalls addressed:** Pitfall 4 (naddr to `a`-tag drift — publish-time re-derivation enforced), Pitfall 8 (`d`-tag lineage — edit reuses `d`, verified per kind)

**Research flag:** SKIP research phase — NIP-23 is well-documented; `getContentPointers` is a library call; 37519 generalization is small and well-scoped.

---

### Phase 4: Temporal Sighting

**Rationale:** Sighting is the simplest new entity (static point + time fields + optional expiry). Fully independent of Article, Group, and Beacon once Foundation lands. Can run in parallel with Article if capacity allows. Resolves the open phase-research question: dedicated kind vs 37515+property+NIP-40.

**Delivers:**
- Phase-research decision: dedicated lightweight kind (recommended over overloading 37515 — avoids re-introducing the discriminated-union problem this milestone is fixing)
- `src/lib/nostr/temporal-sighting/` — Factory+Cast+helpers
- NIP-52-flavored time fields: `["start", unix]` + optional `["end", unix]`; observation-time distinct from `created_at`
- Optional `["expiration", unix]` (NIP-40) for auto-fade; client-side `isExpired` filter at all read paths
- `c`-attach to Group; `useSightings` hook + `SightingMarker` / `SightingPanel`
- UTC-only time comparison (no local-formatted time comparison)
- AI paste-to-Sighting ingest plumbing connected (v1.1 chat + geocode already exist)

**Pitfalls addressed:** Pitfall 5 (NIP-40 advisory — always client-filter expired), Pitfall 8 (`d`-tag lineage)

**Research flag:** NEEDS phase-research decision on dedicated kind vs 37515+property. Confirm relay-side indexing implications for a new kind number on Khatru.

---

### Phase 5: Live Beacon (~37521)

**Rationale:** Beacon is the most novel entity (live transport, moving-point render, privacy/safety constraints). Independent of the other three kinds but adds the one genuinely new map-render subsystem (live `beacons` GeoJSONSource in LayerManager). Sequenced last among kinds so map-render work does not block schema governance work in Group.

**Delivers:**
- Phase-research decision: parameterized-replaceable kind ~37521 + NIP-40 expiration (confirmed default)
- `src/lib/nostr/live-beacon/` — Factory+Cast+helpers; explicit `seq` monotonic tag in content for clock-skew de-dup
- Throttled publish (>=3-5s between updates); client-side `created_at` clamp; BroadcastChannel single-writer lock per beacon `d`
- `useLiveBeacons` hook; `eventStore.timeline` re-emits on replace; LayerManager `beacons` source `setData` per tick
- `requestAnimationFrame` tween between old/new coordinate for smooth motion
- `BeaconPublishControl` — explicit start; visible LIVE indicator + countdown; stop = "ended" terminal state; warn user last point stays public; kill-on-unload/visibilitychange
- Staleness display — age-stamp every render; grey-out past threshold
- Multi-relay de-dup by `(pubkey, d, max-seq)` client-side

**Pitfalls addressed:** Pitfall 1 (overwrite race + clock skew — seq tag + clamp + single-writer), Pitfall 3 (privacy/safety — default-off + time-boxed + terminal state + staleness + no false-delete promise)

**Research flag:** NEEDS phase-research to confirm Beacon lifecycle with relay echo test; confirm NIP-40 GC behavior on Khatru; seq-tag schema; exact staleness grey-out threshold.

---

### Phase 6: Cross-Cutting Polish

**Rationale:** After all four entity kinds land, several cross-cutting concerns need a dedicated pass: comment `K`/`k` widening verification, routing `focusTypes` expansion, taxonomy `L`/`l` authoring UI, and inter-kind reference patterns that only become visible once all kinds exist.

**Delivers:**
- `geo-comment` `K`/`k` root-scope widened and verified for all new kinds
- `useRouting` `focusTypes` extended to `article | group | beacon | sighting`
- `L`/`l` taxonomy authoring surface (namespace picker + controlled-vocab editor in Group schema UI)
- `t` freeform discovery verified not to double-encode what `L`/`l` governs
- Inter-kind reference patterns verified end-to-end (Sighting to Group `c`-attach; Article to Dataset `a`-refs)
- Performance sweep: schema-compile cache tuned; foreign-lane pagination; beacon publish throttle confirmed under load

**Pitfalls addressed:** Pitfall 7 (NIP-32 correctness sweep across all kinds)

**Research flag:** SKIP research phase — standard patterns and cleanup; nothing novel.

---

### Phase Ordering Rationale

- **Foundation first:** `tags.ts`, the validation worker, and the version discriminator are consumed by every entity phase. Building them first means no per-kind phase ships with copy-paste or an unguarded validator.
- **Group second:** it is a refactor of existing code (lowest new-code risk) and exercises the two highest-severity pitfalls (schema DoS, NO-MOD MINIMUM). Problems found here improve Article/Beacon/Sighting.
- **Article and Sighting third/fourth (interchangeable):** both fully independent once Foundation lands. Article is the curate-pull flagship; Sighting is the simplest new kind. Either can go first; Article recommended first because it demonstrates the reference-direction split most cleanly.
- **Beacon last:** adds the one genuinely new map-render subsystem and has the most privacy/safety surface to get right. Sequencing it after schema governance is stable avoids building on an unstable foundation.
- **Cross-cutting last:** only meaningful once all kinds exist and comment/routing/taxonomy needs are confirmed empirically.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (Group):** `governance` enum backward-compat shape with legacy content fields; schema-authoring UI for non-developer owners; exact foreign-lane cap number; NO-MOD MINIMUM UX contract (curated-default presentation, mute persistence scope)
- **Phase 4 (Sighting):** Confirm dedicated-kind choice vs 37515+property — especially relay-side filter implications for a new kind number on Khatru
- **Phase 5 (Beacon):** Confirm replaceable+NIP-40 lifecycle with relay echo test; seq-tag schema definition; NIP-40 GC behavior on Khatru; exact staleness threshold for grey-out

Phases with standard patterns (skip research):
- **Phase 1 (Foundation):** all decisions documented in research files; kinds + tag helpers + worker harness are proven patterns
- **Phase 3 (Article):** NIP-23 is well-documented; `getContentPointers` is a library call; 37519 generalization is small and well-scoped
- **Phase 6 (Cross-cutting):** comment widening, routing, taxonomy UI are incremental; nothing novel

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against installed `node_modules` dist types + `package.json` + CVE advisories; zero new deps confirmed |
| Features | HIGH | NIP-23/32/40/52/72 specs verified; Glympse/iNaturalist/AllTrails comparable-product behavior verified against vendor docs |
| Architecture | HIGH | Grounded in actual codebase (`src/lib/nostr/`, `src/lib/context/`, `LayerManager`); patterns proven 4x; no greenfield speculation |
| Pitfalls | HIGH | NIP-01/40/32 semantics + ajv security verified against authoritative sources; NO-MOD MINIMUM grounded in decentralized-app design norms |

**Overall confidence:** HIGH

### Gaps to Address

- **Beacon lifecycle (replaceable vs ephemeral):** Research strongly leans replaceable+NIP-40 for v1.2 table stakes. Confirm with a relay echo test in Phase 5 planning to verify Khatru NIP-40 GC behavior before committing to the expiry UX contract.
- **Sighting representation (dedicated kind vs 37515+property+NIP-40):** Research leans dedicated kind. Confirm that a new kind number does not require relay-side Khatru filter changes beyond what existing `pool.req` filters handle.
- **37519 proposal generalization for Article Markdown:** Existing 37519 carries a FeatureCollection replacement payload. For Article the replaceable target is Markdown body. Confirm whether this is a pure content-type extension or requires a spec discriminator — resolve in Phase 3 planning.
- **Relay NIP-40 compliance (Khatru):** NIP-40 is advisory; Khatru may or may not GC expired events. The client-side `isExpired` filter is mandatory regardless, but relay behavior affects whether expired Beacons/Sightings accumulate storage on the self-hosted relay.
- **Foreign-lane cap number:** Research says "cap + paginate" but leaves the exact number to product judgment. Decide in Phase 2 planning (suggested starting point: 50 visible at once, paginate, sort by recency).

## Sources

### Primary (HIGH confidence)
- `src/lib/context/validation.ts`, `src/lib/nostr/{geo-event,map-context}/{cast,factory,helpers}.ts`, `src/lib/nostr/index.ts`, `src/features/geo-editor/core/managers/LayerManager.ts` — codebase; established patterns
- `node_modules/applesauce-core/dist/helpers/*.d.ts` — verified installed helper surfaces (`pointers`, `expiration`, `tags`, `time`)
- `package.json`, `bun.lock` — resolved versions; zero new deps confirmed
- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — replaceable event tie-break semantics
- [NIP-23](https://nips.nostr.com/23) — Article metadata tags, Markdown body, draft kind
- [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) — `L`/`l` mark-pairing, `ugc` default, namespace guidance
- [NIP-40](https://nips.nostr.com/40) — expiration advisory semantics; relays SHOULD drop, MAY persist
- [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) — `start`/`end` time tags for time-bound geo events
- [NIP-72](https://nips.nostr.com/72) — `c`/`a` attach-by-tag pattern (moderation machinery deferred)
- [ajv.js.org security](https://ajv.js.org/security.html) + [CVE-2025-69873](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) — ReDoS via `$data`+`pattern`, fixed 8.18.0
- Earthly `SPEC.md` — canonical kind semantics, two-lane context model, schema-hash, blob refs, lineage rules
- Earthly `.planning/PROJECT.md` — v1.2 scope decisions, clean-break policy, deferred moderation, open lifecycle questions

### Secondary (MEDIUM confidence)
- [Glympse FAQ](https://app.glympse.com/faq/how-can-i-stop-sharing-my-location-in-the-glympse-app/) — live-location UX baseline (duration, auto-expire, manual stop)
- [iNaturalist collection-project requirements](https://help.inaturalist.org/en/support/solutions/articles/151000176699-collection-project-observation-requirements-settings) — validate-dont-reject framing for schema governance
- [AllTrails submission approval](https://support.alltrails.com/hc/en-us/articles/360053460631) — human-moderation latency; confirms schema-as-contract advantage
- [Bitchat geohash channel system](https://deepwiki.com/permissionlesstech/bitchat/6.1-geohash-channel-system) — Nostr ephemeral + geohash proximity prior art for beacons

---
*Research completed: 2026-06-23*
*Ready for roadmap: yes*
