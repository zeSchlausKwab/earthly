---
phase: 08
slug: spec-v2-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-25
---

# Phase 08 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> **Audit type:** Mitigation verification — register authored at plan-time (all 5 PLANs carried parseable `<threat_model>` blocks). Every mitigation assumed absent until proven present in shipped code by grep/read + executed test/build evidence. Implementation files unmodified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| relay/cache → guard | Legacy/foreign-relay 37518 (and new-kind) events with untrusted, possibly malformed `content` parsed by `hasCurrentModelVersion` / `is<Entity>()` guards on the read path | Untrusted event JSON (modelVersion discriminator) |
| relay → schema worker | Ajv schema authored by a stranger, fetched from a relay — untrusted executable input crossing into the validator (the one genuinely new boundary Phase 8 introduces) | Untrusted JSON Schema (executed against input) |
| worker registry → runtime | The worker artifact must actually emit and be served, or the safety guarantee silently degrades to fail-open | Build-emitted worker asset |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-08-01-1 | Tampering (false-green tests) | Tests asserting a weaker contract than the seam requires | mitigate | Pinned tests reference exact final symbols + assert real semantics, not vacuous passes: `modelVersion.test.ts:38-57` (`.not.toThrow()` then value), `tags.test.ts:116-121` (throws on `t`/`l` overlap), `schemaWorker.test.ts:48,72-76,98` (fail-closed + compile-once + `$data`-off). 44/44 GREEN | closed |
| T-08-03 | Tampering / DoS (crash) | `hasCurrentModelVersion` parsing legacy/malformed-content 37518 during list `filter`/`map` | mitigate | `modelVersion.ts:25-32` — `JSON.parse` in try/catch returns `false`, never throws (mirrors `map-context/helpers.ts`). `modelVersion.test.ts:44-66` no-throw rows | closed |
| T-08-TAX | Tampering | NIP-32 `l` emitted without paired `L`, or value double-encoded as both `t` and `l` | mitigate | `tags.ts:167-185` atomic `['L','earthly']`+`['l',v,'earthly']` emit; `tags.ts:171-177` throws on `t`==`l` (TAX-01 disjointness). `tags.test.ts:83-121` | closed |
| T-08-EXP | (advisory) | NIP-40 expiry treated as relay-enforced, leaving expired events on the map | accept→mitigate | `expiry.ts:22-30` — client-side `isExpired`/`dropExpired` read filter; relay GC never trusted. Seam consumed by Phases 11/12. Malformed-expiration fail-open noted as advisory residual WR-06 | closed |
| T-08-04-RD | DoS (ReDoS, CVE-2025-69873 class) | ReDoS `pattern` in untrusted schema vs long input | mitigate | `schemaWorker.ts:105` off-thread worker; `:160-163` host watchdog (`100ms` in-engine + `500ms` slack) → `terminate()` + fail-closed; `:114-122` `onerror` fails closed. `ajv@8.20.0` ReDoS patch. `schemaWorker.test.ts:44-58`. (Sync-fallback in-engine bound = advisory WR-01; not the declared production boundary) | closed |
| T-08-04-REF | DoS (`$ref`/`$dynamicRef` blowup) | Recursive/external `$ref` resolver blowup | mitigate | `schema.worker.ts:102-105,140-141` — `rejectUnsafeSchema` rejects `$ref`/`$dynamicRef` BEFORE compile; `ajv.compile` never reached. `schemaWorker.test.ts:62-76` (compile counter stays 0) | closed |
| T-08-04-OOM | DoS (oversize/deep schema) | Oversized / deeply-nested schema OOM | mitigate | `schema.worker.ts:39-43,99-127` — `MAX_SCHEMA_BYTES 64KiB`, `MAX_DEPTH 12`, `MAX_KEYWORDS 4096` enforced by bounded walk before compile. `schemaWorker.test.ts:52-58` | closed |
| T-08-04-PP | Tampering (proto pollution via format+`$data`) | Prototype pollution | mitigate | `schema.worker.ts:67-72` — Ajv2020 `{strict:false,validateSchema:true}`; `$data:true` never passed; `addFormats` annotation-only; `ajv@8.20.0` ≥ 8.19 patch. `schemaWorker.test.ts:90-99` | closed |
| T-08-04-SPOOF | Spoofing of safety guarantee (fail-OPEN) | Worker never loads → validation silently no-ops | mitigate | `workerAssets.ts:62-65` single registration touchpoint; `bun run build` emitted `dist/workers/schema.worker.js` (141 KB) — load-bearing emission proof; fallback is fail-CLOSED (`schemaWorker.ts:143-144`); forbidden `new Worker(new URL(...))` absent in `src/lib/validation/` | closed |
| T-08-04-SC | Tampering (package installs) | npm/pip/cargo installs in this phase | accept | Zero deps added. ajv bumped to `^8.20.0` in ancestor `d9c8ab1` (predates first Phase 8 commit `937fb2e`; `git merge-base --is-ancestor` = YES); no `package.json`/`bun.lock` change in Phase 8 range. See Accepted Risks Log | closed |
| T-08-03-SCAFFOLD | Tampering / DoS (crash) | `is<Entity>()` guard throwing on malformed/legacy event during `filter(guard)`/`map` | mitigate | All 3 guards delegate content read to `hasCurrentModelVersion` (no-throw) + require kind/`d`/modelVersion: `article/helpers.ts:49-55`, `live-beacon/helpers.ts:46-52`, `temporal-sighting/helpers.ts:48-54`. Per-kind reject rows GREEN | closed |
| T-08-LINEAGE | Tampering (lineage fork) | `create()` re-running `generateShortDTag()` on edit forks entity; reusing `d` overwrites another | mitigate | `create()` generates `d` only if absent — `*/factory.ts:42-46`; `modify()` reuses `toEventTemplate(event)`, never regenerates `d` (mirrors `map-context/factory.ts`) | closed |
| T-08-01-DOC | Tampering (spec↔code drift) | SPEC.md documenting a contract that diverges from shipped code | mitigate | `spec.doc.test.ts:26-89` pins kind numbers + `modelVersion` + L/l·t·c split + dialect + NIP-40 against `SPEC.md` on disk; rewrite cites shipped `file_path:line` anchors. GREEN | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-04-SC | Phase 8 installs zero packages. `ajv@^8.20.0` (ReDoS + proto-pollution patches) and `ajv-formats@^3.0.1` were already present from ancestor `d9c8ab1` (2026-05-04). No `package.json`/`bun.lock` change across the Phase 8 commit range. The validation worker reuses pre-existing, audited dependencies. | gsd-security-auditor | 2026-06-25 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-25 | 13 | 13 | 0 | gsd-security-auditor (opus) |

**Verification gates run:** `bun test` (8 security-relevant files) → 44 pass / 0 fail · `bun run build` → GREEN, emitted `dist/workers/schema.worker.js` (T-08-04-SPOOF emission proof) · T-08-04-SC dep audit → no Phase 8 dep-file changes.

---

## Advisory Residuals (knowingly deferred at phase close — NOT blockers)

Code review (`08-REVIEW.md`) and verification (`08-VERIFICATION.md:127-136`) logged 6 advisory WARNINGs, all classified WARNING (not BLOCKER) and deferred to a follow-on pass. None reverse a CLOSED disposition.

- **WR-01** (T-08-04-RD): sync fallback (bun test/SSR/V8 host) has no in-engine time bound. The browser worker path (declared production boundary) IS protected by the host `terminate()` watchdog. Durable fix: per-`pattern` linear-time safety check in `rejectUnsafeSchema`.
- **WR-02** (T-08-LINEAGE): `generateShortDTag()` branch is dead — `blankEventTemplate(kind)` already injects a 21-char applesauce nanoid `d`. Lineage discipline still holds; format-drift only.
- **WR-03** (T-08-TAX): `setHashtags` silently strips overlapping `l` values while `setLabels` throws on overlapping `t` — order-dependent asymmetry. Disjointness still enforced both ways.
- **WR-04** (T-08-04-REF): `$ref` gate is a substring scan — misses `$recursiveRef`/`$recursiveAnchor`. Defense-in-depth gap, not a confirmed bypass (under `strict:false`, Ajv2020 treats `$recursiveRef` as an unknown keyword).
- **WR-05** (T-08-04-OOM): `json.length` counts UTF-16 code units, not bytes — size cap looser than documented for multi-byte schemas. Cap still bounds work.
- **WR-06** (T-08-EXP): a malformed `expiration` (`NaN`) is treated as "never expires" (fails open for an advisory GC predicate). Conservative callers should treat malformed as "could expire."

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-25

---

*Phase: 08-spec-v2-foundation · Audited: 2026-06-25 · threats_open: 0*
