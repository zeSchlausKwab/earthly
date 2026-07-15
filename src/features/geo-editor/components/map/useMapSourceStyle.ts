import type maplibregl from 'maplibre-gl'
import { useMemo } from 'react'
import { useEditorStore, type MapLayerState } from '../../store'
import { buildBlossomStyle, buildPmtilesStyle, resolvePmtilesUrl } from './buildStyles'
import type { MapSource, OverlayStyleDescriptor } from './types'

/**
 * Default remote style URL used when `mapSource.type === 'default'` and no
 * explicit `style` was passed in. Kept as a constant to make the wrapper's
 * default obvious; mapcn would otherwise pick CARTO basemaps via its own
 * `defaultStyles`. We use OpenFreeMap Liberty to match the prior behavior.
 */
export const DEFAULT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export interface ResolvedStyle {
	/** A stable identity for cache-busting / "did the source change" detection. */
	key: string
	/** Style passed to MapLibre — either a URL or an inline spec. */
	style: string | maplibregl.StyleSpecification
}

interface UseMapSourceStyleOpts {
	mapSource: MapSource
	/** Maximum zoom for the chunked-vector basemap; null until announcement-probed. */
	tileSourceMaxZoom: number | null
	/** Overlay descriptors derived from mapLayers (blossom mode only). */
	overlays: OverlayStyleDescriptor[]
	/** Caller-supplied default style URL (overrides DEFAULT_STYLE_URL). */
	defaultStyle?: string | maplibregl.StyleSpecification
}

/**
 * Compute the MapLibre style for the current `MapSource`.
 *
 * Returned `key` changes when a full restyle is required (source type change
 * or blossom overlay topology change). Theme/visibility/opacity changes do
 * NOT bump the key — those are applied incrementally via
 * `useMapLayerStateSync`.
 */
export function useMapSourceStyle({
	mapSource,
	tileSourceMaxZoom,
	overlays,
	defaultStyle,
}: UseMapSourceStyleOpts): ResolvedStyle | null {
	return useMemo<ResolvedStyle | null>(() => {
		if (mapSource.type === 'blossom') {
			if (tileSourceMaxZoom === null) return null
			// Signature intentionally excludes enabled/opacity — those are
			// applied incrementally so toggling/sliders don't force restyle.
			const signature = overlays.map((o) => `${o.id}:${o.fullUrl}`).join('|')
			return {
				key: `pmworld:${tileSourceMaxZoom}:overlays:${signature}`,
				style: buildBlossomStyle(tileSourceMaxZoom, overlays),
			}
		}

		if (mapSource.type === 'pmtiles') {
			const url = resolvePmtilesUrl(mapSource)
			if (!url) return null
			const pmtilesUrl = url.startsWith('pmtiles://') ? url : `pmtiles://${url}`
			return {
				key: `${pmtilesUrl}:${mapSource.pmtilesKind ?? 'vector'}`,
				style: buildPmtilesStyle(url, mapSource.pmtilesKind),
			}
		}

		// default
		const fallback = defaultStyle ?? DEFAULT_STYLE_URL
		const key = typeof fallback === 'string' ? fallback : '__inline_default_style__'
		return { key, style: fallback }
	}, [mapSource, tileSourceMaxZoom, overlays, defaultStyle])
}

/**
 * Read `mapLayers` from the store and project to `OverlayStyleDescriptor[]`
 * for the blossom map source. Returns `[]` for non-blossom sources.
 */
export function useBlossomOverlays(
	mapSource: MapSource,
	defaultBlossomServer: string | undefined,
): OverlayStyleDescriptor[] {
	const mapLayers = useEditorStore((state) => state.mapLayers)
	return useMemo(() => {
		if (mapSource.type !== 'blossom') return []
		return mapLayers
			.filter((layer: MapLayerState) => layer.kind === 'pmtiles' || layer.kind === 'file')
			.map<OverlayStyleDescriptor | null>((layer) => {
				if (!layer.file) return null
				// Skip vector-only layers; allow raster, webp, or unspecified
				if (layer.pmtilesType === 'vector') return null

				const server = layer.blossomServer?.trim() || defaultBlossomServer
				if (!server) return null

				const fullUrl = `${server.replace(/\/+$/, '')}/${layer.file.replace(/^\/+/, '')}`
				return { id: layer.id, fullUrl, enabled: layer.enabled, opacity: layer.opacity }
			})
			.filter((v): v is OverlayStyleDescriptor => v !== null)
	}, [mapLayers, mapSource.type, defaultBlossomServer])
}
