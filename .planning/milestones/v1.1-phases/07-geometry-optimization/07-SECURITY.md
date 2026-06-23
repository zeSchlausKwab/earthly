---
phase: 07
slug: geometry-optimization
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-23
---

# Phase 07 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Geometry optimization: AI shrinks oversized GeoJSON toward a byte budget off-thread
> (topology-aware simplify + lossless merge + microgap stitch), applied through the
> Phase-5 safe-editing gate, never auto-published.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| test/fixture → suite | In-repo deterministic fixture (`makeOversizedTrailFixture`); generated at test time only, never at runtime. | Synthetic GeoJSON (no external/user input) |
| model → optimize_geometry | The model supplies ONLY an optional `targetBytes` number — never geometry/ids (D-04). | Untrusted integer (clamped) |
| main thread → worker | Host posts plain GeoJSON + a number via structured-clone (no transferables); the worker is a pure compute step. | Bound FeatureCollection |
| worker → bundle | The optimize worker's import graph must stay secret-free (no Nostr/signer/wallet/createAuthoring). | Code-import edges (A3) |
| oversized dataset → main thread | A hung worker's fallback must NOT relocate an unbounded computation to the main thread (the UAT crash class). | Large FeatureCollection |
| chat tool → editor | All mutation funnels through `gateBulkApply` → `createAuthoring` → `runInterceptors` (the Phase-5 gate). | Geometry mutations (gated) |
| host → publish | Optimization NEVER auto-publishes; publishing stays the explicit `usePublishing` user action. | Published dataset event |
| gate → transcript UI | The metrics headline is a host-built display string from worker-computed numbers, rendered as plain React text. | Display string (no HTML) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-07-01 | Denial of Service | `makeOversizedTrailFixture` size | accept | Bounded by `lineCount`/`pointsPerLine`, deterministic, only just over 1MB; test-time only, never runtime. | closed |
| T-07-02 | Information Disclosure | fixture/test files → worker bundle | mitigate | `*.test.ts`/`fixture.ts` never imported by `optimize.worker.ts` (worker imports `./optimize` + leaf helpers only). | closed |
| T-07-03 | Tampering | new WORKER_ASSETS entry | accept | Additive config entry; served worker source obeys the same leaf-import rule. No mutation surface. | closed |
| T-07-04 | Tampering (XSS) | metrics headline string | accept | Built host-side from numeric report; rendered as plain React children (no `dangerouslySetInnerHTML`). | closed |
| T-07-05 | Information Disclosure | additive diff plumbing | mitigate | `gateBulkEdit`/`pendingDiffStore`/`DatasetDiffDisclosure` are main-thread chat-UI; string field only, no new Nostr/signer edges. | closed |
| T-07-06 | Repudiation | backward-compat regression | mitigate | Additive optional `headline` field; Phase 5/6 callers unchanged; full diff suite stays green. | closed |
| T-07-07 | Denial of Service | binary-search loop / pathological collection | mitigate | `MAX_ITERS≈12` hard cap (D-03); weakly monotonic → terminates; off-thread; RPC timeout always settles. | closed |
| T-07-08 | Information Disclosure | secret leakage into the worker bundle | mitigate | `optimize.ts`/`optimize.worker.ts`/`optimizeClient.ts` import ONLY leaf modules — never the `@/features/geo-editor/api` barrel. **A3 boundary greps print 0** (re-confirmed 2026-06-23). | closed |
| T-07-09 | Tampering | worker error swallowing | mitigate | Worker never throws out of `onmessage` (always posts `{success:false,error}`); client rejects/settles deterministically; honest `reachedBudget:false`. | closed |
| T-07-10 | Denial of Service | byte re-serialization cost per iteration | accept | `TextEncoder` serialization per step bounded by `MAX_ITERS`, runs off-thread; incremental-delta opt held in reserve. | closed |
| T-07-11 | Denial of Service | absurd/NaN `targetBytes` | mitigate | V5: validate finite-positive, clamp/reject absurd, default `BLOSSOM_UPLOAD_THRESHOLD_BYTES`; bounded search caps work. | closed |
| T-07-12 | Tampering | mutation bypassing the safe-editing gate | mitigate | Converged result applies ONLY via `gateBulkApply` → `createAuthoring` (facade) → `runInterceptors`; no-raw-`editor.*` + A3 greps enforce it. One apply = one snapshot = one undo. | closed |
| T-07-13 | Tampering / Repudiation | auto-publish of AI-optimized data | mitigate | NO publish call anywhere in `geometry-tools.ts` (grep-enforced); under-limit feeds the user's explicit `usePublishing`; over-limit → existing `BlossomUploadDialog`. | closed |
| T-07-14 | Information Disclosure | secret reach via the optimize_geometry tool module | mitigate | `geometry-tools.ts` imports `runOptimize`/`gateBulkApply`/`createAuthoring`/`schemaFor` — no signer/wallet/Nostr; `chat/**` boundary scan enforced. | closed |
| T-07-15 | Repudiation | silent over-budget result | mitigate | `report.reachedBudget:false` surfaces in the tool return AND the headline; gate diff shown before apply — no silent truncation. | closed |
| T-07-12 (07-05) | Denial of Service | `optimize.ts` per-iteration `turf.kinks` (O(V²)) | mitigate | Per-iteration topology validation removed from the search; validate-once-at-end + one-step back-off; `highQuality:false` search; `turf.kinks` skipped above `TOPOLOGY_VALIDATION_MAX_VERTICES=5000`. **Re-verified 5/5; perf regression test green** (2026-06-23). | closed |
| T-07-13 (07-05) | Denial of Service | `optimizeClient.ts` timeout `settleViaSync` on main thread | mitigate | Timeout terminates the worker and **size-gates** the fallback (`SYNC_FALLBACK_MAX_BYTES=256KiB`): over-threshold inputs **reject** with a relayable ToolError instead of blocking the main thread. Code-review **WR-01** fix (`c6ff708`) closed the 2nd-call reopening via `settleWithoutWorker()` + `recycleWorker()`. Tests B/C/D + live UAT confirm. | closed |
| T-07-14 (07-05) | Denial of Service | worker timer leak (WR-05) | mitigate | Per-request timer captured + `clearTimeout`'d on settle and in `terminateOptimizeWorker()`; in-flight pendings rejected on teardown (IN-03). | closed |
| T-07-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | No new dependencies in any Phase-7 plan — only `@turf/turf@^7.3.5` (already present/audited) + existing leaf helpers. slopcheck N/A. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*
*Note: 07-05 reused threat IDs T-07-12/13/14 for the crash-fix DoS surface; the second occurrences are disambiguated with the `(07-05)` suffix and kept distinct from the 07-04 entries.*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-07-01 | T-07-01..T-07-15, T-07-12/13/14 (07-05), T-07-SC (all) | Accepted at user direction at the security gate. Each threat carries a plan-time mitigation/acceptance disposition; this audit did not run a dedicated auditor pass. The high-signal boundary/DoS controls are independently corroborated by this milestone's execution + code-review evidence: A3 worker-boundary greps print 0 (T-07-08/14); the optimize crash-fix DoS mitigations (T-07-12/13 (07-05)) were re-verified 5/5 with a perf regression test and a live optimize→publish UAT; the safe-editing gate routing (T-07-12) and the no-auto-publish grep (T-07-13) are enforced by existing tests. | Schlaus Kwab <michail.karassew@gmail.com> | 2026-06-23 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-23 | 19 | 19 | 0 | /gsd-secure-phase (user-directed accept-all; corroborated by execution + 07-05-REVIEW.md code-review evidence) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-23
