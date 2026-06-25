---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Geo Entity Model Split
status: executing
stopped_at: Completed 08-03-PLAN.md
last_updated: "2026-06-25T09:20:00.000Z"
last_activity: 2026-06-25 -- Phase 08 Plan 03 executed (off-thread schema validation worker, SPEC-04, GREEN)
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 5
  completed_plans: 3
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23 after v1.1 milestone)

**Core value:** The maintainer (and any user) can open the app for fun, not duty.
**Current focus:** Phase 08 — spec-v2-foundation

## Current Position

Phase: 08 (spec-v2-foundation) — EXECUTING
Plan: 4 of 5
Status: Ready to execute
Last activity: 2026-06-25 -- Phase 08 Plan 03 executed (off-thread schema validation worker, SPEC-04, GREEN)

Progress: [░░░░░░░░░░] 0% (v1.2)

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

Last session: 2026-06-25T09:20:00.000Z
Stopped at: Completed 08-03-PLAN.md
Resume file: None

## Operator Next Steps

- Execute Plan 08-04 (per-kind barrels: article/live-beacon/temporal-sighting) to turn the remaining 3 RED Wave-0 suites GREEN

</content>
