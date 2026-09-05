import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

export type BasemapStyle = string | StyleSpecification
export interface BasemapState {
	/** Safe to install application sources/layers; does not wait for basemap tiles. */
	styleReady: boolean
	status: 'loading' | 'ready' | 'error' | 'fallback'
}

export const EMPTY_BASEMAP: StyleSpecification = {
	version: 8,
	sources: {},
	layers: [{ id: 'earthly-background', type: 'background', paint: { 'background-color': '#e7e8e3' } }],
}

/** Owns readiness and recovery, not the map, camera, controls or authored data. */
export function attachBasemapLifecycle(
	map: MapLibreMap,
	initialStyle: BasemapStyle,
	onChange: (state: BasemapState) => void,
	{ timeoutMs = 12000 }: { timeoutMs?: number } = {},
) {
	let desiredStyle = initialStyle
	let state: BasemapState = { styleReady: false, status: 'loading' }
	let fallback = false
	let disposed = false
	let timeout: ReturnType<typeof setTimeout> | undefined
	let basemapSources = new Set<string>()
	const update = (next: BasemapState) => {
		if (disposed) return
		if (next.styleReady === state.styleReady && next.status === state.status) return
		state = next
		onChange(state)
	}
	const clearDeadline = () => clearTimeout(timeout)
	const startDeadline = () => {
		clearDeadline()
		timeout = setTimeout(() => update({ ...state, status: 'error' }), timeoutMs)
	}
	const onStyleLoad = () => {
		basemapSources = new Set(Object.keys(map.getStyle()?.sources ?? {}))
		update({ styleReady: true, status: fallback ? 'fallback' : state.status })
	}
	const onComplete = () => {
		if (!state.styleReady) return
		clearDeadline()
		// A tile error must not disappear merely because the map became idle.
		if (state.status === 'loading') update({ ...state, status: 'ready' })
	}
	const onError = (event: { sourceId?: string }) => {
		if (fallback || (event.sourceId && state.styleReady && !basemapSources.has(event.sourceId))) return
		clearDeadline()
		update({ ...state, status: 'error' })
	}
	const apply = (style: BasemapStyle, useFallback: boolean) => {
		fallback = useFallback
		update({ styleReady: false, status: fallback ? 'fallback' : 'loading' })
		if (fallback) clearDeadline()
		else startDeadline()
		// A complete style lifecycle lets every existing overlay restore itself.
		// Diff-only swaps need not emit style.load and could leave readiness stale.
		try { map.setStyle(style, { diff: false }) } catch { onError({}) }
	}
	map.on('style.load', onStyleLoad)
	map.on('load', onComplete)
	map.on('idle', onComplete)
	map.on('error', onError)
	startDeadline()
	return {
		setStyle(style: BasemapStyle) { desiredStyle = style; apply(style, false) },
		retry() { apply(desiredStyle, false) },
		useFallback() { apply(EMPTY_BASEMAP, true) },
		dispose() {
			disposed = true
			clearDeadline()
			map.off('style.load', onStyleLoad)
			map.off('load', onComplete)
			map.off('idle', onComplete)
			map.off('error', onError)
		},
	}
}
