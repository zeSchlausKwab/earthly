/**
 * World basic-data layers (docs/AI_GEO_AWARENESS.md §4) — slimmed Natural Earth
 * themes plus the Eurostat searoute maritime network, served from
 * `public/static/world/` (see ATTRIBUTION.md there).
 *
 * Layers load once per session and cache as resolved FeatureCollections.
 * `preloadWorldData()` is called eagerly at chat start so the synchronous
 * consumers (map-context anchors, post-write land/water checks) usually find
 * their layer already resolved via `getLoadedWorldLayer`. Every consumer must
 * degrade gracefully when a layer is not (yet) available — world data is an
 * enhancement, never a gate.
 */

export type WorldLayerId =
	| 'land_110m'
	| 'land_50m'
	| 'coastline_110m'
	| 'countries_110m'
	| 'borders_110m'
	| 'rivers_110m'
	| 'rivers_50m'
	| 'lakes_110m'
	| 'cities_110m'
	| 'maritime_network'

export const WORLD_LAYER_IDS: WorldLayerId[] = [
	'land_110m',
	'land_50m',
	'coastline_110m',
	'countries_110m',
	'borders_110m',
	'rivers_110m',
	// 50m rivers carry NAMES for ~450 major rivers (Danube, Rhine, Nile, …) at
	// traceable fidelity — the layer for "trace river X" tasks (110m is too coarse).
	'rivers_50m',
	'lakes_110m',
	'cities_110m',
	'maritime_network',
]

/** Layers the anchor context + validation loop need; preloaded at chat start. */
export const WORLD_PRELOAD_LAYERS: WorldLayerId[] = [
	'land_50m',
	'countries_110m',
	'cities_110m',
	'coastline_110m',
]

export function worldLayerUrl(id: WorldLayerId): string {
	return `/static/world/${id}.json`
}

const layerPromises = new Map<WorldLayerId, Promise<GeoJSON.FeatureCollection>>()
const loadedLayers = new Map<WorldLayerId, GeoJSON.FeatureCollection>()

/**
 * Load a world layer (cached; concurrent callers share one fetch). Failures
 * clear the cache entry so a later call can retry (e.g. transient dev-server
 * hiccup) instead of pinning a rejected promise forever.
 */
export function loadWorldLayer(id: WorldLayerId): Promise<GeoJSON.FeatureCollection> {
	const cached = layerPromises.get(id)
	if (cached) return cached
	const promise = (async () => {
		const response = await fetch(worldLayerUrl(id))
		if (!response.ok) {
			throw new Error(`world layer ${id}: HTTP ${response.status}`)
		}
		const fc = (await response.json()) as GeoJSON.FeatureCollection
		if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
			throw new Error(`world layer ${id}: not a FeatureCollection`)
		}
		loadedLayers.set(id, fc)
		return fc
	})()
	promise.catch(() => {
		if (layerPromises.get(id) === promise) layerPromises.delete(id)
	})
	layerPromises.set(id, promise)
	return promise
}

/** Synchronous accessor: the layer if already resolved, else null (no fetch). */
export function getLoadedWorldLayer(id: WorldLayerId): GeoJSON.FeatureCollection | null {
	return loadedLayers.get(id) ?? null
}

/**
 * Eagerly kick off the core layer loads (fire-and-forget; failures are
 * swallowed here and surface as graceful degradation at the consumers).
 */
export function preloadWorldData(ids: WorldLayerId[] = WORLD_PRELOAD_LAYERS): void {
	for (const id of ids) {
		loadWorldLayer(id).catch(() => {})
	}
}

/** Test seam: install a layer without fetching (also used by Bun-side tests). */
export function primeWorldLayerForTest(id: WorldLayerId, fc: GeoJSON.FeatureCollection): void {
	loadedLayers.set(id, fc)
	layerPromises.set(id, Promise.resolve(fc))
}

/** Test seam: drop all cached layers. */
export function resetWorldDataForTest(): void {
	layerPromises.clear()
	loadedLayers.clear()
}
