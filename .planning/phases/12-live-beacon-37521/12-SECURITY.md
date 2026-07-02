---
phase: 12
slug: live-beacon-37521
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-02
---

# Phase 12 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Live Beacon (kind 37521) — the milestone's highest privacy surface: per-session
> throwaway-key live GPS location sharing.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| relay (untrusted) → useBeacons read path | A relay can serve a forged/legacy/expired 37521. Client never trusts it: filter-before-cast + dropExpired at the subscription. | Beacon events (position, status) |
| client publish → relay | The lifecycle service is the only writer; it controls which tags (t:'live'/geo) leave the device per the D-10 visibility choice. | Position, status, visibility tags |
| device GPS → publish loop | navigator.geolocation fixes drive the throttled publish loop; foreground-only (watchPosition suspends when backgrounded). | Raw GPS coordinates |
| session key (secret) → memory only | The throwaway secp256k1 key is the session secret; it lives in a React ref and NEVER touches a datastore; discarded at Stop. | Private key material |
| user choice → publish identity/visibility | The control panel collects identity (anonymous default) + visibility + informed no-delete consent before any position leaves the device. | Identity/visibility selections |
| share link → logged-out viewer | /beacon/:naddr opens account-free (guest scope); the OG crawler path runs server-side and must never leak an expired beacon's content. | Beacon label/status (public) |
| device clock → staleness/expiry | created_at / expiration are device-set epoch seconds; staleness/expiry derivation compares against the read-side `now` in seconds. | Timestamps |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-12-01-CLOCK | Tampering | Test clock units (ms vs epoch s) | mitigate | Clock assertions compare at explicit epoch-seconds; staleness threshold asserted as heartbeat multiple (`useBeaconPublisher.test.ts:55,65-97`) | closed |
| T-12-01-LINKONLY | Info disclosure | Link-only discoverability test | mitigate | `visibility.test.ts:87-90` asserts no `t:'live'`/`g`/`bbox`; no `#t:['live']` match | closed |
| T-12-02-FORGED | DoS | useBeacons casting forged/legacy 37521 | mitigate | filter-before-cast: `useBeacons.ts:72` `dropExpired(events.filter(isLiveBeacon),now).map(castEvent)` (P-2) | closed |
| T-12-02-EXPIRED | Info disclosure | Relay serving expired beacon | mitigate | `dropExpired(..,now)` at subscription (`useBeacons.ts:72`); 15s re-derive tick (`:55,60`); relay GC untrusted (SPEC-05) | closed |
| T-12-02-FROZEN | Spoofing/integrity | Stale beacon shown as current | mitigate | `beaconState.ts:57` `now-created_at >= BEACON_STALE_THRESHOLD_S` ⇒ stale regardless of status (P-3) | closed |
| T-12-02-LINKONLY | Info disclosure | Link-only leaking discovery tags | mitigate | `lifecycle.ts:136-138` omits bbox/g/hashtags for link-only; discovery filter `useBeacons.ts:82` `#t:['live']` | closed |
| T-12-02-CLOCK | Tampering | Staleness/expiry in ms not epoch s | mitigate | No `Date.now()` in beaconState/useBeacons/lifecycle; `unixNow()`/passed `now` (epoch s); only ms is the tick (P-1) | closed |
| T-12-03-KEYLEAK | Info disclosure | Throwaway session key persisted/leaked | mitigate | sk in React ref only, no storage API (`useBeaconPublisher.ts:164,280`); CR-01 unmount teardown `:303`; CR-02 teardown-first `:340`; idempotent `:257-263`; tests `:135-278` (D-05) | closed |
| T-12-03-DEANON | Info disclosure | De-anon via own-pubkey publish | mitigate | `useBeaconPublisher.ts:330` anonymous default; my-account explicit opt-in `:342-344` | closed |
| T-12-03-FLOOD | DoS | Heartbeat/jitter double-publish flood | mitigate | Single `lastPublished` guard shared by fix + heartbeat (`useBeaconPublisher.ts:128-132`); distance+time floor (P-4); test `:100-118` | closed |
| T-12-03-FROZEN | Spoofing/integrity | Fix-unavailable frozen as live | mitigate | POSITION_UNAVAILABLE/TIMEOUT ⇒ 'searching', no stale republish (`useBeaconPublisher.ts:383-386`) (P-3) | closed |
| T-12-03-STOPFAIL | Integrity | Stop publish fails → stays "live" | mitigate | Stop failure ⇒ 'error' sub-state, degrades via staleness (`useBeaconPublisher.ts:405-411`) (P-3) | closed |
| T-12-04-FROZEN | Spoofing/integrity | Stale/stopped beacon painted live | mitigate | Data-driven `beaconState(beacon,now)` paint re-eval on tick (`useMapLayers.ts:387,961+`); stale=grey/ended=hollow/expired=removed | closed |
| T-12-04-EXPIRED | Info disclosure | Expired beacon still rendered | mitigate | `dropExpired` at source builder (`useMapLayers.ts:362`); 'removed' excluded `:388` | closed |
| T-12-04-LINKLEAK | Info disclosure | Link-only surfacing in list/map | mitigate | `BeaconsPanel.tsx:233` + map source read `#t:['live']`; link-only never matched (D-10/P-6) | closed |
| T-12-04-XSS | Tampering | XSS via label in panel/marker | mitigate | Auto-escaped React text; no `dangerouslySetInnerHTML` (doc-comment only) | closed |
| T-12-05-DEANON | Info disclosure | De-anon via own-pubkey publish | mitigate | Anonymous default (`BeaconControlPanel.tsx:117,123`); `CONSENT_MY_ACCOUNT` stronger copy `:323` | closed |
| T-12-05-LINKHONESTY | Info disclosure | "Link-only" assumed cryptographically private | mitigate | Non-dismissible verbatim "unlisted, not private / published unencrypted" caveat, inline (`BeaconControlPanel.tsx:60-61,271-275`) (D-10) | closed |
| T-12-05-NODELETE | Info disclosure | User unaware last point stays public | mitigate | Start-consent (`BeaconControlPanel.tsx:64-65,322`); Stop AlertDialog recap (`BeaconViewPanel.tsx:193-219`); NO Delete action | closed |
| T-12-05-FROZEN | Spoofing/integrity | Stopped/stale shown current in view/banner | mitigate | `isExpired` gate + beaconState (`BeaconViewPanel.tsx:119-125`); banner searching sub-line (`RunningBeaconBanner.tsx:65-69`) | closed |
| T-12-05-OGLEAK | Info disclosure | OG card leaking expired beacon content | mitigate | `fetchBeacon.ts:52` null for expired; `:81-86` contentExpiresAt; cache hard-miss (`cache.ts:189-194`); OG endpoint guard (`index.ts:345`) | closed |
| T-12-05-XSS | Tampering | XSS via label in panels / OG HTML | mitigate | `generateBeaconOGHtml→generateOGHtml→escapeHtml` (`template.ts:198,207-214`); in-app React text | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-12-01 | T-12-SC (Plans 01/02/03/04/05) | No package installs this phase — zero dependency changes. Verified: `git diff 29b91de^..3a7b4b0 -- package.json bun.lock` is empty (all beacon primitives — applesauce-signers, nostr-tools, @turf/turf, geojson, lucide-react, MapLibre, radix, nip19 — pre-existing). | gsd-security-auditor + maintainer | 2026-07-02 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-02 | 22 | 22 | 0 | gsd-security-auditor (opus, ASVS L1, block_on=high) |

**Audit notes:** Verify-only run against a plan-time-authored register (all 5 plans carried `<threat_model>` blocks). Every declared mitigation confirmed present in the current implementation by grep + direct read (not summary-trusted). The two CRITICAL privacy leaks from 12-REVIEW.md (CR-01 no unmount cleanup, CR-02 no teardown-before-re-Start) were confirmed FIXED in `useBeaconPublisher.ts` (commit bfb954f). 21 beacon threat-related test cases GREEN.

**Non-blocking residuals (deferred, NOT threat gaps — do not weaken any declared mitigation):**
- WR-02 — owner inline Stop/Adjust doesn't detect anonymous-throwaway ownership; the always-on RunningBeaconBanner still provides Stop.
- WR-03 — seed "stale" fixture backdate silently discarded; affects UAT visuals only, not runtime privacy.
- WR-05 — banner reuses "searching" copy for the (now unreachable) permission-denied arm; cosmetic.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-02
