---
phase: 08-spec-v2-foundation
reviewed: 2026-06-25T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - src/lib/nostr/article/article.test.ts
  - src/lib/nostr/article/cast.ts
  - src/lib/nostr/article/factory.ts
  - src/lib/nostr/article/helpers.ts
  - src/lib/nostr/article/index.ts
  - src/lib/nostr/entityFactory.ts
  - src/lib/nostr/expiry.test.ts
  - src/lib/nostr/expiry.ts
  - src/lib/nostr/geo-event/helpers.ts
  - src/lib/nostr/index.ts
  - src/lib/nostr/kinds.ts
  - src/lib/nostr/live-beacon/cast.ts
  - src/lib/nostr/live-beacon/factory.ts
  - src/lib/nostr/live-beacon/helpers.ts
  - src/lib/nostr/live-beacon/index.ts
  - src/lib/nostr/live-beacon/live-beacon.test.ts
  - src/lib/nostr/map-context/helpers.ts
  - src/lib/nostr/modelVersion.test.ts
  - src/lib/nostr/modelVersion.ts
  - src/lib/nostr/spec.doc.test.ts
  - src/lib/nostr/tags.test.ts
  - src/lib/nostr/tags.ts
  - src/lib/nostr/temporal-sighting/cast.ts
  - src/lib/nostr/temporal-sighting/factory.ts
  - src/lib/nostr/temporal-sighting/helpers.ts
  - src/lib/nostr/temporal-sighting/index.ts
  - src/lib/nostr/temporal-sighting/temporal-sighting.test.ts
  - src/lib/validation/schema.worker.ts
  - src/lib/validation/schemaWorker.test.ts
  - src/lib/validation/schemaWorker.ts
  - src/lib/workers/workerAssets.ts
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-25T00:00:00Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Phase 8 introduces three addressable entity kinds (37520/37521/37522) on a clean
Factory+Cast pattern, a shared `tags.ts` seam, the `modelVersion` discriminator, a
NIP-40 expiry filter, a NIP-32 L/l taxonomy helper, and an off-thread hardened Ajv
schema validator. The code is well-documented and the 36 phase tests pass.

I focused the adversarial pass on the four areas called out: (1) the schema worker's
fail-closed semantics, (2) the `modelVersion` no-throw guard, (3) tag round-trip
correctness, (4) the `entityFactory` signer adapter.

No BLOCKERs: the validator does genuinely fail closed on every error path, the
`modelVersion` guard never throws, and the bare-function signer adapter is functional
for both `create()` and `modify()` (verified by tracing applesauce's `stamp`/`sign`
through `toEventTemplate`, which strips `pubkey`, so the upstream "Signer modified
pubkey" guard is never tripped).

However the hardening story has real gaps. The headline is WR-01: the **synchronous
fallback path enforces no in-engine time bound at all** — the `IN_ENGINE_DEADLINE_MS`
constant is never used to bound work, only the worker-path host watchdog is. On a V8
host (which Bun/JSC is not) the ReDoS test input blocks for ~80 seconds with no
recovery. I measured this directly. There is also a dead-code / format-drift defect in
the d-tag generation across all three factories (WR-02), and a tag-helper API asymmetry
that throws or silently strips depending on call order (WR-03).

## Warnings

### WR-01: Synchronous fallback path has no in-engine time bound — ReDoS blocks the thread on a V8 host

**File:** `src/lib/validation/schemaWorker.ts:143-145`, `src/lib/validation/schema.worker.ts:154-164`

**Issue:** The module docstrings claim the engine "bounds its own work" and that
`IN_ENGINE_DEADLINE_MS` (100ms) caps in-engine time. Neither is true. `runSchemaValidation`
runs `ajv.compile` and `validate(data)` as **synchronous CPU work inside an `async`
function with no `await` between them** — it monopolizes the thread until the regex/compile
completes. `IN_ENGINE_DEADLINE_MS` is only ever *added to the host watchdog timeout* in the
worker path (`schemaWorker.ts:163`); it is never consulted by the engine itself.

The size/depth/keyword/`$ref` gate does NOT catch a ReDoS `pattern`: the test schema
`{ type: 'string', pattern: '^(a+)+$' }` is tiny and passes every gate, then Ajv compiles
that pattern into a native `RegExp` and runs it inside `validate(data)`.

In the synchronous fallback (`!hasSpawnableWorker()` — SSR, `bun test`, or any non-http(s)
host) there is **no watchdog**, so a ReDoS schema blocks the calling thread with no
fail-closed deadline. I measured the test's own `REDOS_INPUT` (`'a'.repeat(40)+'!'`)
against `^(a+)+$`:
- **V8 / Node: ~80,000 ms** (catastrophic backtracking)
- JSC / Bun: ~345 ms (JSC caps backtracking)

The test passes only because it runs under Bun/JSC. The browser worker path IS protected
(the host `terminate()` watchdog fires at 600ms), but the sync path on a V8-class engine
is not. The `IN_ENGINE_DEADLINE_MS` deadline the docs advertise simply does not exist.

**Fix:** Either (a) honestly document that the sync fallback relies on the host engine's
backtracking limit and is unprotected on V8, and gate the fallback to JSC-class engines
only; or (b) give the engine a real in-engine bound. A pre-validation regex-safety check on
each compiled `pattern` (e.g. reject nested unbounded quantifiers, or use a
linear-time regex engine such as RE2 for `pattern` keywords) is the durable fix:

```ts
// In rejectUnsafeSchema, walk for `pattern` keywords and reject obviously
// catastrophic shapes before they reach ajv.compile (defense in depth that
// works even when no watchdog exists):
if (node && typeof node === 'object' && typeof (node as any).pattern === 'string') {
  assertLinearTimeSafe((node as any).pattern) // throws -> fail closed
}
```

### WR-02: d-tag is always a 21-char applesauce `nanoid`, never the project-standard `generateShortDTag` — branch is dead code

**File:** `src/lib/nostr/article/factory.ts:44-46`, `src/lib/nostr/live-beacon/factory.ts:42-44`, `src/lib/nostr/temporal-sighting/factory.ts:42-44`

**Issue:** All three kinds are addressable (verified: `isAddressableKind(37520/37521/37522)
=== true`). `blankEventTemplate(kind)` from applesauce **already injects `["d", nanoid()]`
for addressable kinds**. So `if (!tpl.tags.some((t) => t[0] === 'd'))` is *always false* in
`create()`, and `generateShortDTag()` is **never called** — it is dead code, and the
`generateShortDTag` import is effectively unused on the create path.

The practical consequence is a silent format drift: the project's d-tag convention is an
8-char lowercase base32 id (`generateShortDTag`), but every Phase 8 entity ships a 21-char
`nanoid` (mixed case, `-`/`_`). The factory docstrings ("generates a `d` tag only if
absent") describe an invariant that does not hold as written. The Wave-0 tests only assert
`t[0] === 'd' && !!t[1]`, so they cannot catch this.

**Fix:** Either start from `blankEventTemplate` and accept the nanoid format (then delete
the dead `generateShortDTag` branch and import and fix the docstrings), or build the
template without the auto d-tag and inject `generateShortDTag()` deliberately:

```ts
const tpl = blankEventTemplate(ARTICLE_KIND)
tpl.tags = tpl.tags.filter((t) => t[0] !== 'd')
tpl.tags.push(['d', generateShortDTag()])
```

### WR-03: `setLabels`/`setHashtags` disjointness enforcement is order-dependent — silently strips one way, throws the other

**File:** `src/lib/nostr/tags.ts:110-114` (`setHashtags`) and `src/lib/nostr/tags.ts:167-185` (`setLabels`)

**Issue:** The t/l disjointness rule is enforced asymmetrically depending on call order:
- `setHashtags` **silently drops** values that already exist as `l` labels (`allowed = values.filter((value) => !governed.has(value))`).
- `setLabels` **throws** if a value already exists as a `t` hashtag.

So `factory.labels(['natural']).hashtags(['natural'])` silently produces an event with no
`natural` hashtag (data quietly lost), while `factory.hashtags(['natural']).labels(['natural'])`
**rejects the whole build** — the throw propagates through `chain`/`modifyPublicTags` (which
runs inside `EventFactory`'s promise chain) and rejects `await factory.sign(...)`. Same
logical intent, two opposite outcomes, neither obvious to a caller. The silent-strip branch
is the more dangerous one: a caller who sets a label then a hashtag loses the hashtag with no
signal.

**Fix:** Pick one discipline. Preferably make both non-throwing and symmetric: `setLabels`
should strip overlapping `t` values (mirroring `setHashtags`) rather than throw, so the build
never fails on an ordering accident, and surface the conflict via a separate validation
helper the caller can opt into:

```ts
export function setLabels(tags: string[][], values: string[]): string[][] {
  // strip any t-hashtag that is being promoted to an l-label (mirror setHashtags)
  const cleanedT = tags.filter((t) => !(t[0] === 't' && values.includes(t[1] ?? '')))
  const cleaned = cleanedT.filter((t) => t[0] !== 'L' && t[0] !== 'l')
  if (values.length === 0) return cleaned
  return [...cleaned, ['L', EARTHLY_LABEL_NAMESPACE], ...values.map((v) => ['l', v, EARTHLY_LABEL_NAMESPACE])]
}
```

### WR-04: `$ref` denylist is a substring scan over serialized JSON — over-rejects valid schemas and misses `$recursiveRef`

**File:** `src/lib/validation/schema.worker.ts:103`

**Issue:** The reference gate is `/"\$ref"|"\$dynamicRef"/.test(json)` over `JSON.stringify(schema)`.
Two problems:

1. **Misses `$recursiveRef`** (draft 2019-09, still recognized by `Ajv2020`). The denylist
   names only `$ref` and `$dynamicRef`. A schema using `$recursiveRef`/`$recursiveAnchor`
   slips past the gate. (Under `strict:false` Ajv may treat it as an unknown keyword rather
   than resolving it, so this is defense-in-depth rather than a confirmed RCE — but the gate's
   stated job is "external resolution is never attempted," and this is a hole in that claim.)
2. **Over-rejects** any schema where the literal text `"$ref"`/`"$dynamicRef"` appears as a
   *property name under `properties`*, an `enum`/`const` string value, or even inside a
   `description`. Those are fail-closed-safe (rejection, not bypass), but they make the gate
   reject legitimate stranger schemas for the wrong reason.

**Fix:** Walk the parsed object structurally (you already do this in `walk` for depth/keyword
caps) and reject reference *keywords* by key name, covering the full set, instead of a flat
string scan:

```ts
const REF_KEYWORDS = new Set(['$ref', '$dynamicRef', '$recursiveRef'])
// inside walk(), when iterating object entries:
for (const [key, value] of Object.entries(node)) {
  if (REF_KEYWORDS.has(key)) throw new Error('schema uses a reference keyword')
  keywordCount++; ...
}
```

### WR-05: `rejectUnsafeSchema` dead branch + size cap is char-count, not byte-count

**File:** `src/lib/validation/schema.worker.ts:95-101`

**Issue:** Two minor robustness defects in the OOM gate:
1. `const json = JSON.stringify(schema); if (typeof json !== 'string')` — `JSON.stringify`
   returns `string | undefined` (undefined for `undefined`, a function, or a symbol input).
   The `typeof json !== 'string'` guard is meant to catch this, but for an *undefined* input
   the very next line `json.length` would throw a `TypeError` if the guard were ever removed,
   and the guard's error message ("not serializable") is reached only for top-level
   non-serializable values; nested `undefined`/functions are silently dropped by
   `JSON.stringify` and never counted. Acceptable for fail-closed but the guard is partly
   decorative.
2. `json.length > MAX_SCHEMA_BYTES` compares **UTF-16 code-unit count** against a constant
   named `_BYTES`. A schema full of multi-byte characters (or astral-plane chars) has a byte
   length up to ~3-4x its `.length`, so the real OOM cap is looser than 64 KiB advertised, and
   surrogate pairs make `.length` an undercount of bytes. The name promises bytes; the code
   measures chars.

**Fix:** Measure actual bytes and treat an undefined serialization as a hard reject:

```ts
const json = JSON.stringify(schema)
if (json === undefined) throw new Error('schema is not serializable')
if (new TextEncoder().encode(json).length > MAX_SCHEMA_BYTES) {
  throw new Error(`schema exceeds ${MAX_SCHEMA_BYTES} bytes`)
}
```

### WR-06: Malformed `expiration` tag (`NaN`) silently treated as "never expires"

**File:** `src/lib/nostr/expiry.ts:22-25`

**Issue:** `isExpired` reads the timestamp via applesauce's `getExpirationTimestamp`, which
does `parseInt(expiration)` (no radix) and returns `NaN` for a non-numeric tag value (e.g.
`['expiration', 'soon']` or `['expiration', '']`). `getExpirationTimestamp` only returns
`undefined` when the tag is *absent*, not when it is *malformed*. The wrapper then evaluates
`NaN < now`, which is `false`, so a malformed expiration is treated as **never expires** —
the opposite of the conservative choice for an advisory-GC predicate. A hostile or buggy
author can publish an event that should be dropped but is kept forever client-side.

**Fix:** Treat a non-finite expiration as already-expired (fail-safe drop), or at minimum
document the choice explicitly:

```ts
export function isExpired(event: NostrEvent, now: number): boolean {
  const expiration = getExpirationTimestamp(event)
  if (expiration === undefined) return false
  if (!Number.isFinite(expiration)) return true // malformed -> drop
  return expiration < now
}
```

## Info

### IN-01: `entityFactory` signer adapter uses an empty-string `getPublicKey` placeholder

**File:** `src/lib/nostr/entityFactory.ts:33-37`

**Issue:** `toEventSigner` returns `getPublicKey: () => ''`. This is functional today only
because applesauce's `stamp()` sets `pubkey: ''` on the draft and the bare sign-function's
returned event overwrites it, AND the upstream "Signer modified pubkey" guard is skipped
because neither `blankEventTemplate` nor `toEventTemplate` carries a `pubkey` (verified). The
adapter is correct but relies on three upstream implementation details staying true. If a
future applesauce version stamps `pubkey` earlier, or `toEventTemplate` starts preserving
`pubkey`, the empty-string placeholder will trip "Signer modified pubkey". A short comment
pinning that assumption (or deriving the pubkey from a dry-run of the function) would harden
it.

### IN-02: `compileOnce` cache key trusts a caller-supplied `schemaHash` with no schema↔hash binding

**File:** `src/lib/validation/schema.worker.ts:136-147`

**Issue:** The compile-once cache is keyed solely on `schemaHash`, which the caller supplies
and the engine never verifies against the actual `schema`. If two different schemas are ever
submitted under the same `schemaHash` (collision, caller bug, or a malicious actor reusing a
victim's hash), the first one's compiled validator is reused for the second's data — the gate
and compile for the second schema never run. Within Phase 8 the hash is content-derived
upstream so this is latent, but the engine offers no defense. Consider hashing the serialized
schema inside the engine, or asserting the cached entry was compiled from an
identical-serialization schema.

### IN-03: `runSchemaValidation` is `async` but performs only synchronous work

**File:** `src/lib/validation/schema.worker.ts:154-164`

**Issue:** The function is declared `async` and returns a `Promise`, but compile+validate are
fully synchronous with no `await`. This is harmless but reinforces the WR-01 confusion that
the engine might yield/await a deadline — it cannot. If kept async for interface symmetry,
note in the docstring that it never yields.

### IN-04: `terminate()` / `setTimeout` typing leans on DOM lib globals in a Bun project

**File:** `src/lib/validation/schemaWorker.ts:105,160`

**Issue:** `new Worker(...)`, `setTimeout`/`clearTimeout`, `ErrorEvent`, and `MessageEvent`
are referenced as ambient globals. This is fine in the browser bundle and under Bun, but the
`self` global in `schema.worker.ts` is hand-declared (`declare const self`) while these
others are not, which is inconsistent. Low risk; flagged only for typing consistency.

### IN-05: Test asserts a wall-clock budget that only holds on JSC, not the documented engine bound

**File:** `src/lib/validation/schemaWorker.test.ts:44-58`

**Issue:** The ReDoS/oversized tests assert `elapsed <= 600ms`. As measured in WR-01, this
passes only because `bun test` runs on JSC, which caps regex backtracking. The same assertion
would fail (~80s) on a V8-based runner. The test therefore validates the host engine's regex
limiter, not the module's own hardening, and gives false confidence that the engine bounds
its work. Tie the assertion to an actual in-engine guard once WR-01 is addressed.

---

_Reviewed: 2026-06-25T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
