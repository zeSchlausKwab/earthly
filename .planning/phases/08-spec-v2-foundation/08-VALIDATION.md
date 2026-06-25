---
phase: 8
slug: spec-v2-foundation
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-25
validated: 2026-06-25
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Generated from `08-RESEARCH.md` § Validation Architecture (Nyquist source). Per-task IDs are
> reconciled to the actual plans by the Nyquist audit once `*-PLAN.md` files exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun's built-in `bun:test` runner — not jest/vitest) |
| **Config file** | none — Bun auto-discovers `*.test.ts` |
| **Quick run command** | `bun test src/lib/nostr/ src/lib/validation/` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | ~5s quick · ~15s full |

> **Gate composition (per MEMORY tsc baseline):** the phase gates are `bun test` + `bun run build` + `biome`. `tsc --noEmit` carries a ~305-error pre-existing baseline and is **not** a gate — do not regress it, do not block on it. `bun run build` is load-bearing here: it is the only automated proof that the new schema Worker is registered (`workerAssets.ts` + `build.ts` entrypoint + `src/index.ts` route) and actually emitted (Pitfall 1 — a missing worker entrypoint silently 404s→`index.html`).

---

## Sampling Rate

- **After every task commit:** Run `bun test src/lib/nostr/ src/lib/validation/`
- **After every plan wave:** Run `bun test` (full) **+** `bun run build` **+** `bun run lint` (biome)
- **Before `/gsd-verify-work`:** Full suite green + `bun run build` green + biome clean
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Rows are keyed by requirement (the observable seam from research). Task IDs are assigned at plan
> time; the Nyquist audit binds each row to its concrete `{N}-{plan}-{task}` id and updates Status.

| Req | Plan | Behavior (observable seam) | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|------|----------------------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SPEC-01 | 08-05 | SPEC.md v2 contains a section per kind (37515/37518/37520/37521/37522), the kind numbers, the `modelVersion` clause, and the `L/l·t·c` split | T-08-01-DOC (spec↔code drift) | Doc-assertion imports `MODEL_VERSION`/`EARTHLY_LABEL_NAMESPACE`/`FEATURE_CATEGORY_VOCAB` from code so pinned strings can't drift | doc-assertion | `bun test src/lib/nostr/spec.doc.test.ts` | ✅ | ✅ green (8) |
| SPEC-02 | 08-01/02/04 | Each new kind: `is<Entity>()` accepts well-formed / rejects wrong-kind; `Factory.create()` emits `d` tag + `modelVersion`; cast getters typed; **all tag reads route through `tags.ts`** (geo-event + map-context round-trip bbox/t/c/a identically via shared helper) | — | N/A | unit (round-trip) | `bun test src/lib/nostr/tags.test.ts src/lib/nostr/article src/lib/nostr/live-beacon src/lib/nostr/temporal-sighting` | ✅ | ✅ green |
| SPEC-03 | 08-02/04 | Legacy-shaped 37518 (no `modelVersion` / no slimmed `governance`) → guard returns `false` **without throwing**; malformed-JSON content → `false` without throwing; new-model event → `true`; event excluded from `filter(guard)` render set | T-8-03 (defensive parse) | Malformed/legacy event never enters render set; no-throw guard | unit (guard + defensive parse) | `bun test src/lib/nostr/modelVersion.test.ts` | ✅ | ✅ green |
| SPEC-04 | 08-03 | (a) ReDoS `pattern` / recursive `$ref` / oversized-deep schema each **fail-closed within timeout** (resolves to "could not validate" in < timeout+slack); (b) `$ref` rejected before compile; (c) compile-once-per-`schemaHash` (cache hit on repeat); (d) `$data` off | T-8-04 (untrusted schema DoS) | Off-thread Ajv-2020, ≤100ms hard timeout-kill, fail-closed, `$ref`/`$data` rejected, size/depth caps | unit (hardening) + timing-bounded | `bun test src/lib/validation/schemaWorker.test.ts` | ✅ | ✅ green (7) |
| SPEC-05 | 08-02 | `isExpired(event)` → `true` for `expiration < now`, `false` for future/no-expiry; `dropExpired([...])` removes only expired; asserted against a fixed UTC epoch clock | — | Client filters expired on read regardless of relay GC | unit (predicate) | `bun test src/lib/nostr/expiry.test.ts` | ✅ | ✅ green |
| TAX-01 | 08-02 | `setLabels(tags, ['natural','route'])` emits exactly one `["L","earthly"]` + one `["l",v,"earthly"]` per value (paired); `setLabels(tags, [])` removes all `L`/`l`; `getLabels` reads back only `earthly`-namespaced `l`; round-trip stable; `t` value equal to an `l` value flagged (disjointness) | — | N/A | unit (pairing + round-trip + disjointness) | `bun test src/lib/nostr/tags.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/lib/nostr/tags.test.ts` — SPEC-02 (tag round-trips, shared-helper equality across geo-event/map-context) + TAX-01 (`L`/`l` pairing, vocab, disjointness)
- [x] `src/lib/nostr/modelVersion.test.ts` — SPEC-03 (guard truth table + defensive parse, no-throw)
- [x] `src/lib/nostr/expiry.test.ts` — SPEC-05 (`isExpired`/`dropExpired` against a fixed UTC clock)
- [x] `src/lib/validation/schemaWorker.test.ts` — SPEC-04 (ReDoS/`$ref`/oversized fail-closed within timeout via **synchronous fallback** — no live Worker under `bun test`; compile-once-per-hash; `$data` off)
- [x] `src/lib/nostr/article/article.test.ts`, `live-beacon/live-beacon.test.ts`, `temporal-sighting/temporal-sighting.test.ts` — SPEC-02 (per-kind guard + `create()` `d`+`modelVersion` + cast getters)
- [x] `src/lib/nostr/spec.doc.test.ts` — SPEC-01 (required headings/kind-numbers/clauses present in SPEC.md)
- [x] No framework install needed — `bun test` is built-in.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live-Worker timeout-kill in a real browser tab | SPEC-04 | `bun test` exercises the **synchronous fallback**, not a live `Worker`. The live worker's emission is proven by `bun run build`; its in-browser timeout-kill behavior is only observable at runtime | After `bun run build`, load the app, feed the Group validator a ReDoS `pattern` schema, confirm the tab stays responsive and validation resolves fail-closed (Phase 9 wires the actual call site; in Phase 8 verify via a temporary harness or defer the live check to Phase 9) |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (8 test files above)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-06-25 — all 7 requirements automated-green (44 tests; full suite 615/0).

---

## Validation Audit 2026-06-25

State A audit of the plan-time draft against the executed phase. All 8 Wave-0 test
files exist and were committed during execution (Plans 08-01..08-05); all 44 tests run
green; full suite 615 pass / 0 fail. Each test was spot-verified as behavior-targeting
(not vacuous) — SPEC-04 asserts fail-closed verdicts within the wall-clock budget +
compile-once + `$data`-off; SPEC-03 asserts the no-throw truth table + render-set
filter; TAX-01 asserts `L`/`l` pairing + namespace read-back + `t`/`l` disjointness throw.
No auditor spawn required (zero unfilled gaps). The lone manual-only item (live-Worker
in-browser timeout-kill) is supplementary — SPEC-04's hardening is fully automated via
the synchronous fallback, and worker emission is proven by `bun run build`.

| Metric | Count |
|--------|-------|
| Requirements | 7 |
| Gaps found | 0 |
| Resolved (auto-green) | 7 |
| Escalated to manual-only | 0 (1 pre-existing supplementary) |
| Tests asserting | 44 (all green) |
