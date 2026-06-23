---
phase: 02-tool-registry-authoring-api
plan: 05
subsystem: authoring-primitives
tags: [tools-01, primitives, circle, buffer, turf, authoring-api, d-13, d-14, d-15, d-16, v5-dos]

# Dependency graph
requires:
  - phase: 02
    plan: 02
    provides: createAuthoring(editor) facade + MutationResult/MutationIntent contract — the geometry-mutation seam circle/buffer draw through
  - phase: 02
    plan: 04
    provides: unified typed registry (register/dispatch/advertise + ToolEntry{kind}) + ToolError(handler_error) contract the primitive tools surface errors through
provides:
  - "TOOLS-01 — parametric circle + buffer as Authoring API methods (authoring.circle / authoring.buffer) AND as registered AI tools (draw_circle / buffer_feature, kind:'authoring-primitive')"
  - "primitives.ts — makeCircle/makeBuffer turf wrappers with bounded radius/distance validation (V5/T-02-14); meters canonical (D-14); makeBuffer returns undefined un-coerced for degenerate input (T-02-15)"
  - "authoring.buffer by-id composition (D-11/D-15): returns [sourceId, newId] so Phase 4 can chain 'buffer the circle I just drew'"
affects: ["02-06 (also edits definitions-derived registry surface)", "Phase 4 (sandbox composition: buffer the circle I just drew)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Primitive geometry lives in the standalone api/ layer (D-07 boundary): primitives.ts imports ONLY @turf/turf + geojson types, no chat/registry/Nostr"
    - "AI tool handler resolves active editor → createAuthoring → authoring.circle/buffer (never editor.* directly; A3 boundary preserved)"
    - "Validate-before-turf: radius/distance rejected (finite/>0/bounded) BEFORE turf runs so unbounded/NaN input can't freeze the main thread (V5/T-02-14)"
    - "turf buffer undefined null-checked → { ok:false } MutationResult → thrown at tool layer → ToolError(handler_error) (D-16 self-correction)"

key-files:
  created:
    - src/features/geo-editor/api/primitives.ts
    - src/features/geo-editor/api/primitives.test.ts
    - src/features/chat/tools/primitives-tools.ts
  modified:
    - src/features/geo-editor/api/authoring.ts
    - src/features/geo-editor/api/index.ts
    - src/features/geo-editor/api/boundary.test.ts
    - src/features/chat/tools/registry.ts
    - src/features/chat/tools/registry.test.ts

key-decisions:
  - "[02-05]: MAX_DISTANCE_METERS = 40,075,000 (Earth's equatorial circumference) is the V5 DoS cap; radius/distance is normalized to meters (kilometers×1000, miles×1609.344) before the at-or-above-cap rejection so the bound is unit-independent. Rejection throws InvalidPrimitiveArgError — never silent geometry."
  - "[02-05]: turf circle's own default unit is 'kilometers'; primitives.ts OVERRIDES the default to 'meters' (D-14 canonical) — callers/tools must still pass radius explicitly (no magic default radius)."
  - "[02-05]: authoring.buffer(featureId) returns featureIds = [sourceId, newId] (source FIRST), so the tool maps bufferedFeatureId = featureIds[1]; raw-geojson buffer returns [newId] only. This is the D-11/D-15 composition contract Phase 4 chains on."
  - "[02-05]: Primitive tools supply their schema INLINE (like editor_* commands) rather than via schemas.ts — they are not part of the static migrated set, so definitions.ts (geoTools = advertise()) picks them up automatically with ZERO edits (D-04), keeping the file untouched for Plan 06 merge cleanliness."
  - "[02-05]: Tool-layer error surfacing = THROW (not a {ok:false} return) so registry.dispatch wraps it as ToolError(handler_error); unknown id, degenerate buffer, non-finite radius, and missing editor all become structured ToolErrors fed back to the model loop (D-16)."

requirements-completed: [TOOLS-01]

# Metrics
duration: 12min
completed: 2026-06-16
---

# Phase 2 Plan 05: Parametric Circle + Buffer Primitives Summary

**Shipped the first capability built on the Authoring API: parametric `circle` and `buffer` as Authoring API methods FIRST (`authoring.circle` / `authoring.buffer`, in the standalone `api/` layer) and registered AI tools SECOND (`draw_circle` / `buffer_feature`, `kind:'authoring-primitive'`). Both wrap turf's `circle`/`buffer` (previously installed-but-unused), draw immediately AND return structured `MutationResult`s — satisfying TOOLS-01 and ROADMAP criterion #4. Meters is canonical (D-14, no magic default radius); radius/distance is bounded (V5/T-02-14 DoS mitigation); a degenerate buffer (turf → `undefined`) and an unknown feature id yield `{ ok:false }` / a structured `ToolError`, never a crash (D-16/T-02-15/T-02-16).**

## Method + tool signatures (for Phase 4 — wire to this)

### Authoring API methods (api/authoring.ts)
```ts
authoring.circle(center: [lon, lat], radius: number, opts?: { units?; steps? }): MutationResult
  // draws a Polygon; returns { ok:true, intent:'add', featureIds:[newId], counts.created:1 }
  // throws InvalidPrimitiveArgError on a non-finite/negative/zero/absurd radius (no geometry)

authoring.buffer(target: string | Feature | Geometry, distance: number, opts?: { units? }): MutationResult
  // by-id  → resolves editor.getFeature(id); featureIds = [sourceId, newId]  (D-11/D-15 composition)
  // raw    → featureIds = [newId]
  // unknown id        → { ok:false } (T-02-16)
  // turf returns undef → { ok:false } (T-02-15)
  // throws InvalidPrimitiveArgError on a bad distance (V5)
```

### turf wrappers (api/primitives.ts — exported from the api barrel)
```ts
makeCircle(center, radius, { units='meters', steps? }): Feature<Polygon>   // ring = steps+1 pts
makeBuffer(geom: Feature|Geometry, distance, { units='meters' }): Feature | undefined  // undef un-coerced
// DEFAULT_UNITS='meters'; MAX_DISTANCE_METERS=40_075_000; InvalidPrimitiveArgError; PrimitiveUnits='meters'|'kilometers'|'miles'
```

### Registered AI tools (chat/tools/primitives-tools.ts)
- `draw_circle` — params `center:[lon,lat]`, `radius:number` (required), `units:enum` (required; meters|kilometers|miles). Returns `{ ok, featureId, featureIds, counts }`.
- `buffer_feature` — params `featureId:string` (preferred) OR `geojson:object`, `distance:number` (required), `units:enum` (required). Returns `{ ok, sourceFeatureId, bufferedFeatureId, featureIds, counts }`.
- Both `kind:'authoring-primitive'`, no origin, advertised automatically via `registry.advertise()`.

## What Shipped

### Task 1 — turf wrappers + authoring.circle/buffer — commit `c6d2dfb`
- `primitives.ts`: `makeCircle`/`makeBuffer` over `@turf/turf`; `validateDistance` (finite, > 0, ≤ MAX_DISTANCE_METERS after unit normalization) throwing `InvalidPrimitiveArgError`; meters override (D-14); `makeBuffer` wraps a bare Geometry in a Feature to select turf's single-feature overload and returns `undefined` un-coerced.
- `authoring.ts`: added `circle` (→ `makeCircle` → reuse `addFeature` add path) and `buffer` (by-id via `editor.getFeature` → `{ ok:false }` on miss; raw geometry; `makeBuffer` undefined → `{ ok:false }`; success returns `[sourceId, newId]` when by-id).
- `index.ts`: barrel exports the primitives surface.
- `boundary.test.ts`: updated the geometry-only surface assertion to include `buffer`/`circle` (still no signer/wallet/store leak — V4/T-02-03 intact).
- `primitives.test.ts`: 21 tests — ring shape (steps+1), explicit steps, meters-vs-km span, NaN/Inf/-5/0/over-cap rejections, buffer Feature + bare Geometry, by-id composition (`[sourceId,newId]`), raw buffer, unknown-id `{ok:false}`, degenerate-buffer `{ok:false}`.

### Task 2 — register draw_circle + buffer_feature — commit `842cd2e`
- `primitives-tools.ts`: `registerPrimitiveTools()` registers both tools (`kind:'authoring-primitive'`); handlers resolve the active editor (`useEditorStore.getState().editor`) → `createAuthoring` → `authoring.circle/buffer`; inline OpenAI schemas with required radius/distance + explicit `units` enum (D-14); unknown id / degenerate buffer / bad radius / missing editor all THROW → `ToolError(handler_error)` (D-16).
- `registry.ts`: `registerPrimitiveTools()` wired into `bootstrapRegistry()` (import-cycle-safe: `register` is defined before bootstrap runs).
- `registry.test.ts`: +6 tests — kind assertions, schema required-radius/distance + units enum, `dispatch('draw_circle')` draws a Polygon via authoring, `dispatch('buffer_feature', {featureId})` buffers + returns source+new ids, missing-id → `ToolError(handler_error)`, NaN-radius → `ToolError`.

## How buffer-by-id composition returns source + new ids (Phase 4 reference)

`authoring.buffer('feat-123', 500, {units:'meters'})` →
1. `editor.getFeature('feat-123')` resolves the source (or `{ ok:false }` if missing).
2. `makeBuffer(sourceFeature, 500, ...)` → buffered Feature (or `{ ok:false }` if turf returns undefined).
3. `addFeature(buffered)` → new id via the canonical add path.
4. Result `featureIds = [sourceId, newId]` (source first). The `buffer_feature` tool maps `sourceFeatureId = featureId`, `bufferedFeatureId = featureIds[1]`.

Raw-geometry buffer (no id) skips step 1 and returns `featureIds = [newId]` only. This lets a Phase 4 sandbox chain `draw_circle` → capture `featureId` → `buffer_feature` against it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test] Updated boundary.test.ts geometry-only surface assertion**
- **Found during:** Task 1
- **Issue:** `boundary.test.ts` asserts the exact Authoring surface keys (`['addFeature','editorCommand','writeGeoJSON']`). Adding the two new geometry methods (`circle`/`buffer`) failed that equality check.
- **Fix:** Extended the expected key list to `['addFeature','buffer','circle','editorCommand','writeGeoJSON']`. `circle`/`buffer` are geometry-mutation methods — part of the geometry-only surface; the forbidden-key checks (signer/wallet/store/getState/editor/eventStore/accounts) are unchanged and still pass, so V4/T-02-03 is intact.
- **Files modified:** `src/features/geo-editor/api/boundary.test.ts`
- **Commit:** `c6d2dfb`

**2. [Note — not a deviation] definitions.ts left untouched**
- The plan's `files_modified` listed `definitions.ts`, but it is purely derived (`geoTools = advertise()`). The new tools appear automatically once registered (D-04). Leaving it untouched satisfies the Plan 06 coordination note (minimal/localized edits to the shared registry surface for clean merge).

## Threat Model Compliance
- **T-02-14 (DoS — unbounded/NaN/Infinity radius):** mitigated. `validateDistance` rejects NaN/Infinity/negative/zero and caps at MAX_DISTANCE_METERS (unit-normalized) BEFORE turf runs. Asserted in `primitives.test.ts` (NaN/Inf/-5/0/over-cap) and `registry.test.ts` (NaN radius → ToolError). Off-thread execution remains Phase 7's concern (forward-coupling noted).
- **T-02-15 (Tampering — turf buffer returns undefined):** mitigated. `makeBuffer` returns `undefined` un-coerced; `authoring.buffer` null-checks → `{ ok:false }`; the tool throws → `ToolError(handler_error)`. Asserted (degenerate GeometryCollection → `{ok:false}`; tool path covered by missing-id ToolError).
- **T-02-16 (Repudiation — buffer-by-id missing feature silent no-op):** mitigated. `authoring.buffer(unknownId)` → `{ ok:false }`; `buffer_feature` throws a named not-found error → structured ToolError. Asserted in both test files.
- **T-02-SC (package installs):** none — turf already present, zero new packages.

## Gates
- `bun test src/features/geo-editor/api/primitives.test.ts` — 21 pass / 0 fail.
- `bun test src/features/chat/tools/registry.test.ts` — 13 pass / 0 fail.
- `bun test src/features/chat/tools src/features/geo-editor` — 77 pass / 0 fail.
- `bun test` (full repo) — 104 pass / 0 fail.
- `bun run build` — succeeds (~765ms).
- `bunx biome lint` on all changed files — clean, no diagnostics.

## Known Stubs
None. circle/buffer draw real geometry, return real ids, and are dispatchable end-to-end on a headless editor.

## Next Phase Readiness
- Plan 06 (mcp-sync, D-05) edits the same registry surface AFTER this plan in the wave — definitions.ts was left untouched and the primitive tools register via the dynamic `register(...)` path, so the merge is clean.
- Phase 4's sandbox can compose `draw_circle` → `buffer_feature` using the `[sourceId, newId]` contract documented above, and inherits the D-16 ToolError self-correction loop for degenerate inputs.

## Self-Check: PASSED
- Files verified present: `api/primitives.ts`, `api/primitives.test.ts`, `chat/tools/primitives-tools.ts` (created); `api/authoring.ts`, `api/index.ts`, `api/boundary.test.ts`, `chat/tools/registry.ts`, `chat/tools/registry.test.ts` (modified).
- Commits verified in git log: `c6d2dfb` (Task 1), `842cd2e` (Task 2).

---
*Phase: 02-tool-registry-authoring-api*
*Completed: 2026-06-16*
