# Coding Conventions

**Analysis Date:** 2026-05-24

## Naming Patterns

**Files:**
- React components: PascalCase `.tsx` — `GeoEditorView.tsx`, `ChatPanel.tsx`, `SelectionManager.ts`
- Hooks: camelCase with `use` prefix — `usePublishing.ts`, `useMapLayers.ts`
- Utility modules: camelCase — `normalizeGeoJSON.ts`, `resolveBlobReferences.ts`, `workerJsonParse.ts`
- Store slices: camelCase with `Slice` suffix — `editorCoreSlice.ts`, `publishingSlice.ts`
- Directories: kebab-case for features and libs — `geo-editor/`, `map-context/`, `seed-relay/`

**Functions:**
- Utilities and helpers: camelCase verbs — `bboxFromGeometry`, `normalizeGeoJsonToFeatureCollection`, `computeChecksum`
- Event handlers in hooks: camelCase with `handle` prefix — `handlePublishNew`, `handleDeleteDataset`, `handlePublishUpdate`
- Store actions: camelCase setters — `setMode`, `setFeatures`, `setSnappingEnabled`
- Hook-internal helpers: camelCase — `buildCollectionFromEditor`, `serializeBlobReferences`

**Variables:**
- camelCase throughout — `activeDataset`, `blobReferences`, `selectedFeatureIds`
- Boolean flags: positive (avoid negation) — `snappingEnabled`, `isDirty`, `isPublishing`

**Constants:**
- Module-level constants: `SCREAMING_SNAKE_CASE` — `BLOSSOM_UPLOAD_THRESHOLD_BYTES`, `DEFAULT_PUBLIC_RELAYS`, `GEO_COLLECTION_DRAFTS_STORAGE_KEY`
- Storage keys: namespaced with colons — `'earthly:geo-editor:collection-drafts:v1'`

**Types:**
- Interfaces: PascalCase — `EditorStats`, `MapStackEntry`, `GeoEditorOptions`
- Type aliases: PascalCase — `EditorMode`, `SidebarViewMode`, `MobilePanelSnap`
- Manager interface marker: `I` prefix for the `IManager` interface (isolated case in core)
- Prop interfaces: PascalCase with `Props` suffix — `ChatPanelProps`, `GeoMentionProps`
- Zustand slice interfaces: PascalCase with `Slice` suffix — `EditorCoreSlice`, `PublishingSlice`
- Factory/options interfaces: descriptive nouns — `BuildOptions`, `UsePublishingOptions`

**Classes:**
- PascalCase — `GeoEditor`, `GeoDataset`, `GeoDatasetFactory`, `SelectionManager`
- Class files: same name as the class — `SelectionManager.ts`, `GeoDatasetFactory` inside `factory.ts`

**React Components:**
- Named exports (not default) for all feature components — `export function ChatPanel(...)`, `export function GeoEditorView()`
- Default export only for the root `App` component

## Code Style

**Formatter:** Biome (`@biomejs/biome ^2.4.14`), config at `/Users/schlaus/workspace/earthly/biome.json`

**Key settings:**
- Indent: tabs (not spaces)
- Line width: 100 characters
- Quote style: single quotes
- Semicolons: as-needed (omit where optional)

**Linter:**
- Biome recommended ruleset (`"recommended": true`)
- Scope: `src/**/*.ts`, `src/**/*.tsx`, `src/**/*.js`, `src/**/*.jsx`
- Excluded: `src/components/ui` (Radix-based generated primitives), JSON, CSS

**Run commands:**
```bash
bun run lint        # Check with Biome
bun run lint:fix    # Auto-fix with Biome
```

## TypeScript Configuration

Config at `/Users/schlaus/workspace/earthly/tsconfig.json`.

**Strict settings enabled:**
- `strict: true` — enables all strict checks
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `verbatimModuleSyntax: true` — requires `import type` for type-only imports

**Relaxed:**
- `noUnusedLocals: false`
- `noUnusedParameters: false`

**Module resolution:** `bundler` mode — Bun handles resolution; `.ts` extension imports allowed.

**Path alias:** `@/*` maps to `./src/*` — use `@/components/...`, `@/lib/...` for cross-feature imports.

## Import Organization

Biome does not enforce import order in this project, but the observed pattern is:

1. External packages (alphabetical) — `applesauce-*`, `geojson`, `lucide-react`, `maplibre-gl`, `react`, `rxjs`, `sonner`
2. Internal `@/` absolute imports — `@/components/...`, `@/lib/...`, `@/config`
3. Relative imports from the same feature — `'../store'`, `'./types'`, `'./hooks'`

**Type imports:** Always use `import type` for type-only imports (`verbatimModuleSyntax` enforces this).

```typescript
import { castEvent } from 'applesauce-core/casts'
import type { FeatureCollection } from 'geojson'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { accounts, eventStore, publish } from '@/lib/nostr'
import type { MapContext } from '@/lib/nostr/map-context'
import { useEditorStore } from '../store'
import type { EditorBlobReference } from '../types'
```

**Path aliases:** Always use `@/` for cross-feature/cross-module imports. Use relative paths only within the same feature directory.

## Error Handling

**Strategy:** Two-tier approach:
1. User-visible: `toast.error()` / `toast.success()` from `sonner` for UI feedback
2. Developer-visible: `console.error()` / `console.warn()` with context prefix

**Error type narrowing** — always narrow unknown caught errors before using message:
```typescript
catch (error) {
  toast.error(error instanceof Error ? error.message : 'Relay list discovery failed')
}
```

**Async IIFE pattern** — use `void` operator to suppress floating promise warnings in `useEffect`:
```typescript
useEffect(() => {
  void (async () => {
    // async work
  })()
}, [])
```

**Standalone async callbacks** — suppress with `void`:
```typescript
void loadModels()
```

**User-facing error messages:** Prefer descriptive strings over raw `error.message` propagation. Pattern:
```typescript
toast.error(error instanceof Error ? error.message : 'Fallback human message')
```

## Logging

**Framework:** `console.*` (no logging library)

**Console patterns:**
- `console.error('[Module] Action failed:', error)` — errors with bracketed module prefix
- `console.warn('Descriptive message', error)` — recoverable warnings
- `console.log('[Module] Action:', { data })` — debug info with module prefix and structured data

**Prefix pattern:** `[Chat]`, `[Routstr]`, `[OG image route]` — square-bracketed module names for filtering.

## Comments

**When to comment:**
- File-level JSDoc block for all non-trivial modules — purpose, usage patterns, migration notes
- Function-level JSDoc for public API and exported utilities
- Inline comments for non-obvious logic, deferred operations, and performance decisions

**JSDoc style:**
```typescript
/**
 * Cast for kind 37515 (GeoJSON Data Event) — read-only view.
 *
 * Use `castEvent(event, GeoDataset, eventStore)` to wrap a raw NostrEvent.
 * For reactive bindings in React, prefer `castTimelineStream` or the
 * `useTimeline` helper hook combined with `.map(e => castEvent(e, GeoDataset))`.
 */
```

**Inline comments:** Used for MapLibre quirk workarounds, performance deferrals, and `void` usages to explain intent:
```typescript
// Defer layer mutations to avoid MapLibre placement crashes when style reloads.
```

**`@deprecated` tag:** Used in config interfaces to mark superseded APIs:
```typescript
/** @deprecated use `writeRelays` or `readRelays` */
```

## Function Design

**Size:** Hooks can be large (hooks in `/hooks/` average 200–550 lines each). Core editor classes run 1,800+ lines. No hard line limit enforced, but functionality is split into focused managers.

**Parameters:** Prefer options objects for hooks with multiple inputs:
```typescript
interface UsePublishingOptions {
  currentUserPubkey: string | undefined
  getDatasetName: (event: GeoDataset) => string
  mapContexts: MapContext[]
}
export function usePublishing({ currentUserPubkey, ... }: UsePublishingOptions) { ... }
```

**Return values:** Hooks return a named object of values and handlers:
```typescript
return {
  handlePublishNew,
  handlePublishUpdate,
  currentCollectionSize,
  isOverSizeLimit,
}
```

**Memoization:** All hook-returned callbacks use `useCallback`; derived values use `useMemo`. Dependencies must be complete.

## Zustand Store Pattern

Store is composed of named slices, each typed as `StateCreator<EditorState, [], [], XxxSlice>`.

```typescript
// slice definition
export const createEditorCoreSlice: StateCreator<EditorState, [], [], EditorCoreSlice> = (set, get) => ({
  // state
  features: [],
  // actions
  setFeatures: (features) => set({ features }),
})

// composed store
export const useEditorStore = create<EditorState>((...a) => ({
  ...createEditorCoreSlice(...a),
  ...createDraftSlice(...a),
}))
```

Selectors are granular — each store value is selected independently to minimize re-renders:
```typescript
const features = useEditorStore((state) => state.features)
const isDirty = useEditorStore((state) => state.isDirty)
```

## Module Design

**Exports:** Named exports for all components, hooks, utilities, and types. Default export only for `App` in `src/App.tsx`.

**Barrel files:** Used for feature directories:
- `src/features/geo-editor/hooks/index.ts` — explicit named exports (not `export *`)
- `src/lib/nostr/geo-event/index.ts` — re-exports from `cast`, `factory`, `helpers`

**Feature directory structure pattern:**
```
feature/
├── index.ts (barrel, optional)
├── store/ or store.ts
├── hooks/
│   ├── index.ts (barrel)
│   └── useXxx.ts
├── components/
│   └── Xxx.tsx
├── types.ts
├── constants.ts
└── utils.ts
```

## Builder/Factory Pattern

Complex event construction uses a fluent builder via the `applesauce-core` `EventFactory` base:

```typescript
// Factory: fluent chain, ends with .sign(signer)
const event = await GeoDatasetFactory.create(fc)
  .hashtags(['nature'])
  .withDerivedMetadata()
  .sign(signer)
await publish(event, { routing: 'outbox' })
```

Factories live in `factory.ts` files co-located with the event type.

## Zod Validation

Used for environment variable validation only — schema at `src/config/env.schema.ts`. Not used for runtime data validation beyond config.

---

*Convention analysis: 2026-05-24*
