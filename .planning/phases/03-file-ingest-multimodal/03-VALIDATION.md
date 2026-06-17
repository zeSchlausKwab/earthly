---
phase: 3
slug: file-ingest-multimodal
status: populated
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-17
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `bun test` (Bun's built-in runner) |
| **Config file** | none dedicated; `bunfig.toml` exists (serve plugins only); tests are `*.test.ts` colocated |
| **Quick run command** | `bun test src/features/chat/ingest` (+ `bun test src/features/chat/vision` for INGEST-07 tasks) |
| **Full suite command** | `bun test` |
| **Build gate** | `bun run build` (worker-emission gate, Pitfall 3) + `bun run lint` (Biome) |
| **Estimated runtime** | ~30 seconds (quick scope ~5s; full suite + build ~30s) |

*Note (project memory): there is NO tsc gate (~305 pre-existing tsc errors); the binding gates are `bun test` + `bun run build` + Biome. Do not introduce a tsc-pass requirement.*

---

## Sampling Rate

- **After every task commit:** Run `bun test src/features/chat/ingest` (+ `bun test src/features/chat/vision` for INGEST-07 tasks)
- **After every plan wave:** Run `bun test` (full suite) + `bun run build` (worker-emission + bundle gate) + `bun run lint`
- **Before `/gsd-verify-work`:** Full suite green + build green + UAT (attach + drop + parse + place + vision three-tier)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | INGEST-02/03 | T-03-02 / T-03-SC | npm supply-chain: papaparse/exceljs legitimacy-gated; SheetJS forbidden | manual (blocking-human pkg gate) | — (legitimacy checkpoint; `bun install` after approval) | ✅ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | INGEST-02/03 | T-03-01 | worker try/catch never crashes host; build emits worker chunk | unit + build | `bun run build && bun test test/build-emits-ingest-worker.test.ts` | ❌ W0 (creates worker + emission gate) | ⬜ pending |
| 03-01-03 | 01 | 0 | INGEST-02/03 | T-03-SC | read-excel-file (SUS) fallback gated, only on spike failure | manual (conditional blocking-human) | — (skipped unless Task 2 build fails) | ✅ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | INGEST-02/03 | — | parse correctness across all five kinds (RED scaffold + fixtures) | unit | `bun test src/features/chat/ingest/parse.test.ts` | ❌ W0 (creates parse.test.ts + fixtures) | ⬜ pending |
| 03-02-01 | 02 | 1 | INGEST-02/03 | T-03-03 / T-03-04 / T-03-05 | 30s timeout + sync fallback + broken-worker latch always settles; xlsx transferable (no copy) | unit | `bun test src/features/chat/ingest/ingestClient.test.ts` | ❌ W0 (stub in Plan 01 scope; impl here) | ⬜ pending |
| 03-03-01 | 03 | 1 | INGEST-05 | T-03-06 | D-11 INVARIANT: model-facing payload (`toModelSummary`) excludes fullRows; session-only (no persistence) | unit | `bun test src/features/chat/ingest/ingestStore.test.ts` | ❌ W0 (creates ingestStore.test.ts) | ⬜ pending |
| 03-03-02 | 03 | 1 | INGEST-05 | T-03-06 / T-03-09 | summary = schema + head/tail/random samples; column cap; no fullRows in summary | unit | `bun test src/features/chat/ingest/parseSummary.test.ts` | ❌ W0 (creates parseSummary.test.ts) | ⬜ pending |
| 03-03-03 | 03 | 1 | INGEST-06 | T-03-07 | coord-column heuristic; `assertFileWithinCaps` rejects over-cap before parse (DoS guard) | unit | `bun test src/features/chat/ingest/detectCoordinateColumns.test.ts` | ❌ W0 (creates detectCoordinateColumns.test.ts) | ⬜ pending |
| 03-04-01 | 04 | 1 | INGEST-07 | T-03-11 / T-03-12 / T-03-13 | ladder fail-safe: unknown/unreachable ⇒ no-vision/uncertain, never silent vision; cached; never throws | unit | `bun test src/features/chat/vision/detectVisionSupport.test.ts` | ❌ W0 (creates detectVisionSupport.test.ts) | ⬜ pending |
| 03-04-02 | 04 | 1 | INGEST-07 | T-03-10 | both image paths gate on one source (D-09); snapshot never auto-sends unless confirmed-vision | unit/integration | `bun test src/features/chat/store.test.ts && bun run build` | ⚠️ extend existing store.test.ts | ⬜ pending |
| 03-05-01 | 05 | 2 | INGEST-06 | T-03-14 / T-03-17 / T-03-18 | placement iterates ALL fullRows (not samples); Authoring-API write only; coord range-validated (V5) | unit | `bun test src/features/chat/tools/ingest-tools.test.ts` | ❌ W0 (creates ingest-tools.test.ts) | ⬜ pending |
| 03-05-02 | 05 | 2 | INGEST-06 | T-03-15 / T-03-16 | batch_geocode bounded (≤50) + throttled (~1 req/s) + de-duped + skip-and-report | unit | `bun test src/features/chat/tools/ingest-tools.test.ts` | ❌ W0 (same file as 03-05-01) | ⬜ pending |
| 03-06-01 | 06 | 3 | INGEST-01/04/05 | T-03-19 | attach order pinned: `assertFileWithinCaps` → `parseFileInWorker` → `putDataset`; over-cap short-circuits before parse | unit + build | `bun test src/features/chat/components/fileAttachHandler.test.ts && bun run build && bun run lint` | ❌ (creates fileAttachHandler.test.ts) | ⬜ pending |
| 03-06-02 | 06 | 3 | INGEST-05/07 | T-03-20 / T-03-21 | D-11 send-path: composed payload carries {handleId, summary}, NOT fullRows; image_url only per vision gate (never on no-vision) | unit + build | `bun run build && bun test src/features/chat/ingestSendPath.test.ts src/features/chat/store.test.ts` | ❌ (creates ingestSendPath.test.ts) | ⬜ pending |
| 03-06-03 | 06 | 3 | INGEST-01/04 | T-03-20 | UAT: attach + drop + parse summary + place-on-map (Plan 05 tools) + three-tier vision (never silent send) | manual UAT (blocking) | — (human-verify checkpoint) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*File Exists key: ✅ W0 = present/created in Wave 0 (Plan 03-01); ❌ W0 = test stub seeded/created in Wave 0; ⚠️ = extend an existing file; ❌ (no W0) = new test authored in its own plan.*

---

## Wave 0 Requirements

Test stubs / fixtures created in Plan **03-01** (Wave 0) that later plans make GREEN:

- [ ] `src/features/chat/ingest/parse.test.ts` — CSV/xlsx/json/geojson/text parse correctness (INGEST-02/03) — RED scaffold, GREEN via Plan 02 client
- [ ] `test/build-emits-ingest-worker.test.ts` — build emits the ingest-worker chunk to `dist/` (Pitfall 3 worker-emission gate)
- [ ] Fixtures `src/features/chat/ingest/__fixtures__/` — `messy.csv` (quoted fields, embedded newline, lat+lon + a `place` place-name column), `sample.xlsx` (small real xlsx), `sample.geojson` (FeatureCollection), `sample.txt` (plain text)
- [ ] Framework install: none (`bun test` present) — `bun add papaparse exceljs` + `bun add -d @types/papaparse` (blocking-human legitimacy gate, Task 03-01-01)

Test files authored in their own plans (not Wave 0, but listed for the sampling map):

- `src/features/chat/ingest/ingestClient.test.ts` (Plan 02, INGEST-02)
- `src/features/chat/ingest/ingestStore.test.ts` · `parseSummary.test.ts` · `detectCoordinateColumns.test.ts` (Plan 03, INGEST-05/06/D-11)
- `src/features/chat/vision/detectVisionSupport.test.ts` (Plan 04, INGEST-07)
- `src/features/chat/tools/ingest-tools.test.ts` (Plan 05, INGEST-06 — canonical placement+geocode test; supersedes the RESEARCH Wave-0 placeholder `placement.test.ts`)
- `src/features/chat/components/fileAttachHandler.test.ts` · `src/features/chat/ingestSendPath.test.ts` (Plan 06, INGEST-01/04/05/D-11)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Package legitimacy (papaparse/exceljs install; read-excel-file fallback) | INGEST-02/03 | npm install legitimacy gate is mandatory + never auto-approvable | Verify papaparse/exceljs at npmjs.com; confirm NOT installing SheetJS `xlsx`; approve, then `bun add ...` (Tasks 03-01-01, 03-01-03) |
| Attach + drop + per-file parse summary; off-thread no-freeze | INGEST-01/05 | Drag-drop, visual chip language, expandable summary, and no-freeze are interaction/visual properties | `bun dev` → Attach `messy.csv` (chip with rows×cols + coord cols), drop `sample.geojson` (chip with feature count + bbox), attach over-cap file ("too large" copy) — no freeze (Task 03-06-03) |
| Place-on-map flow (ALL rows; place-name geocode) | INGEST-06 | End-to-end AI tool-call + map render needs a live model + map | Ask the AI to place `messy.csv` rows → confirm `place_dataset_features` places ALL rows; place-name-only rows geocode via `batch_geocode` (Task 03-06-03) |
| Three-tier vision gate (enabled / hard-disabled+tooltip / uncertain+opt-in) across both image paths | INGEST-07/D-08/D-09 | Per-model affordance + never-silent-send + `capture_map_snapshot` parity need real model selection | Confirmed-vision → enabled; confirmed-no-vision → hard-disabled+tooltip; uncertain → amber + `Send anyway` opt-in (image not sent unless clicked); confirm snapshot obeys same gate (Task 03-06-03) |

*Automated coverage below UAT: the D-11 send-path invariant (handle+summary, no fullRows) and the vision-gate image inclusion/exclusion logic are unit-tested in `ingestSendPath.test.ts`; the attach order is unit-tested in `fileAttachHandler.test.ts`. The UAT verifies only the genuinely-visual/interactive surface.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the three manual checkpoints — 03-01-01, 03-01-03, 03-06-03 — are legitimate human gates: npm legitimacy + visual/place/vision UAT; their below-UAT logic is covered by `fileAttachHandler.test.ts` + `ingestSendPath.test.ts`)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every wave's implementation tasks carry an automated command)
- [x] Wave 0 covers all MISSING references (parse.test.ts + build-emission gate + fixtures seeded in Plan 03-01)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-17
