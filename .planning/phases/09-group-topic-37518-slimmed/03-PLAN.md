---
phase: 09-group-topic-37518-slimmed
plan: 03
type: execute
wave: 3
depends_on: ["09-02"]
files_modified:
  - src/lib/validation/schema.worker.ts
  - src/lib/validation/schemaWorker.ts
  - src/lib/group/schemaHash.ts
  - src/lib/group/filterModes.ts
  - src/lib/group/attach.ts
  - src/lib/mute/useMuteStore.ts
autonomous: true
requirements: [GROUP-02, GROUP-04, GROUP-05]
must_haves:
  truths:
    - "An untrusted Group schema is validated ONLY off the main thread via the Phase-8 worker — the in-thread context/validation.ts path is never used for gating"
    - "Validation failures carry per-rule structured errors so the UI can show exactly which rule failed (D-06)"
    - "A schema-hash is computed canonically (key-order-independent) and a mismatch causes do-not-validate-show-warning, never silent divergent filtering (O-03)"
    - "The foreign-lane filter resolves off/warn/strict with default strict for schema Groups and a legible reason on every hidden/flagged item (GROUP-05)"
    - "A contributor's dataset is never blocked from publishing on schema failure (GROUP-04)"
    - "A muted contributor is dropped device-locally and app-globally (D-10/D-11)"
  artifacts:
    - path: "src/lib/validation/schema.worker.ts"
      provides: "SchemaValidationVerdict extended with structured errors[]; SchemaRuleError type"
      contains: "errors"
    - path: "src/lib/group/schemaHash.ts"
      provides: "canonicalizeSchema + computeSchemaHash + verifySchemaHash over computeChecksum"
      contains: "canonicalize"
    - path: "src/lib/group/filterModes.ts"
      provides: "GroupFilterMode off/warn/strict, resolveGroupFilterDefault, off-thread filterForeignAttachment with reason"
      contains: "validateSchema"
    - path: "src/lib/group/attach.ts"
      provides: "attach-discovery filter + governance!=closed foreign-lane condition + warn-not-block entrypoint"
      contains: "governance"
    - path: "src/lib/mute/useMuteStore.ts"
      provides: "device-local global persisted mute set"
      contains: "persist"
  key_links:
    - from: "src/lib/group/filterModes.ts"
      to: "src/lib/validation/schemaWorker.ts"
      via: "validateSchema(schema, data, { schemaHash }) off-thread"
      pattern: "validateSchema\\("
    - from: "src/lib/group/schemaHash.ts"
      to: "src/lib/nostr/geo-event/helpers.ts"
      via: "computeChecksum (SHA-256-hex)"
      pattern: "computeChecksum"
    - from: "src/lib/group/filterModes.ts"
      to: "src/lib/group/schemaHash.ts"
      via: "verifySchemaHash before validating"
      pattern: "verifySchemaHash"
---

<objective>
Wire the security-critical validation pipeline that Phase 9's success criteria mandate ship HERE, never after: route ALL Group schema/geometry validation through the Phase-8 off-thread hardened worker (schema DoS guard), extend the worker verdict to carry per-rule structured errors (D-06), add canonical schema-hash compute+verify (O-03 / Pitfall 3), build the off/warn/strict `filterModes` gate with default-strict-for-schema (GROUP-05), build the governance-keyed attach-discovery + warn-not-block entrypoint (GROUP-02/GROUP-04), and ship the device-local app-global mute store (D-10/D-11). This turns Plan 01's schemaHash / filterModes / warnNotBlock / attach / schemaErrors / useMuteStore tests GREEN.

Purpose: This is the trust core. The two phase-mandated guards (schema DoS, NO-MOD coordinate validation) and the warn-not-block invariant all live in this pure/service layer so the editor (04), publish flow (05), and view (06) can consume verified primitives without re-inventing validation.
Output: Extended worker verdict; schemaHash util; filterModes service; attach service; mute store.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-group-topic-37518-slimmed/09-RESEARCH.md
@.planning/phases/09-group-topic-37518-slimmed/09-PATTERNS.md
@.planning/phases/09-group-topic-37518-slimmed/09-CONTEXT.md
@src/lib/validation/schema.worker.ts
@src/lib/validation/schemaWorker.ts
@src/lib/context/scope.ts
@src/lib/context/validation.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend worker verdict with per-rule errors (D-06) + canonical schema-hash (O-03)</name>
  <files>src/lib/validation/schema.worker.ts, src/lib/validation/schemaWorker.ts, src/lib/group/schemaHash.ts</files>
  <read_first>
    - src/lib/validation/schema.worker.ts (SchemaValidationVerdict {ok,error?} ~line 56; runSchemaValidation discards validate.errors ~line 154-164; Ajv2020 allErrors:true is already set)
    - src/lib/validation/schemaWorker.ts (validateSchema settle() copies only {ok,error} at ~line 154 — must forward errors)
    - src/lib/validation/schemaWorker.test.ts (Phase-8 DoS proofs — MUST still pass; the fail-closed verdict shape changes additively only)
    - src/lib/context/validation.ts (ContextValidationIssue shape ~line 288-300 — the per-rule message shape to mirror for SchemaRuleError)
    - src/lib/nostr/geo-event/helpers.ts (computeChecksum ~line 182 — SHA-256-hex via crypto.subtle, guarded)
    - src/lib/validation/schemaErrors.test.ts (Plan 01 RED contract for errors[])
    - src/lib/group/schemaHash.test.ts (Plan 01 RED contract for canonical hash)
  </read_first>
  <behavior>
    - runSchemaValidation on a failing instance returns { ok:false, error, errors:[{instancePath,keyword,message,...}] } (allErrors mapped from Ajv validate.errors).
    - runSchemaValidation on a passing instance returns { ok:true } with no errors.
    - A gate rejection / ReDoS overrun still fails closed { ok:false, error } (errors may be absent — DoS path must not allocate per-rule detail).
    - computeSchemaHash is key-order-independent and prefixed 'sha256:'.
    - verifySchemaHash(schema, hash) true on match, false on mismatch.
  </behavior>
  <action>
    Extend the worker verdict ADDITIVELY (option (a), the flagged D-06/A3 decision — keep validation off-thread, do NOT add a second in-thread validator path). In `src/lib/validation/schema.worker.ts`: define `export interface SchemaRuleError { instancePath: string; schemaPath?: string; keyword: string; message: string; params?: Record<string, unknown> }` and add optional `errors?: SchemaRuleError[]` to `SchemaValidationVerdict`. In `runSchemaValidation`, when `validate(data)` returns false, map `validate.errors` (Ajv2020 is already `allErrors:true`) into `SchemaRuleError[]` — bound the array to a sane cap (e.g. first 50 errors) so a hostile schema/instance cannot return an unbounded error list (DoS-in-the-error-channel). On the catch path (gate rejection / overrun) keep returning `{ ok:false, error }` WITHOUT errors (the DoS path must stay cheap). In `src/lib/validation/schemaWorker.ts` `settle()`, forward `errors` alongside `ok`/`error` (`resolve({ ok: res.ok, error: res.error, errors: res.errors })`) so off-thread callers receive per-rule detail.

    Create `src/lib/group/schemaHash.ts`. Implement `canonicalizeSchema(value)` = deep recursive key-sort (arrays mapped, objects rebuilt from `Object.keys().sort()`) so author and viewer serialize identically (Pitfall 3 — `JSON.stringify` is key-order-dependent). `export async function computeSchemaHash(schema): Promise<string | undefined>` = `sha256:${await computeChecksum(JSON.stringify(canonicalizeSchema(schema)))}` reusing `computeChecksum` from `geo-event/helpers.ts` (do NOT add new crypto); return undefined if computeChecksum is unavailable (guarded). `export async function verifySchemaHash(schema, expected): Promise<boolean>` recomputes and compares; a mismatch returns false (the caller treats false as "do not validate, show warning" — never silently use a different schema).
  </action>
  <verify>
    <automated>bun test src/lib/validation/schemaErrors.test.ts src/lib/validation/schemaWorker.test.ts src/lib/group/schemaHash.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bun test src/lib/validation/schemaErrors.test.ts` GREEN: failing validation carries a non-empty `errors[]` of `SchemaRuleError`; passing validation has none.
    - `bun test src/lib/validation/schemaWorker.test.ts` STILL GREEN: the Phase-8 DoS/fail-closed proofs are unbroken (additive change only).
    - `bun test src/lib/group/schemaHash.test.ts` GREEN: key-order-independent hash, `sha256:` prefix, verify rejects mismatch.
    - `grep -n "errors" src/lib/validation/schemaWorker.ts` shows the settle() forwards the errors array (no in-thread re-validation path was added).
    - `grep -c "ajv.compile\\|new Ajv" src/lib/group/schemaHash.ts` is 0 — schemaHash adds NO validator (reuses computeChecksum only).
    - The per-rule error array is bounded (source assertion: a `.slice(0, 50)` or equivalent cap on the mapped errors).
  </acceptance_criteria>
  <done>Worker verdict carries bounded per-rule errors[]; schemaHash computes canonically and verifies; Phase-8 DoS proofs intact.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: filterModes (off/warn/strict off-thread) + attach (governance discovery + warn-not-block) + mute store</name>
  <files>src/lib/group/filterModes.ts, src/lib/group/attach.ts, src/lib/mute/useMuteStore.ts</files>
  <read_first>
    - src/lib/validation/schemaWorker.ts (validateSchema off-thread entrypoint — the ONLY gating path; returns {ok,error,errors})
    - src/lib/context/scope.ts (allowForeignAttachments branch ~line 35,48 — rewrite to governance !== 'closed'; the dedup-by-scope-key map ~line 20-22,29-42)
    - src/lib/context/validation.ts (getEffectiveContextValidationMode/defaultContextFilterMode ~line 37-57 — deprecated, rewrite to governance enum; do NOT use its in-thread ajv path for gating)
    - src/lib/context/references.ts (resolveContextReferences ~line 66, getContextReferencedDatasets ~line 128 — curated a-ref resolution)
    - src/lib/nostr/kinds.ts (GEO_EVENT_KIND=37515)
    - src/lib/group/schemaHash.ts (verifySchemaHash — call before validating)
    - src/features/chat/store.ts (persist(...) ~line 945 partialize, ~line 965 — mute store analog)
    - src/lib/group/filterModes.test.ts, src/lib/group/warnNotBlock.test.ts, src/lib/group/attach.test.ts, src/lib/mute/useMuteStore.test.ts (Plan 01 RED contracts)
  </read_first>
  <behavior>
    - resolveGroupFilterDefault('schema')==='strict', ('open')==='off'; 'closed' → no foreign lane.
    - filterForeignAttachment in strict hides non-conforming WITH a reason; warn shows WITH reason+badge flag; off shows all.
    - attach-discovery filter === { '#c':[coord], kinds:[37515] }; governance 'open'|'schema' enable it, 'closed' suppresses it.
    - the warn-not-block entrypoint returns warnings but the publish-permitted decision is always true for a standalone-valid dataset (GROUP-04).
    - useMuteStore: mute/unmute, Set-dedup, persisted under 'earthly-muted-contributors'.
  </behavior>
  <action>
    Create `src/lib/group/filterModes.ts`. Define `export type GroupFilterMode = 'off' | 'warn' | 'strict'`. `resolveGroupFilterDefault(governance)`: `'schema' → 'strict'`, `'open' → 'off'`, `'closed' → no foreign lane` (rewrites the deprecated `getEffectiveContextValidationMode`/`defaultContextFilterMode` — `context/validation.ts:37-57`). `export async function filterForeignAttachment(group, attachmentProperties, mode): Promise<{ visible, reason?, conforming }>`: if `group.governance !== 'schema'` it is always visible/conforming; otherwise FIRST `verifySchemaHash` (when a schema-hash tag is present) — on mismatch return visible-with-warn-reason "Schema could not be verified" (never silently strict-hide); then call `validateSchema(group.schema, attachmentProperties, { schemaHash })` OFF-THREAD; map the verdict's `errors[]` into a legible `reason` (e.g. "missing required `name`", "geometry `Polygon` not allowed"). `strict`: non-conforming → `visible:false` + reason. `warn`: non-conforming → `visible:true` + reason (badge). `off`: always `visible:true`. On a worker failure, return visible-unfiltered with the "couldn't check" reason (fail-open ONLY for the view's legibility — the DoS protection is the worker's timeout-kill, not a hide). NEVER import `context/validation.ts`'s `ajv.compile` for gating.

    Create `src/lib/group/attach.ts`. Export the attach-discovery filter builder: for a group coordinate return `{ '#c': [groupCoord], kinds: [GEO_EVENT_KIND] }`; gate it on `group.governance !== 'closed'` (rewrite of `scope.ts:35,48`'s `allowForeignAttachments` branch). Export the lane-resolution helper rewritten from `scope.ts` (curated `a`-refs via `references.ts`, foreign `c`-lane via the discovery filter), keeping the dedup-by-scope-key map pattern (`scope.ts:20-42`). Export the warn-not-block entrypoint the publish dialog calls (Plan 05 consumes): it runs `filterForeignAttachment`/`validateSchema` for warnings but returns a result whose `canPublish` is ALWAYS true for a standalone-valid dataset — encode GROUP-04 as a hard invariant (warnings are advisory; there is no code path that disables publish).

    Create `src/lib/mute/useMuteStore.ts`. Zustand `create(persist<...>(...))` mirroring `chat/store.ts:965`: state `{ muted: string[]; mute(pk); unmute(pk); isMuted(pk) }`; `mute` uses Set-dedup `[...new Set([...s.muted, pk])]`; persisted with `{ name: 'earthly-muted-contributors' }` (consider a `partialize` allow-list like `chat/store.ts:945`). Device-local, app-global (D-10/D-11) — no signing, no publish.
  </action>
  <verify>
    <automated>bun test src/lib/group/filterModes.test.ts src/lib/group/attach.test.ts src/lib/group/warnNotBlock.test.ts src/lib/mute/useMuteStore.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `bun test src/lib/group/filterModes.test.ts` GREEN: default-strict-for-schema / default-off-for-open; off/warn/strict outcomes each carry a legible reason.
    - `bun test src/lib/group/attach.test.ts` GREEN: `{ '#c':[coord], kinds:[37515] }` discovery; `governance !== 'closed'` gates the lane.
    - `bun test src/lib/group/warnNotBlock.test.ts` GREEN: validation never blocks a standalone-valid publish (GROUP-04 invariant).
    - `bun test src/lib/mute/useMuteStore.test.ts` GREEN: Set-dedup, unmute, persist key.
    - `grep -c "context/validation" src/lib/group/filterModes.ts` is 0 (no in-thread gating import); `grep -n "validateSchema" src/lib/group/filterModes.ts` present (off-thread gating).
    - `grep -n "verifySchemaHash" src/lib/group/filterModes.ts` present (hash verified before validating — Pitfall 3).
  </acceptance_criteria>
  <done>filterModes/attach/mute are GREEN; gating runs exclusively off-thread; warn-not-block is invariant; mute is device-local + global.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| relay → viewer (untrusted schema) | A Group-owner-authored JSON Schema is stranger-authored executable input validated on the viewer's fetch path |
| relay → viewer (foreign attachment) | A `c`-attached 37515 dataset is untrusted; its properties feed the validator and its signature/kind gate the lane |
| published schema-hash → inline schema | A `schema-hash` tag may diverge from the inline schema (forged/stale) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-03-DOS-SCHEMA | Denial of Service | filterForeignAttachment / validateSchema | mitigate | ALL governance validation routes through the Phase-8 off-thread `validateSchema` (timeout-kill, `$ref` reject, 64KB/depth-12/4096-keyword caps, fail-closed). The in-thread `context/validation.ts` is forbidden for gating — a ReDoS/recursive/oversized schema cannot freeze the UI thread (HIGH-severity phase guard). |
| T-09-03-ERR-DOS | Denial of Service | worker errors[] channel | mitigate | The per-rule error array is bounded (cap ~50) so a hostile schema/instance cannot return an unbounded error list that itself OOMs the UI |
| T-09-03-HASH-DIVERGE | Tampering | schemaHash verify | mitigate | Canonical (deep key-sorted) SHA-256 via `computeChecksum`; viewer verifies `schema-hash` before validating; mismatch ⇒ do-not-validate-show-warning, never silent divergent filtering (Pitfall 3) |
| T-09-03-BLOCK-BYPASS | Tampering (integrity of GROUP-04) | warn-not-block entrypoint | mitigate | The publish-permitted decision is invariantly true for a standalone-valid dataset; no code path disables publish on schema failure (GROUP-04, REQUIREMENTS "Out of scope: blocking publish") |
| T-09-SC | Tampering | npm/pip/cargo installs | mitigate | No installs (RESEARCH audit N/A — zero new deps); slopcheck N/A |
</threat_model>

<verification>
- `bun test src/lib/group src/lib/validation src/lib/mute` GREEN (filterModes, attach, warnNotBlock, schemaHash, schemaErrors, useMuteStore, and the unbroken Phase-8 schemaWorker proofs).
- `bun run build` succeeds (worker artifact re-emits with the additive verdict shape).
- `biome check src/lib/group src/lib/validation src/lib/mute` clean.
</verification>

<success_criteria>
- The schema DoS guard is wired: every Group validation is off-thread; in-thread gating is impossible (grep-asserted).
- D-06 per-rule errors flow from the worker to the service layer (extended verdict, not a second validator).
- O-03 schema-hash is canonical and verified-before-validate.
- GROUP-04 warn-not-block is a hard invariant; GROUP-05 off/warn/strict resolves with legible reasons and default-strict-for-schema; the mute set is device-local + app-global.
</success_criteria>

<output>
Create `.planning/phases/09-group-topic-37518-slimmed/09-03-SUMMARY.md` when done.
</output>
