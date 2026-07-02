---
status: investigating
trigger: "Phase 13 UAT Tests 5/6/7 — the entire Plan-04 Map Stack ↔ entity-layer unification UI surface appears absent in the running app; contradiction: sightings/beacons still render while Map Stack shows '0/0 visible / No map stack entries'"
created: 2026-07-02T14:30:00Z
updated: 2026-07-02T14:30:00Z
---

## Current Focus

hypothesis: CONFIRMED — the running dev server (`bun --hot`, PID 95035) started 13:00:39, ~2.5h BEFORE the Plan-03 (15:31–15:40) and Plan-04 (15:50–15:59) code existed. Bun `--hot` HMR failed to fully apply the sweeping structural change (new module-scope export, deleted `extraMapBeacons` state, added hooks changing hook-order, new props threaded through 4 files, switched useMapLayers call), leaving the running bundle in a mixed/stale state. UAT was run against this stale process at 17:12.
test: Reconcile source wiring (all correct end-to-end) vs runtime symptoms; check dev-server start time vs commit times; run committed unit tests.
expecting: If source is fully wired AND tests pass AND dev server predates the code → stale-runtime is the root cause; a clean dev restart (or the already-fresh `dist/` prod build) surfaces the UI.
next_action: Diagnosis complete — return ROOT CAUSE FOUND (stale HMR runtime). Recommend restart of dev server and re-run UAT 5/6/7.

## Symptoms

expected: |
  Test 5: Beacon/Sighting view panels + rail rows show "Add to map stack" button; clicking adds a stack entry.
  Test 6: MapStackPanel shows top-pinned "Sightings"/"Live beacons" aggregate rows; toggling removes the layer.
  Test 7: Cold-start Browse seeds both aggregate layers, visible by default.
actual: |
  Test 5: No add-to-map-stack button anywhere (view panels or rails). Beacon rail shows only locate+inspect; sighting rows show heart/bolt/share/comment/locate/inspect.
  Test 6: On /sightings, MapStackPanel shows "0/0 visible / No map stack entries" — no aggregate rows.
  Test 7: Fresh Browse does not seed aggregate layers; stack stays empty.
  CONTRADICTION: sightings + live beacon STILL RENDER on map while stack is empty.
errors: none (UI absence, not a thrown error)
reproduction: Phase 13 UAT Tests 5,6,7 at ~1900px desktop width; /sightings and landing Browse loads.
started: Discovered during Phase 13 UAT 2026-07-02. Plans 13-03 + 13-04 claim this all works.

## Eliminated

## Evidence

- timestamp: 2026-07-02T14:30:00Z
  checked: 13-03-SUMMARY + 13-04-SUMMARY claims
  found: SUMMARYs assert useMapLayers fed visibleSightingsFromStack/visibleBeaconsFromStack (caller-side), cold-start seed effect added guarded by aggregateLayersSeededRef + stance==='browse' + hydrated + no ?ms=, and AppSidebar/GeoEditorInfoPanel threaded onAddBeaconToMapStack/onAddSightingToMapStack. stackLayers.test.ts empty-stack case allegedly asserts [].
  implication: If all true at runtime, UAT should pass. UAT shows absence + render-contradiction. Must verify against ACTUAL source, not SUMMARY.

- timestamp: 2026-07-02T14:35:00Z
  checked: git — are Plan-03/04 commits ancestors of HEAD (66bae10 feature/better-map-ux)?
  found: 45936be, a219548, c8d6df4, 77071df ALL ancestors of HEAD. Code is present in the checkout.
  implication: Not a missing-commit / wrong-branch problem. Bug is in wiring or runtime.

- timestamp: 2026-07-02T14:40:00Z
  checked: GeoEditorView.tsx useMapLayers call site (L1470-1475) + selectors (L1246-1300) + deriveVisibleEntitiesFromStack (L123-174)
  found: useMapLayers IS fed visibleSightings=visibleSightingsFromStack / visibleBeacons=visibleBeaconsFromStack. useMapLayers.ts renders sightings/beacons EXCLUSIVELY from those props (L1214 buildSightingSource(visibleSightings), L1234 buildBeaconSource(visibleBeacons)); no separate always-on subscription. deriveVisibleEntitiesFromStack returns [] for an empty stack (no aggregate seed).
  implication: In SOURCE, an empty stack ⇒ [] ⇒ nothing renders. The render-contradiction (entities render while stack empty) is therefore IMPOSSIBLE against the committed source — it can only arise from a runtime that does NOT reflect the committed source.

- timestamp: 2026-07-02T14:45:00Z
  checked: MapStackPanel.tsx — where entries come from + empty-state
  found: MapStackPanel reads mapStackEntries/mapStackOrder DIRECTLY from useEditorStore (L855-856), not from props. entries.length===0 ⇒ "No map stack entries." (L1064-1071) and "0/0 visible" (L984). So the screenshot ("0/0 visible / No map stack entries") PROVES the store stack is genuinely empty at that moment.
  implication: Stack empty (per panel) BUT entities render (per map) — hard contradiction vs source. Confirms the runtime bundle diverges from committed source.

- timestamp: 2026-07-02T14:50:00Z
  checked: full wiring chain in source — GeoEditorView mount (L2385-2485, L2464-2465) → AppSidebar (declare L203/218, destructure L320/326, sightingsPanelProps.onAddToMapStack L764, beaconsPanelProps.onAddToMapStack L781, editorPanelProps.onAddSightingToMapStack L858 + onAddBeaconToMapStack L870) → GeoEditorInfoPanel (declare L176/200, destructure L259/271, forward onAddToMapStack to BeaconViewPanel L725 + SightingViewPanel L750) → SightingViewPanel L244 / BeaconViewPanel L304 render the button gated on onAddToMapStack → SightingsPanel L216/L353 + BeaconsPanel L185/L286 render rail button gated on onAddToMapStack. Cold-start seed effect L850-888 guard stance==='browse' (default per stanceSlice L20) + stackUrlHydrated (true when no ?ms=, L691-693).
  found: EVERY layer is correctly declared, destructured, and forwarded. NO code-level forwarding gap. Handlers addSightingToMapStack/addBeaconToMapStack defined L578/L598 (before mount). Both AppSidebar mounts (L2464-2465 desktop, L2816-2817) wired.
  implication: The source has no wiring bug for tests 5/6/7. All three symptoms must be explained by the runtime, not the code.

- timestamp: 2026-07-02T14:55:00Z
  checked: `git status --short` on all 9 involved source files
  found: clean — no uncommitted reverts/edits masking the committed code.
  implication: The checkout on disk == committed code. Rules out a local revert.

- timestamp: 2026-07-02T15:00:00Z
  checked: `ps` — running dev server + its start time; commit timestamps
  found: PID 95035 `bun --hot src/index.ts` STARTED Thu Jul 2 13:00:39, ELAPSED 4h17m — still running. Plan-03 code committed 15:31–15:40; Plan-04 code committed 15:50–15:59. UAT recorded 17:12 (66bae10). The dev server started ~2.5h BEFORE ANY Map Stack unification code existed and was NEVER restarted before UAT.
  implication: THE ROOT CAUSE. UAT was run against a `bun --hot` process whose live module graph predates the Plan-03/04 code. Bun HMR cannot reliably hot-apply this class of change (new module-scope export deriveVisibleEntitiesFromStack, DELETED extraMapBeacons useState [changes hook count/order of GeoEditorView → React bails fast-refresh], added useRef/useEffect/useMemo, new props threaded through AppSidebar/GeoEditorInfoPanel/view+rail panels, switched useMapLayers call). The running bundle kept the PRE-Plan-13 GeoEditorView — which still rendered sightings/beacons via the OLD always-on path (pre-gate) and had NO add-to-stack props, NO aggregate rows, NO cold-start seed. That exactly reproduces all three symptoms AND the render-contradiction: old code renders entities always-on; new MapStackPanel (if partially swapped) reads an empty store because the old code never seeds it.

- timestamp: 2026-07-02T15:05:00Z
  checked: committed logic soundness — `bun test` on stackLayers + MapStackPanel.layerEntries
  found: 13 pass / 0 fail. Empty-stack → [] verified; top-pin bucketing verified; label no-fallthrough verified.
  implication: The committed code is correct. Nothing to fix in source. A clean dev restart (kill PID 95035, `bun dev`) or the already-fresh prod `dist/` (built 16:20, AFTER the code) will surface the full Plan-03/04 UI.

## Resolution

root_cause: |
  STALE HMR RUNTIME — not a code defect. The `bun --hot src/index.ts` dev server (PID 95035) was
  started at 13:00:39 and ran continuously; the Plan-03 (15:31–15:40) and Plan-04 (15:50–15:59)
  Map Stack ↔ entity-layer unification code was written ~2.5h AFTER the server started, and the
  server was never restarted before the 17:12 UAT. Bun `--hot` HMR could not fully apply a change
  of this structural magnitude — a new module-scope export (`deriveVisibleEntitiesFromStack`), a
  DELETED `extraMapBeacons` useState (which alters GeoEditorView's hook count/order and makes React
  fast-refresh bail to a full-remount that HMR didn't perform), added useRef/useEffect/useMemo, new
  props threaded through AppSidebar → GeoEditorInfoPanel → view+rail panels, and a switched
  `useMapLayers` call site. The live bundle therefore kept the PRE-Phase-13 GeoEditorView, which
  (a) still rendered sightings/beacons via the OLD always-on subscription (before the stack-gate),
  and (b) had no add-to-stack props, no aggregate rows, and no cold-start seed. This single cause
  explains all three failing tests AND the render-contradiction: the map shows entities because the
  stale code renders them unconditionally, while the (empty) Map Stack panel is honest because the
  stale GeoEditorView never seeds aggregate entries into the store.

  The committed source is fully and correctly wired end-to-end (verified layer-by-layer) and all
  13 relevant unit tests pass. There is NO code-level forwarding gap, NO never-firing guard, and
  the `useMapLayers` switch IS in place — contrary to the three hypotheses (a)/(b)/(c) posed in the
  task; those would all be real bugs IF the runtime reflected the source, but it does not.
fix: |
  No source change required. Restart the dev server so the running bundle reflects the committed
  code, then re-run UAT Tests 5/6/7:
    kill 95035   (or Ctrl-C the `bun dev` in that terminal)
    bun dev      (fresh `bun --hot` picks up the full Plan-03/04 module graph)
  A hard browser reload after restart is also advisable to drop any stale client bundle. The prod
  `dist/` build (16:20, post-code) already contains the correct code, so `bun run build && bun start`
  would also surface it.
verification: |
  Committed logic verified: `bun test GeoEditorView.stackLayers.test.ts MapStackPanel.layerEntries.test.ts`
  → 13 pass / 0 fail. Full source wiring chain traced and confirmed intact (see Evidence). Runtime
  cause confirmed by `ps` start-time (13:00:39) predating all Plan-03/04 commit times (15:31–15:59).
  FINAL end-to-end confirmation (dev restart + UAT 5/6/7 re-run) is a human step — this is a
  diagnose-only (find_root_cause_only) session; no fix applied.
files_changed: []
