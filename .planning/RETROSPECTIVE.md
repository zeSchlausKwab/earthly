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

## Milestone: v1.2 — Geo Entity Model Split

**Shipped:** 2026-07-03
**Phases:** 6 (8–13) | **Plans:** 31

### What Was Built
Split the overloaded kind-37518 "context" into four role-specific entity kinds — Story/Article (37520), slimmed Group/Topic (37518), Live Beacon (37521), Temporal Sighting (37522) — each a first-class create/edit/comment/react/attach/route/share entity over one shared Phase-8 foundation (`tags.ts`, `modelVersion` clean break, off-thread schema worker, NIP-40 filter, NIP-32 taxonomy). Comment/route/share/Map-Stack parity across all kinds; NO-MOD MINIMUM + schema DoS guard + beacon privacy invariant.

### What Worked
- **Foundation-first sequencing.** Building all six shared seams in Phase 8 (with a RED Nyquist baseline pinning exact export names) before any entity phase meant Groups/Story/Sighting/Beacon each delegated instead of copy-pasting — the milestone audit confirmed zero re-inlining and an un-bypassed schema DoS guard.
- **Adversarial review caught real privacy criticals.** Phase 12 code review found 2 GPS-leak bugs; the milestone integration checker independently re-confirmed the Map-Stack aggregate-seeds-discovery-only invariant holds structurally.
- **Clean-break discriminator (`modelVersion='earthly/2'`).** `is<Kind>` filters drop legacy 37518 before cast; a test proving cast-without-filter throws keeps the filter load-bearing, not decorative.

### What Was Inefficient
- **Automated verification ≠ done for UI phases.** Phase 13's verifier passed 3/3 with zero human items and auto-closed the phase — then `/gsd-verify-work` UAT found 5 real issues. A UI phase's real gate is the human UAT; the automated pass was a false "complete."
- **Stale HMR runtime masqueraded as code bugs.** 3 of the 5 Phase-13 UAT gaps were a `bun --hot` server serving a pre-change bundle (structural edits bail fast-refresh) — diagnosed correctly as not-a-code-defect, closed by a restart checkpoint. Costs a UAT cycle each time.
- **Bespoke share-URL builder bypassed the canonical pipeline.** The beacon Copy-share-link hand-built a doubled-prefix legacy URL (WR-01, deferred and never fixed) — invisible until UAT because every other kind used the shared `getEntitySharePath`. Second cause (AppSidebar `viewBeacon` omission) was hidden behind the first until the URL was fixed.
- **Stale tracking status.** Phase 9 was fully verified+secured on Jun 26 but its VERIFICATION.md sat at `human_needed`, nearly blocking the milestone close over already-done work.

### Patterns Established
- **Kind-generic seams pay off but must be exhaustive.** `SHARE_ROUTES`, `useGeoComments` unions, `deriveVisibleEntitiesFromStack`, AppSidebar subject-gating — each collapsed N per-kind branches into one, but the *last* kind wired (beacon) got missed in two subject-gating sites. Lesson: when adding the Nth kind to a generic seam, grep every switch/union/effect that enumerates kinds.
- **Prefix strings must agree across emit + parse.** `getEntitySharePath` prefix ↔ `SHARE_ROUTES` key is a recurring fragility class worth a co-location test.

### Key Lessons
- For a UI-heavy phase, gate the phase on human UAT, not just the automated verifier.
- A long-lived `bun --hot` dev server silently diverges after structural edits — restart before UAT, or diagnose "missing UI" as stale-runtime first.
- When generalizing per-kind code, the newest kind is the one most likely to be omitted from a sibling site.

### Cost Observations
- Model mix: executors + integration/verification on opus; integration-checker on sonnet.
- Zero new runtime dependencies across all 6 phases (the whole split rode existing applesauce + turf).

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.1 | 7 | 33 | First GSD-framework milestone for Earthly; stood up the repo's first test suite; established the registry + Authoring API spine and gate-before-destructive ordering |
| v1.2 | 6 | 31 | Foundation-first entity split; RED Nyquist baselines pinning shared-seam exports before entity phases; milestone audit (integration checker) added as an explicit pre-close gate; gap-closure via `--gaps-only` after UAT |

### Cumulative Quality

| Milestone | Tests | Zero-Dep Additions |
|-----------|-------|--------------------|
| v1.1 | ~538 bun:test (from 0) | Several focused fixes shipped with no new packages (e.g. conversation-dump, output-budget, vision gate); new deps were deliberate (papaparse, exceljs, quickjs-emscripten, turf) |
| v1.2 | ~778 bun:test (+~240) | **Zero new dependencies** — the entire 4-kind entity split rode existing applesauce + turf |

### Top Lessons (Verified Across Milestones)

1. **Runtime/lifecycle behavior is a higher risk than algorithmic correctness.** v1.1: sandbox/off-thread lifecycle bugs. v1.2: stale-HMR-runtime masqueraded as 3 UAT "bugs"; the real Phase-13 defects were state/effect wiring (AppSidebar subject-gating, own-beacon auto-add), not algorithms. **Verified across v1.1 + v1.2.**
2. **For UI-heavy phases, human UAT is the real gate — not the automated verifier.** v1.2 Phase 13 auto-closed on a 3/3 verifier pass with zero human items, then UAT found 5 real issues.
3. **When generalizing per-kind/per-case code, the newest case is the one omitted from a sibling site.** v1.2: beacon (last kind wired) was missing from two AppSidebar subject-gating sites that already handled the other four kinds.
