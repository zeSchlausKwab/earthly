# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — AI Chat (Data Ingest, Transform & Safe Authoring)

**Shipped:** 2026-06-23
**Phases:** 7 | **Plans:** 33 | **Tasks:** 64

### What Was Built
- Encrypted-to-self settings persistence (provider config + keys) surviving reloads and NIP-46 signers, with an export/import recovery hatch.
- The two load-bearing seams the rest of the milestone routed through: a typed tool registry (unknown tool → hard error) and a single `createAuthoring` map-mutation API.
- Off-thread file ingest (CSV/Excel/JSON/GeoJSON/text/image) with a handle-keyed "model never sees raw rows" privacy seam and a fail-safe vision-capability detection ladder.
- A QuickJS-WASM-in-Worker code interpreter confined to the Authoring API — provably secret-denying, timeout- and output-bounded, self-correcting on error.
- A dataset-aware safe-editing gate (binding chip + add/modify/delete diff + configurable safety levels + snapshot/undo) gating every destructive bulk tool, plus the bulk transform, styling, and geometry-optimization tools that build on it.

### What Worked
- **Dependency-ordered phasing.** Settings first (so later phases never re-entered keys), then the registry + Authoring API seam, then everything else routing through that one choke point. The safe-editing gate (Phase 5) was deliberately sequenced *before* any destructive bulk tool (Phases 6–7), so no transform ever shipped destructive.
- **A single mutation seam paid off repeatedly.** Because every write went through `createAuthoring` + interceptors, the Phase 5 gate had exactly one place to attach, and the A3 boundary scan could mechanically prove the AI/sandbox path can't bypass it.
- **Structural privacy invariants over conventions.** The handle-keyed ingest store and the import-boundary scans made "no raw rows to the model" and "no secrets in the sandbox" testable facts rather than review promises.
- **Growing a real `bun:test` suite from zero** (Phase 1 stood up the first suites; ~538 tests by Phase 6) gave each later phase an objective contract to turn green.

### What Was Inefficient
- **Heavy post-execution UAT churn.** Many fixes landed *after* a phase was nominally complete — vision-gate regressions, output-token caps, run_code return-convention traps, geo-result trimming — as standalone "not a phase plan, no SUMMARY" commits. The plans under-modeled real-model behavior and live-runtime constraints.
- **The sandbox needed three correctness passes.** Confinement (04-01) → wiring (04-02) → then an OOM/CPU runaway (un-memoized wasm recompile per run) and a Phase-7 optimize crash (quadratic `turf.kinks` + an unsafe main-thread timeout fallback). Both were performance/lifecycle failures that unit tests missed and only live use surfaced.
- **Verification vs. live confirmation drift.** Several CODE-* and the Phase 4/6 items reached "implemented + automated-green" but stayed pending live in-browser UAT, leaving debug/verification artifacts open at milestone close.

### Patterns Established
- **One typed registry + one mutation seam** as the architectural spine for all AI tooling; new capabilities register into it rather than adding parallel paths.
- **Gate-before-destructive ordering** as a roadmap rule, not an afterthought.
- **Import-boundary fs-scans as tests** to keep trust boundaries (secrets, store access) statically provable.
- **Pure, DI'd, DOM-free orchestration helpers** (e.g. `composeOutboundContent`, `handleAttachedFile`, `resolveBinding`) so headless `bun:test` can assert invariants without a browser.

### Key Lessons
1. **Model behavior and runtime lifecycle are the real risk, not the algorithm.** Confinement and correctness were proven early; the costly bugs were memory/CPU lifecycle (worker reuse, quadratic validation, unsafe timeout fallback) and prompt/return-convention mismatches. Budget explicit live-runtime spikes per phase, not just unit tests.
2. **"Implemented + automated-green" ≠ "verified."** Carrying live-UAT confirmation as a distinct, tracked state would have closed the debug/verification artifacts before close instead of deferring 4 at the gate.
3. **A single choke-point seam compounds.** The Authoring API made the safety gate, the boundary proofs, and the sandbox replay all cheap. Worth paying the upfront refactor cost (Phase 2) before piling features on.

### Cost Observations
- Model mix: not instrumented this milestone (config `model_profile: quality`).
- Notable: a large share of total effort went to post-phase UAT fixes and two debug sessions rather than to first-pass plan execution — a signal to front-load live-runtime validation.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.1 | 7 | 33 | First GSD-framework milestone for Earthly; stood up the repo's first test suite; established the registry + Authoring API spine and gate-before-destructive ordering |

### Cumulative Quality

| Milestone | Tests | Zero-Dep Additions |
|-----------|-------|--------------------|
| v1.1 | ~538 bun:test (from 0) | Several focused fixes shipped with no new packages (e.g. conversation-dump, output-budget, vision gate); new deps were deliberate (papaparse, exceljs, quickjs-emscripten, turf) |

### Top Lessons (Verified Across Milestones)

1. *(first milestone — trends accrue as later milestones validate these.)* Runtime/lifecycle behavior is a higher risk than algorithmic correctness for sandboxed/off-thread work.
