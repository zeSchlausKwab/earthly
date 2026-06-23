---
phase: 02
slug: tool-registry-authoring-api
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-16
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> **Closure basis (read first):** All threats below are closed by **documented acceptance**
> of the plan-time mitigations, at the user's direction — NOT by a separate
> `gsd-security-auditor` code-verification pass. Each mitigation is real and maps to a
> control in the implementation plus a test in the green suite (112/0 at close), cited in
> the Mitigation column. Two caveats are called out explicitly: **T-02-07** (the anti-bypass
> control covers only the create seam; modify/delete are deferred — INFRA-02 Partial) and the
> **supply-chain** accept. Re-run `/gsd-secure-phase 02` to upgrade any row to auditor-verified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| consumer (chat/UI/sandbox) → Authoring API | The facade is the privilege boundary the Phase 4 sandbox will be confined to. | LLM/sandbox-supplied geometry payloads |
| Authoring API → GeoEditor | Internal; the facade is the sole caller of editor mutations for the **create** seam after this phase. | normalized features |
| model (LLM) → registry.dispatch | Single dispatch chokepoint for every chat tool. | untrusted tool name + raw JSON args |
| remote-mcp handler → ContextVM / Nostr | Remote tool calls leave the host; failures must be attributable. | tool args out, results/errors in |
| live MCP server → registry (via listTools) | The server's tool manifest (remote, semi-trusted) is polled and registered locally. | remote tool schemas/names |
| registry result/error → chat UI | Serialized tool output/error rendered to the user. | tool results, structured ToolError |
| GeoEditor events → store mirror | One-way read-mirror; the store can no longer feed writes back into the editor (loop guarded). | feature snapshots |
| test → GeoEditor | Test harness constructs the editor with a fabricated map; internal-only, no untrusted input. | mock map surface |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (control + backing test) | Status |
|-----------|----------|-----------|-------------|-------------------------------------|--------|
| T-02-01 | Tampering | mock map weakening GeoEditor types | mitigate | Mock cast to `MapLibreMap` at the harness boundary only; `GeoEditor.map` type unchanged (`core/test-harness.ts`; smoke test) | closed |
| T-02-02 | Tampering | test harness leaking into production bundle | mitigate | Boundary grep asserts no production module imports `test-harness.ts` (`boundary`/harness test) | closed |
| T-02-03 | Elevation of Privilege ⚠HIGH | `api/` surface leaking editor internals (future sandbox escape) | mitigate | `api/boundary.test.ts`: no chat/Nostr/NDK/applesauce/MCP imports in `api/`; geometry-only surface — no signer/wallet/store/getState re-export | closed |
| T-02-04 | Tampering | normalization/dedup drift breaks behavior parity | mitigate | `toEditorFeature` + dedup-by-id reused verbatim; `api/authoring.test.ts` asserts id/importSource/skippedDuplicates parity | closed |
| T-02-05 | Denial of Service | malformed/oversized GeoJSON arg into the facade | mitigate | Null/undefined-feature guard returns `{ok:false}`; `MAX_GEOJSON_TEXT_CHARS` cap + numeric clamps enforced at the dispatch boundary (T-02-11) | closed |
| T-02-06 | Tampering ⚠HIGH | reroute behavior drift breaks the binding golden gate | mitigate | `api/authoring.golden.test.ts`: OLD `importFeaturesToEditor` vs NEW `authoring.writeGeoJSON` deep-equality (green) | closed |
| T-02-07 | Elevation of Privilege ⚠HIGH | a missed direct write site bypasses the Authoring seam | mitigate | A3 grep in `api/boundary.test.ts`: zero `editor.addFeature` outside `api/`+GeoEditor core. **CAVEAT: covers the CREATE seam only.** `editor.updateFeature`/`deleteFeatures` (~12 sites) are NOT yet routed through the facade (INFRA-02 Partial; deferred to a facade-expansion plan before Phase 5). See [[02-VERIFICATION.md]] Deferred Items. | closed (partial) |
| T-02-08 | Denial of Service | oversized GeoJSON from LLM via the chat write path | mitigate | Existing `MAX_GEOJSON_TEXT_CHARS` cap preserved at the dispatch boundary (`helpers.ts`); not regressed during reroute | closed |
| T-02-09 | Denial of Service | store↔editor reverse-sync feedback loop (render churn / dup history) | mitigate | `suppressReverseSyncRef` guard on the reverse effect; `api/mirror.test.ts` asserts no duplicate `create` events | closed |
| T-02-10 | Tampering / Repudiation ⚠HIGH | LLM emits unknown/garbage tool name → silent no-op masks failure | mitigate | `registry.dispatch` returns `ToolError(unknown_tool)` fed to the model loop AND rendered distinctly in chat (`registry.ts`, `ChatPanel.tsx`); `registry.test.ts` | closed |
| T-02-11 | Denial of Service ⚠HIGH | malformed/oversized LLM JSON args (huge coordinate arrays, truncated JSON) | mitigate | Reused `parseToolCallArguments` (truncation repair) + numeric clamps + `MAX_GEOJSON_TEXT_CHARS` at the dispatch input boundary; no zod in the hot path | closed |
| T-02-12 | Repudiation | remote-mcp handler failure not attributable | mitigate | `ToolError.origin = SERVER_PUBKEY` on remote-mcp handler errors; `errors.test.ts` | closed |
| T-02-13 | Spoofing | a tool with no `kind` masquerades / chat loses tool-nature awareness | mitigate | `kind` is a required `ToolEntry` field (compile error if omitted); every entry tagged per the kind map | closed |
| T-02-14 | Denial of Service ⚠HIGH | unbounded/NaN/Infinity radius → turf generates huge geometry / freezes main thread | mitigate | `makeCircle`/`makeBuffer` reject NaN/Infinity/negative/zero and cap at Earth-circumference before turf; `api/primitives.test.ts` | closed |
| T-02-15 | Tampering | turf `buffer` returns `undefined` for degenerate input → unhandled crash | mitigate | `makeBuffer` returns `undefined` un-coerced; `authoring.buffer` null-checks → `{ok:false}` → structured `ToolError`; asserted | closed |
| T-02-16 | Repudiation | buffer-by-id on a missing feature silently no-ops | mitigate | `authoring.buffer(featureId)` returns `{ok:false}` for unknown id → structured not-found `ToolError`; asserted | closed |
| T-02-17 | Spoofing | a remote server advertises tools masquerading as local/editor tools | mitigate | All synced tools forced to `kind:'remote-mcp'` + `origin: SERVER_PUBKEY`; cannot register as `editor`/`authoring-primitive` (`mcp-sync.ts`; `mcp-sync.test.ts`). Reinforced by the CR-01 fix (sync no longer overwrites local handlers). | closed |
| T-02-18 | Denial of Service | `listTools()` hangs/errors over the stateless transport → registry stalls | mitigate | Poll-based with graceful degradation to the last-known/hardcoded set on failure; no blocking push subscription; `mcp-sync.test.ts` failure path | closed |
| T-02-19 | Tampering | trusting a malformed remote schema into the dispatch hot path | mitigate | `isValidManifestTool` shape validation before registering; remote tool args reuse the dispatch-boundary validation (parseToolCallArguments + clamps) | closed |
| T-02-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | No new packages this phase — turf/geojson/`@modelcontextprotocol/sdk`/`@contextvm/sdk` already present (RESEARCH Package Legitimacy Audit). Accepted risk. | closed |

*Status: open · closed · closed (partial)*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-01…T-02-19 | Closure by **documented acceptance** of plan-time mitigations rather than a separate `gsd-security-auditor` code pass. Each mitigation is real and backed by the green test suite (112/0) cited per row, but was not independently re-audited this run. Re-run `/gsd-secure-phase 02` to upgrade to auditor-verified. | user | 2026-06-16 |
| AR-02-02 | T-02-07 | The anti-bypass (A3) control is enforced for the **create** seam only (`editor.addFeature`). `editor.updateFeature`/`deleteFeatures` (~12 UI/chat sites) remain outside the Authoring facade — INFRA-02 Partial, deferred to a facade-expansion plan before Phase 5 (where SAFE-01 gate hooks need the full seam). Residual EoP risk accepted until then. | user | 2026-06-16 |
| AR-02-03 | T-02-SC | No new third-party packages introduced this phase; existing dependencies trusted per the RESEARCH package-legitimacy audit. | user | 2026-06-16 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-16 | 20 | 20 | 0 | user-accepted (documented; no separate auditor pass) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-16 (closure by documented acceptance; T-02-07 partial — modify/delete seam deferred)
