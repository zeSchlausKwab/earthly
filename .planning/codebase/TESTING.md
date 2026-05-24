# Testing Patterns

**Analysis Date:** 2026-05-24

## Test Framework

**Runner:**
- Bun's built-in test runner (no separate Jest or Vitest)
- No config file — Bun auto-discovers test files
- Version: follows `@types/bun ^1.3.13` (Bun 1.x)

**Assertion Library:**
- Bun's built-in `expect` API (Jest-compatible)

**Run Commands:**
```bash
bun test              # Run all tests
bun test --watch      # Watch mode
bun test --coverage   # Coverage report
```

## Current State

**There are zero test files in this repository.**

A search across the entire codebase for `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx`, and `__tests__` directories returned no results. The `bun test` script in `package.json` is configured but has no tests to run.

The codebase does contain:
- `src/lib/fixtures.ts` — dev user keypairs and test constants (used by seed scripts, not unit tests)
- `scripts/seed.ts` — Faker-based data seeder for manual local testing
- `bun run seed` — generates fake datasets via relay for UI testing

## Test Infrastructure Available

Although no tests are written, the runtime fully supports testing:

**Bun test globals** (available without import):
- `describe`, `it`, `test`, `expect`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll`
- `mock()`, `spyOn()` for mocking
- `jest`-compatible matchers: `toBe`, `toEqual`, `toThrow`, `toHaveBeenCalled`, etc.

**Bun-specific test utilities:**
```typescript
import { describe, test, expect, mock, spyOn } from 'bun:test'
```

## Recommended Test File Organization

Based on the codebase structure, tests should follow co-location with source:

```
src/
├── lib/
│   ├── geo/
│   │   ├── normalizeGeoJSON.ts
│   │   └── normalizeGeoJSON.test.ts   # co-located
│   └── nostr/
│       └── geo-event/
│           ├── helpers.ts
│           └── helpers.test.ts
└── features/
    └── geo-editor/
        ├── utils.ts
        └── utils.test.ts
```

**File naming convention:** `<module>.test.ts` (not `.spec.ts`).

## What Should Be Tested (Priority Order)

### High-Value Units (Pure Functions)

**GeoJSON utilities** — `src/lib/geo/`:
- `normalizeGeoJSON.ts`: `normalizeGeoJsonToFeatureCollection`, `isGeoJsonFeature`, `isGeoJsonGeometry`
- `bbox.ts`: `bboxFromGeometry`
- `geometry.ts`: `countGeometryVertices`, `isSimplifiableGeometryType`

**Nostr event helpers** — `src/lib/nostr/geo-event/helpers.ts`:
- `computeChecksum`, `computeBboxFor`, `computeGeohashFor`
- `getBlobReferences`, `getFeatureCollection`, `getBoundingBox`

**Editor utilities** — `src/features/geo-editor/utils.ts`:
- `extractCollectionMeta`, `sanitizeEditorProperties`, `ensureFeatureCollection`

### Integration-Worthy Areas

**Factory builders** — `src/lib/nostr/geo-event/factory.ts`:
- `GeoDatasetFactory.create(fc)` chain — verify tag structure, content encoding, d-tag generation

**Blob resolution** — `src/lib/geo/resolveBlobReferences.ts`:
- `resolveGeoEventFeatureCollection` — fetch mocking, merge logic

**Context validation** — `src/lib/context/validation.ts`:
- `validateDatasetForContext`, `isDatasetAllowedByContextFilter`

## Mocking

**Framework:** Bun built-in `mock()` and `spyOn()`

**Pattern for fetch-dependent code:**
```typescript
import { mock } from 'bun:test'

const fetchMock = mock(() =>
  Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
)
global.fetch = fetchMock
```

**Pattern for module mocking:**
```typescript
import { mock } from 'bun:test'

mock.module('@/lib/nostr', () => ({
  publish: mock(() => Promise.resolve()),
  eventStore: { getEvent: mock(() => null) },
}))
```

**What to mock:**
- Network calls (`fetch`, WebSocket connections)
- Nostr relay publish/subscribe
- Blossom upload endpoints
- `crypto.randomUUID()` for deterministic IDs in snapshot tests

**What NOT to mock:**
- Pure transformation functions (test with real inputs/outputs)
- Zustand stores (use real store instances with `create()`)
- GeoJSON parsing and geometry math

## Fixtures and Factories

**Existing test data** (`src/lib/fixtures.ts`):
```typescript
export const devUser1 = {
  pk: '86a82cab...',  // public key
  sk: '5c81bffa...',  // secret key
}
// devUser1 through devUser5 available
```

**Recommended fixture structure** (to be created):
```typescript
// src/lib/test-fixtures/geo.ts
import type { FeatureCollection } from 'geojson'

export const emptyFeatureCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

export const singlePointCollection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'test-point-1',
    geometry: { type: 'Point', coordinates: [13.4, 52.5] },
    properties: { name: 'Test Point' },
  }],
}
```

## Coverage

**Requirements:** None enforced. No minimum threshold configured.

**View coverage:**
```bash
bun test --coverage
```

## Test Types

**Unit Tests:**
- Target: pure utility functions in `src/lib/geo/`, `src/lib/nostr/*/helpers.ts`, `src/features/geo-editor/utils.ts`
- Scope: single function, no I/O or DOM
- Use Bun globals directly — no imports needed for `describe`/`test`/`expect`

**Integration Tests:**
- Target: factory builders, blob resolution pipeline, context validation chains
- Scope: multiple modules interacting, with mocked network
- Use `mock.module()` to stub external dependencies

**E2E Tests:**
- Not used. No Playwright config exists, though `playwright-skill` is present in `.agents/skills/` and `.claude/skills/` — it is available for future setup.

## Example Test Structure

```typescript
// src/lib/geo/normalizeGeoJSON.test.ts
import { describe, expect, test } from 'bun:test'
import {
  isGeoJsonFeature,
  isGeoJsonFeatureCollection,
  normalizeGeoJsonToFeatureCollection,
} from './normalizeGeoJSON'

describe('normalizeGeoJsonToFeatureCollection', () => {
  test('wraps a bare Feature in a FeatureCollection', () => {
    const feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: null,
    }
    const result = normalizeGeoJsonToFeatureCollection(feature)
    expect(result.type).toBe('FeatureCollection')
    expect(result.features).toHaveLength(1)
  })

  test('returns FeatureCollection unchanged', () => {
    const fc = { type: 'FeatureCollection', features: [] }
    const result = normalizeGeoJsonToFeatureCollection(fc)
    expect(result).toEqual(fc)
  })

  test('throws on non-GeoJSON input', () => {
    expect(() => normalizeGeoJsonToFeatureCollection({ invalid: true })).toThrow()
  })
})
```

## CI/CD

No CI pipeline configured. No `.github/` directory exists. Tests must be run manually with `bun test`.

---

*Testing analysis: 2026-05-24*
