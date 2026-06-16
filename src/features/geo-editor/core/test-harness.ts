import type { Map as MapLibreMap } from 'maplibre-gl'
import { GeoEditor } from './GeoEditor'
import type { GeoEditorOptions } from './types'

/**
 * Headless test harness for {@link GeoEditor}.
 *
 * TEST-ONLY. Do NOT import this module from any production file — it fabricates
 * a MapLibre `Map` and a minimal `window` so the editor can be constructed in
 * `bun:test` with no DOM/WebGL. The mock implements exactly the `Map` surface
 * the editor + managers touch (enumerated from a live grep of GeoEditor and the
 * managers/modes under `core/`).
 *
 * Design note: `getStyle()` deliberately returns `undefined`, which makes
 * `LayerManager.isStyleReady()` return false. That keeps `setupLayers()` and
 * source resolution as safe no-ops, so rendering during `addFeature`/`render`
 * does nothing instead of touching unmocked layer internals. Behaviour that
 * does not depend on the style (feature storage, event emission, history) works
 * exactly as in production.
 */

/**
 * Install a minimal `window` global if one is absent (Bun's test runtime has no
 * DOM). GeoEditor's constructor calls `window.addEventListener` in
 * `setupEventListeners`, and the style handler uses `window.setTimeout`/
 * `clearTimeout`. We back the timer functions with the real globals.
 */
function ensureWindow(): void {
	if (typeof globalThis.window !== 'undefined') return
	const shim = {
		addEventListener: () => {},
		removeEventListener: () => {},
		setTimeout: (handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
			setTimeout(handler, timeout, ...args),
		clearTimeout: (id?: number) => clearTimeout(id),
	}
	;(globalThis as { window?: unknown }).window = shim
}

/**
 * Returns a stub implementing the MapLibre `Map` methods the editor + managers
 * call. Source/layer mutations are no-ops; getters return benign values.
 *
 * The return value is cast to `MapLibreMap` via `as unknown as` at THIS boundary
 * only — production types (`GeoEditor`'s `map: MapLibreMap` field, the managers'
 * `map` params) are never loosened to accommodate the mock.
 */
export function createMockMap(): MapLibreMap {
	const dragPanState = { enabled: true }
	const doubleClickZoomState = { enabled: true }

	const mockMap = {
		// Source/layer mutation — no-ops
		addSource: () => {},
		addLayer: () => {},
		removeLayer: () => {},
		removeSource: () => {},
		// Source/layer/style getters
		getSource: () => ({ setData: () => {} }),
		getLayer: () => undefined,
		// Returning undefined keeps LayerManager.isStyleReady() false.
		getStyle: () => undefined,
		// Viewport getters
		getZoom: () => 12,
		getCenter: () => ({ lat: 52.5, lng: 13.4 }),
		getBounds: () => ({
			getWest: () => 13.0,
			getSouth: () => 52.0,
			getEast: () => 14.0,
			getNorth: () => 53.0,
			toArray: () => [
				[13.0, 52.0],
				[14.0, 53.0],
			],
		}),
		getCanvas: () => ({
			style: { cursor: '' },
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
		}),
		// Projection
		project: (lngLat: [number, number]) => ({ x: lngLat[0], y: lngLat[1] }),
		unproject: (point: { x: number; y: number }) => ({ lng: point.x, lat: point.y }),
		// Queries
		queryRenderedFeatures: () => [],
		// Interaction sub-controllers
		dragPan: {
			isEnabled: () => dragPanState.enabled,
			enable: () => {
				dragPanState.enabled = true
			},
			disable: () => {
				dragPanState.enabled = false
			},
		},
		doubleClickZoom: {
			isEnabled: () => doubleClickZoomState.enabled,
			enable: () => {
				doubleClickZoomState.enabled = true
			},
			disable: () => {
				doubleClickZoomState.enabled = false
			},
		},
		// Rendering
		triggerRepaint: () => {},
		// Event subscription — no-ops
		on: () => {},
		off: () => {},
		once: () => {},
	}

	return mockMap as unknown as MapLibreMap
}

/**
 * Construct a real {@link GeoEditor} backed by {@link createMockMap}. The
 * returned instance supports `addFeature`/`updateFeature`/`deleteFeatures`/
 * `setFeatures`/`getAllFeatures` and `on`/`off` event subscription.
 */
export function createHeadlessEditor(options?: GeoEditorOptions): GeoEditor {
	ensureWindow()
	return new GeoEditor(createMockMap(), options)
}
