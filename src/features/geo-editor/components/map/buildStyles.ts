import { namedFlavor, layers as protomapsLayers } from '@protomaps/basemaps'
import type maplibregl from 'maplibre-gl'
import type { PmtilesKind } from '@/lib/localPmtiles'
import type { MapSource, OverlayStyleDescriptor } from './types'

const PROTOMAPS_ATTRIBUTION =
	'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'

/*
 * MapLibre 5 renders glyphs from local device fonts when a style omits its
 * `glyphs` URL. The shared missing-image handler supplies transparent
 * placeholders for optional Protomaps pictograms when `sprite` is omitted.
 * Keeping both URLs absent makes a verified local PMTiles archive genuinely
 * self-contained instead of silently depending on a CDN after restart.
 */

/**
 * Build the inline MapLibre style for the `blossom` map source — uses the
 * Protomaps vector base layered with any chunked PMTiles raster overlays
 * announced via Nostr (`pmworld://` source resolves at fetch time).
 */
export function buildBlossomStyle(
	maxZoom: number,
	overlaysUiOrder: OverlayStyleDescriptor[],
): maplibregl.StyleSpecification {
	const baseLayers = protomapsLayers('protomaps', namedFlavor('light'), {
		lang: 'en',
	}) as maplibregl.LayerSpecification[]

	const firstSymbolIndex = baseLayers.findIndex((l) => l?.type === 'symbol')
	const insertAt = firstSymbolIndex >= 0 ? firstSymbolIndex : baseLayers.length

	const sources: maplibregl.StyleSpecification['sources'] = {
		protomaps: {
			type: 'vector',
			tiles: ['pmworld://world/{z}/{x}/{y}'],
			minzoom: 0,
			maxzoom: maxZoom,
			attribution: PROTOMAPS_ATTRIBUTION,
		},
	}

	const overlayLayers = overlaysUiOrder
		.slice()
		.reverse() // UI order is top-to-bottom; style order is bottom-to-top.
		.map((layer): maplibregl.LayerSpecification => {
			const sourceId = `layer-${layer.id}-source`
			const mapLayerId = `layer-${layer.id}`
			sources[sourceId] = {
				type: 'raster',
				tiles: [`pmtiles://${layer.fullUrl}/{z}/{x}/{y}`],
				tileSize: 256,
			}
			return {
				id: mapLayerId,
				type: 'raster',
				source: sourceId,
				layout: { visibility: layer.enabled ? 'visible' : 'none' },
				paint: { 'raster-opacity': layer.opacity },
			}
		})

	const layers = baseLayers.slice()
	layers.splice(insertAt, 0, ...overlayLayers)

	return {
		version: 8,
		sources,
		layers,
	}
}

/**
 * Build a MapLibre style for a single PMTiles vector source (the `pmtiles`
 * source mode). The PMTiles URL can be remote (https://) or local (object URL).
 */
export function buildPmtilesStyle(
	pmtilesUrl: string,
	kind: PmtilesKind = 'vector',
): maplibregl.StyleSpecification {
	const url = pmtilesUrl.startsWith('pmtiles://') ? pmtilesUrl : `pmtiles://${pmtilesUrl}`
	if (kind === 'raster') {
		return {
			version: 8,
			sources: {
				pmtiles: {
					type: 'raster',
					tiles: [`${url}/{z}/{x}/{y}`],
					tileSize: 256,
				},
			},
			layers: [{ id: 'pmtiles-raster', type: 'raster', source: 'pmtiles' }],
		}
	}
	return {
		version: 8,
		sources: {
			protomaps: {
				type: 'vector',
				url,
				attribution: PROTOMAPS_ATTRIBUTION,
			},
		},
		layers: protomapsLayers('protomaps', namedFlavor('light'), { lang: 'en' }),
	}
}

/** Resolve the PMTiles URL for a `pmtiles` source, materializing local files. */
export function resolvePmtilesUrl(source: MapSource): string | null {
	if (source.type !== 'pmtiles') return null
	if (source.location === 'local' && source.file) {
		return URL.createObjectURL(source.file)
	}
	return source.url ?? null
}
