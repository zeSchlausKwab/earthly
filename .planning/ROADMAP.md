# Roadmap: Earthly

## Milestones

- ✅ **v1.1 AI Chat** — Phases 1–7 (shipped 2026-06-23) — see [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Geo Entity Model Split** — Phases 8–13 (shipped 2026-07-03) — see [`milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.1 AI Chat (Phases 1–7) — SHIPPED 2026-06-23</summary>

Data Ingest, Transform & Safe Authoring — turned the AI chat from a map-drawing assistant into a data-ingest-and-transformation workbench. Full phase details, decisions, and per-plan breakdown archived in [`milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

- [x] Phase 1: Encrypted Settings Persistence (3/3 plans) — completed 2026-06-16
- [x] Phase 2: Tool Registry & Authoring API (6/6 plans) — completed 2026-06-16
- [x] Phase 3: File Ingest & Multimodal (6/6 plans) — completed 2026-06-17
- [x] Phase 4: Code Interpreter Sandbox (3/3 plans) — completed 2026-06-20
- [x] Phase 5: Dataset-Aware Safe Editing (5/5 plans) — completed 2026-06-21
- [x] Phase 6: AI Bulk Transform & Data-Driven Styling (5/5 plans) — completed 2026-06-22
- [x] Phase 7: Geometry Optimization (5/5 plans) — completed 2026-06-23

</details>

<details>
<summary>✅ v1.2 Geo Entity Model Split (Phases 8–13) — SHIPPED 2026-07-03</summary>

Split the overloaded kind-37518 "context" into role-specific geo entity kinds — Story/Article (37520, curate-pull), slimmed Group/Topic (37518, attach-push + governance ladder), Live Beacon (37521, real-time position), Temporal Sighting (37522, time-bound observation) — each with full create/edit/comment/react/attach authoring UI, over a shared Phase-8 foundation (kind constants, `tags.ts`, `modelVersion='earthly/2'` clean break, off-thread schema-validation worker, NIP-40 expiry filter, NIP-32 `L`/`l` helper). Milestone audit PASSED (30/30 reqs, 5/5 cross-phase seams, 4/4 E2E flows). Full phase details, decisions, per-plan breakdown, and audit archived in [`milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md) + [`milestones/v1.2-MILESTONE-AUDIT.md`](milestones/v1.2-MILESTONE-AUDIT.md).

- [x] Phase 8: Spec v2 + Foundation (5/5 plans) — completed 2026-06-25
- [x] Phase 9: Group / Topic — 37518 slimmed (6/6 plans) — completed 2026-06-26
- [x] Phase 10: Story / Article — 37520 (4/4 plans) — completed 2026-06-27
- [x] Phase 11: Temporal Sighting — 37522 (4/4 plans) — completed 2026-06-28
- [x] Phase 12: Live Beacon — 37521 (5/5 plans) — completed 2026-07-02
- [x] Phase 13: Cross-Cutting — comment widening + entity routing/addressing + Map Stack unification (7/7 plans incl. gap-closure) — completed 2026-07-03

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Encrypted Settings Persistence | v1.1 | 3/3 | Complete | 2026-06-16 |
| 2. Tool Registry & Authoring API | v1.1 | 6/6 | Complete | 2026-06-16 |
| 3. File Ingest & Multimodal | v1.1 | 6/6 | Complete | 2026-06-17 |
| 4. Code Interpreter Sandbox | v1.1 | 3/3 | Complete | 2026-06-20 |
| 5. Dataset-Aware Safe Editing | v1.1 | 5/5 | Complete | 2026-06-21 |
| 6. AI Bulk Transform & Data-Driven Styling | v1.1 | 5/5 | Complete | 2026-06-22 |
| 7. Geometry Optimization | v1.1 | 5/5 | Complete | 2026-06-23 |
| 8. Spec v2 + Foundation | v1.2 | 5/5 | Complete | 2026-06-25 |
| 9. Group / Topic (37518 slimmed) | v1.2 | 6/6 | Complete | 2026-06-26 |
| 10. Story / Article (~37520) | v1.2 | 4/4 | Complete | 2026-06-27 |
| 11. Temporal Sighting | v1.2 | 4/4 | Complete | 2026-06-28 |
| 12. Live Beacon (~37521) | v1.2 | 5/5 | Complete | 2026-07-02 |
| 13. Cross-Cutting | v1.2 | 7/7 | Complete | 2026-07-03 |
