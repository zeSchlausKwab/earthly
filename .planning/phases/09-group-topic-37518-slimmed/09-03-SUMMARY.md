---
phase: 09-group-topic-37518-slimmed
plan: 03
subsystem: nostr-group
tags: [group, governance, schema-validation, off-thread, mute, filter-modes, green]
requires:
  - "Plan 01 RED contracts (schemaErrors, schemaHash, filterModes, attach, warnNotBlock, useMuteStore)"
  - "Plan 02 group/ module (GroupGovernance enum)"
  - "Phase 8 off-thread schema worker (schema.worker.ts / schemaWorker.ts)"
provides:
  - "Extended SchemaValidationVerdict carrying bounded per-rule errors[] (D-06)"
  - "src/lib/group/schemaHash.ts — canonical SHA-256 compute + verify (O-03)"
  - "src/lib/group/filterModes.ts — off/warn/strict foreign-lane gate, off-thread (GROUP-05)"
  - "src/lib/group/attach.ts — #c discovery filter + governance lane gate + warn-not-block (GROUP-02/04)"
  - "src/lib/group/index.ts — Group service barrel"
  - "src/lib/mute/useMuteStore.ts — device-local app-global mute set (D-10/D-11)"
affects:
  - "Plan 04 (editor) / 05 (publish) / 06 (view) consume these verified primitives"
tech-stack:
  added: []
  patterns:
    - "EXTEND the off-thread worker verdict (D-06 option a) — no second in-thread validator"
    - "canonical deep key-sort before SHA-256 (Pitfall 3 — JSON.stringify is key-order-dependent)"
    - "verify-before-validate on publishedHash; mismatch ⇒ show-with-warn, never silent strict-hide"
    - "zustand persist with explicit createJSONStorage so .persist admin API attaches under bun test"
key-files:
  created:
    - src/lib/group/schemaHash.ts
    - src/lib/group/filterModes.ts
    - src/lib/group/attach.ts
    - src/lib/group/index.ts
    - src/lib/mute/useMuteStore.ts
  modified:
    - src/lib/validation/schema.worker.ts
    - src/lib/validation/schemaWorker.ts
decisions:
  - "D-06 option (a): EXTEND SchemaValidationVerdict with bounded errors[] (cap MAX_ERRORS=50); DoS/gate path stays cheap (no per-rule allocation)"
  - "filterForeignAttachment(mode, schema, properties, opts) signature follows the RED test (mode-first), distinct from the plan prose's (group, properties, mode)"
  - "Split the verify target: options.schemaHash is the worker cache key; options.publishedHash is the verify-before-validate target (the RED test passes an arbitrary cache key and still expects strict to hide — so the cache key is NOT verified)"
  - "Mute store needs explicit storage: createJSONStorage(() => localStorage) — the default resolver does not attach .persist under bun's localStorage polyfill"
metrics:
  duration: ~22m
  completed: 2026-06-25
  tasks: 2
  files: 7
---

# Phase 9 Plan 03: Group Validation Trust Core Summary

Wired the security-critical Group validation pipeline entirely through the Phase-8 off-thread hardened worker: extended the worker verdict with bounded per-rule `errors[]` (D-06), added canonical schema-hash compute/verify (O-03), and built the `filterModes` / `attach` / `mute` service layer with default-strict-for-schema, governance-keyed foreign lanes, the GROUP-04 warn-not-block invariant, and a device-local app-global mute set. This turns Plan 01's schemaErrors / schemaHash / filterModes / attach / warnNotBlock / useMuteStore contracts GREEN — gating runs EXCLUSIVELY off-thread (no in-thread `ajv.compile` for gating).

## What Was Built

**Task 1 (commit a467ba1)** — worker verdict extension + schema-hash:
- `schema.worker.ts`: new `SchemaRuleError { instancePath, schemaPath?, keyword, message, params? }` + optional `errors?: SchemaRuleError[]` on `SchemaValidationVerdict`. `runSchemaValidation` maps Ajv's `allErrors` list into `errors[]` on a VALIDATION failure, bounded by `MAX_ERRORS = 50` (T-09-03-ERR-DOS). The DoS/gate-reject catch path returns `{ ok:false, error }` WITHOUT `errors` — it stays cheap. Phase-8 DoS/fail-closed proofs unchanged (additive only).
- `schemaWorker.ts`: `settle()` now forwards `errors` alongside `ok`/`error` (`resolve({ ok, error, errors })`). No in-thread re-validation path added.
- `schemaHash.ts` (new): `canonicalizeSchema` deep recursive key-sort (arrays keep order, objects rebuilt from sorted keys); `computeSchemaHash` = `sha256:${computeChecksum(JSON.stringify(canonical))}` reusing the existing SHA-256 (no new crypto / no validator); `verifySchemaHash` recomputes and compares, returning `false` on mismatch (caller treats false as do-not-validate-show-warning).

**Task 2 (commit 3db6eec)** — filterModes + attach + mute:
- `filterModes.ts` (new): `GroupFilterMode = 'off'|'warn'|'strict'`; `resolveGroupFilterDefault('schema')→'strict'`, `('open')→'off'`, `('closed')→null` (no lane). `filterForeignAttachment(mode, schema, properties, { schemaHash?, publishedHash? })`: `off` shows all; otherwise verify `publishedHash` first (mismatch → show-with-warn "Schema could not be verified", never silent strict-hide), then `validateSchema` OFF-THREAD; map `errors[]` into a legible reason (e.g. "missing required `name`"); `strict` hides non-conforming, `warn` shows-with-reason. Worker throw → fail-open-for-legibility-only ("couldn't check"). No in-thread gating import.
- `attach.ts` (new): `buildAttachDiscoveryFilter(coord) = { '#c':[coord], kinds:[37515] }`; `resolveForeignLaneFilter(coord, governance)` returns `null` for `closed`, the filter for `open`/`schema` (rewrite of `scope.ts`'s `allowForeignAttachments` branch into `governance !== 'closed'`). `validateAttachment(schema, props, opts)` runs the off-thread worker; `canPublishStandalone(verdict)` is INVARIANTLY `true` — GROUP-04 hard invariant, no code path disables publish (T-09-03-BLOCK-BYPASS).
- `index.ts` (new): barrel re-exporting attach/filterModes/schemaHash (warnNotBlock imports `validateAttachment` + `canPublishStandalone` from `@/lib/group`).
- `mute/useMuteStore.ts` (new): zustand `persist` store `{ muted: string[]; mute; unmute; isMuted }`; `mute` Set-dedups; persisted under `earthly-muted-contributors` with `partialize` allow-list and explicit `createJSONStorage(() => localStorage)`. Device-local, app-global, no signing.

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 - Blocking] `filterForeignAttachment` signature is mode-first, per the RED test.**
- **Found during:** Task 2.
- **Issue:** The plan prose specifies `filterForeignAttachment(group, attachmentProperties, mode)`. The frozen RED contract (`filterModes.test.ts:49`) calls `filterForeignAttachment(mode, schema, properties, { schemaHash })`. Plan 01 SUMMARY is explicit that Plans 02–06 implement against the fixed contracts (no drift).
- **Resolution:** Implemented the test's signature exactly (mode, schema, properties, options) returning `{ show, reason? }` (the contract's shape, not the prose's `{ visible, conforming }`).
- **Files:** src/lib/group/filterModes.ts · **Commit:** 3db6eec

**2. [Rule 1 - Bug] Cache-key vs. verify-target split.**
- **Found during:** Task 2 (strict-hide test initially failed).
- **Issue:** The plan says verify the supplied `schemaHash` before validating. But the RED test passes an arbitrary cache key (`'sha256:rn'`) that does NOT match `requireNameSchema`'s real hash, while still expecting `strict` to HIDE a non-conforming attachment. Treating the cache key as a verify target made strict show-with-warn instead of hiding.
- **Resolution:** Split into two options — `schemaHash` (opaque worker compile-cache key, never verified) and `publishedHash` (the verify-before-validate target, Pitfall 3). The Pitfall-3 mismatch behavior is preserved on `publishedHash`; the cache key drives the worker only.
- **Files:** src/lib/group/filterModes.ts · **Commit:** 3db6eec

**3. [Rule 3 - Blocking] Mute store needs explicit `createJSONStorage`.**
- **Found during:** Task 2 (`persist.getOptions().name` returned undefined).
- **Issue:** zustand's default storage resolver does not attach the `.persist` admin API under bun's memory-backed `localStorage` polyfill, so `useMuteStore.persist.getOptions()` was undefined and the persist-contract test failed. A minimal-repro probe confirmed the default resolver vs. explicit `createJSONStorage` difference.
- **Resolution:** Pass `storage: createJSONStorage(() => localStorage)` explicitly. `.persist` attaches and `getOptions().name === 'earthly-muted-contributors'`.
- **Files:** src/lib/mute/useMuteStore.ts · **Commit:** 3db6eec

## Out of Scope (deferred)

- `src/lib/group/noModMinimum.test.ts` (GROUP-08 RED from Plan 01) remains RED. It pins `@/lib/group/noModMinimum` (kind→sig→mute gate, 50-cap, flipToClosed), which is NOT in Plan 03's `files_modified`. A later plan implements it. Logged to `deferred-items.md`. No action taken.

## Verification

- `bun test src/lib/validation/schemaErrors.test.ts src/lib/validation/schemaWorker.test.ts src/lib/group/schemaHash.test.ts` → 17 pass / 0 fail (Task 1).
- `bun test src/lib/group/filterModes.test.ts src/lib/group/attach.test.ts src/lib/group/warnNotBlock.test.ts src/lib/mute/useMuteStore.test.ts` → 18 pass / 0 fail (Task 2).
- `bun test src/lib/group src/lib/validation src/lib/mute` → 35 pass / 1 fail (1 error) — the single fail/error is `noModMinimum.test.ts` (out-of-scope GROUP-08 RED, later plan). All Plan-03 contracts GREEN; Phase-8 worker proofs intact.
- `bun run build` → ✅ 1178ms; `dist/workers/schema.worker.js` re-emitted with the additive verdict shape.
- `biome check` clean on all 7 created/modified files.

## Acceptance Grep Assertions

- `grep -n "errors" src/lib/validation/schemaWorker.ts` → settle() forwards `errors` (no in-thread re-validate).
- `grep -c "ajv.compile\|new Ajv" src/lib/group/schemaHash.ts` → 0 (no validator added).
- `MAX_ERRORS=50` `.slice(0, MAX_ERRORS)` cap present in schema.worker.ts.
- `grep -c "context/validation" src/lib/group/filterModes.ts` → 0 (no in-thread gating import).
- `grep -n "validateSchema" src/lib/group/filterModes.ts` → present (off-thread gating).
- `grep -n "verifySchemaHash" src/lib/group/filterModes.ts` → present (verify-before-validate).

## Threat Mitigations Applied

- T-09-03-DOS-SCHEMA: all Group validation routes through the off-thread `validateSchema` worker; no in-thread `ajv.compile` for gating (grep-asserted 0).
- T-09-03-ERR-DOS: per-rule `errors[]` bounded by `MAX_ERRORS = 50`.
- T-09-03-HASH-DIVERGE: canonical key-sorted SHA-256; `verifySchemaHash` mismatch ⇒ show-with-warn, never silent divergent filtering.
- T-09-03-BLOCK-BYPASS: `canPublishStandalone` invariantly `true`; no path disables publish on schema failure (GROUP-04).
- T-09-SC: zero new dependencies (no installs).

No new threat surface beyond the plan's `<threat_model>`.

## Self-Check: PASSED

- All 7 created/modified files exist on disk (verified).
- Both task commits exist (a467ba1, 3db6eec).
