---
phase: 9
slug: group-topic-37518-slimmed
status: secured
threats_open: 0
asvs_level: 2
created: 2026-06-26
---

# SECURITY.md — Phase 09: Group / Topic (kind 37518 slimmed)

**Audit type:** State-B retroactive verification (`register_authored_at_plan_time: true`)
**ASVS Level:** 2
**block_on:** high
**Audited:** 2026-06-26
**Result:** SECURED — `threats_open: 0`

This file records the disposition of every threat in the Phase-9 STRIDE registers
(`01-PLAN.md` … `06-PLAN.md` `## STRIDE Threat Register` blocks) and the in-code
evidence proving each declared mitigation is actually present. Implementation files
were treated as READ-ONLY; nothing was patched.

---

## Verdict

| Metric | Count |
|--------|-------|
| Threats found (registered) | 23 (22 mitigate + 1 accept) |
| Supply-chain rows (N/A, zero new deps) | 6 (`T-09-SC` ×6) |
| Closed | 23 / 23 |
| Open (BLOCKER) | 0 |
| HIGH-severity phase guards verified | 4 / 4 |
| Unregistered flags | 0 |

All 4 HIGH-severity guards (`T-09-03-DOS-SCHEMA`, `T-09-06-FORGED-COORD`,
`T-09-06-DOS-SCHEMA`, `T-09-06-SPAM-FLOOD`) are present and exercised by passing tests.
62 security-relevant tests pass / 0 fail (group + validation + mute + worker DoS proofs).

---

## Threat Verification (mitigate)

| Threat ID | Category | Sev | Evidence (file:line) |
|-----------|----------|-----|----------------------|
| T-09-01-FALSEGREEN | Tampering | low | RED baseline tests assert behavior, not just imports — superseded by the GREEN suites below (62 pass). |
| T-09-01-DOS-PIN | DoS | low | DoS proof pinned to the off-thread worker path; in-thread `ajv.compile` gating forbidden — confirmed in `src/lib/group/filterModes.ts` (zero `context/validation`, zero real `ajv.compile`). |
| T-09-02-LEGACY | Spoofing | med | `isGroup` requires `hasCurrentModelVersion(event)` — `src/lib/nostr/group/helpers.ts:85-91`. Legacy 37518 (no modelVersion) returns false. |
| T-09-02-VERSION-OVERRIDE | Tampering | med | Caller `modelVersion` stripped then re-asserted last — `src/lib/nostr/group/factory.ts:47,51` (create) and `:83` (`group()` chain). |
| T-09-02-LINEAGE | Tampering | med | `GroupFactory.modify` uses `toEventTemplate` (preserves `d`, no regenerate) — `factory.ts:61-66`. |
| T-09-02-PARSE-CRASH | DoS | med | `getGroupContent` try/catch → `DEFAULT_GROUP_CONTENT` — `helpers.ts:102-112`. |
| T-09-03-DOS-SCHEMA | DoS | **HIGH** | Gating runs only through off-thread `validateSchema` — `filterModes.ts:125`. Worker hardening: `rejectUnsafeSchema` runs BEFORE `ajv.compile` (`schema.worker.ts:181-182`), caps `MAX_SCHEMA_BYTES=64KB` / `MAX_DEPTH=12` / `MAX_KEYWORDS=4096` (`:41-45`), rejects `$ref`/`$dynamicRef`/`$recursiveRef`/`$recursiveAnchor`/`$dynamicAnchor` (`:144`), wall-clock watchdog `terminate()`+fail-closed (`schemaWorker.ts:162-163`), fail-closed engine (`schema.worker.ts:191+`). `context/validation` import count = 0. |
| T-09-03-ERR-DOS | DoS | med | Per-rule `errors[]` bounded by `MAX_ERRORS=50` `.slice(0,MAX_ERRORS)` — `schema.worker.ts:81,205`. DoS/gate catch path carries no `errors`. |
| T-09-03-HASH-DIVERGE | Tampering | med | Canonical deep key-sort SHA-256 (`schemaHash.ts:25-45`, no validator). `verifySchemaHash` runs BEFORE validate; mismatch → show-with-warn, never silent strict-hide — `filterModes.ts:110-114`. |
| T-09-03-BLOCK-BYPASS | Tampering (GROUP-04) | med | `canPublishStandalone` invariantly returns `true`; argument never gates — `attach.ts:67-69`. `validateAttachment` advisory only (`:54-60`). |
| T-09-04-BAD-DIALECT | Tampering | low | Builder emits draft-2020-12 (`schemaBuilder.ts:25`), pure (0 React imports), no emitted `$ref`/`$data` (only JSDoc mentions). Both authoring paths feed the off-thread worker; the worker rejects unsafe dialect/`$recursiveRef` read-side and fails closed. **Residual (non-blocking):** see Residuals §1. |
| T-09-04-HASH-OMIT | Tampering | med | `computeSchemaHash(schema)` computed on save and written via `.schemaHash(hash)` — `GroupEditorPanel.tsx:372,415`. |
| T-09-04-XSS-DESC | Tampering/Elevation | med | Description stored as `descriptionFormat:'markdown'` (`GroupEditorPanel.tsx:384`); zero `dangerouslySetInnerHTML`. Rendered later via the sanitized `RichContentRenderer` (token-AST → React JSX, no raw-HTML sink). |
| T-09-04-A11Y | quality | n/a | shadcn `Checkbox` + `Label htmlFor` (11 occurrences); zero raw `type="checkbox"` — `GroupEditorPanel.tsx`. |
| T-09-05-DOS-PUBLISH | DoS | med | Blocking `validateDatasetForContext`/`validationMode==='required'` removed (count 0); publish validation via off-thread `validateAttachment`/`filterForeignAttachment` from `@/lib/group` — `usePublishing.ts:5`, `GroupAttachField.tsx:22,154`. |
| T-09-05-BLOCK | Tampering (GROUP-04) | med | "Publish anyway" always present; publish `disabled={!canPublish \|\| isPublishing}` — a pure function of publish readiness, never the validation verdict — `GroupAttachField.tsx:219,356`. |
| T-09-06-FORGED-COORD | Spoofing | **HIGH** | `gateForeignLane` applies kind (37515) → `verifyEvent` signature → mute IN ORDER inside `.filter()` so invalid events never paint — `noModMinimum.ts:85-100`. Signature gate hardened against nostr-tools `verifiedSymbol` cache poisoning via `verifyUntrustedEvent` (rebuilds plain event) — `:44-59`. Wired before render in `ForeignLane.tsx:141`. |
| T-09-06-DOS-SCHEMA | DoS | **HIGH** | Read-side filter routes through off-thread `filterForeignAttachment` layered AFTER the trust gate — `ForeignLane.tsx:156-181`; `context/validation` count = 0 in ForeignLane and GroupViewPanel. Same hardened worker as T-09-03. |
| T-09-06-SPAM-FLOOD | DoS (UX) | **HIGH** | Curated lane privileged/expanded (`tone="context"`); foreign lane collapsed `Collapsible` `tone="neutral"`, capped `FOREIGN_LANE_CAP=50` newest-first + Load more (`noModMinimum.ts:104-107`); device-local app-global mute drop (`ForeignLane.tsx:114-141`); owner one-click flip-to-closed gated `governance!=='closed'` (`GroupViewPanel.tsx:117,131`). |
| T-09-06-HASH-DIVERGE | Tampering | med | `filterForeignAttachment` passed `publishedHash`; verify-before-validate, mismatch → warn — `ForeignLane.tsx:167-172` consuming `filterModes.ts:110-114`. |
| T-09-06-XSS-NARRATIVE | Tampering/Elevation | med | Narrative via `RichContentRenderer` (`GroupViewPanel.tsx:221`); zero `dangerouslySetInnerHTML` in panel and in `RichContentRenderer.tsx` (token-AST → React JSX, URLs constrained to `https?://`). |
| T-09-06-LINEAGE | Tampering | med | Flip-to-closed and curated pin/bless both via `GroupFactory.modify(...)` (preserves `d`) — `GroupViewPanel.tsx:131-133`, `CuratedLane.tsx:57-58`. |

---

## Accepted Risks Log

| Threat ID | Category | Disposition | Rationale | Compensating control |
|-----------|----------|-------------|-----------|----------------------|
| T-09-05-WORKER-FAIL-OPEN | Availability | **accept** | On schema-worker failure the contributor sees "Couldn't check this contribution right now. It's shown unfiltered." and may publish. The published artifact is a valid standalone kind-37515 dataset regardless of whether it conformed to a stranger Group's schema, so failing open here does not weaken the contributor's own data integrity. | Read-side re-validation: the viewer's `ForeignLane` re-runs `filterForeignAttachment` off-thread on every `c`-attached coordinate (`ForeignLane.tsx:156-181`), so an unconformant attachment is still filtered (strict default for schema Groups) on the consuming side. Confirmed fail-open is legibility-only — the real DoS guard is the worker's wall-clock timeout-kill (`schemaWorker.ts:162-163`), which is independent of this accept. |

---

## Supply-Chain Rows (N/A)

`T-09-SC` appears in all six PLAN registers with disposition `mitigate` / rationale
"zero new dependencies; RESEARCH Package Legitimacy Audit = N/A; slopcheck N/A."
Verified: each SUMMARY records `tech-stack.added: []`. No npm/pip/cargo install occurred
in this phase; all UI primitives are official shadcn already present in `src/components/ui`.
No package-legitimacy verification was required.

---

## Unregistered Flags

None. No SUMMARY (`09-01` … `09-06`) contains a `## Threat Flags` section; each
explicitly declares "No new threat surface beyond the plan's `<threat_model>`." No new
attack surface appeared during implementation that lacks a registered threat mapping.

---

## Residuals (non-blocking)

1. **T-09-04-BAD-DIALECT — authoring-time catch is advisory, not enforcing.**
   The declared mitigation text says the Advanced-tab raw JSON is "run through
   `validateSchema` … before save so a malformed/hostile schema is caught at authoring
   time." In code, the save gate (`GroupEditorPanel.tsx:357-374`) blocks only on JSON
   *parse* errors (`effectiveSchema.error`); the off-thread `validateSchema` call
   (`:310`) drives the live "Sample properties" verdict (display-only `setSampleVerdict`),
   not the save decision. A power user could therefore save a syntactically-valid but
   unsafe-dialect schema from the Advanced tab.
   **Why non-blocking / CLOSED:** the *security-load-bearing* protection is read-side, and
   it is present and verified — the off-thread worker `rejectUnsafeSchema` rejects
   `$ref`/`$recursiveRef`/oversized/deep schemas BEFORE compile and fails closed
   (`schema.worker.ts:130-182`), so a hostile published schema cannot freeze any viewer.
   The author is the only party who runs their own unsaved schema, and every published
   schema is re-validated on the consuming side. This is a UX-hygiene gap on a LOW-severity
   Tampering threat, not a HIGH guard; `block_on: high` is satisfied. (The Phase-9 REVIEW
   also noted this same authoring-vs-viewer distinction at `09-REVIEW.md:241-242`.)
   *Optional hardening (future):* gate `handleSave` on the off-thread verdict as well, so
   the Advanced tab refuses to publish a worker-rejected schema.

2. **Recency-only trust-sort (documented follow-up).** The foreign lane sorts
   newest-first only; follows-weighted trust-sort is a documented Phase-follow-up
   (RESEARCH O-01/A1; code comment in `noModMinimum.ts:102-104`). Not a registered threat;
   recorded for completeness.

---

## Prior Review Linkage (informational)

Phase-9 code review (`09-REVIEW.md`, `criticals_open: 0`) caught and fixed 3 real blockers
that plan-time dispositions had under-specified; both security-relevant fixes are present
and carry passing regression tests:

- **CR-01** (`aa44770`): `rejectUnsafeSchema` regex extended to `$recursiveRef` /
  `$recursiveAnchor` / `$dynamicAnchor` — closes the draft-2019-09 recursive-reference
  DoS-gate bypass. Live at `schema.worker.ts:144`; regression at
  `schemaWorker.test.ts:87-97` (rejected-before-compile, counter stays 0).
- **verifyEvent cache-poisoning hardening** (`df26707`): `verifyUntrustedEvent` rebuilds a
  plain event from signature-bearing fields, defeating a poisoned `verifiedSymbol` flag.
  Live at `noModMinimum.ts:44-59`; regression at `noModMinimum.test.ts:54-58`
  (corrupted-signature dropped).

These strengthen `T-09-03-DOS-SCHEMA` and `T-09-06-FORGED-COORD` respectively; both
HIGH guards verified CLOSED.

---

## Audit Method Notes

- Every mitigation was confirmed by reading the cited code, not by accepting SUMMARY
  claims. Grep matches that landed on comments/JSDoc (e.g. `ajv.compile` in
  `filterModes.ts:5`, `$ref`/`$data` in `schemaBuilder.ts:18,68`) were inspected and
  excluded; the corresponding behaviors were confirmed in actual call sites.
- HIGH guards were verified through ALL entry points: off-thread validation confirmed in
  the publish path (`usePublishing`/`GroupAttachField`) AND the read path (`ForeignLane`);
  the `c`-tag write confirmed at all four `usePublishing` publish entrypoints
  (`:460,545,625,699`).
- Test gate: `bun test` over `src/lib/group src/lib/nostr/group src/lib/mute` + the worker
  DoS/error suites → 62 pass / 0 fail.
