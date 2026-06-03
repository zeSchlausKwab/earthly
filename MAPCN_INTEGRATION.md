# mapcn integration plan

Goal: replace `src/features/geo-editor/components/Map.tsx` (~894 LOC of custom MapLibre wrapper) with a thin wrapper around mapcn's `<Map>` primitive, preserving **every** custom feature.

## What mapcn gives us (free)

mapcn ships a single file at `src/components/ui/map.tsx` (53 KB) that exports:

- `<Map>` — forwardRef'd MapLibre wrapper with built-in:
  - Theme awareness (`useResolvedTheme`: watches `document.documentElement` class + system preference)
  - `MapContext` + `useMap()` hook — **same shape as our current one** (`{ map, isLoaded }`), `isLoaded` is composite of `load` + `styledata`
  - Light/dark `styles` prop with sensible CARTO defaults
  - Controlled `viewport` mode (center/zoom/bearing/pitch) with `onViewportChange`
  - `loading` indicator
  - `projection` (globe / mercator)
  - Spread-through of any `maplibregl.MapOptions`
- `<MapControls>` — composable zoom/compass/locate/fullscreen
- `<MapMarker>`, `<MarkerContent>`, `<MarkerPopup>`, `<MarkerTooltip>`, `<MarkerLabel>`
- `<MapPopup>` — standalone (not anchored to marker)
- `<MapRoute>`, `<MapArc>`, `<MapClusterLayer>`

CSS overrides for popups were appended to `styles/globals.css` by the installer.

## Public surface contract (must not break)

Our `<MapComponent>` is consumed at only 2 sites:
- `GeoEditorView.tsx:1509` — `<MapComponent className={...} onLoad={(m) => ...} mapSource={mapSource}><Editor /></MapComponent>`
- `Editor.tsx:12` — `const { map, isLoaded } = useMap()`

The new component **keeps the same export name and prop signature**:

```tsx
export const GeoEditorMap: React.FC<{
  style?: string | maplibregl.StyleSpecification
  center?: [number, number]
  zoom?: number
  children?: ReactNode
  className?: string
  onLoad?: (map: maplibregl.Map) => void
  mapSource?: MapSource
}>
```

`useMap` will be re-exported from the same module so `import { useMap } from './Map'` keeps working.

## Feature → integration strategy

| # | Feature | Strategy |
|---|---|---|
| 1 | Three `mapSource` types (default / pmtiles / blossom) | Keep `MapSource` type. Wrapper computes a `styles` prop for mapcn from the current source. For blossom, we build a vector-style derived from Protomaps + chunked-vector overlay layers. |
| 2 | `pmtiles://` + `pmworld://` protocol registration | Run once globally at module scope (idempotent flags). Same as today. |
| 3 | Nostr kind 34444 layer-set subscription | Hook `useNostrMapLayerAnnouncements(mapSource)` extracted into wrapper. Populates `useEditorStore.mapLayers` + `announcementSource`. |
| 4 | mapLayers ⟶ MapLibre layer sync (visibility/opacity for chunked-vector basemap + pmtiles/file overlays) | Hook `useMapLayerStateSync()` runs once map is loaded (`useMap().map` + `isLoaded`). RAF-batched. |
| 5 | PMTiles bounds locking | Hook `usePmtilesBoundsLock(mapSource)` post-load. |
| 6 | Style switching without map recreation | mapcn's Map already calls `setStyle({ diff: true })` when theme changes. Our wrapper passes our computed `mapSource`-derived style as the appropriate light/dark slot. When source switches, the style ref changes ⟶ mapcn re-applies. |
| 7 | `preserveDrawingBuffer: true` for canvas export | Pass through mapcn's `...MapOptions` spread. |
| 8 | `maxZoom: 22` | Same — passed via `...MapOptions`. |
| 9 | `styleimagemissing` placeholder handler | Hook `useStyleImageMissingHandler()` — adds 1×1 transparent on demand. |
| 10 | ResizeObserver auto-resize | mapcn's container is `relative h-full w-full`; MapLibre itself responds to `resize()` calls. We add a small ResizeObserver effect inside the wrapper for parity. |
| 11 | Cleanup on unmount | Handled by mapcn. |
| 12 | Module-level `pmtilesCache` | Keep — extract into its own small module to share between our custom hooks. |
| 13 | `MapContext` + `useMap` | Use mapcn's. **The hook signature is identical** (`{ map, isLoaded }`), so callers don't change. |

## Theme awareness

mapcn ships a theme detector that watches `document.documentElement` for `dark`/`light` classes (next-themes compatible) + system preference. We get this for free.

We don't yet have a theme toggle in the UI — the basemap will follow the OS preference. When we add a theme toggle later, mapcn picks it up automatically.

The implication for `mapSource`: when in `default` mode, the wrapper passes `styles={{ light: ourLightStyle, dark: ourDarkStyle }}` and lets mapcn pick. When in `pmtiles`/`blossom` mode, the same style is used for both themes (until we add a dark Protomaps flavor).

## File plan

- **New**: `src/features/geo-editor/components/map/useMapSourceStyle.ts` — computes `{ light, dark }` styles from `MapSource` + tile metadata
- **New**: `src/features/geo-editor/components/map/usePmtilesProtocols.ts` — once-only protocol registration + `pmtilesCache`
- **New**: `src/features/geo-editor/components/map/useNostrMapLayerAnnouncements.ts` — kind 34444 subscription + store sync
- **New**: `src/features/geo-editor/components/map/useMapLayerStateSync.ts` — mapLayers ⟶ MapLibre layer mutations
- **New**: `src/features/geo-editor/components/map/usePmtilesBoundsLock.ts` — bounds locking
- **New**: `src/features/geo-editor/components/map/useStyleImageMissingHandler.ts` — sprite fallback
- **Rewritten**: `src/features/geo-editor/components/Map.tsx` — small wrapper composing the above hooks + mapcn's `<Map>`, exports `GeoEditorMap`, `MapSource`, `AnnouncementRecord`, re-exports `useMap` from mapcn
- **Unchanged**: callers (`GeoEditorView.tsx`, `Editor.tsx`)

## Risks + mitigations

- **mapcn renders children inside its container** as we already do — `<Editor />` continues to work via `useMap()`.
- **mapcn's `Map` only renders `children` after `mapInstance && isLoaded`** — if our `<Editor>` had run effects before the map was ready, those would now run later. Editor.tsx already gates on `isLoaded`, so this is fine.
- **Children only render after first style load** — same gating behavior as today (we render Editor but it bails when `!isLoaded`).
- **`setStyle({ diff: true })` in mapcn vs `{ diff: false }` in our current** — for full source-type switches (default → pmtiles → blossom) we need `diff: false`. Strategy: when our wrapper detects a source-type change (not just theme), bypass mapcn's style switching and call `map.setStyle(newStyle, { diff: false })` imperatively via the ref.
