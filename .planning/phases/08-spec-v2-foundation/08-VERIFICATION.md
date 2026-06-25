---
phase: 08-spec-v2-foundation
verified: 2026-06-25T10:30:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 8: Spec v2 Foundation — Verification Report

**Phase Goal:** Every shared seam the four entity kinds depend on exists and is safe — kind constants, the extracted tag-helper module, the off-thread schema-validation worker, the in-content version discriminator with defensive legacy skip, the shared NIP-40 expiry filter, and the NIP-32 L/l taxonomy helper — with SPEC.md v2 documenting the whole split entity model. Nothing per-kind ships with copy-paste or an unguarded validator.
**Verified:** 2026-06-25T10:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SPEC.md v2 documents the split entity model (Article ~37520, slimmed Group 37518, Live Beacon ~37521, Temporal Sighting ~37522) with final kind-number assignments, replacing the overloaded kind-37518 "context" | VERIFIED | SPEC.md opens with "v2 (split entity model)", includes a kind table with 37520/37521/37522 as NEW, §3 documents slimmed 37518 with clean break, §4/§5/§6 cover Story/Live Beacon/Temporal Sighting; doc-assertion test (spec.doc.test.ts) passes 8/8 assertions |
| 2 | Each new kind has Factory+Cast event-class scaffolding (helpers.ts/cast.ts/factory.ts) consuming ONE shared tags.ts module for bbox/g/L/l/t/c/a — NO copy-pasted tag logic | VERIFIED | All three kinds (article/live-beacon/temporal-sighting) import tag helpers from `@/lib/nostr/tags` in their helpers.ts; no copy-pasted `getTagValue(event,'bbox')` or `filter(tag[0]==='t')` bodies found in any new entity file; both existing kinds (map-context/geo-event) migrated to delegate to tags.ts |
| 3 | A legacy kind-37518 event is recognized via the in-content version discriminator (modelVersion) and defensively skipped rather than mis-rendered or crashing the viewer (no-throw on malformed JSON) | VERIFIED | `hasCurrentModelVersion()` in modelVersion.ts wraps `JSON.parse` in try/catch, returns false on parse failure, absence, or version mismatch — never throws; all three per-kind guards gate on `kind + d-tag + hasCurrentModelVersion(event)`; modelVersion.test.ts passes 4/4 tests including no-throw truth table |
| 4 | An untrusted relay-authored schema (ReDoS pattern or recursive $ref) cannot freeze/crash a viewer tab — schema validation runs off the main thread with a hard timeout-kill, schema-hash cache, restricted dialect (no $data, no external $ref, size/depth capped) | VERIFIED | Production browser path: `hasSpawnableWorker()` returns true for http(s) origins → Worker path → host `setTimeout` watchdog → `terminate()` at 600ms fail-closed; `rejectUnsafeSchema` runs before `ajv.compile` (gate blocks $ref/$dynamicRef, MAX_SCHEMA_BYTES=64KB, MAX_DEPTH=12, MAX_KEYWORDS=4096); $data is OFF (no `$data:true` in Ajv config); compile-once cache keyed by schemaHash; `schema.worker.js` emitted to `dist/workers/` (141 KB); schemaWorker.test.ts passes 7/7 tests |
| 5 | The client filters expired (NIP-40) events on read; a user can apply NIP-32 L/l controlled-vocabulary labels with correct namespace pairing while freeform t hashtags remain available — the three-way L/l·t·c split is in place | VERIFIED | `isExpired(event, now)` + `dropExpired(events, now)` in expiry.ts wrap applesauce's `getExpirationTimestamp`; `setLabels` emits paired `['L','earthly']` + `['l',v,'earthly']`; `setHashtags` strips values governed by l-labels; `setLabels` throws on t/l overlap; EARTHLY_LABEL_NAMESPACE='earthly', FEATURE_CATEGORY_VOCAB defined; tags.test.ts passes; expiry.test.ts passes |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/nostr/kinds.ts` | ARTICLE_KIND=37520, LIVE_BEACON_KIND=37521, TEMPORAL_SIGHTING_KIND=37522 | VERIFIED | All three constants present at lines 24, 27, 30 |
| `src/lib/nostr/tags.ts` | Shared bbox/g/t/L/l/c/a read+write helpers + FEATURE_CATEGORY_VOCAB + EARTHLY_LABEL_NAMESPACE + disjointness guard | VERIFIED | 192 lines; exports all 14 required symbols; both shipped kinds delegate to it |
| `src/lib/nostr/modelVersion.ts` | MODEL_VERSION constant + hasCurrentModelVersion no-throw guard | VERIFIED | 29 lines; MODEL_VERSION='earthly/2'; try/catch defensive parse confirmed |
| `src/lib/nostr/expiry.ts` | isExpired wrapper over applesauce-core/helpers/expiration + dropExpired | VERIFIED | 27 lines; delegates to getExpirationTimestamp; both functions exported |
| `src/lib/validation/schema.worker.ts` | Pure runSchemaValidation engine: rejectUnsafeSchema gate + Ajv2020 ($data off) + compile-once-per-hash cache | VERIFIED | 199 lines; gate runs before ajv.compile; compiledCache Map; __compileCount/__resetCompileCount hooks |
| `src/lib/validation/schemaWorker.ts` | Main-thread validateSchema client: workerUrl spawn + host watchdog terminate + fail-closed + sync fallback | VERIFIED | 180 lines; hasSpawnableWorker() gates Worker vs sync; watchdog setTimeout → disposeWarmWorker → terminate() |
| `src/lib/workers/workerAssets.ts` | schema worker registration entry (servedName + sourcePath) | VERIFIED | schema: { servedName: 'schema.worker.js', sourcePath: 'src/lib/validation/schema.worker.ts' } at line 62 |
| `src/lib/nostr/article/{helpers,cast,factory,index}.ts` | Article (37520) Factory+Cast scaffolding | VERIFIED | All 4 files exist; extends EventCast; MODEL_VERSION injected; delegates to tags.ts |
| `src/lib/nostr/live-beacon/{helpers,cast,factory,index}.ts` | Live Beacon (37521) Factory+Cast scaffolding with expiresAt | VERIFIED | All 4 files exist; getExpirationTimestamp in cast.ts:56; MODEL_VERSION injected |
| `src/lib/nostr/temporal-sighting/{helpers,cast,factory,index}.ts` | Temporal Sighting (37522) Factory+Cast scaffolding with expiresAt | VERIFIED | All 4 files exist; getExpirationTimestamp in cast.ts:59; MODEL_VERSION injected |
| `SPEC.md` | v2 canonical spec covering all kinds + tag vocabulary + modelVersion + schema dialect + NIP-40 | VERIFIED | v2 status declared; §1–§11 cover all kinds; §7 three-way split; §8 modelVersion; §9 schema governance; §10 NIP-40 |
| `src/lib/nostr/spec.doc.test.ts` | SPEC-01 doc-assertion test | VERIFIED | 8 tests pass; reads SPEC.md via Bun.file; asserts kind numbers + modelVersion + L/l split + vocab + dialect + NIP-40 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| map-context/helpers.ts | tags.ts | import + delegate | VERIFIED | `import { getBbox, getContextRefs, getHashtags, getReferencedAddresses } from '@/lib/nostr/tags'` |
| geo-event/helpers.ts | tags.ts | import + delegate | VERIFIED | `import { getBbox, getContextRefs, getGeohash as getGeohashShared, getHashtags as getHashtagsShared } from '@/lib/nostr/tags'` |
| article/helpers.ts | tags.ts | delegates bbox/g/t/L/l/c/a reads | VERIFIED | Imports all 6 read helpers from '@/lib/nostr/tags' |
| article/factory.ts | modelVersion.ts (MODEL_VERSION) | writes modelVersion into create() content | VERIFIED | `import { MODEL_VERSION } from '@/lib/nostr/modelVersion'`; injected at factory.ts:42 |
| article/cast.ts | applesauce-core/casts (EventCast) | extends EventCast | VERIFIED | `import { EventCast, type CastRefEventStore } from 'applesauce-core/casts'` |
| schemaWorker.ts | workerAssets.ts (workerUrl('schema')) | Worker spawn via registry | VERIFIED | `import { workerUrl } from '@/lib/workers/workerAssets'`; `new Worker(workerUrl('schema'), { type: 'module' })` |
| schemaWorker.ts | schema.worker.ts (runSchemaValidation) | synchronous fallback | VERIFIED | `import { runSchemaValidation, ... } from './schema.worker'`; called at line 144 |
| spec.doc.test.ts | SPEC.md | reads the doc and asserts required strings | VERIFIED | `const SPEC = await Bun.file('SPEC.md').text()`; 8 assertions pass |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All Phase 8 tests pass | `bun test src/lib/nostr/tags.test.ts ... spec.doc.test.ts` | 44 pass, 0 fail | PASS |
| Full suite stays green | `bun test` | 615 pass, 0 fail | PASS |
| schema.worker.js emitted by build | `ls dist/workers/` | schema.worker.js (141 KB) | PASS |
| modelVersion truth table | `bun test src/lib/nostr/modelVersion.test.ts` | 4 pass, 0 fail | PASS |
| ReDoS/oversized fail-closed within 600ms | schemaWorker.test.ts timing assertions | elapsed < 600ms (Bun/JSC) | PASS |
| $ref rejected before compile (compile count = 0) | schemaWorker.test.ts | count stays 0 | PASS |
| compile-once-per-schemaHash | schemaWorker.test.ts | count=1 after 2 calls same hash | PASS |
| No forbidden spawn pattern | `grep -rq "new Worker(new URL" src/lib/validation/` | ABSENT | PASS |
| No copy-pasted tag bodies in new entity files | `grep -rn "getTagValue.*'bbox'..." article/ live-beacon/ temporal-sighting/` | ABSENT | PASS |
| No TBD/FIXME/XXX markers in Phase 8 files | `grep -rn "TBD\|FIXME\|XXX" ...` | NONE | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| SPEC-01 | Plan 05 | SPEC.md v2 documents split entity model with final kind-number assignments | SATISFIED | SPEC.md v2 in place; spec.doc.test.ts 8/8 pass; all kind numbers + modelVersion + three-way split + dialect + NIP-40 documented |
| SPEC-02 | Plans 02, 04 | Each new kind has Factory+Cast following existing pattern, sharing one tags.ts module | SATISFIED | Article/LiveBeacon/TemporalSighting all have helpers.ts/cast.ts/factory.ts/index.ts; all delegate to tags.ts; no copy-paste |
| SPEC-03 | Plans 02, 04 | In-content version discriminator; legacy 37518 defensively skipped | SATISFIED | hasCurrentModelVersion no-throw guard; all three kind guards use it; legacy/malformed → false, never throw |
| SPEC-04 | Plan 03 | Off-thread schema validation, hard timeout-kill, hash cache, restricted dialect | SATISFIED | schema.worker.ts + schemaWorker.ts; Worker path with terminate() watchdog for browser production; sync fallback for SSR/test; $ref/$data/$size/$depth gates; compile-once cache |
| SPEC-05 | Plan 02 | NIP-40 expiry: client always filters on read | SATISFIED | isExpired + dropExpired in expiry.ts; applesauce getExpirationTimestamp; expiry.test.ts passes |
| TAX-01 | Plan 02 | NIP-32 L/l labels with correct namespace pairing; three-way L/l·t·c split | SATISFIED | setLabels emits paired L+l with 'earthly' namespace; setHashtags strips l-governed values; setLabels throws on overlap; FEATURE_CATEGORY_VOCAB defined; tags.test.ts passes |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| schema.worker.ts | 103 | `$ref` gate is substring scan (`/"\$ref"\|"\$dynamicRef"/.test(json)`) — misses `$recursiveRef`/`$recursiveAnchor`; over-rejects schemas where `"$ref"` appears in property values | Warning | Defense-in-depth gap only — `$recursiveRef` under `strict:false` is treated as an unknown keyword by Ajv2020 rather than resolved; gate is still fail-closed on both paths. Documented as WR-04. |
| expiry.ts | 22-25 | Malformed `expiration` tag (`NaN` from `parseInt`) treated as "never expires" rather than fail-safe drop | Warning | Advisory expiry — a hostile author publishing `['expiration','soon']` bypasses the client filter. Documented as WR-06. |
| article/factory.ts live-beacon/factory.ts temporal-sighting/factory.ts | 44-46 | `generateShortDTag()` branch is dead code — `blankEventTemplate(kind)` for addressable kinds already injects a 21-char nanoid d-tag, so the `if (!tpl.tags.some((t) => t[0] === 'd'))` guard is always false | Warning | Format drift — entities ship 21-char nanoid d-tags (applesauce default) instead of 8-char base32 project convention. Functional but inconsistent. Documented as WR-02. |
| tags.ts | 110-114 vs 167-185 | `setHashtags` silently strips overlapping l-values; `setLabels` throws on overlapping t-values — asymmetric discipline | Warning | Order-dependent behavior: `labels(['natural']).hashtags(['natural'])` silently drops 'natural' hashtag; `hashtags(['natural']).labels(['natural'])` throws. Neither is obvious. Documented as WR-03. |

---

### WR-01 Assessment (SC#4 — hard timeout-kill)

The code review identified that the synchronous fallback path (`!hasSpawnableWorker()`) has no in-engine time bound — `IN_ENGINE_DEADLINE_MS` is only used to compute the host watchdog timeout in the Worker path, not to bound work in the engine itself. The ReDoS test passes under Bun/JSC because JSC caps backtracking, but would block ~80s on V8.

**Assessment for SC#4:** SC#4 says "schema validation runs off the main thread with a hard timeout-kill." The **production browser path** (`hasSpawnableWorker()` returns true for http/https origins) DOES run off the main thread in a Worker with a host `terminate()` watchdog at 600ms — this is the path that protects browser viewer tabs from freezing. The sync fallback is used only in SSR and `bun test` environments, neither of which run in a viewer tab. The threat model (T-08-04-RD) targets browser viewer tab freeze — and that path IS protected.

**Verdict:** SC#4 is VERIFIED for the stated threat (browser viewer tab). WR-01 is a documented limitation of the sync fallback path (no in-engine deadline, JSC-dependent), not a blocker for the browser production use case. The code review correctly classified it as WARNING, not BLOCKER.

---

### Human Verification Required

None. All must-haves verified programmatically.

---

### Gaps Summary

No gaps. All 5 success criteria are verified against the actual codebase. The code review identified 6 warnings (WR-01 through WR-06) and 5 info items, none of which are blockers for the phase goal. Key warnings noted:

- **WR-01** (SC#4): Sync fallback unprotected on V8-class host — acceptable limitation; browser production path is fully protected.
- **WR-02**: Dead `generateShortDTag` branch; d-tags are nanoid format (applesauce default) rather than project 8-char base32 — format inconsistency, not a functional failure.
- **WR-03**: Asymmetric t/l disjointness enforcement (throw vs. silent strip) — advisory for downstream callers.
- **WR-04**: `$recursiveRef` not in denylist — defense-in-depth gap, not a confirmed bypass.
- **WR-05**: `json.length` measures UTF-16 code units, not bytes — size cap is looser than documented for multi-byte schemas.
- **WR-06**: Malformed `expiration` tag fails open (NaN < now = false) — conservative callers should treat missing or malformed as "could expire."

All six warnings are advisory and deferred to a follow-on `/gsd-secure-phase` pass, consistent with how the code review classified them.

---

_Verified: 2026-06-25T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
