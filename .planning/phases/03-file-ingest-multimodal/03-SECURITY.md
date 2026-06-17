---
phase: 03
slug: file-ingest-multimodal
status: secured
threats_open: 0
threats_total: 23
threats_closed: 22
threats_accepted: 1
asvs_level: 2
block_on: high
created: 2026-06-17
---

# SECURITY.md — Phase 03: File Ingest & Multimodal

**Audited:** 2026-06-17
**Auditor:** gsd-security-auditor (adversarial / FORCE stance)
**ASVS Level:** L2
**Block-on:** high
**Register:** authored at plan time (`register_authored_at_plan_time: true`) → each declared mitigation verified present in the **current source**, not accepted on documentation/intent.
**Verdict:** SECURED — 22/22 threats closed; `threats_open: 0`.

This phase had no prior SECURITY.md (State B); this file is created by the audit verdict.

---

## Scope of verification

Every threat in the Phase 03 register (T-03-01 … T-03-22, plus T-03-SC) was verified by
reading the cited implementation file and locating the actual mitigation call/branch — not by
trusting SUMMARY/VERIFICATION prose. Three plan-time `mitigate` dispositions had been found
broken by code review and re-fixed (CR-01/02/03); all three fixes were re-confirmed against the
current source and their invariant tests re-run (37 pass / 0 fail).

No `## Threat Flags` section appears in any of the six Phase 03 SUMMARY files → the executor
registered **no new attack surface** during implementation. No unregistered flags.

---

## Threat verification table

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-03-01 | DoS | mitigate | CLOSED | `ingest.worker.ts:20-61` — every kind branch inside `try/catch`; on error posts `{success:false,error}`, never throws out of the handler. |
| T-03-02 | Tampering (supply chain) | mitigate | CLOSED | `package.json:82,89` — `exceljs ^4.4.0` + `papaparse ^5.5.3` (RESEARCH-audited); no `"xlsx"`/SheetJS dep; no `postinstall`/`preinstall` scripts. |
| T-03-SC | Tampering (installs) | mitigate | CLOSED | `package.json` — no `read-excel-file` (gated SUS lib never pulled); no install lifecycle scripts. |
| T-03-03 | DoS | mitigate | CLOSED | `ingestClient.ts:189-195` — 30s `setTimeout` → `parseSync` fallback; promise always settles. |
| T-03-04 | DoS | mitigate | CLOSED | `ingestClient.ts:129-139` `onerror` sync-fallbacks all pending + latches `workerBroken=true` + terminates; `:165-167` skips worker thereafter. Build-emission gate: `test/build-emits-ingest-worker.test.ts` actually `Bun.build`s the worker for `target:'browser'` and asserts success + ExcelJS/PapaParse present. |
| T-03-05 | DoS | mitigate | CLOSED | `ingestClient.ts:182-183` — xlsx posted as transferable: `w.postMessage(request, [payload.buffer])`. |
| T-03-06 | Information Disclosure | mitigate | CLOSED **(re-fix held)** | `ingestStore.ts:69-75` `toModelSummary` returns `{handleId,summary}` only; `fullRows` reachable solely via `getDataset` (`:55-57`). CR-01 fix in `parseSummary.ts:143-209` `deriveSampleRows` branches by kind — geojson → ≤5 `{geometryType,properties}` (no coords), json → shape/keys preview, text → first/last lines; full payload never copied into the summary. |
| T-03-07 | DoS | mitigate | CLOSED **(re-fix held)** | CR-02 fix `fileSizeGuards.ts:47-50` — `const size = Number.isFinite(raw) && raw >= 0 ? raw : Number.POSITIVE_INFINITY` then `if (size > cap)` → fail-closed on NaN/Infinity/negative. Called pre-parse via `handleAttachedFile`. Session-only store (`ingestStore.ts`, in-memory Map, no storage backend). |
| T-03-08 | Tampering/Spoofing (prompt injection) | **accept** | CLOSED | Rationale documented (Plan 03 `<threat_model>` + accepted-risks log below): samples shown to model by design; framing mitigation carried into T-03-17; no privileged action keyed off cell text. ASVS-L1 residual risk accepted. |
| T-03-09 | Information Disclosure | mitigate | CLOSED | `parseSummary.ts:27,219-220,235` — `MAX_SUMMARY_COLS=30`; schema sliced, `moreColumns` remainder surfaced. |
| T-03-10 | Information Disclosure/Spoofing | mitigate | CLOSED | `store.ts:1279-1281` `canUseVision = visionSupport === 'vision' && …`; snapshot `image_url` injected only `if (canUseVision && …capture_map_snapshot)` (`:1507-1528`). Fail-safe ladder defaults to `'no-vision'`. |
| T-03-11 | SSRF | mitigate | CLOSED | `detectVisionSupport.ts:91` `${ollamaBase}/api/show`, `:115` `${provider.baseUrl}/models` — target derived only from `provider.baseUrl` + fixed path, never file content/model output. |
| T-03-12 | DoS | mitigate | CLOSED | `detectVisionSupport.ts:54-56,138-139,153` — `visionCache` keyed `(type|baseUrl|modelId)`, checked before any fetch. |
| T-03-13 | DoS | mitigate | CLOSED | `detectVisionSupport.ts:148-151` `catch → nameHeuristic` (never throws); tier fns return `undefined` on `!res.ok`. |
| T-03-14 | Tampering (out-of-range coords) | mitigate | CLOSED **(re-fix held)** | CR-03 fix `ingest-tools.ts:96-111` recursive `geometryCoordsInRange` (validates every `[lon,lat]` via `isValidLngLat`, handles GeometryCollection, fails closed on non-numeric). Applied on WKT branch `:257` and geometry-cell branch `:269` (both `geom && geometryCoordsInRange(geom)` before push, else `skippedInvalid++`). Explicit lat/lon branch validates at `:238`; geocoded coords validated in `firstCoordinate` `:322`. |
| T-03-15 | DoS/rate-policy | mitigate | CLOSED | `ingest-tools.ts:35,335` cap `BATCH_GEOCODE_MAX_ROWS=50`; `:37,355` `await delay(minInterval)` (~1 req/s); `:343-350` de-dupe `seen` Set; in-call `coordsByName` cache. |
| T-03-16 | SSRF | mitigate | CLOSED | `ingest-tools.ts:32,444` `batch_geocode` is `kind:'remote-mcp', origin: REMOTE_MCP_ORIGIN` (= `EarthlyGeoServerClient.SERVER_PUBKEY`); geocoding via `client.SearchLocation` (fixed MCP origin) — no file-derived URL constructed. |
| T-03-17 | Tampering/Spoofing (prompt injection) | mitigate | CLOSED | `schemas.ts` place/geocode descriptions frame data as a column-mapping over rows; placement handler (`ingest-tools.ts:387-438`) keys no privileged action off cell text — only geometry parse + range-validate + editor write; returns counts only. |
| T-03-18 | Information Disclosure | mitigate | CLOSED | Placement returns counts only (`ingest-tools.ts:430-437`). Prompt-path compaction guard `helpers.ts:1287-1294` `compactIngestHandleResult` strips to `{ingestHandle,ingestSummary}`, dropping `fullRows`. |
| T-03-19 | DoS | mitigate | CLOSED **(re-fix held)** | `fileAttachHandler.ts:166-169` — `assertFileWithinCaps` runs FIRST; over-cap → `{status:'rejected'}` with "too large" copy before any parse/store; off-thread parse follows. Shares the CR-02-fixed guard. |
| T-03-20 | Information Disclosure (UI gate) | mitigate | CLOSED | `VisionGateControl.tsx` — `'no-vision'` hard-disabled (`aria-disabled`+Tooltip), `'uncertain'` amber opt-in Button. Send path `composeOutboundContent.ts:37-41,70` `canSendImage` excludes `image_url` for `'no-vision'`/un-opted `'uncertain'`. |
| T-03-21 | Information Disclosure (UI send) | mitigate | CLOSED **(re-fix held)** | `composeOutboundContent.ts:59-65` composes a text part of `{ingestHandle, ingestSummary}` only — never `fullRows`. Backed by CR-01 bounded summary. |
| T-03-22 | Tampering (third-party UI registry) | mitigate | CLOSED | No `@mapcn`/`mapcn` dependency in `package.json`; only vendored `src/components/ui/*` consumed (e.g. `VisionGateControl.tsx:2-3`). Vetting gate not triggered, as planned. |

**Closed: 22/22. Open: 0.**

---

## Re-fixed-threat confirmation (skeptical re-check of CR-01/02/03)

The three commits were verified against current source AND their invariant tests re-run:

- **CR-01 / `6df7433`** (T-03-06, T-03-21): `deriveSampleRows` bounds geojson/json/text previews;
  the model path (`toModelSummary`, `composeOutboundContent`, `compactIngestHandleResult`) never
  carries full payloads. Full data stays host-side in `fullRows` for placement only. **Holds.**
- **CR-02 / `fb85d7f`** (T-03-07, T-03-19): `assertFileWithinCaps` normalizes non-finite/negative
  size to `+Infinity` and rejects — no longer routes through the `clampPositiveInt` fallback-to-0
  inversion. **Holds.**
- **CR-03 / `0994acc`** (T-03-14): both the WKT and geometry-cell placement branches now call
  `geometryCoordsInRange` before writing; out-of-range is skipped and counted. **Holds.**

Invariant test run (2026-06-17): `parseSummary.test.ts` + `fileSizeGuards`(via
`detectCoordinateColumns.test.ts`) + `ingest-tools.test.ts` + `ingestSendPath.test.ts` →
**37 pass / 0 fail**.

---

## Accepted risks log

| ID | Category | Decision | Rationale |
|----|----------|----------|-----------|
| T-03-08 | Tampering/Spoofing — CSV cell prompt-injection via sampled rows | **Accepted** (ASVS L2 context, originally dispositioned at L1) | Sampled rows are intentionally shown to the model (column-mapping inference needs first/last/middle rows). Mitigation is framing, not exclusion: the placement/tool-result message frames samples as DATA, not instructions (T-03-17, verified in `schemas.ts` descriptions + `ingest-tools.ts` handler), and **no privileged action is keyed off cell text** (placement only parses geometry, range-validates, and writes through the Authoring API). Residual risk is low-value and bounded; accepted with framing as the compensating control. |

---

## Unregistered flags

None. No `## Threat Flags` section is present in any Phase 03 SUMMARY (01–06); no new attack
surface was registered during implementation, and none was discovered during this audit within
the declared register's scope.

---

## Out-of-scope tracked debt (not register threats — informational)

These are code-review Warnings/Info already tracked in `03-REVIEW.md`. They are **not** declared
threats in the register and do **not** change any disposition above, but are noted so the
accepted residual posture is explicit:

- **WR-02** — `evictDataset` has no production caller → the session-only store grows unbounded
  until reload. T-03-07's primary control (pre-parse size cap) holds; the *lifetime* sub-claim
  ("session-only bounds the in-memory file") is weakened by missing eviction. Defense-in-depth
  gap, not a register-threat regression.
- **WR-01** — xlsx timeout/`onerror` sync-fallback re-parses a transferred (detached) ArrayBuffer,
  so the large-xlsx fallback can return empty/error rather than correct data. Affects correctness
  of the T-03-05 fallback under the rare timeout path, not a confidentiality/integrity threat.
- **WR-03** — `batch_geocode` and `place_dataset_features` geocode share no cross-call throttle;
  the ~1 req/s policy (T-03-15) holds within a call but can be exceeded across back-to-back calls.
- **WR-05/WR-06**, **IN-01..05** — provider-key exposure on a user-controlled custom `baseUrl`
  (pre-existing trust model), name-heuristic over-matching (only drives opt-in UI, never a silent
  send), and minor parse/inference refinements. None open a register threat.

Recommend folding WR-02 (eviction) and WR-01 (detached-buffer fallback) into the next
gap-closure pass; neither blocks this phase under `block_on: high`.

---

_Generated by gsd-security-auditor. Implementation files were not modified._
