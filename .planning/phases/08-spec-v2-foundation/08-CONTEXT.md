# Phase 8: Spec v2 + Foundation - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Build every shared seam the four new entity kinds depend on, and document the split entity model in SPEC.md v2 — **without** shipping any per-kind authoring UI. Concretely:

- Kind constants for the new entities (`ARTICLE_KIND`, `LIVE_BEACON_KIND`, `TEMPORAL_SIGHTING_KIND`) in `src/lib/nostr/kinds.ts`.
- A shared `src/lib/nostr/tags.ts` module extracting `bbox`/`g`/`L`/`l`/`t`/`c`/`a` tag read/write helpers.
- An off-thread schema-validation Web Worker (`src/lib/validation/schemaWorker.ts`) hardening untrusted relay-authored Group schemas.
- An in-content `modelVersion` discriminator + defensive-parse contract so legacy kind-37518 events are recognized and skipped.
- A shared NIP-40 expiry filter (consumed later by Beacon + Sighting).
- A NIP-32 `L`/`l` paired-emit taxonomy helper + starter controlled vocabulary.
- `SPEC.md` rewritten to v2 describing the whole split (Story ~37520, slimmed Group 37518, Live Beacon ~37521, Temporal Sighting 37522).

**Scope anchor:** This is foundation only. `group/` rename (from `map-context/`), per-kind cast/factory/UI, governance ladder, NO-MOD MINIMUM, and beacon render belong to Phases 9–13. Phase 8 ships the seams those phases inherit, plus Factory+Cast *scaffolding* for the new kinds (SPEC-02) — no copy-pasted tag logic, no unguarded validator.

</domain>

<decisions>
## Implementation Decisions

### Kind-number assignment
- **D-01:** Assign `TEMPORAL_SIGHTING_KIND = 37522` **now** in `kinds.ts` and SPEC v2. Block is contiguous: **37520 Article · 37521 Beacon · 37522 Sighting** (Group stays 37518 slimmed; Dataset 37515 / Comment 37517 / Proposal 37519 unchanged).
- **D-02:** Phase 11 may still pivot Sighting *representation* (dedicated kind vs 37515+property) — the **number is reserved** regardless, so Foundation seams (tags.ts, discriminator) can reference it. SPEC v2 documents it as the assigned-and-recommended dedicated kind, with a note that Phase 11 confirms representation.

### Legacy 37518 handling (SPEC-03 defensive parse)
- **D-03:** **Silent drop.** New-model events carry an in-content `modelVersion` discriminator. On read, an event whose `modelVersion` is **absent or unrecognized** is classified legacy/inert and **never enters the render set** — no chip, no placeholder, no user-facing noise.
- **D-04:** This is a clean-break stance: legacy 37518 is treated as "no longer exists" from the UX's point of view. No migration, no back-compat rendering. (Detection keys off the discriminator; for 37518 specifically, legacy = missing v2 discriminator / missing slimmed `governance` shape.)

### Taxonomy (TAX-01, NIP-32)
- **D-05:** Phase 8 ships the NIP-32 paired-emit helper (`["L", ns]` + `["l", value, ns]`) **and** a starter controlled vocabulary — not helper-only.
- **D-06:** Namespace = flat **`earthly`** (not reverse-DNS `org.earthly.*`, not per-axis). `["L", "earthly"]` / `["l", <value>, "earthly"]`.
- **D-07:** Starter vocab axis = **feature category** — a small controlled set (e.g. `natural`, `infrastructure`, `amenity`, `route`, `boundary`) that a schema-Group can later enforce on attachments. Freeform `t` hashtags remain available and must not double-encode what `L`/`l` governs.

### Claude's Discretion (resolved defaults — user opted not to discuss)
- **SPEC.md v2 form:** rewrite the existing 421-line `SPEC.md` **in place** (clean break); v1 stays in git history. No parallel/versioned spec file.
- **`tags.ts` migration blast radius:** extract the shared helpers **and** migrate the two existing shipped kinds (`geo-event/helpers.ts`, `map-context/helpers.ts`) to consume `tags.ts` — research mandates extraction *from* both, so they become the first consumers (no lingering copy-paste). Planner should weigh keeping the diff to the shipped surface tight.
- **Schema worker hardening:** research defaults — Web Worker, hard timeout-kill (≤100ms), compile-once per schema-hash cache, reject external/recursive `$ref`, cap byte-size/depth/nesting before compile, Ajv `$data` **off**, draft-2020-12 dialect pinned (`ajv/dist/2020`).
- **`modelVersion` shape/placement:** in-content field; exact key + value scheme is planner/research detail, constrained only by D-03 (absence/mismatch ⇒ skip) and the requirement that it round-trips through Factory+Cast.
- **NIP-40 expiry filter:** single shared `isExpired` wrapper over `applesauce-core/helpers/expiration`, client-filters `expiration < now` at all read paths regardless of relay GC.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Spec & requirements
- `SPEC.md` — current v1 canonical spec (421 lines); **target of the v2 rewrite** in this phase. Defines kind semantics, two-lane context model, schema-hash, blob refs, lineage rules.
- `.planning/REQUIREMENTS.md` §SPEC-01..05, §TAX-01 — the six requirements this phase delivers; also lists the clean-break / no-migration policy.
- `.planning/PROJECT.md` — v1.2 scope, clean-break policy, deferred moderation (NIP-72/WoT), entity model (spec v2).
- `.planning/ROADMAP.md` §Phase 8 — goal + 5 success criteria + dependency spine.

### Research (v1.2 — all decisions documented; Phase 8 research flag = SKIP)
- `.planning/research/SUMMARY.md` — executive summary; Phase 1 (Foundation) deliverables list, pitfalls 5/6/7 mapped to this phase, zero-new-deps confirmation.
- `.planning/research/STACK.md` — exact installed library surfaces (`ajv@8.20.0` via `ajv/dist/2020`, `applesauce-core@6.1.0` helpers `pointers`/`expiration`/`tags`/`time`, `worldGeohash.ts`); explicit non-additions.
- `.planning/research/ARCHITECTURE.md` — Factory+Cast structure, `tags.ts` extraction rationale, schema-worker placement, EventStore query shapes.
- `.planning/research/PITFALLS.md` — schema-DoS (pitfall 1), NIP-40 advisory (5), clean-break orphans (6), NIP-32 pairing/namespace (7), `d`-tag lineage (8).

### Casting contract (mandated by maintainer)
- https://applesauce.build/apps/casting/events.html — new entity classes MUST follow official applesauce casting (`EventCast` + `castEvent()`/`castEventStream()`/`castTimelineStream()`, `eventStore.replaceable()` reads, `EventFactory` blueprint writes). Existing `src/lib/nostr/*/cast.ts` already extend `EventCast` — mirror them.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/nostr/kinds.ts` — central kind-constant module; add the three new constants here (existing block 37515/37517/37518/37519/34444 + status kinds).
- `src/lib/nostr/{geo-event,map-context,geo-comment,geo-proposal}/{helpers,cast,factory,index}.ts` — Factory+Cast pattern proven 4×; new kinds slot in identically. `map-context/cast.ts` already extends `applesauce-core/casts` `EventCast` — the casting contract is established, not new.
- `src/lib/context/validation.ts` — existing `ajv` usage; the schema worker reuses this dialect/config knowledge (move it off-thread, harden it).
- `src/lib/worldGeohash.ts` — dependency-free geohash for `g` tags (precision 5–7 on centroid).
- v1.1 QuickJS-in-Worker harness — the proven shape for the off-thread timeout-kill schema worker (same Worker + hard-kill pattern).

### Established Patterns
- One `helpers.ts` + `cast.ts` + `factory.ts` + `index.ts` per kind; `EventCast` read views; `EventFactory` blueprint writes. `tags.ts` is the *only* new shared abstraction — it removes the copy-paste that 4 more kinds would multiply.
- `src/lib/context/scope.ts`, `references.ts`, `displayOrdering.ts` — context-layer helpers that later phases (Group attach lane) build on; not modified here but inform tag-helper shapes.

### Integration Points
- `tags.ts` becomes a dependency of `geo-event/helpers.ts` + `map-context/helpers.ts` (migrated to consume it) and all four new-kind helper modules.
- The schema worker is instantiated by the Group validation pipeline (Phase 9) — Phase 8 ships the worker + a typed call interface, not the Group wiring.
- NIP-40 `isExpired` filter plugs into read paths consumed by Beacon (Phase 12) + Sighting (Phase 11).

</code_context>

<specifics>
## Specific Ideas

- Kind block must read 37520/37521/37522 contiguous — deliberate, documented in SPEC v2.
- Taxonomy: flat `earthly` namespace with a feature-category starter vocab — concrete enough to test the enforce path in Phase 9, not a guessed full taxonomy.
- Legacy events should "just disappear" from the user's perspective — the maintainer explicitly does not want a legacy/unsupported placeholder cluttering the UI.

</specifics>

<deferred>
## Deferred Ideas

- **Dev-visible legacy logging** — a `console.debug('skipped legacy 37518 …')` was offered and not chosen; pure silent drop preferred. Could be revisited if legacy events cause confusion during dev, but not in scope.
- **SPEC.md versioned/parallel form** — keeping v1 alongside v2 was offered; rejected in favor of in-place rewrite (git history is the archive).
- **Per-axis / reverse-DNS taxonomy namespaces** (`org.earthly.category`, sibling axes) — not now; flat `earthly` chosen. Revisit if a second controlled axis is needed.
- **Group governance ladder, NO-MOD MINIMUM, schema-authoring UI** — Phase 9.
- **Sighting representation final call (dedicated kind vs 37515+property)** — Phase 11 (number 37522 reserved regardless).
- **Beacon lifecycle (replaceable+NIP-40 vs ephemeral)** — Phase 12.

</deferred>

---

*Phase: 8-spec-v2-foundation*
*Context gathered: 2026-06-25*
