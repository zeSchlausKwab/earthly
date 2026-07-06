---
phase: 11
slug: temporal-sighting
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-28
---

# Phase 11 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time across 11-01..11-04; verified by gsd-security-auditor.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| relay → client read (useSightings) | Arbitrary Nostr authors publish kind-37522 events; untrusted content/geometry/start/end/expiration cross into the cast + timeline. | Untrusted JSON content + tags |
| relay → expiry freshness | NIP-40 GC is advisory; a lagging/malicious relay may serve an expired Sighting on any read path (subscription, map source, OG fetch). | Untrusted timestamps |
| relay → map/browse/detail render | Untrusted title/description/geometry rendered in the marker layer, browse rows, create form, and detail view. | Untrusted text + geometry |
| crawler → OG server fetch | An arbitrary `/sighting/:naddr` crawl triggers a raw-WebSocket relay fetch on the OG renderer (separate read path, no cast/filter). | Attacker-chosen naddr |
| contributor → schema Group (c-attach) | Off-thread schema validation of a Sighting's `c`-attach against a potentially malicious relay-authored schema. | Untrusted JSON Schema |
| localStorage → client (draft) | Per-device, pubkey-scoped Sighting draft; no cross-user boundary, but a malformed stored value must not crash. | Local serialized draft |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-11-01-DOC | Tampering (expiry units) | expiry test pins epoch-seconds | mitigate | `expiry.test.ts:22-23,97-103` fixed UTC epoch-seconds NOW + units guard (`< 1e11`); never `Date.now()` ms | closed |
| T-11-02-01 | Denial of Service | `useSightings` casting a forged/legacy 37522 | mitigate | `useSightings.ts:63` `events.filter(isTemporalSighting)` BEFORE `castEvent` (SPEC-03 defensive skip) | closed |
| T-11-02-02 | Tampering / freshness | expired Sighting at the subscription read path | mitigate | `useSightings.ts:63` `dropExpired(..., now)`; `now=useExpiryClock()→unixNow()` epoch-seconds | closed |
| T-11-02-03 | Denial of Service | turf bbox/centroid on oversized/malformed geometry | mitigate | `lifecycle.ts:73-79,88-96` `deriveBbox`/`deriveCentroid` try/catch → undefined, never throws | closed |
| T-11-02-04 | Tampering | malformed localStorage draft | accept | `draft.ts:37-55` `readDraftMap` returns `{}` on non-object, per-field guards, never throws; pubkey-scoped/local-only | closed |
| T-11-03-01 | Tampering (XSS) | SightingsPanel rows + SightingEditorPanel | mitigate | `SightingsPanel.tsx:155` escaped React text node; no `dangerouslySetInnerHTML` (verified zero JSX sinks) | closed |
| T-11-03-02 | Tampering / freshness | map marker source (separate read path) | mitigate | `useMapLayers.ts:255-264` `dropExpired(..., unixNow())` BEFORE FeatureCollection build; expired removed, not hidden | closed |
| T-11-03-03 | Denial of Service (ReDoS) | c-attach schema validation (malicious schema) | mitigate | `GroupAttachField.tsx:154` off-thread Phase-8 hardened worker (`'warn'`); publish `disabled` is `!canPublish` only, never the verdict | closed |
| T-11-03-04 | Denial of Service | malformed geometry rendered to the map | mitigate | `useMapLayers.ts:270-290` `pointOnFeature` try/catch → null; failed feature `continue`-skipped, never crashes the layer | closed |
| T-11-04-01 | Information Disclosure | OG social card leaking an EXPIRED sighting | mitigate | `fetchEvent.ts:324` `isOGEventExpired → null` before content parse; `cache.ts:186-190,273` `isContentExpired` hard-miss (no fresh/stale/fallback serves expired) | closed |
| T-11-04-02 | Tampering (XSS) | SightingViewPanel + OG template | mitigate | `SightingViewPanel.tsx:156,201,212` escaped React text; OG reuses audited `template.ts → generateOGHtml` (escapeHtml/sanitizeUrl/escapeJsString) | closed |
| T-11-04-03 | Denial of Service / SSRF | OG renderer fetching an arbitrary event id | mitigate | `fetchEvent.ts:313` kind guard `!== TEMPORAL_SIGHTING_KIND → null`; bounded 5s `fetchEventFromRelay`; `index.ts:188-217` reuses cached/bounded path | closed |
| T-11-04-04 | Denial of Service | casting a forged 37522 in detail/route resolve | mitigate | `GeoEditorView.tsx:243,1764-1772` resolve via `useSightings()` (filter-before-cast + dropExpired); `SightingViewPanel.tsx:117` `isExpired → return` before content | closed |
| T-11-01-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | Zero new runtime deps; `package.json` diff (phase-10 baseline `fe30f91`) is the single `seed:sightings` dev-script line | closed |
| T-11-02-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | Same — `@turf/turf`, `geojson`, `applesauce-core` already in the tree | closed |
| T-11-03-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | Same — `calendar`, `radio-group`, lucide `Eye` UI primitives pre-installed | closed |
| T-11-04-SC | Tampering (supply chain) | npm/pip/cargo installs | accept | Same — OG/route/comment surfaces reuse shipped modules | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-11-01 | T-11-02-04 | Malformed localStorage Sighting draft is a per-device, pubkey-scoped value behind no trust boundary; `readDraftMap` degrades to `{}` and never throws. | Phase 11 plan + audit | 2026-06-28 |
| AR-11-02 | T-11-01-SC..T-11-04-SC | Phase added zero new runtime dependencies (verified `package.json` diff vs baseline `fe30f91`: one dev-script line). Supply-chain surface unchanged. | Phase 11 plan + audit | 2026-06-28 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-28 | 17 | 17 | 0 | gsd-security-auditor (opus) |

Notes: register authored at plan time (11-01..11-04). Auditor verified each mitigation against the implementation (file:line evidence above), independently confirmed no `dangerouslySetInnerHTML` JSX sink and no ms/seconds expiry-units crossing, and confirmed the post-execution code-review (`32e58ed..4972eba`) + UI-polish (`6a7c765`) commits hardened rather than weakened the expiry/XSS mitigations. Both 11-03/11-04 SUMMARY `## Threat Flags` declare "None".

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-28
