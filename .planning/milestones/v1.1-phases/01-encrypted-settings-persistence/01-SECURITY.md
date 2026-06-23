---
phase: 01
slug: encrypted-settings-persistence
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-16
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

**Disposition note:** All 14 plan-time threats were accepted as documented risk per the maintainer's decision on 2026-06-16 (no separate `gsd-security-auditor` pass was run this round). The `mitigate`-disposition threats below are recorded CLOSED on the strength of evidence already produced this phase: `01-VERIFICATION.md` (15/15 observable truths verified, including the partialize secret-exclusion invariant, `validateImportedSnapshot`, the persistent export warning, and the nonce/generation guard) and `01-REVIEW.md` + `01-REVIEW-FIX.md` (code review found and fixed 2 blockers + 6 warnings hardening exactly these secret-handling and load/save-lifecycle paths). A future `/gsd-secure-phase 01` run can spawn the auditor to independently re-verify if desired.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Zustand store state → localStorage `persist` | Secret-bearing in-memory state (`providerOverrides[*].apiKey`) must not cross into the persisted/devtools-serialized `chat-store` blob. | API keys, provider base URLs (secret) |
| Decrypted snapshot → `chat-store` localStorage | Only `chatSessions` + `activeChatId` may persist; settings flow exclusively through the encrypted envelope in `settingsStorage.ts`. | Settings snapshot (secret) vs. session metadata (non-secret) |
| In-the-wild v1 envelope → loaded snapshot | Untrusted historical shape decrypted from localStorage; migrated by `migrateV1ToV2`. | Persisted settings of unknown vintage |
| NIP-46 remote signer → load lifecycle | Async/fallible decrypt over relays; latency, offline, or scheme-mismatch can reject — must surface visibly, not as silent data loss. | Encrypted envelope, signer responses |
| Retry button → load effect | User-triggered reload must re-enter the generation-counter guard, not bypass it. | Reload trigger |
| Transient status slice → persist | `settingsStatus`/`settingsError`/`settingsLoadNonce` must not enter the persisted/devtools `chat-store` blob. | UI status, error message (must carry no secrets) |
| Pasted import JSON → store | Untrusted user-pasted text crosses into application state; must be parsed + validated before `hydrateSettings`. | Arbitrary user input |
| Live snapshot → clipboard | Export deliberately emits plaintext secrets (API keys) to the OS clipboard — a known, warned-about disclosure. | Plaintext API keys (secret) |
| Imported snapshot → debounced save → envelope | Re-encryption to the current signer happens via the existing save path; no new crypto. | Settings snapshot |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-01-01 | Information Disclosure | `store.ts` persist `partialize` | mitigate | Allow-list = `{ chatSessions, activeChatId }`; `providerOverrides` (contains `apiKey`) stays OUT. Verified: `01-VERIFICATION.md` truth #4 + `store.test.ts` partialize assertion (SC-1). | closed |
| T-01-02 | Information Disclosure | decrypted snapshot logging/devtools | mitigate | Snapshot/overrides never `console.log`'d; only the encrypted envelope is written to localStorage. Verified by review (no secret-logging found). | closed |
| T-01-03 | Tampering / data loss | localStorage key prefix | mitigate | Stable prefix `earthly.chat-settings.v1`; only in-envelope `version` bumped to 2, migrated on read. Verified: `01-VERIFICATION.md` artifacts row (key prefix line 9). | closed |
| T-01-04 | Tampering | `migrateV1ToV2` on untrusted payload | mitigate | Pure defensive field-by-field reconstruction; garbage yields safe defaults without throwing. Hardened by WR-01 (JSON.parse guarded). Verified: `settingsStorage.test.ts` garbage-safe test. | closed |
| T-01-05 | Cryptography | encrypt-to-self envelope | accept (reuse) | No hand-rolled crypto; reuses existing `signer.nip44 ?? signer.nip04` scheme negotiation (D-06). See Accepted Risks. | closed |
| T-01-06 | Tampering (integrity) | retry / stale async load | mitigate | Retry increments `settingsLoadNonce` in load-effect deps; effect bumps generation ref so a stale in-flight load fails its guard. Retry never calls the loader directly. Verified: `01-VERIFICATION.md` truth #11. | closed |
| T-01-07 | Denial of Service (lockout) | NIP-04-only signer vs NIP-44 envelope | mitigate | Scheme-mismatch `throw` caught → `'failed'` status with visible message; export/import (T-01-13) is the recovery path. Preferred-with-fallback preserved. Verified: truth #8 (UAT test 3 passed). | closed |
| T-01-08 | Information Disclosure | new status slice in persist | mitigate | `settingsStatus`/`settingsError`/`settingsLoadNonce` kept OUT of `partialize`; `settingsError` carries a message only, never secret values. Verified: partialize allow-list unchanged. | closed |
| T-01-09 | Spoofing / silent data loss | failure presented as fresh-user defaults | mitigate | Catch branch sets `'failed'` + message instead of silently applying DEFAULT; UI distinguishes `failed` from `no-settings`/`no-signer` (D-11). Hardened by CR-01 fix. Verified: truths #8/#9, UAT test 1 passed. | closed |
| T-01-10 | Tampering | import: malicious/garbage pasted JSON | mitigate | `JSON.parse` in try/catch → `validateImportedSnapshot` (rejects null/array/non-object, unknown provider, oversized via `MAX_IMPORT_BYTES`) before `hydrateSettings`. Verified: `settingsExport.test.ts` 12 tests; truth #15. | closed |
| T-01-11 | Information Disclosure | export: plaintext secrets on clipboard | accept (warned) | Deliberate per D-08 (recovery hatch must survive a lost signer); persistent user-facing warning that the clipboard holds plaintext API keys (D-10). See Accepted Risks. UAT test 4 confirmed the warning. | closed |
| T-01-12 | Information Disclosure | export reads live store, not logs | mitigate | Serializes the in-memory snapshot directly; never logged; user-initiated clipboard write is the only egress. Verified: review found no secret-logging egress. | closed |
| T-01-13 | Denial of Service (lockout recovery) | signer-rotation lockout | mitigate | Import re-encrypts to the CURRENT signer via the existing debounced save (D-07/D-09) — the recovery path for the lockout flagged by T-01-07. Verified: UAT test 5 passed. | closed |
| T-01-SC | Tampering (supply chain) | dependency installs | accept | Phase installs NO new packages (RESEARCH § Package Legitimacy Audit). See Accepted Risks. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-05 | Reuse the existing audited `nip44 ?? nip04` encrypt-to-self scheme rather than introduce new crypto; preferred-with-fallback preserved (D-06). | Maintainer (Schlaus Kwab) | 2026-06-16 |
| AR-02 | T-01-11 | Plaintext-key export to clipboard is the intentional recovery escape hatch (SET-03 / D-08) for a lost or rotated signer; residual disclosure is mitigated by a persistent on-screen warning (D-10) and is user-initiated. | Maintainer (Schlaus Kwab) | 2026-06-16 |
| AR-03 | T-01-SC | No new dependencies were added in this phase, so no package-legitimacy checkpoint applies. | Maintainer (Schlaus Kwab) | 2026-06-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-16 | 14 | 14 | 0 | Maintainer decision (accept-all-as-documented-risk), backed by 01-VERIFICATION.md + 01-REVIEW.md/01-REVIEW-FIX.md evidence |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-16
