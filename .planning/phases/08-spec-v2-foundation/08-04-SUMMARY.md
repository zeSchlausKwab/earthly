---
phase: 08-spec-v2-foundation
plan: 04
subsystem: api
tags: [nostr, applesauce, event-factory, event-cast, geojson, nip-40, nip-52, nip-23]

# Dependency graph
requires:
  - phase: 08-01
    provides: "Wave-0 RED test stubs pinning per-kind export contracts (isEntity/EntityFactory/Entity cast + *_KIND barrel constant)"
  - phase: 08-02
    provides: "kinds.ts (ARTICLE/LIVE_BEACON/TEMPORAL_SIGHTING _KIND), shared tags.ts read/write seam, modelVersion.ts (MODEL_VERSION + hasCurrentModelVersion), main barrel re-exports"
provides:
  - "Article (37520) Factory+Cast scaffold (helpers/cast/factory/index)"
  - "Live Beacon (37521) Factory+Cast scaffold with NIP-40 expiresAt"
  - "Temporal Sighting (37522) Factory+Cast scaffold with NIP-40 expiresAt"
  - "EntityFactory base — shared create/modify d-lineage + sign() accepting a bare sign-function"
  - "Three per-kind barrels wired into src/lib/nostr/index.ts"
affects: [09-group, 10-story, 11-sighting, 12-beacon]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-kind Factory+Cast scaffold mirroring map-context house pattern"
    - "EntityFactory base centralising modelVersion injection + d-lineage discipline across new kinds"
    - "Guard = kind + d + hasCurrentModelVersion (no-throw modelVersion gate, SPEC-03)"

key-files:
  created:
    - src/lib/nostr/entityFactory.ts
    - src/lib/nostr/article/{helpers,cast,factory,index}.ts
    - src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts
    - src/lib/nostr/temporal-sighting/{helpers,cast,factory,index}.ts
  modified:
    - src/lib/nostr/index.ts

key-decisions:
  - "Introduced a shared EntityFactory base (not in plan) to avoid copy-pasting create/modify d-lineage and to satisfy the Wave-0 sign(fn) contract once for all three kinds"
  - "create() strips any caller-supplied modelVersion then re-asserts MODEL_VERSION, so the SPEC-03 discriminator can never be overridden"
  - "TemporalSighting cast also exposes expiresAt (both expiry-bearing kinds), per the plan action even though only the beacon test asserts it"

patterns-established:
  - "Entity scaffold: helpers (guard + content getter + tag-read delegation) / cast (EventCast read view) / factory (EntityFactory create+modify+tag setters) / index barrel"
  - "Tag reads delegate to tags.ts getters; tag writes delegate to tags.ts setters — zero per-kind copy-paste (SPEC-02)"

requirements-completed: [SPEC-02, SPEC-03]

# Metrics
duration: 7min
completed: 2026-06-25
---

# Phase 8 Plan 04: Per-Kind Factory+Cast Scaffolds Summary

**Article (37520), Live Beacon (37521 + NIP-40 expiresAt), and Temporal Sighting (37522) Factory+Cast scaffolds, each gating its guard on the modelVersion discriminator and routing all tag reads/writes through the shared tags.ts seam — turning the last three Wave-0 RED suites GREEN.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-06-25T09:20:00Z
- **Completed:** 2026-06-25T09:27:00Z
- **Tasks:** 2
- **Files modified:** 14 (13 created + 1 barrel edit)

## Accomplishments
- Three net-new entity kinds scaffolded against the official applesauce `EventCast`/`EventFactory` contract, mirroring the `map-context/` house pattern.
- Each `is<Entity>()` guard gates on `kind` + `d` + `hasCurrentModelVersion` (SPEC-03): wrong-kind / legacy / malformed-content events return `false` without throwing.
- Each `create()` injects `MODEL_VERSION` into content and generates a `d` tag only if absent; each `modify()` reuses `toEventTemplate(event)` and never regenerates `d` (T-08-LINEAGE mitigated).
- Every tag read delegates to `tags.ts` getters and every tag write to `tags.ts` setters — no copy-pasted bbox/`g`/`t`/`L`/`l`/`c`/`a` logic (SPEC-02).
- LiveBeacon and TemporalSighting casts expose `expiresAt` via NIP-40 `getExpirationTimestamp`; both factories expose an `expiration()` setter.
- All three per-kind Wave-0 suites GREEN; full suite 607 pass / 0 fail (was 595 pass / 3 fail).

## Task Commits

Each task was committed atomically:

1. **Task 1: Article (37520) scaffold** - `fed5461` (feat)
2. **Task 2: Live Beacon (37521) + Temporal Sighting (37522) scaffolds** - `d487292` (feat)

## Files Created/Modified
- `src/lib/nostr/entityFactory.ts` - Shared `EntityFactory` base; `sign()` accepts a full `EventSigner` OR a bare sign-function `(template) => signedEvent` (Wave-0 test contract).
- `src/lib/nostr/article/helpers.ts` - `ArticleEvent` type, `ArticleContent`, defensive `getArticleContent`, `isArticle` guard, tag-read delegators; re-exports `ARTICLE_KIND`.
- `src/lib/nostr/article/cast.ts` - `Article extends EventCast` read view; `dTag` + tag getters.
- `src/lib/nostr/article/factory.ts` - `ArticleFactory extends EntityFactory`; `create()`/`modify()` + tag setters via `tags.ts`.
- `src/lib/nostr/article/index.ts` - Barrel.
- `src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts` - Same shape for kind 37521; cast exposes NIP-40 `expiresAt`; factory exposes `expiration()`.
- `src/lib/nostr/temporal-sighting/{helpers,cast,factory,index}.ts` - Same shape for kind 37522; cast exposes NIP-40 `expiresAt`; factory exposes `expiration()`; content carries NIP-52 `start`/optional `end` placeholders.
- `src/lib/nostr/index.ts` - Wired `./article`, `./live-beacon`, `./temporal-sighting` barrels (added below 08-02's `tags`/`modelVersion`/`expiry` re-exports, not clobbering them).

## Decisions Made
- **Shared `EntityFactory` base (deviation Rule 3 — blocking).** The Wave-0 tests call `Factory.create().sign(async (e) => ({...e, id, pubkey, sig}))` — a bare sign-function, not the `EventSigner` object applesauce's `sign()` operation requires (it calls `signer.getPublicKey()`/`signer.signEvent()`). Rather than copy a `sign()` override into all three factories, a single `EntityFactory` base overrides `sign()` to wrap a bare function into an `EventSigner` adapter. The three factories extend it, also sharing the create/modify d-lineage discipline. This honors "no copy-paste" in spirit and keeps the per-kind factories thin.
- **modelVersion is authoritative on create().** `create()` destructures out any caller-supplied `modelVersion`, then sets `modelVersion: MODEL_VERSION` last, so content can never declare a stale/foreign version.
- **Both expiry-bearing casts expose `expiresAt`.** Per the plan action (Task 2), TemporalSighting's cast gets `expiresAt` too, not just LiveBeacon's.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wave-0 sign(fn) contract vs applesauce EventFactory.sign(signer)**
- **Found during:** Task 1 (Article scaffold)
- **Issue:** The binding Wave-0 tests sign via `.sign(async (e) => ({...}))` (a bare sign-function), but applesauce's `EventFactory.sign()` delegates to a `sign(signer)` operation that requires an `EventSigner` object (`getPublicKey`/`signEvent`). A plain function threw `signer.getPublicKey is not a function`.
- **Fix:** Added `src/lib/nostr/entityFactory.ts` — an `EntityFactory extends EventFactory` whose `sign()` accepts either an `EventSigner` or a bare function, wrapping the latter into an `EventSigner` adapter (`signEvent` delegates to the function; `getPublicKey` is a best-effort placeholder the function's own result overrides). All three factories extend `EntityFactory`.
- **Files modified:** src/lib/nostr/entityFactory.ts (created); article/live-beacon/temporal-sighting factory.ts
- **Verification:** All three Wave-0 `create()` tests GREEN; biome clean; build green.
- **Committed in:** fed5461 (Task 1) and reused in d487292 (Task 2)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The shared base is a small, justified extraction required to satisfy the test contract without per-kind copy-paste. No scope creep — no UI, hooks, or render added (scaffolding only, as planned).

## Issues Encountered
None beyond the sign-function contract documented above.

## Threat Surface
No new threat surface beyond the plan's `<threat_model>`. Both registered threats are mitigated as specified:
- **T-08-03-SCAFFOLD** (guard throwing on malformed/legacy event): each guard delegates the content read to `hasCurrentModelVersion` (defensive `JSON.parse`, no-throw) and returns `false` on kind/`d`/`modelVersion` mismatch — asserted by each suite's reject row.
- **T-08-LINEAGE** (lineage fork on edit): `create()` generates `d` only if absent; `modify()` reuses `toEventTemplate(event)` and never regenerates `d`.

## Known Stubs
The content interfaces (`ArticleContent`, `LiveBeaconContent`, `TemporalSightingContent`) are intentionally minimal placeholders — this is scaffolding only. Per-kind authoring UI, hooks, and render are owned by Phases 9–13. No stubs flow to UI in this plan (no UI exists yet).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full Wave-0 baseline is now GREEN (607 pass / 0 fail). Phases 9–13 inherit ready-to-use Factory+Cast seams for Group/Story/Sighting/Beacon.
- Plan 08-05 (SPEC.md v2 rewrite + doc-assertion test) is the remaining Phase 8 plan.

## Self-Check: PASSED

All 13 created source files present on disk; both task commits (`fed5461`, `d487292`) found in git history.

---
*Phase: 08-spec-v2-foundation*
*Completed: 2026-06-25*
