---
phase: 09-group-topic-37518-slimmed
reviewed: 2026-06-25T12:13:59Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - src/components/AppSidebar.tsx
  - src/components/GeoEditorInfoPanel.tsx
  - src/components/info-panel/GroupViewPanel.tsx
  - src/components/info-panel/group-lane/CuratedLane.tsx
  - src/components/info-panel/group-lane/ForeignLane.tsx
  - src/components/info-panel/index.ts
  - src/features/geo-editor/GeoEditorView.tsx
  - src/features/geo-editor/components/GroupAttachField.tsx
  - src/features/geo-editor/hooks/usePublishing.ts
  - src/features/groups/GroupEditorPanel.tsx
  - src/features/groups/groups-columns.tsx
  - src/features/groups/schemaBuilder.ts
  - src/lib/group/attach.ts
  - src/lib/group/filterModes.ts
  - src/lib/group/index.ts
  - src/lib/group/noModMinimum.ts
  - src/lib/group/schemaHash.ts
  - src/lib/hooks/useGroups.ts
  - src/lib/mute/useMuteStore.ts
  - src/lib/nostr/group/cast.ts
  - src/lib/nostr/group/factory.ts
  - src/lib/nostr/group/helpers.ts
  - src/lib/nostr/group/index.ts
  - src/lib/nostr/index.ts
  - src/lib/nostr/tags.ts
  - src/lib/validation/schema.worker.ts
  - src/lib/validation/schemaWorker.ts
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
criticals_resolved: 3
criticals_open: 0
status: criticals_resolved
fixes_applied:
  - "CR-01: aa44770 — reject $recursiveRef/$recursiveAnchor/$dynamicAnchor in schema DoS gate"
  - "CR-02: 3e1bcb0 — content-based compile-cache key for unhashed schemas (resolveSchemaCacheKey + FNV-1a fallback)"
  - "CR-03: 5087a36 — seed + preserve curated a-refs when editing a Group"
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-25T12:13:59Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** criticals_resolved (3/3 blockers fixed 2026-06-25; 6 warnings + 4 info remain open)

## Resolution (2026-06-25)

All 3 BLOCKER findings fixed and committed atomically on `feature/better-map-ux`, +12 regression tests, suite 663→675 pass / 0 fail, build green:

- **CR-01** `aa44770` — extended `rejectUnsafeSchema` regex to `$recursiveRef`/`$recursiveAnchor`/`$dynamicAnchor` (draft-2019-09 recursive-ref DoS bypass closed; `__compileCount()` stays 0 on rejection).
- **CR-02** `3e1bcb0` — replaced the shared `'sha256:unhashed'` cache-key sentinel with `resolveSchemaCacheKey()` (published hash → `computeSchemaHash` → deterministic `unhashed:`+FNV-1a fingerprint) across `filterModes.ts`, `GroupAttachField.tsx`, `usePublishing.ts`.
- **CR-03** `5087a36` — `GroupEditorPanel` now seeds `curatedReferences` from the edited Group's existing `a` refs and preserves non-reverse-encodable coords on save (routine edits no longer wipe the curated lane).

The 6 WARNING and 4 INFO findings below remain open (not in fix scope).

## Summary

Phase 9 slims kind-37518 into a Group/Topic entity with a 3-rung governance ladder
(`open`/`schema`/`closed`), an off-thread schema-validation worker, the NO-MOD-MINIMUM
foreign-lane trust gate, and a warn-not-block contributor attach flow. The two
security-critical surfaces called out in the brief were weighted heavily.

The foreign-lane trust gate (`gateForeignLane`) is correctly ordered (kind → signature →
mute) and its cache-poisoning-resistant `verifyUntrustedEvent` reconstruction is sound. The
GROUP-04 hard invariant (a valid standalone dataset is never blocked from publishing) holds
across every publish entrypoint and the attach UI — `canPublishNew` never references any
validation verdict.

However, the off-thread DoS guard has a **real bypass**: the schema-rejection gate blocks
`$ref`/`$dynamicRef` but NOT `$recursiveRef`/`$recursiveAnchor`, which are live, compilable
keywords in the pinned Ajv2020 dynamic vocabulary — defeating the gate's stated
recursive-reference protection (CR-01). Two further correctness defects: the
`'sha256:unhashed'` compile-cache key collides across distinct unhashed schemas, validating
attachments against the wrong compiled validator (CR-02); and editing any Group silently
wipes its entire curated `a`-reference lane because the editor resets curated refs to `[]`
on mount while the save path reconciles `a` tags destructively (CR-03, data loss).

## Critical Issues

### CR-01: Schema DoS gate misses `$recursiveRef`/`$recursiveAnchor` — recursive-reference bypass

**File:** `src/lib/validation/schema.worker.ts:135`
**Issue:** `rejectUnsafeSchema` rejects only `$ref` and `$dynamicRef`:
```js
if (/"\$ref"|"\$dynamicRef"/.test(json)) { throw new Error('schema uses $ref/$dynamicRef') }
```
The pinned `ajv/dist/2020` instance registers the full `dynamic` vocabulary —
`dynamicAnchor`, `dynamicRef`, **`recursiveAnchor`, `recursiveRef`** (verified in
`node_modules/ajv/dist/vocabularies/dynamic/index.js:7`). A relay-authored schema using
draft-2019-09 `$recursiveRef`/`$recursiveAnchor` passes the gate, reaches `ajv.compile`, and
can construct exactly the recursive/self-referential resolver blow-up the module docstring
(lines 6-13) claims to mitigate. This is the precise threat class T-08-04-REF the gate
exists to close, and it is open. The bounded structural walk does not help: a `$recursiveRef`
schema can be shallow and tiny yet still recurse at validation time.
**Fix:** Extend the rejection regex to cover every reference keyword the registered
vocabulary supports:
```js
if (/"\$ref"|"\$dynamicRef"|"\$recursiveRef"|"\$recursiveAnchor"|"\$dynamicAnchor"/.test(json)) {
	throw new Error('schema uses a reference/anchor keyword')
}
```
(Including `$dynamicAnchor`/`$recursiveAnchor` is recommended — an anchor with no matching
ref is dead weight but a defense-in-depth signal; the ref keywords are the load-bearing
ones.) Add a regression test that a `$recursiveRef` schema is rejected before compile
(`__compileCount()` stays 0).

### CR-02: `'sha256:unhashed'` compile-cache key collides across distinct schemas

**File:** `src/lib/group/filterModes.ts:117`, `src/features/geo-editor/components/GroupAttachField.tsx:131`, `src/features/geo-editor/hooks/usePublishing.ts:368`
**Issue:** When a `schema` Group has no `schema-hash` tag, all three call sites fall back to
the literal cache key `'sha256:unhashed'`. The worker's compile cache
(`schema.worker.ts:107`, `compiledCache.get(schemaHash)`) returns the cached `ValidateFunction`
on a key hit **without re-compiling or comparing the schema**. So the first unhashed schema
compiled under `'sha256:unhashed'` is reused to validate every subsequent unhashed schema —
attachments are validated against the wrong schema. This silently produces incorrect
show/hide (strict mode) and incorrect contributor warnings. Reachable whenever
`computeSchemaHash` returns `undefined` (no `crypto.subtle`), or a Group's `schema-hash` tag
is absent/stripped, or a foreign/legacy Group carries an inline schema without the tag.
**Fix:** Never use a shared constant as a cache key. Derive a per-schema key when the
published hash is absent — e.g. compute the canonical hash locally:
```js
const schemaHash = group.schemaHash ?? (await computeSchemaHash(schema)) ?? `unhashed:${someStableSchemaFingerprint(schema)}`
```
At minimum, route the no-hash case through `computeSchemaHash(schema)` (already imported in
`schemaHash.ts`) so the cache key is content-derived. A shared sentinel must never key a
compiled-validator cache.

### CR-03: Editing a Group silently wipes all curated `a`-references (data loss)

**File:** `src/features/groups/GroupEditorPanel.tsx:153,184,368-381`
**Issue:** On mount and on every `initialContext` change the editor sets
`setCuratedReferences([])` (lines 153, 184) — it never seeds the Group's existing curated
`a` refs from `getGroupReferencedAddresses`. On save, `referencedCoords` is built from
`description` coords + the (empty) `curatedReferences` list, then handed to
`setAddressReferenceTags(referencedCoords)` with no `preservedCoordinates`. That transformer
(`computeAddressReferenceTags`, `references.ts:156-158`) **drops every existing `a` tag**
unless its coordinate is in the preserved set:
```js
const filtered = currentTags.filter((tag) => tag[0] !== 'a' || preserved.has(tag[1] ?? ''))
```
Result: an owner who edits a Group's name/description/governance and clicks Save loses their
entire curated lane (every `a` ref pinned via CuratedLane / "Add to curated"). This is silent
destructive data loss on a routine edit.
**Fix:** Seed curated refs from the edited Group on load, and/or preserve them on save. Either:
```js
// on load
setCuratedReferences(getGroupReferencedAddresses(event))
```
or pass the existing curated coordinates as `preservedCoordinates` to
`setAddressReferenceTags(referencedCoords, existingCuratedCoords)` so they survive the
reconcile. Add a test: modify a Group with existing `a` refs and assert they persist on the
re-signed event.

## Warnings

### WR-01: ReDoS / unbounded-compile in the synchronous fallback path has no deadline

**File:** `src/lib/validation/schemaWorker.ts:143-144`
**Issue:** `validateSchema` only enforces `IN_ENGINE_DEADLINE_MS + WATCHDOG_SLACK_MS` via the
host watchdog on the real-Worker path. The `!hasSpawnableWorker()` fallback drives
`runSchemaValidation` synchronously with no timeout. The engine docstring claims it "bounds
its own work," but `runSchemaValidation` has no in-engine time bound — a ReDoS `pattern`
(CVE-2025-69873 class, named in the worker docstring lines 5-7) validated against a long
input, or a pathological `ajv.compile`, runs to completion on whatever thread invoked it.
This fallback is the path under `bun test`/SSR; if it is ever reachable in a browser without
a spawnable worker, the tab freezes despite the "DoS guard" framing.
**Fix:** Document explicitly that the fallback has no wall-clock bound and is test/SSR-only,
and assert at the call sites (`filterModes.ts`, `attach.ts`) that the foreign-lane filter
never runs on this path in production. If browser-without-worker is reachable, add an
in-engine bound (input-length cap before validate, and/or wrap compile+validate in a
cooperative deadline) so the engine's self-bounding claim is true.

### WR-02: `usePublishing` advisory-validation block is dead code duplicated in `GroupAttachField`

**File:** `src/features/geo-editor/hooks/usePublishing.ts:328-424,858-861`
**Issue:** `attachValidation`, `attachedSchemaGroup`, `runAttachValidation`, and
`clearAttachValidation` (~100 lines incl. `toAttachWarnings`/`describeAttachError`) are
returned from the hook but no component consumes them (verified by grep — the only other
matches are `GroupAttachField`'s own local symbols of the same name). The actual contributor
advisory pass is reimplemented independently inside `GroupAttachField`
(`filterForeignAttachment` loop, lines 117-176). Two divergent copies of the same
off-thread-validation logic invite drift (e.g. `GroupAttachField` uses `warn` mode +
`publishedHash` verify-before-validate; `usePublishing` uses raw `validateAttachment` with no
hash verification). Dead code on a security-adjacent path is a maintenance hazard.
**Fix:** Delete the unused `usePublishing` advisory block, or consolidate both into a single
shared hook and have `GroupAttachField` consume it. Do not keep two implementations.

### WR-03: `flipToClosed` lineage-preserving escape hatch is dead; lock-down uses a different path

**File:** `src/lib/group/noModMinimum.ts:130-151`
**Issue:** `flipToClosed` (the D-02 owner escape hatch documented to preserve `d` and
re-assert `modelVersion`) is exported but unused. The live lock-down in
`GroupViewPanel.handleLockDown` (`GroupViewPanel.tsx:131-134`) instead calls
`GroupFactory.modify(groupEvent).group({ governance: 'closed' })`. Two implementations of the
same flip means the carefully-tested helper isn't the one shipping; the factory path's
lineage/modelVersion guarantees are implied but not pinned by the helper's tests.
**Fix:** Either wire `GroupViewPanel` through `flipToClosed` (as its docstring says it does),
or delete the helper and ensure the factory path has equivalent test coverage for `d`
preservation.

### WR-04: ForeignLane double-caps shown rows; "Load more" is unreachable under strict hiding

**File:** `src/components/info-panel/group-lane/ForeignLane.tsx:210,279`
**Issue:** `gateForeignLane` already caps `visible` to `FOREIGN_LANE_CAP` (50) and computes
`hasMore` on the pre-filter survivors. The render then re-slices `shownRows.slice(0, 50)`
with a hardcoded `50` (drifts from `FOREIGN_LANE_CAP`). Because the off-thread schema filter
can only *reduce* `shownRows` below 50, the second slice never trims, and when strict mode
hides items the user sees fewer than the cap with no way to load the hidden-but-existing
survivors beyond the cap (`hasMore` true but "Load more" reveals only already-loaded rows).
The cap/hasMore semantics interact confusingly with the schema filter.
**Fix:** Use the `FOREIGN_LANE_CAP` constant instead of the literal `50`, and decide whether
"Load more" should expand the *gated* set or the *schema-filtered* set — apply the schema
filter to the full validated set (not just `visible`) so `hasMore`/Load-more is coherent.

### WR-05: `readAttachmentProperties` only validates the first feature's properties

**File:** `src/components/info-panel/group-lane/ForeignLane.tsx:82-91`
**Issue:** The foreign-lane schema filter reads `parsed.features?.[0]?.properties` — only the
first feature. A multi-feature attachment whose first feature conforms but whose later
features violate the schema is shown as conforming (strict mode lets it through). The
contributor-side `GroupAttachField` correctly iterates *all* features
(`GroupAttachField.tsx:138`), so author and viewer disagree on conformance for multi-feature
datasets.
**Fix:** Validate every feature's `properties` (mirror `GroupAttachField`'s per-feature loop)
and hide/flag if any fails, so the strict gate matches the authoring-time check.

### WR-06: `GroupEditorPanel` Advanced-tab schema is not validated/sanitized at save time

**File:** `src/features/groups/GroupEditorPanel.tsx:206-215,334-351`
**Issue:** In Advanced mode `effectiveSchema` only `JSON.parse`s the textarea — it never runs
the worker's `rejectUnsafeSchema` gate or a compile check before publishing. An owner can
paste a schema containing `$ref`/`$recursiveRef`/oversized/deep content and publish it; the
hardening only fires later at viewer validate-time (where, per CR-01, `$recursiveRef` is not
even caught). Publishing an un-vettable schema degrades every viewer's foreign lane to
"Schema could not be verified"/unfiltered with no author-side feedback.
**Fix:** Run the same `rejectUnsafeSchema`-equivalent + a trial `validateSchema(schema, {}, …)`
on save; block the save (or warn prominently) if the schema is unsafe/uncompilable, so the
author learns at authoring time.

## Info

### IN-01: `setGeohash` precision clamp ignores the documented default contract

**File:** `src/lib/nostr/tags.ts:99`
**Issue:** `setGeohash` clamps precision to `[5,7]` via `Math.min(7, Math.max(5, precision))`,
silently overriding any caller value outside that band including the documented default of 6.
Harmless today (default 6 is in-band) but a caller passing precision 8 gets 7 with no signal.
**Fix:** Document the clamp range on the parameter, or validate-and-throw on out-of-range so
the silent narrowing is intentional and visible.

### IN-02: Redundant per-render off-thread validation in GroupAttachField

**File:** `src/components/GeoEditorInfoPanel.tsx:688-690`, `src/features/geo-editor/components/GroupAttachField.tsx:176`
**Issue:** `featureProperties={features.map(...)}` allocates a new array every render and is a
dependency of `GroupAttachField`'s validation `useEffect`, so the off-thread validation
re-runs on every parent re-render (not only on actual property changes). Not a correctness
bug (cancelled-flag guards stale writes; cache hits keep it cheap) and performance is
out-of-scope, but it is wasteful churn on a worker boundary.
**Fix:** Memoize the mapped array (`useMemo`) keyed on a stable serialization of feature
properties, or pass a stable signature so the effect fires only on real changes.

### IN-03: `info-panel/index.ts` exports `GroupViewPanel` from a path whose siblings live under `info-panel/group-lane/` and `features/groups/`

**File:** `src/components/info-panel/index.ts:15`
**Issue:** `GroupViewPanel` lives in `components/info-panel/` but imports `CuratedLane`/
`ForeignLane` from `./group-lane/` and `ConfirmDeleteAction`/`EntityPanelShell` from siblings,
while the editor/columns live under `features/groups/`. The Group surface is split across
three directories with cross-imports (`GroupViewPanel.tsx:51-54`). Navigability/consistency
smell; no functional defect.
**Fix:** Consider colocating the Group view + lane components under one feature directory in a
follow-up, matching the feature-based structure CLAUDE.md prescribes.

### IN-04: Stale "MapContext" typing bridge threaded through the Group view/editor lifecycle

**File:** `src/components/info-panel/GroupViewPanel.tsx:15-16,91-100`, `src/features/groups/GroupEditorPanel.tsx:94-99,385-388`
**Issue:** The store still types the viewed/edited Group as a `MapContext` cast over the
37518 event; both panels re-derive Group state via `rawEvent()` + Group helpers and the
editor returns a `MapContext` cast on save. The code is defensive (`isGroup` guards) and
documented as a Plan-06 migration deferral, but the dual-cast bridge is fragile — any caller
that reads `MapContext`-specific getters off the returned cast will get map-context semantics
over a Group payload.
**Fix:** Track the documented Plan-06 migration to a `Group`-typed store slot; until then, keep
the `isGroup` guards at every `rawEvent()` boundary (currently present).

---

_Reviewed: 2026-06-25T12:13:59Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
