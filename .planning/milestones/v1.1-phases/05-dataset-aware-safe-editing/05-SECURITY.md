---
phase: 05
slug: dataset-aware-safe-editing
status: verified
threats_found: 24
threats_closed: 24
threats_open: 0
asvs_level: 2
created: 2026-06-21
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> AI-write trust boundary: a host-side confirm gate buffers AI map mutations,
> classifies add/modify/delete, snapshots for undo, gates by a persisted safety
> level (1/2/3), and renders an Apply/Cancel diff. Core property: AI/sandbox code
> cannot mutate the map without routing through the Authoring facade
> (`runInterceptors`); every apply is visible + reversible.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| AI/sandbox/UI → Authoring facade | Single geometry-mutation intercept point; the new modify/delete verbs widen it but keep validation + intercept | EditorFeature geometry/properties |
| `api/` module graph → rest of app | `api/` stays free of chat/Nostr/registry imports so it remains the confinable Phase-4 sandbox boundary | Type/code imports only |
| Untrusted sandbox code → worker recorded-call channel | Sandbox JS calls `authoring.*` arbitrarily; the worker records each call (uncapped = write-path DoS) | Recorded op + serialized args |
| Worker → host synchronous replay | Host replays recorded calls synchronously on the main thread; unbounded batch freezes the app | RecordedCall[] |
| Decrypted settings envelope → in-memory store | A tampered/garbage envelope must not crash the load or inject an out-of-range `safetyLevel` | safetyLevel int + provider config |
| AI proposal → visible diff → user decision | Chip always shown; diff always rendered before (or, at L3, alongside) apply — user awareness is the security property | DatasetDiff |
| "Just accept" toggle → persisted safety level | Flipping to Level 3 weakens gating; the change must be visible and not silently downgrade | safetyLevel int |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-05-01 | Tampering / EoP | `editor.update/deleteFeatures` bypass outside `api/` | mitigate | A3 scan covers all four write verbs across chat/** + **/sandbox/**, zero offenders asserted | `boundary.test.ts:80,130-153` | closed |
| T-05-02 | Tampering (silent mis-write) | `modifyFeature` non-geometry input | mitigate | `coerceToFeature` → loud `throw` (not silent updated:0) | `authoring.ts:435-440` | closed |
| T-05-03 | DoS (crash) | modify/delete with unknown ids | mitigate | Unknown id → quiet `{ok:false}`; delete filters to present ids | `authoring.ts:429-431,456` | closed |
| T-05-04 | Info Disclosure | api/ leaking signer/wallet/store via new methods | mitigate | Surface assertion lists 9 geometry/meta keys; `forbidden` list (signer/wallet/store/getState/editor/eventStore/accounts) asserted absent; import scan covers diff.ts | `boundary.test.ts:188-204` | closed |
| T-05-05 | Tampering | interceptor made async → breaks sync MutationResult | accept | Interceptor stays synchronous (classification-only); `classifyIntentInterceptor` returns `{intent}`, `runInterceptors` returns `InterceptorContext` not Promise | `interceptor.ts:53,60-72` | closed (accepted) |
| T-05-06 | DoS | `recordedCalls` recording loop in worker | mitigate | `MAX_RECORDED_CALLS=2000` + `MAX_RECORDED_ARG_BYTES=4MiB`; stops appending + latches `recordedCallsOverBudget` | `sandbox.worker.ts:135-136,205-216` | closed |
| T-05-07 | DoS (memory) | `DatasetSnapshotManager` stack | mitigate | Depth bounded (default 20, shift-on-overflow); shallow `{...f}` copy, no deep coordinate clone | `DatasetSnapshotManager.ts:53-54,74-89` | closed |
| T-05-08 | Tampering (partial apply) | host replay of over-budget batch | mitigate | Whole batch rejected BEFORE the replay loop; throws model-facing ToolError, no partial write | `runCode.ts:273-280` (precedes loop at :294) | closed |
| T-05-09 | Tampering / Repudiation | AI dataset edit not reversible (incl. metadata) | mitigate | Snapshot captures features + collectionMeta; undo restores both as one step (LIFO) | `DatasetSnapshotManager.ts:74-89`, `GeoEditor.ts:1567-1572` | closed (see WR-04) |
| T-05-10 | EoP | new verbs reaching sandbox replay surface | accept | modify/delete NOT in `AUTHORING_METHODS`/`REPLAYABLE_AUTHORING_OPS`; host-tool-only this phase | `runCode.ts:92` (4-op allow-list) | closed (accepted) |
| T-05-11 | Tampering | tampered envelope sets out-of-range `safetyLevel` | mitigate | `normalizeSafetyLevel` membership-checks → falls back to 2 on any invalid value | `settingsStorage.ts:53-55,95` | closed |
| T-05-12 | DoS (data-loss appearance) | garbage envelope throws during migrate | mitigate | `migrateV1ToV2` never throws on garbage; all three branches carry `safetyLevel` | `settingsStorage.ts:70-131` | closed |
| T-05-13 | Info Disclosure | safetyLevel persistence leaking secrets | accept | Non-secret int on the same encrypt-to-self envelope; secret-exclusion partialize unchanged (apiKey handled separately) | `settingsExport.ts:21,91` | closed (accepted) |
| T-05-14 | Tampering / Repudiation | gate firing on an unbound target | mitigate | `resolveBinding` always yields a shown target or `needsAutoCreate:true` — never refuses | `binding.ts:42-62` | closed |
| T-05-15 | Tampering / Repudiation | destructive AI edit applied without user awareness | mitigate | Gate buffers modify/delete under L1-2 + awaits Apply/Cancel; even L3 snapshots + emits diff | `AuthoringGate.ts:120-178` | closed |
| T-05-16 | Tampering (partial apply) | "fix all" skipping out-of-context features | mitigate | `runFixAllRule` iterates `editor.getAllFeatures()`; takes predicate/transform, NOT a features array | `fixAll.ts:59-83` | closed |
| T-05-17 | EoP | gate bypassing the interceptor on apply | mitigate | Apply routes through `createAuthoring`/facade verbs → `runInterceptors`; gate never calls `editor.*` mutators | `AuthoringGate.ts:131-142,177` | closed |
| T-05-18 | Tampering | Cancel leaving partial state | mitigate | Dry-run runs against the current set via pure `computeProposed`; Cancel returns with zero editor mutation | `AuthoringGate.ts:148-152,172-175` | closed |
| T-05-19 | Repudiation | an apply that cannot be undone | mitigate | `pushDatasetSnapshot(label)` before every apply (one per unit) → SAFE-06 undo | `AuthoringGate.ts:139-141`, `gateRunCode.ts:68` | closed (see WR-04) |
| T-05-20 | Tampering / Repudiation | destructive AI edit applied without user awareness | mitigate | BindingChip never returns null (mounted ChatPanel:643); `DatasetDiffDisclosure` always pushed via `emitDiffBlock`, rendered by PendingDiffList (ChatPanel:802); L3 renders with status applied | `BindingChip.tsx:43-93`, `pendingDiffStore.ts:83-88`, `PendingDiffList.tsx:42-47` | closed |
| T-05-21 | EoP | "Just accept" silently downgrading safety | mitigate | Toggle in visible header (not settings); `autoAcceptOn = safetyLevel === 3` reads persisted level directly; tooltip states diff+undo retained; no hidden L3 state | `BindingChip.tsx:50,74-91` | closed (see WR-02) |
| T-05-22 | EoP | gate/bridge bypassing interceptor on apply | mitigate | No direct `editor.*` write added on the apply path; A3 boundary test still passes; apply via `createAuthoring`/import/run_code replay | `gateEditorImport.ts:100-103`, `gateRunCode.ts:71`, `boundary.test.ts:130-153` | closed |
| T-05-23 | Tampering (double/forged apply) | pending-diff resolver settled twice / out of band | mitigate | `resolvePendingDiff` flips status then no-ops on an already-resolved/unknown entry (idempotent) | `pendingDiffStore.ts:125-139` | closed |
| T-05-24 | Tampering (Cancel partial state) | Cancel after diff renders | mitigate | AuthoringGate Cancel = zero mutation (dry-run clone); run_code Cancel rolls back via `undoLastDatasetSnapshot()` | `AuthoringGate.ts:172-175`, `gateRunCode.ts:92-95` | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-05-01 | T-05-05 | Interceptor stays synchronous (classification only); the async confirm gate lives one layer up at the chat layer. Making the facade async would ripple through run_code sync replay, primitives, MutationResult, and the A3 test. `runInterceptors` returns `InterceptorContext` (not a Promise). | gsd-security-auditor | 2026-06-21 |
| AR-05-02 | T-05-10 | Per decision A5, `modifyFeature`/`deleteFeatures` are NOT added to the sandbox `AUTHORING_METHODS`/`REPLAYABLE_AUTHORING_OPS` allow-list this phase — they are host-tool-only. The CR-01 4-op replay allow-list invariant is unchanged, so the sandbox cannot reach the new destructive verbs. | gsd-security-auditor | 2026-06-21 |
| AR-05-03 | T-05-13 | `safetyLevel` is a non-secret integer riding the existing encrypt-to-self settings envelope. No secret (apiKey) is added to the persisted shape; the Phase-1 secret-exclusion partialize is unchanged. | gsd-security-auditor | 2026-06-21 |

---

## Residual Warnings (code review — non-blocking under `block_on: high`)

These are open advisory WARNINGS from `05-REVIEW.md`. None negates a declared
mitigation's presence in code; each is recorded so it does not silently regress.
Per the audit charge, WR-02 was assessed against T-05-21 and WR-04 against
T-05-09/T-05-19 — neither materially undermines the declared mitigation:

| Ref | Affects | Assessment | Disposition |
|-----|---------|------------|-------------|
| WR-02 | T-05-21 | The toggle OFF path hard-codes Level 2, so a Level-1 user toggling on→off is silently downgraded 1→2, and L1/L2 render identically (both OFF). HOWEVER T-05-21's declared property — "toggle position always reflects `safetyLevel === 3`, no hidden Level-3 state" — is literally true in code (`BindingChip.tsx:50,82`). The threat is *toward* Level 3 (the privilege-relaxing direction), which is faithfully shown. WR-02 is the inverse (1→2) visibility gap, a UX correctness defect, not an absence of the T-05-21 mitigation. **T-05-21 stays CLOSED.** | advisory — fix recommended (preserve prior non-3 level, surface L1 distinctly) |
| WR-04 | T-05-09, T-05-19 | A single LIFO snapshot stack + a blind `undoLastDatasetSnapshot()` (PendingDiffList.tsx:35; gateRunCode.ts:94) can target the WRONG apply when multiple applied diff blocks coexist or two batches resolve out of order. WITHIN one model turn applies are serialized (`store.ts:1725-1727` `for…await`), so the common path is safe. The reversibility *mechanism* (snapshot-before-apply, restore-on-undo) is present and correct for every apply; WR-04 is an undo-*targeting* bug, not an *un*-reversibility — an apply is never left without a snapshot. T-05-09/T-05-19's declared property ("every apply is snapshotted / reversible") holds. **T-05-09 and T-05-19 stay CLOSED.** | advisory — fix recommended (per-apply snapshot handle, or serialize/queue pending applies) |
| WR-01 | T-05-07 (adjacent) | `pendingDiffs` Map is never pruned in production — unbounded growth class. This is the *pending-diff store*, distinct from the bounded `DatasetSnapshotManager` (T-05-07, which IS bounded and verified). Not a declared-threat regression. | advisory — bound/evict on chat lifecycle |
| WR-03 | T-05-18/T-05-24 (run_code path) | `gateRunCodeBatch` applies to the LIVE editor before confirm and rolls back on Cancel (snapshot+restore), unlike AuthoringGate's clone dry-run. Net mutation on Cancel is still zero (T-05-24 mitigation present), but a visible un-confirmed window exists at Level 1. The declared T-05-24 mitigation ("Cancel → zero net editor mutation") holds via the documented snapshot-restore divergence (`gateRunCode.ts:14-17,92-95`). | advisory — buffer run_code like AuthoringGate, or guard interleaving |
| WR-05 | T-05-23 (adjacent) | `requestConfirm(id)` overwrites a prior resolver if called twice for the same id (leaked promise → hung await). The idempotent `resolvePendingDiff` (T-05-23) is present; this is a distinct double-`requestConfirm` edge. | advisory — guard one-awaiter-per-id |
| WR-07 | T-05-06 byte cap | `serializedByteLength` undercounts cyclic args (`String(value)` fallback ≈ 15 bytes), weakening the byte cap; the `MAX_RECORDED_CALLS` count cap still applies. T-05-06's declared mitigation (count + byte caps + over-budget latch) is present; the byte cap is bypassable for the narrow cyclic-arg case. | advisory — charge a conservative LARGE cost / reject non-serializable args |

*CR-01 (the `useSyncExternalStore` cached-snapshot BLOCKER) was FIXED — `getAllPendingDiffs` returns a cached reference invalidated in `notify()` (`pendingDiffStore.ts:64,72-76,100-103`). Verified.*

---

## Unregistered Flags

No SUMMARY.md `## Threat Flags` section presented new attack surface outside the
24-threat register. All new safe-editing surface (gate, diff classifier, snapshot
stack, pending-diff bridge, gate-wiring helpers, WR-04 caps) maps to declared
threats T-05-01..T-05-24.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-21 | 24 | 24 | 0 | gsd-security-auditor |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (T-05-05, T-05-10, T-05-13)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-21
