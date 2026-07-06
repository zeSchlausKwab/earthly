# Phase 12: Live Beacon (~37521) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-28
**Phase:** 12-live-beacon-37521
**Areas discussed:** Update cadence, Stop & ended state, Staleness & render, Visibility & share

---

## Update cadence

### Publish trigger
| Option | Description | Selected |
|--------|-------------|----------|
| Distance + time floor | Re-publish when moved >~X m OR every ~N s, whichever first | ✓ |
| Fixed time interval | Re-publish every N s regardless of movement | |
| Every GPS fix | Re-publish on each watchPosition update | |

**User's choice:** Distance + time floor.

### Heartbeat
| Option | Description | Selected |
|--------|-------------|----------|
| Yes — heartbeat | Time floor doubles as keepalive; stationary-but-active stays live | ✓ |
| No — movement only | Only publish on movement; stationary goes stale | |

**User's choice:** Yes — heartbeat.
**Notes:** Distinguishes "parked but here" from "tab closed / gone". Couples directly to the staleness threshold.

---

## Stop & ended state

### Time box input
| Option | Description | Selected |
|--------|-------------|----------|
| Presets + custom | Duration presets + custom; sensible default pre-selected (mirror Sighting D-04) | ✓ |
| Presets only | Fixed duration buttons, no custom | |
| Required custom only | Must always pick an explicit end time | |

**User's choice:** Presets + custom.

### "Ended" terminal state
| Option | Description | Selected |
|--------|-------------|----------|
| Final 'ended' event | Stop publishes a last replaceable 37521 with status='ended' + expiration | ✓ |
| Expire immediately | Stop sets expiration=now; dropExpired removes it (silent vanish) | |
| Status only, no expiry change | Mark ended via flag, leave original expiry | |

**User's choice:** Final 'ended' event.
**Notes:** Implies adding `status:'live'|'ended'` to LiveBeaconContent. Honest — viewer sees a clear ended marker rather than ambiguous disappearance.

### No-delete warning
| Option | Description | Selected |
|--------|-------------|----------|
| At start, recap at stop | Consent up front + brief recap at stop | ✓ |
| At start only | One warning at start | |
| At stop only | Warn only when ending | |

**User's choice:** At start, recap at stop — with a key clarification (below).
**Notes (user free-text):** "the default will be the user sharing his position with a throw away pubkey (anon) and only when he explicitly chooses to publish it under his own pubkey this happens." → established the **default throwaway-pubkey identity model**; the no-delete warning carries real weight only in the own-pubkey opt-in case.

### Throwaway key scope (follow-up from the above)
| Option | Description | Selected |
|--------|-------------|----------|
| Per-session key | One throwaway key from Start, reused for all updates; fresh key next Start | ✓ |
| Per-publish key | Fresh key every update (breaks replaceable semantics) | |
| Persistent throwaway | One throwaway key reused across sessions | |

**User's choice:** Per-session key.
**Notes:** Sessions unlinkable to each other and to the user's identity. Implies a generated per-session signer, not the app's main signer. Share link must carry the throwaway pubkey.

---

## Staleness & render

### Lifecycle visual states
| Option | Description | Selected |
|--------|-------------|----------|
| Live / stale / removed | Solid live → greyed stale (last-seen age) → removed at expiry (+ ended marker) | ✓ |
| Live / removed only | Solid then removed at threshold; no greyed middle | |
| Opacity-aging gradient | Continuous fade toward transparent, removed at expiry | |

**User's choice:** Live / stale / removed.

### Staleness threshold
| Option | Description | Selected |
|--------|-------------|----------|
| Tight (~2–3 min) | Stale after a few missed heartbeats | |
| Relaxed (~5–10 min) | More forgiving of brief gaps | |
| Derive from cadence | Threshold = a multiple of the heartbeat interval | ✓ |

**User's choice:** Derive from cadence.
**Notes:** Keeps threshold and cadence in sync automatically; exact factor (e.g. ~4×) is the planner's call.

---

## Visibility & share

### Visibility / enforcement
| Option | Description | Selected |
|--------|-------------|----------|
| Ask each time, soft-enforced | Prompt public vs link-only at Start; public=discoverable marker+geo tags, link-only=omit marker (unlisted, not encrypted) | ✓ |
| Link-only this phase | Ship only the unlisted/share-link path | |
| Default link-only, opt-in public | Same mechanism, sticky link-only default, no per-start prompt | |

**User's choice:** Ask each time, soft-enforced.
**Notes (user free-text):** Asked "how do we enforce this on the client (on the read side)?" → established that unencrypted events on a public relay can't be cryptographically restricted; "link-only" = client-side discovery-gating (obscurity), NOT access control. True privacy = deferred BEACON-07 / cordn.

### Entry point / browse surface
| Option | Description | Selected |
|--------|-------------|----------|
| Beacons rail tab | Dedicated AppSidebar destination (mirrors Stories/Sightings) | ✓ |
| Map control | Start/Stop button near the locate control | |
| Both | Rail tab index + map quick control | |

**User's choice:** Beacons rail tab.
**Notes:** This question was first dismissed (user paused the session), then resolved as option 1 on resume.

---

## Claude's Discretion

- Position/geometry content contract (D-09).
- Exact cadence thresholds (D-01) and staleness factor (D-08).
- Detail/view panel layout.
- Edit/resume semantics for an active beacon (modify preserves `d`).
- Permission-denied / geolocation-error handling.
- Marker styling specifics within the live/stale/ended scheme.

## Deferred Ideas

- **cordn-style encrypted-GeoJSON transport** (NEW agenda, future milestone) — key
  coordinator + encrypted GeoJSONs across all entities; the proper home for
  BEACON-07 and a new cryptographic-privacy dimension. Memory:
  `project_cordn_encrypted_geojson_agenda`.
- Encrypted/private per-viewer beacons (BEACON-07) — subsumed by cordn; deferred.
- External-data-source / sandbox-driven beacon (BEACON-05) — deferred.
- Beacon trail / breadcrumb history (BEACON-06) — deferred.
- Full canonical entity routing/addressing + comment-root widening — Phase 13
  (XCUT-01/02); `/beacon/:naddr` here may be a thin slice generalized in Phase 13.
