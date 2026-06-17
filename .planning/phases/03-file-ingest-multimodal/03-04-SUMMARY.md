---
phase: 03-file-ingest-multimodal
plan: 04
subsystem: ai
tags: [vision, multimodal, ollama, routstr, image_url, fail-safe, caching]

# Dependency graph
requires:
  - phase: 02-tool-registry
    provides: chat tool loop + capture_map_snapshot one-shot + ProviderConfig
provides:
  - "detectVisionSupport(provider, modelId): Promise<VisionSupport> — D-07 layered, cached, fail-safe vision-capability ladder"
  - "VisionSupport union ('vision' | 'no-vision' | 'uncertain') — the contract Plan 06's VisionGateControl three-tier UI consumes"
  - "clearVisionCache() test seam"
  - "store.ts: canUseVision + capture_map_snapshot gate unified on the single ladder (D-09)"
affects: [03-file-ingest-multimodal Plan 06 (VisionGateControl UI / user-attached image path)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-branched capability ladder: native endpoint (Ollama /api/show) → OpenAI /v1/models → name heuristic → fail-safe"
    - "Per-(type,baseUrl,modelId) Map cache for network capability probes; never-throws degradation"

key-files:
  created:
    - src/features/chat/vision/detectVisionSupport.ts
    - src/features/chat/vision/detectVisionSupport.test.ts
  modified:
    - src/features/chat/store.ts

key-decisions:
  - "Ollama vision read from POST /api/show capabilities[] (its /v1/models surface omits them); /v1 stripped before /api/show"
  - "Name heuristic returns 'uncertain' (NOT confirmed) — drives Plan 06 opt-in, never the autonomous snapshot send"
  - "Autonomous capture_map_snapshot path sends only on confirmed 'vision'; 'uncertain'/'no-vision' suppress the silent send (acceptance criterion #4)"
  - "Detection resolved once per request before the tool loop; cache makes the snapshot-gate reuse free (D-09 single source)"

patterns-established:
  - "Capability ladder degrades to name heuristic on any fetch error and never throws (T-03-13)"
  - "entryAdvertisesImage() treats 'capability data present but no image/vision' as authoritative no-vision; absent data falls through"

requirements-completed: [INGEST-07]

# Metrics
duration: 4min
completed: 2026-06-17
---

# Phase 3 Plan 04: Vision-Detection Ladder Summary

**Layered, cached, fail-safe `detectVisionSupport` ladder (Ollama `/api/show` → `/v1/models` → name heuristic → no-vision) now the single source of truth gating both image paths, so an image is never silently sent to a blind model.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-17T07:28:18Z
- **Completed:** 2026-06-17T07:32:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `detectVisionSupport(provider, modelId): Promise<VisionSupport>` implementing the full D-07 ladder, cached per `(type, baseUrl, modelId)`, never throwing on fetch failure.
- Ollama branch hits native `POST {baseUrl-without-/v1}/api/show` and reads `capabilities[]` (its OpenAI `/v1/models` surface omits them).
- Other providers reuse the `/v1/models` + `Authorization: Bearer` idiom, reading `capabilities` / `input_modalities` / `architecture.input_modalities` for an image/vision modality.
- `store.ts` rewired so `canUseVision` and the `capture_map_snapshot` one-shot both derive from one awaited ladder result (D-09); name-only `modelMaySupportVision` removed (demoted to the ladder's tier-3 hints).
- 20 ladder tests (all four tiers + network-failure degradation + caching) + 8 existing store tests green; `bun run build` and biome clean.

## Contract for Plan 06

```ts
export type VisionSupport = 'vision' | 'no-vision' | 'uncertain'
export async function detectVisionSupport(
  provider: ProviderConfig,
  modelId: string,
): Promise<VisionSupport>
export function clearVisionCache(): void
```

- `'vision'` — authoritative confirm (provider API). Autonomous snapshot send is allowed.
- `'no-vision'` — authoritative deny OR fail-safe default. Plan 06 UI hard-disables image attach.
- `'uncertain'` — name heuristic matched but no authoritative data. Plan 06 UI offers opt-in; the autonomous snapshot loop NEVER sends.

**Snapshot path gating:** `canUseVision = (detectVisionSupport(...) === 'vision') && effectiveContextTokens >= MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE`. The `capture_map_snapshot` gate (`if (canUseVision && toolCall.function.name === 'capture_map_snapshot')`) pushes the `{ type:'image_url', image_url:{ url } }` content-part only when confirmed-vision; `'uncertain'`/`'no-vision'` suppress the autonomous send.

## Task Commits

1. **Task 1 (RED): failing tests for the ladder** - `674b714` (test)
2. **Task 1 (GREEN): implement detectVisionSupport ladder** - `b813495` (feat)
3. **Task 2: route both image paths through the ladder (D-09)** - `6284c50` (feat)

_TDD task 1 was committed as test → feat; no refactor commit needed._

## Files Created/Modified

- `src/features/chat/vision/detectVisionSupport.ts` - The D-07 ladder + `VisionSupport` union + `clearVisionCache()`.
- `src/features/chat/vision/detectVisionSupport.test.ts` - 20 mocked-fetch tests covering all four tiers, degradation, and caching.
- `src/features/chat/store.ts` - `canUseVision` and the snapshot gate now consume the awaited ladder; `modelMaySupportVision` removed; import added.

## Decisions Made

- Ollama capabilities read from native `/api/show` (not `/v1/models`) — Pitfall 1.
- Tier-2 `entryAdvertisesImage()` also accepts a `'vision'` entry (not just `'image'`) in a capabilities array, since some OpenAI-compatible providers label it that way; absence of all capability fields falls through to the heuristic rather than asserting no-vision.
- Autonomous snapshot path is confirmed-vision-only; `'uncertain'` opt-in is deferred to the Plan 06 UI per D-08.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Model Verification

All four registered threats mitigated as planned:
- **T-03-10** (silent send to blind model): autonomous path sends only on `'vision'`; fail-safe default is `'no-vision'`.
- **T-03-11** (SSRF): fetch target is always `provider.baseUrl` + a fixed path (`/api/show` or `/models`), never derived from file content/model output.
- **T-03-12** (DoS repeated probes): per-`(type,baseUrl,modelId)` cache; one network call per model per session.
- **T-03-13** (provider down / CORS): caught → degrade to name heuristic → never throws.

No new security surface introduced beyond the planned threat model.

## Issues Encountered

None. Biome reflowed one long test assertion on auto-fix; tests re-verified green afterward.

## Known Stubs

None - both image paths are fully wired to a live capability source.

## Next Phase Readiness

- Plan 06's `VisionGateControl` can consume `detectVisionSupport` + the `VisionSupport` union directly for the three-tier UI (D-08).
- The user-attached image path (Plan 06) should gate on the same `detectVisionSupport` result to honor D-09.

## Self-Check: PASSED

- FOUND: src/features/chat/vision/detectVisionSupport.ts
- FOUND: src/features/chat/vision/detectVisionSupport.test.ts
- FOUND commits: 674b714 (test), b813495 (feat), 6284c50 (feat)

---
*Phase: 03-file-ingest-multimodal*
*Completed: 2026-06-17*
