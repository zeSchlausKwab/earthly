---
phase: 13
slug: cross-cutting
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-02
---

# SECURITY.md — Phase 13: Cross-Cutting (v1.2 FINAL)

**Audited:** 2026-07-02
**ASVS Level:** 1
**block_on:** high
**Commit range:** `f785460^..b6492c3`
**threats_open:** 0

Threat register authored at PLAN time (`register_authored_at_plan_time: true`).
This audit VERIFIES each declared mitigation exists in the implemented code; it does
NOT scan for new vulnerabilities. Every threat resolved to CLOSED by grep-based
acceptance check + code read at the cited location. Implementation files were NOT
modified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| relay → comment render (37517) under BeaconViewPanel | untrusted comment events render beneath a beacon | comment text / mentions |
| beacon.pubkey → comment root address | throwaway-key beacon pubkey forms the `37521:pubkey:d` comment-root address | pubkey / d-tag |
| URL (untrusted) → parsePathSegments dispatcher | any path/hash segment (incl. attacker-crafted naddr) enters the route dispatcher | naddr, prefix, commentId |
| route (untrusted) → isolated stack entry | a crafted deep-link creates an `isolated:true` stack entry | resolved entityKey |
| relay subscription → stack-gated map render | untrusted sighting/beacon events flow through stack selectors to the map | GeoJSON geometry |
| beacon geometry → map render (Phase 12 CR-01/CR-02) | beacon position rendering must not regress the GPS-privacy posture | GPS coordinates |

---

## Result: SECURED — 15/15 threats CLOSED

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation / Evidence | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-13-01-XSS | Tampering | comment render under BeaconViewPanel | mitigate | `grep -c dangerouslySetInnerHTML src/components/info-panel/BeaconViewPanel.tsx` = **0**. CommentsPanel mount (BeaconViewPanel.tsx:334-347) reuses the existing escaped-React-text render path; no new sink. | closed |
| T-13-01-MISATTACH | Spoofing | reused own-pubkey beacon `d` carries old comments | accept | Accepted risk genuinely documented (see Accepted Risks Log). No de-dup code built (correct per disposition); own-pubkey `d`-reuse residual recorded in 13-01-SUMMARY.md:37,92,96. | closed |
| T-13-01-GPS | Info Disclosure | beacon GPS-privacy (CR-01/CR-02) | mitigate | `grep -c "beacon.geometry\|beacon.position" BeaconViewPanel.tsx` = **0**. Mount reads only `beacon.id`/`beacon.dTag`/`beacon` (as `target`); position never read or emitted (BeaconViewPanel.tsx:334-347). | closed |
| T-13-02-MALNADDR | DoS | parsePathSegments / dispatcher | mitigate | `parsePathSegments` (useRouting.ts:108-156) assigns `naddr: segments[1]` opaque — **no `nip19.decode` on the share-form path**. The two `nip19.decode` calls (L69, L123) are both try/catch'd and off the share path. | closed |
| T-13-02-MISROUTE | Tampering | SHARE_ROUTES lookup | mitigate | `SHARE_ROUTES` (useRouting.ts:90-99) is a closed `Record` literal keyed by the 5 known prefixes; `focusType`/`sidebarView` come from table values, never the URL segment. Unknown `first` → `undefined` → falls through (L148-156). Cloned-block grep = **0**. | closed |
| T-13-02-URLBREAK | Repudiation | shared links + OG cards | mitigate | `git diff --numstat f785460^..b6492c3 -- src/index.ts` = **empty** (server-side OG redirects untouched). Client parser preserves all 5 prefixes byte-for-byte. | closed |
| T-13-02-GPS | Info Disclosure | beacon deep-link resolution (CR-01/CR-02) | mitigate | Account-free `{authors,#d}` beacon resolution logic byte-identical (GeoEditorView.tsx:2224-2226); only the `handleInspectBeacon(beacon, route.commentId)` CALL gained a 2nd arg (L2237). commentId is a comment d-tag; does not alter position resolution/render. | closed |
| T-13-03-FORCEISO | Tampering | route → addMapStackEntry({isolated:true}) | mitigate | `addSightingToMapStack`/`addBeaconToMapStack` derive `entityKey` from the RESOLVED entity via `encode*NaddrPure` (GeoEditorView.tsx:582,602), never a raw URL field; `isolated: source === 'route'` (L587,607) uses the existing mutually-exclusive `setMapStackEntryIsolated` rule. | closed |
| T-13-03-DROPEXPIRED | Info Disclosure / Integrity | stale/expired beacon still painted | mitigate | `git diff --numstat ... -- src/features/geo-editor/hooks/useMapLayers.ts` = **empty**. `buildSighting/BeaconSource` + internal `dropExpired` intact; selectors feed an input set, never a pre-built source. | closed |
| T-13-03-GPSREGRESS | Info Disclosure | beacon GPS-privacy (CR-01/CR-02) | mitigate | `deriveVisibleEntitiesFromStack` aggregate branch seeds from `subscriptionSet = beacons` (`#t:['live']` discovery) ONLY (GeoEditorView.tsx:163-167,1288-1299); link-only beacons render solely via individual/isolated entries against the `beaconLookupSuperset` (L135,148,169). `useMapLayers.ts` + `useBeacons` discovery filter unchanged. | closed |
| T-13-03-REGRESSION | DoS (self-inflicted) | shared useMapLayers dataset/context path | mitigate | `git diff --numstat ... -- useMapLayers.ts` = **empty**; `visibleGeoEvents` untouched. Only 2 new caller-side props (GeoEditorView.tsx:1474-1475). | closed |
| T-13-04-EXPIRELEAK | Info Disclosure | expired entry lingering on stack | mitigate | Expiry sweep (GeoEditorView.tsx:1311-1333) resolves each individual entry against the dropExpired'd subscription and calls `removeMapStackEntry(id)` when gone or `isExpired`. Aggregate `*-layer` entries self-drop via buildSource. No tombstone rows. | closed |
| T-13-04-GPSREGRESS | Info Disclosure | link-only beacon GPS-privacy (CR-01/CR-02) | mitigate | Cold-start seeds ONLY aggregate `sighting-layer`/`beacon-layer` with `entityKey:'all'` (GeoEditorView.tsx:869-887); `beacon-layer` renders the discovery set via the aggregate branch. No code path feeds a link-only beacon to the rail/aggregate. | closed |
| T-13-04-COLDSTART | Tampering | idempotent cold-start seeding | mitigate | Seed idempotent: `aggregateLayersSeededRef` per-session ref (GeoEditorView.tsx:850,852,859) + `?ms=` deep-link skip (L855-858) + per-type existence check before add (L862-878). Repeated cold-start cannot duplicate or resurrect cleared layers. | closed |
| T-13-04-XSS | Tampering | new entity labels in MapStackPanel rows | mitigate | `grep -c dangerouslySetInnerHTML src/components/MapStackPanel.tsx` = **0**. Entity labels render as escaped React text nodes in the existing row component. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-13-01 | T-13-01-MISATTACH | Own-pubkey `d`-reuse cross-session comment misattach. Phase-12 D-05 throwaway-key-per-session default makes `37521:pubkey:d` effectively session-unique, so misattach only occurs in the opt-in own-pubkey case. Deferred to cordn encrypted-GeoJSON / key-coordinator agenda. | Schlaus Kwab | 2026-07-02 |

### T-13-01-MISATTACH — own-pubkey `d`-reuse cross-session comment misattach (Spoofing)

**Disposition:** ACCEPT (declared at PLAN time, plan 13-01 threat register).
**Status:** Genuinely accepted — documented, not a silent gap. No mitigation code
was expected or built (correct for an `accept` disposition).

**Description:** A reused `d` tag across sessions on an **own-pubkey (non-throwaway)**
beacon could let old kind-37517 comments carry onto a new beacon at the same
`37521:pubkey:d` comment-root address.

**Why accepted:** The Phase-12 D-05 throwaway-key-per-session default makes the
`37521:pubkey:d` address effectively session-unique, so cross-session misattach only
occurs in the opt-in own-pubkey case. A session-scoped comment-addressing /
`d`-uniqueness fix is out of scope this phase.

**Deferral target:** CONTEXT.md Deferred Ideas → cordn encrypted-GeoJSON /
key-coordinator agenda (the real home for beacon/entity privacy hardening).

**Documentation trail:** 13-01-SUMMARY.md key-decisions (D-07, line 37), Threat Model
Outcomes (line 92), Known Residuals (line 96).

---

## Verification Method

- **`mitigate` threats (14):** grep for the declared mitigation pattern at the cited
  file:line + code read to confirm it applies to the actual entry point. Acceptance
  greps from the threat register run and passed (XSS=0, GPS position refs=0, cloned
  blocks=0, SHARE_ROUTES closed Record, etc.).
- **`accept` threats (1):** confirmed the accepted-risk entry is present and documented
  (Accepted Risks Log above); confirmed NO silent mitigation was expected.
- **Claimed-unchanged files:** `git diff --numstat f785460^..b6492c3` on `src/index.ts`
  and `src/features/geo-editor/hooks/useMapLayers.ts` returns EMPTY — both byte-for-byte
  untouched, validating T-13-02-URLBREAK, T-13-03-DROPEXPIRED, T-13-03-REGRESSION, and
  the useMapLayers side of T-13-03-GPSREGRESS.
- **Defense-in-depth:** no `dangerouslySetInnerHTML` was added in ANY phase-changed
  `.tsx` file (full-diff grep = NONE ADDED).

## Unregistered Flags

**None.** No SUMMARY contains a `## Threat Flags` section; all self-reported threat
outcomes map exactly to the 15 registered threat IDs. The two `deferred-items.md`
entries are pre-existing biome a11y/unused-param lint findings on lines the phase did
not author — not new attack surface, not security-relevant.

## Notes on Structural Movement (verified benign)

- The `{authors,#d}` beacon-resolution block and `encodeBeaconNaddr` were **relocated**
  (Plan 03 Rule-3 reorder: moved above the `useMapLayers` call to fix a temporal-dead-zone
  ref, and the pure `encode*NaddrPure` encoders extracted to module scope). The
  resolution *logic* — `{ authors: [pubkey], '#d': [identifier] }` and the discovery→routed
  `.find` fallback — is byte-identical. This does not weaken T-13-02-GPS: the account-free
  fallback semantics are preserved; only line positions changed.
- The `66a155e` `extraMapBeacons` side-channel is fully DELETED (`grep -c` = 0 for both
  `extraMapBeacons` and `beaconsForMap`), and no side-channel was reintroduced — a
  deep-linked beacon now renders via the isolated `'route'` stack entry, keeping the
  GPS-privacy posture inside the audited stack-membership render gate.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-02 | 15 | 15 | 0 | gsd-security-auditor (opus) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-02

---
*Phase: 13-cross-cutting | ASVS L1 | threats_open: 0*
