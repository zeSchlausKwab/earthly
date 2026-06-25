---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Geo Entity Model Split
status: executing
stopped_at: Completed 08-05-PLAN.md (Phase 08 complete)
last_updated: "2026-06-25T07:35:00.000Z"
last_activity: 2026-06-25 -- Phase 08 Plan 05 executed (SPEC.md v2 in-place rewrite + spec.doc.test.ts doc-assertion, SPEC-01); Phase 08 COMPLETE (5/5 plans, suite 615 pass / 0 fail)
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 5
  completed_plans: 5
  percent: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23 after v1.1 milestone)

**Core value:** The maintainer (and any user) can open the app for fun, not duty.
**Current focus:** Phase 08 — spec-v2-foundation

## Current Position

Phase: 08 (spec-v2-foundation) — COMPLETE
Plan: 5 of 5 (all complete)
Status: Phase 08 complete — ready for Phase 09 (Group / Topic)
Last activity: 2026-06-25 -- Phase 08 Plan 05 executed (SPEC.md v2 in-place rewrite + spec.doc.test.ts doc-assertion, SPEC-01); Phase 08 COMPLETE

Progress: [██░░░░░░░░] 17% (v1.2)

## Roadmap (v1.2 — Phases 8–13)

Phase numbering continues from v1.1 (ended at Phase 07). Dependency spine: Foundation blocks everything → Group first → Story / Sighting / Beacon → Cross-cutting.

| Phase | Name | Requirements | Research |
|-------|------|--------------|----------|
| 8 | Spec v2 + Foundation | SPEC-01..05, TAX-01 | SKIP |
| 9 | Group / Topic (37518 slimmed) | GROUP-01..08 | NEEDS (governance shape, schema UI, lane cap, NO-MOD UX) |
| 10 | Story / Article (~37520) | STORY-01..06 | SKIP |
| 11 | Temporal Sighting | SIGHT-01..04 | NEEDS (dedicated kind vs 37515+property — LEFT OPEN) |
| 12 | Live Beacon (~37521) | BEACON-01..04 | NEEDS (replaceable+NIP-40 vs ephemeral lifecycle — LEFT OPEN) |
| 13 | Cross-Cutting | XCUT-01, XCUT-02 | SKIP |

## Performance Metrics

**Velocity (v1.1 — shipped):**

- Total plans completed (v1.1): 33
- v1.2 plans completed: 0

**By Phase (v1.2):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 8 | TBD | - | - |
| 9 | TBD | - | - |
| 10 | TBD | - | - |
| 11 | TBD | - | - |
| 12 | TBD | - | - |
| 13 | TBD | - | - |

*Updated after each plan completion*
| Phase 08 P01 | 9min | 2 tasks | 7 files |
| Phase 08 P02 | 11min | 2 tasks | 7 files |
| Phase 08 P03 | 18min | 2 tasks | 3 files |
| Phase 08 P04 | 7min | 2 tasks | 14 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap v1.2]: Foundation (Phase 8) is built first and blocks every entity phase — kind constants, shared `tags.ts`, the off-thread schema-validation worker, the in-content version discriminator + legacy-37518 defensive skip, the shared NIP-40 expiry filter, and the NIP-32 `L`/`l` helper. No per-kind phase ships with copy-paste or an unguarded validator.
- [Roadmap v1.2]: TAX-01 lives in Foundation (Phase 8) — the NIP-32 `L`/`l` paired-emit helper is the canonical home; Phase 9 (Group) consumes it for schema-enforced allowed-`l`-value sets.
- [Roadmap v1.2]: Group (Phase 9) is the first entity — ~90% rename of `map-context/`, exercises every shared seam and the two highest-severity pitfalls. NO-MOD MINIMUM (GROUP-08) + off-thread schema validation (SPEC-04, consumed) MUST ship in the same phase as foreign `c`-attach, never after.
- [Roadmap v1.2]: Story / Sighting / Beacon are independent once Foundation lands; sequenced after Group. Beacon is last among kinds (only net-new live-map-render + most privacy surface).
- [Roadmap v1.2]: Two phase-level decisions LEFT OPEN as research flags — Beacon lifecycle (parameterized-replaceable + NIP-40 vs ephemeral) in Phase 12; Sighting representation (dedicated kind vs 37515 + property + NIP-40) in Phase 11. Do NOT pre-decide; resolve in phase planning/research.
- [Roadmap v1.2]: Amend, don't replace — `group/` refactors `map-context/`; dataset (37515) and proposal (37519) stay untouched; 37519 gets only a small Markdown-target extension for STORY-06. Clean break on legacy 37518 data (SPEC-03 = defensive skip, not migration).
- [Phase ?]: [08-01]: Nyquist Wave-0 RED baseline pins exact foundation-seam symbol names (tags/modelVersion/expiry/schemaWorker + 3 per-kind barrels) before Plans 02-04 implement them
- [08-02]: Shared tags.ts seam (bbox/g/t/c/a read+write) extracted; geo-event + map-context read getters now delegate (copy-paste removed). MODEL_VERSION='earthly/2' chosen. setLabels throws on t/l overlap (TAX-01); setHashtags strips l-governed values. Write setters live in tags.ts as pure transformers but shipped factories left on their inline setters (tight diff) — new kinds in Plan 04 consume the transformers.
- [08-03]: Off-thread schema-validation worker (SPEC-04) shipped — rejectUnsafeSchema gate ($ref/$dynamicRef + 64KB/depth-12/4096-keyword caps) runs BEFORE ajv.compile; Ajv2020 with $data OFF; compile-once-per-schemaHash cache; fail-closed on every throw; host watchdog (100ms+500ms) terminate-on-overrun; sync pure-engine fallback. Fallback discriminator widened to hasSpawnableWorker() (Worker + http(s) origin) because bun test defines a Worker global it can't serve — typeof-Worker alone left the GREEN unreachable. Registered in workerAssets.ts; bun run build emits dist/workers/schema.worker.js (anti-fail-open). NO Group wiring (Phase 9 consumes validateSchema()).
- [08-04]: Article (37520), Live Beacon (37521), Temporal Sighting (37522) Factory+Cast scaffolds landed (SPEC-02/03). Each is<Entity>() guard = kind + d + hasCurrentModelVersion (no-throw); create() injects MODEL_VERSION + generates d only if absent; modify() preserves d. Tag reads/writes delegate to tags.ts (no copy-paste). Introduced shared EntityFactory base (src/lib/nostr/entityFactory.ts) so create/modify d-lineage + a sign() that accepts a bare sign-function (the Wave-0 test contract, since applesauce sign() needs an EventSigner) are written once. LiveBeacon AND TemporalSighting casts expose NIP-40 expiresAt. Three barrels wired into src/lib/nostr/index.ts. Full Wave-0 baseline now GREEN: 607 pass / 0 fail.
- [08-05]: SPEC.md rewritten IN PLACE to v2 (SPEC-01) — split entity model with final kind block (37515 Dataset / 37517 Comment / 37518 slimmed Group / 37519 Proposal / 37520 Story / 37521 Live Beacon / 37522 Temporal Sighting / 34444 Map Layer); modelVersion='earthly/2' clean break (absence/mismatch => legacy/inert/skipped); three-way disjoint L/l·t·c taxonomy split + flat earthly namespace (with reverse-DNS tradeoff note) + FEATURE_CATEGORY_VOCAB; schema governance dialect (draft-2020-12, no $data, no external $ref, 64KB/depth-12/4096 caps); NIP-40 advisory client-always-filters. spec.doc.test.ts pins those strings against the doc on disk (RED on v1, GREEN on v2, mitigates doc-drift T-08-01-DOC). Suite 615 pass / 0 fail; build green; biome clean. Phase 08 COMPLETE (5/5). NOTE: gsd-tools not on PATH — STATE/ROADMAP updated manually.

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 9 (Group)]: NEEDS deeper research at planning time — `governance` enum backward-compat shape with legacy content fields; non-developer schema-authoring UI; exact foreign-lane cap (suggested start: 50 visible, paginate, sort by recency); NO-MOD MINIMUM UX contract.
- [Phase 11 (Sighting)]: OPEN decision — dedicated lightweight kind vs 37515 + property + NIP-40; confirm a new kind number needs no relay-side Khatru filter changes beyond existing `pool.req`.
- [Phase 12 (Beacon)]: OPEN decision — replaceable + NIP-40 vs ephemeral lifecycle; confirm with a relay echo test (Khatru NIP-40 GC); `seq`-tag schema for clock-skew de-dup; staleness grey-out threshold; visibility/privacy model.
- [v1.1 carry-forward]: Three live in-browser human-verify items remain bookkeeping-open (see Deferred Items) — not work-open, regression-tested.

## Deferred Items

Items acknowledged and carried forward / out of scope.

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Feature | Nostr-scrolls / WASM (NIP-5C) | Deferred (builds on shipped code interpreter) | 2026-06-16 |
| Feature | Compound routing | Deferred to v2 | 2026-06-16 |
| Refactor | Reroute editor.updateFeature + deleteFeatures + dataset-load setFeatures through Authoring API (tighten A3 to all 4 verbs) | Deferred (facade-expansion follow-up) | 2026-06-16 (02-03) |
| Feature (v1.2) | NIP-72 human moderation/approval + role lists (MOD-01) | Deferred to next milestone | 2026-06-23 |
| Feature (v1.2) | Web-of-trust + mute lists for spam (MOD-02) | Deferred to next milestone | 2026-06-23 |
| Feature (v1.2) | Scroll-linked Story map camera (STORY-07) | Deferred to v2 | 2026-06-23 |
| Feature (v1.2) | External-source / sandbox-driven Beacon (BEACON-05), beacon trail (BEACON-06), encrypted beacons (BEACON-07) | Deferred to v2 | 2026-06-23 |
| Feature (v1.2) | AI paste→Sighting ingest (SIGHT-05), geoprivacy obscuring (SIGHT-06) | Deferred to v2 | 2026-06-23 |

### Acknowledged at v1.1 milestone close (2026-06-23)

Open artifact-audit items awaiting live in-browser human confirmation or design questions already resolved in code — bookkeeping-open, not work-open.

| Category | Item | Status |
|----------|------|--------|
| debug | sandbox-worker-file-url-dev | awaiting_human_verify (fix landed: dev `.wasm` served as application/wasm; regression-tested) |
| debug | sandbox-worker-oom-runaway | awaiting_human_verify (fix landed: warm-pooled worker + circuit breaker; regression-tested) |
| verification | Phase 06 — 06-VERIFICATION.md | human_needed (automated gates green 538/0; awaiting live UAT confirmation) |

## Session Continuity

Last session: 2026-06-25T07:35:00.000Z
Stopped at: Completed 08-05-PLAN.md — Phase 08 COMPLETE
Resume file: None

## Operator Next Steps

- Phase 08 (spec-v2-foundation) is complete — all 5 plans landed, SPEC.md v2 is canonical, suite 615 pass / 0 fail.
- Next: run /gsd-verify-work on Phase 08 (verifier + end-of-phase human-verify), then plan/execute Phase 09 (Group / Topic — slimmed 37518: governance ladder, NO-MOD MINIMUM, schema-authoring UI, validate-on-fetch wiring of the §9 worker).

</content>
