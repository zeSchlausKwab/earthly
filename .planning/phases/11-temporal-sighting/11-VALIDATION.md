---
phase: 11
slug: temporal-sighting
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-27
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `11-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test runner (`bun:test`) |
| **Config file** | none — Bun built-in; tests colocate as `*.test.ts` |
| **Quick run command** | `bun test src/lib/nostr/temporal-sighting` |
| **Full suite command** | `bun test` |
| **Estimated runtime** | quick ~1s · full ~tens of seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun test src/lib/nostr/temporal-sighting` (+ touched module dir)
- **After every plan wave:** Run `bun test`
- **Before `/gsd-verify-work`:** `bun test` green + `bun run build` green + `biome check .` clean
- **Max feedback latency:** < 5 seconds (quick run)

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| SIGHT-01 | Factory round-trips `title`/`desc`/`start`/`end`/**`geometry`**; bbox/g derived from geometry | unit | `bun test src/lib/nostr/temporal-sighting/temporal-sighting.test.ts` | ⚠️ extend — W0 | ⬜ pending |
| SIGHT-01 | `modify()` preserves `d` (no lineage fork) | unit | same | ⚠️ extend | ⬜ pending |
| SIGHT-01 | Defensive content getter: 37522 without `geometry` → `geometry: undefined`, no throw | unit | same | ❌ W0 | ⬜ pending |
| SIGHT-02 | `contextReferences()` emits `c` tag for an attached Group coord | unit | same | ❌ W0 | ⬜ pending |
| SIGHT-03 | `dropExpired` removes expired Sightings; non-expired kept; UTC-epoch comparison | unit | `bun test src/lib/nostr/expiry.test.ts` | ⚠️ extend — W0 | ⬜ pending |
| SIGHT-03 | Each Sighting read path filters expired (`useSightings` / `SightingsPanel` / OG fetch / map layer / Group lane) | unit/integration | `bun test src/lib/hooks src/lib/og` | ❌ W0 | ⬜ pending |
| SIGHT-04 | `GeoCommentFactory.root({kind:37522})` emits `K`/`k` = 37522 | unit | `bun test src/lib/nostr/geo-comment` | ⚠️ extend | ⬜ pending |
| (observation state) | classify live-now / upcoming / past from `start`/`end`/now | unit | new `*.test.ts` for the time-cue classifier | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `temporal-sighting.test.ts` — geometry round-trip, bbox/g derivation, defensive geometry-absent parse, `c`-emit, `d`-preserve
- [ ] Extend `expiry.test.ts` + add per-read-path coverage — assert each Sighting read path drops expired (subscription, panel, OG fetch, map layer, Group lane)
- [ ] New observation-state classifier test (live / upcoming / past)
- [ ] No framework install needed — Bun test is built in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Map pin-drop placement → form opens in right info panel | SIGHT-01 / D-01 | Map interaction + GeoEditor mode | "New Sighting" → click map → confirm pin placed + compact form opens |
| Optional small-area draw | D-02 | Map drawing interaction | In create form, switch to area → draw small polygon → confirm geometry captured |
| Distinct marker + time-cue + fade rendering | D-05 / D-06 | Visual map rendering | Confirm Sighting markers visually distinct; live-now highlighted, upcoming badged, past dimmer; expired removed |
| Sightings rail discoverability | D-07 | Navigation/visual | Confirm `sightings` rail tab → `SightingsPanel` lists + fly-to/open detail; "New Sighting" button at top |
| `/sighting/:naddr` share + OG card | D-08 | External crawler render | Open deep link → detail opens; fetch OG card → image renders with expiry-filtered data |
| Group-picker warn-not-block during create | SIGHT-02 | Off-thread validation UX | Attach to a `schema` Group with invalid payload → warning shown, publish NOT blocked |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
