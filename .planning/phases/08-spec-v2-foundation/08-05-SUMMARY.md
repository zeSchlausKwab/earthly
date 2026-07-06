---
phase: 08-spec-v2-foundation
plan: 05
subsystem: documentation
tags: [spec, nostr, doc-assertion, bun-test, nip-23, nip-32, nip-40, nip-52, clean-break]

# Dependency graph
requires:
  - phase: 08-02
    provides: "kinds.ts (ARTICLE/LIVE_BEACON/TEMPORAL_SIGHTING _KIND), tags.ts (EARTHLY_LABEL_NAMESPACE + FEATURE_CATEGORY_VOCAB), modelVersion.ts (MODEL_VERSION), expiry.ts"
  - phase: 08-03
    provides: "schema.worker.ts hardened dialect (Ajv2020, $data off, $ref rejected, size/depth caps)"
  - phase: 08-04
    provides: "article/live-beacon/temporal-sighting Factory+Cast scaffolds + guards gating on modelVersion"
provides:
  - "SPEC.md v2 (in-place rewrite) — canonical split entity model: 37515 Dataset / 37517 Comment / 37518 slimmed Group / 37519 Proposal / 37520 Story / 37521 Live Beacon / 37522 Temporal Sighting / 34444 Map Layer"
  - "src/lib/nostr/spec.doc.test.ts — SPEC-01 doc-assertion pinning kind numbers + modelVersion clause + three-way L/l·t·c split + dialect/NIP-40 tokens against the doc on disk"
affects: [09-group, 10-story, 11-sighting, 12-beacon, 13-comments]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-assertion test reads the spec via Bun.file('SPEC.md').text() and asserts stable substrings (kind numbers, modelVersion literal, vocab members) — robust to prose rewording, pins the spec↔code contract (mitigates doc-drift T-08-01-DOC)"
    - "Spec cites every shipped seam by file_path:line_number per CLAUDE.md so the doc tracks the code"

key-files:
  created:
    - src/lib/nostr/spec.doc.test.ts
  modified:
    - SPEC.md

key-decisions:
  - "SPEC.md rewritten IN PLACE (clean break); v1 remains in git history as the only archive — no parallel/versioned file (CONTEXT discretion default)"
  - "Doc test asserts by case-insensitive substring on stable tokens (kind numbers, MODEL_VERSION literal, FEATURE_CATEGORY_VOCAB members imported from tags.ts) — not exact sentences — so the prose can evolve without false RED"
  - "The single surviving 'discriminated union' phrase is the PAST-TENSE clean-break contrast (what v1 37518 WAS); the slimmed Group is described as a curated topic, not a multi-role union — acceptance criterion satisfied"
  - "Temporal Sighting documented as the assigned-and-recommended dedicated kind 37522 with the D-02 note that Phase 11 confirms representation"

requirements-completed: [SPEC-01]

# Metrics
duration: 3min
completed: 2026-06-25
---

# Phase 8 Plan 05: SPEC.md v2 + Doc-Assertion Summary

**Rewrote `SPEC.md` in place to v2 — documenting the whole split entity model (37520 Story · 37521 Live Beacon · 37522 Temporal Sighting + the slimmed 37518 Group) with final kind numbers, the `modelVersion='earthly/2'` clean break, the three-way disjoint `L`/`l`·`t`·`c` taxonomy split, the hardened schema governance dialect, and the NIP-40 advisory contract — and added `spec.doc.test.ts`, a doc-assertion that pins those required strings against the doc on disk (RED on v1, GREEN on v2).**

## Performance
- **Duration:** ~3 min
- **Started:** 2026-06-25T07:31Z
- **Completed:** 2026-06-25T07:35Z
- **Tasks:** 2
- **Files created:** 1; modified: 1

## Accomplishments
- **Task 1 — SPEC-01 doc-assertion (`spec.doc.test.ts`, ~95 lines):** reads `SPEC.md` via `Bun.file('SPEC.md').text()` and asserts (a) every shipped kind number `37515/37517/37518/37520/37521/37522`; (b) each split entity named by role (Story/Article, Live Beacon, Temporal Sighting, Group); (c) the `modelVersion` discriminator + the imported `MODEL_VERSION` literal + clean-break wording (`legacy`, `clean break`); (d) the three-way `L`/`l`·`t`·`c` split (`disjoint`/`three-way`), the `EARTHLY_LABEL_NAMESPACE` literal, the reverse-DNS tradeoff note, and every `FEATURE_CATEGORY_VOCAB` member; (e) the dialect (`draft-2020-12`, `$data`, `$ref`, `depth`) and NIP-40 advisory tokens. Verified RED against v1 (7 fail / 1 pass).
- **Task 2 — SPEC.md v2 (in-place rewrite, ~17 sections):** followed the RESEARCH 10-section map. Kept 37515 Dataset (incl. blob refs), 37516 collection (marked removed-from-active-model), 37519 Proposal, and 34444 Map Layer unchanged. Added/re-scoped: §3 slimmed Group (modelVersion gate, `governance: open|schema|closed` placeholder, two-lane `a`/`c`, legacy clean break), §4 Story 37520 (NIP-23 + naddr→`a` mirror Phase 10), §5 Live Beacon 37521 (replaceable + NIP-40), §6 Temporal Sighting 37522 (NIP-52 + D-02 representation note), §7 three-way taxonomy split, §8 modelVersion clean break, §9 schema governance dialect, §10 NIP-40 expiry. Every cross-cutting claim cites the shipped seam by `file_path:line_number`.
- Doc-assertion turns GREEN (8/8); full suite **615 pass / 0 fail** (was 607); `bun run build` green (schema worker still emits); biome clean on the test file.

## Task Commits
1. **Task 1: SPEC-01 doc-assertion test** — `1609bf5` (test)
2. **Task 2: SPEC.md v2 in-place rewrite** — `4d708a4` (feat)

**Plan metadata:** committed separately with SUMMARY/STATE/ROADMAP (docs).

## Files Created/Modified
- `src/lib/nostr/spec.doc.test.ts` (created) — SPEC-01 doc-assertion; imports `MODEL_VERSION` / `EARTHLY_LABEL_NAMESPACE` / `FEATURE_CATEGORY_VOCAB` from the shipped seams so the pinned strings can never drift from the code constants.
- `SPEC.md` (modified, in-place v2 rewrite) — canonical split entity model + tag vocabulary + modelVersion + schema dialect + NIP-40.

## Decisions Made
- **In-place rewrite (clean break).** No parallel/versioned spec file — git history is the v1 archive (CONTEXT discretion default).
- **Substring-token assertions, not exact prose.** The doc test matches stable tokens (kind numbers, the `MODEL_VERSION` literal, the vocab members imported from `tags.ts`) case-insensitively, so the spec narrative can be reworded freely without a false RED, while still failing if a required contract token disappears.
- **Past-tense union contrast retained.** SPEC §3 keeps one "discriminated union" phrase describing what v1 37518 *was*, immediately followed by the v2 re-scope to a curated Group. The slimmed Group is nowhere described as a live multi-role union — the acceptance criterion ("no remaining description of 37518 as a multi-role discriminated union") is met by the clean-break contrast, not violated by it.
- **Sighting representation note.** 37522 is documented as the assigned-and-recommended dedicated kind with the explicit D-02 note that Phase 11 confirms representation (number reserved regardless).

## Deviations from Plan
None — plan executed exactly as written. Both tasks landed in order; the doc test was RED on v1 then GREEN on v2 as specified.

## Test Results
- `bun test src/lib/nostr/spec.doc.test.ts` → **8 pass / 0 fail** (GREEN; was 7 fail / 1 pass against v1).
- Full suite: **615 pass / 0 fail** (was 607 pass / 0 fail — the +8 are this plan's doc-assertion; no regression).
- `bun run build` → green; `dist/workers/schema.worker.js` still emitted.
- `bunx biome check src/lib/nostr/spec.doc.test.ts` → clean. (SPEC.md is Markdown — outside biome's scope; the repo `bun run lint` lints the whole tree against its known pre-existing baseline, so biome was run on the changed source file directly, consistent with prior plans in this phase.)
- Acceptance greps: `37520|37521|37522` present, `modelVersion` present, `earthly` present.

## Known Stubs
None. This plan is documentation + a doc-assertion test; no runtime data path, no placeholder values flowing to UI.

## Threat Model Coverage
- **T-08-01-DOC (spec↔code drift):** mitigated. The doc-assertion pins the kind numbers, the `modelVersion` literal (imported from `modelVersion.ts`), the namespace/vocab literals (imported from `tags.ts`), and the dialect/NIP-40 tokens against `SPEC.md` on disk; the spec body cites each seam by `file_path:line_number`. A future code change that moves a constant without updating the spec breaks the test.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Phase 8 is **complete**: all 5 plans landed, full Wave-0 baseline GREEN, SPEC.md v2 is the canonical contract. Phases 9–13 inherit the documented kind block + shared seams.
- Phase 9 (slimmed Group: governance enum, NO-MOD MINIMUM, schema-authoring UI, validate-on-fetch wiring of the §9 worker) is next.
- No blockers.

## Self-Check: PASSED

- `src/lib/nostr/spec.doc.test.ts` — FOUND
- `SPEC.md` (v2) — FOUND
- Commit `1609bf5` (test) — FOUND
- Commit `4d708a4` (feat) — FOUND

---
*Phase: 08-spec-v2-foundation*
*Completed: 2026-06-25*
