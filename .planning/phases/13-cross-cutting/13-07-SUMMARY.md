---
phase: 13-cross-cutting
plan: 07
type: execute
gap_closure: true
status: complete
completed: 2026-07-03T07:45:45Z
result: pass
---

# 13-07 SUMMARY — Stale-runtime UAT re-run (tests 5/6/7/9) + two new beacon findings

**Plan type:** verification-only human-verify checkpoint (`files_modified: []` as planned — no source
change was authored *by 13-07 itself*; the two adjacent defects it surfaced were fixed under separate
`fix(13-uat):` commits, see below).

**Outcome: ALL PASS.** The stale-HMR-runtime cluster (tests 5/6/7) is closed by verification, test 9 is
unblocked and passing, and two additional beacon defects that surfaced only against the clean runtime were
diagnosed and fixed.

## Re-run results (clean dev server + hard reload)

| Test | Prior status | Re-run result |
|------|--------------|---------------|
| 5 — Add Beacon/Sighting to Map Stack (button renders on panels + rails) | issue (stale HMR) | **pass** |
| 5b — add-action renders an out-of-discovery beacon (no phantom) | failed → fixed by 13-06 | **pass** |
| 6 — Aggregate layer toggle (top-pinned Sightings/Live beacons rows) | issue (stale HMR) | **pass** |
| 7 — Cold-start Browse seeds both aggregate layers visible-by-default | issue (stale HMR) | **pass** |
| 9 — Pinned individual entry auto-removes on expiry (no tombstone) | blocked (add button absent) | **pass** |

Root-cause confirmation for 5/6/7: exactly as diagnosed in `13-UAT.md` and
`.planning/debug/mapstack-ui-surface-absent.md` — a `bun --hot` dev server started before the Plan-03/04
commits could not hot-apply the structural change (new module-scope export, deleted `extraMapBeacons`
useState → changed hook order → fast-refresh bail), so the live bundle was pre-Phase-13. A clean restart +
hard reload replaced it with the correct committed bundle. No source defect behind 5/6/7.

## Two NEW beacon findings surfaced during the re-run (both fixed)

Once the runtime was clean and the 13-05 URL fix was live, two further beacon-specific defects became
observable. Both were beacon-only omissions from otherwise kind-generic sites (beacon was the last kind
wired in Phase 12/13):

### Finding A — creator's own beacon must auto-add to the Map Stack on Start
- **Symptom:** as the sharer, after starting a beacon you had to click "Add to map stack" manually before
  your own (esp. link-only) beacon rendered.
- **Root cause:** the map feed is `visibleBeaconsFromStack`, which renders an individual beacon only if it
  is in discovery (`#t:live`) or explicitly pinned; `useBeaconController`'s `pendingOwnView` effect opened
  the inspect view but never added the own beacon to the stack.
- **Fix (`ffaf12b`):** new guarded effect in `GeoEditorView.tsx` (after the `ownLiveBeacon` memo) that
  auto-adds the own beacon once per session via `addBeaconToMapStack(ownLiveBeacon, 'own')`. New `'own'`
  source (added to `MapStackEntrySource` + `addBeaconToMapStack` union + `sourceLabel` "you"): non-isolated,
  no toast, still deposits into `addedBeaconCacheRef` so a link-only own beacon resolves in the render gate
  **without** forcing `#t:live` (privacy invariant T-13-06-01/T-13-03-GPSREGRESS preserved — aggregate
  `beacon-layer` seed unchanged, `useBeacons` filter untouched). Keyed by stable `d` → fires once, not per
  30s heartbeat; ref resets on Stop.

### Finding B — /beacon/:naddr deep-link must open the inspect panel, not the list
- **Symptom:** landing on a shared beacon link (clean URL + no tour, post-13-05) still showed the beacons
  **list** instead of that beacon's inspect panel. (This was the *second* cause behind the test-2/3 "lands
  on list" symptom, hidden until 13-05 fixed the doubled-prefix URL.)
- **Root cause:** the deep-link resolver already calls `handleInspectBeacon` correctly, but `viewBeacon`
  was omitted from two kind-generic AppSidebar sites — the `hasInspectSubject` guard (forced
  `setShowEntityAsFullPanel(false)` → list) and the "subject → show panel" effect (no beacon branch).
- **Fix (`19a833d`):** extracted the two inline predicates into shared pure helpers
  `hasActiveInspectSubject` / `resolveActiveInspectEntity` (beacon included, checked first — mirrors
  `currentSurface`/`returnToCurrentSurface`); both effects now consume them; deps updated. Bonus: the
  Share-live-location control panel now opens as a full panel on desktop (same omission).
- **Regression test (`fba9551`):** `AppSidebar.inspectSubject.test.ts` (10/10) pins beacon (and
  `beaconControlMode`) as an inspect subject that resolves to `'beacon'` and wins over a co-present sighting.

## Commits (on `feature/better-map-ux`)
- `ffaf12b` fix(13-uat): auto-add own live beacon to map stack on start
- `19a833d` fix(13-uat): open beacon inspect panel on /beacon/:naddr deep-link (AppSidebar subject wiring)
- `fba9551` test(13-uat): pin beacon as AppSidebar inspect subject (finding B regression)

## Gates
- `bun run build`: PASS (client + 5 workers).
- biome: clean on all touched files (one pre-existing `onClearBeaconView` unused-param warning, not in diff).
- `bun test`: 775 pass; the 3 fails are the documented pre-existing `storyProposal` / `optimizeClient`
  ordering/worker-asset flake (6/0 and 4/0 in isolation) — not a regression. Beacon-touched suites
  (AppSidebar inspect, stackLayers, MapStackPanel layerEntries) 30/0.

## UAT verified by
Human UAT re-run against a freshly restarted `bun dev` server + hard-reloaded browser, 2026-07-03 —
user reported "all pass" across A, B, and tests 5/6/7/9.

## Residuals / notes
- No newly-confirmed real bug remains (the two findings were fixed, not deferred).
- `gsd-tools` shim resolved via `node $HOME/.claude/gsd-core/bin/gsd-tools.cjs`; tracking updated by the
  orchestrator for this human-verify checkpoint.
