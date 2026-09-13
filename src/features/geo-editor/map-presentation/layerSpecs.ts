import type * as maplibregl from 'maplibre-gl'
import {
	displayIconColorExpression,
	displayIconDiscRadiusExpression,
	displayIconImageExpression,
	displayIconSizeExpression,
	hasDisplayIconFilter,
	pointLabelAnchorExpression,
	pointLabelRadialOffsetExpression,
} from '../icons/displayIcon'
import { LINE_ARROW_IMAGE_ID } from '../icons/registerDisplayIconImages'
import { SOLID_LINE_DASH_FILTER } from '../utils/lineDashFilters'
import {
	PRESENTATION_LAYER_ROLE_ORDER,
	PRESENTATION_PROPERTY_KEYS,
	presentationStyleLayerId,
	type PresentationLayerRole,
} from './ids'
import {
	PRESENTATION_COLLAPSE_TO_POINT_PROPERTY,
	type MaterializedPresentationLayer,
} from './materialize'

export type FeatureLayerBundleIds = Readonly<Record<PresentationLayerRole, string>>
export type EarthlyFeatureLayerSpecification =
	| maplibregl.FillLayerSpecification
	| maplibregl.LineLayerSpecification
	| maplibregl.CircleLayerSpecification
	| maplibregl.SymbolLayerSpecification

export interface EarthlyFeatureLayerBundleOptions {
	readonly sourceId: string
	readonly ids: FeatureLayerBundleIds
	readonly textFont?: readonly string[] | null
	readonly visible?: boolean
	/** Omit for the legacy view-mode bundle, set for presentation instances. */
	readonly opacityMultiplierProperty?: string
	readonly collapseToPointProperty?: string
}

export const FALLBACK_TEXT_FONT_STACK = Object.freeze([
	'Open Sans Regular',
	'Arial Unicode MS Regular',
])

export function getMapStyleTextFont(
	style: maplibregl.StyleSpecification | undefined,
): string[] | null {
	const isStringArray = (value: unknown): value is string[] =>
		Array.isArray(value) && value.every((entry) => typeof entry === 'string')

	const extract = (value: unknown): string[] | null => {
		if (typeof value === 'string') return [value]
		if (isStringArray(value)) return value
		if (!Array.isArray(value) || value.length === 0) return null

		const [operator, ...parts] = value
		if (operator === 'literal' && parts.length > 0 && isStringArray(parts[0])) return parts[0]
		if (operator === 'case') {
			for (const part of parts) {
				const extracted = extract(part)
				if (extracted) return extracted
			}
		}
		return null
	}

	try {
		for (const layer of style?.layers ?? []) {
			const layout = (layer as unknown as { layout?: Record<string, unknown> }).layout
			const extracted = extract(layout?.['text-font'])
			if (extracted) return extracted
		}
	} catch {
		return null
	}
	return null
}

export function presentationLayerBundleIds(
	carrierId: string,
	layerId: string,
): FeatureLayerBundleIds {
	return Object.freeze(
		Object.fromEntries(
			PRESENTATION_LAYER_ROLE_ORDER.map((role) => [
				role,
				presentationStyleLayerId(carrierId, layerId, role),
			]),
		) as Record<PresentationLayerRole, string>,
	)
}

type Expression = maplibregl.ExpressionSpecification

function multipliedOpacity(base: number | Expression, property?: string): number | Expression {
	if (!property) return base
	return ['*', base, ['coalesce', ['get', property], 1]] as Expression
}

function collapseAwareOpacity(
	base: number | Expression,
	options: Pick<
		EarthlyFeatureLayerBundleOptions,
		'collapseToPointProperty' | 'opacityMultiplierProperty'
	>,
): number | Expression {
	const multiplied = multipliedOpacity(base, options.opacityMultiplierProperty)
	if (!options.collapseToPointProperty) return multiplied
	return [
		'case',
		['boolean', ['get', options.collapseToPointProperty], false],
		0,
		multiplied,
	] as Expression
}

function visibilityLayout(visible: boolean | undefined): maplibregl.LayerSpecification['layout'] {
	return visible === undefined ? {} : { visibility: visible ? 'visible' : 'none' }
}

/**
 * Shared author-style bundle used by both the legacy remote source and each
 * presentation instance. Presentation opacity is injected as one expression
 * input, so all geometry/symbol opacity stays in sync without rewriting data.
 */
export function buildEarthlyFeatureLayerBundle(
	options: EarthlyFeatureLayerBundleOptions,
): readonly EarthlyFeatureLayerSpecification[] {
	const { sourceId, ids, textFont } = options
	const layout = visibilityLayout(options.visible)
	const lineGeometryFilter: maplibregl.FilterSpecification = [
		'any',
		['==', ['geometry-type'], 'LineString'],
		['==', ['geometry-type'], 'MultiLineString'],
	]
	const pointGeometryFilter: maplibregl.FilterSpecification = [
		'any',
		['==', ['geometry-type'], 'Point'],
		['==', ['geometry-type'], 'MultiPoint'],
	]
	const linePaint: NonNullable<maplibregl.LineLayerSpecification['paint']> = {
		'line-color': ['coalesce', ['get', 'strokeColor'], ['get', 'color'], '#1d4ed8'],
		'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
		'line-opacity': collapseAwareOpacity(
			['coalesce', ['get', 'strokeOpacity'], 1] as Expression,
			options,
		) as maplibregl.DataDrivenPropertyValueSpecification<number>,
	}
	const multiplier = multipliedOpacity(1, options.opacityMultiplierProperty)
	const fillMultiplier = multipliedOpacity(
		['coalesce', ['get', 'fillOpacity'], 1] as Expression,
		options.opacityMultiplierProperty,
	)
	const strokeMultiplier = multipliedOpacity(
		['coalesce', ['get', 'strokeOpacity'], 1] as Expression,
		options.opacityMultiplierProperty,
	)

	const layers: EarthlyFeatureLayerSpecification[] = [
		{
			id: ids.fill,
			type: 'fill',
			source: sourceId,
			layout,
			filter: [
				'any',
				['==', ['geometry-type'], 'Polygon'],
				['==', ['geometry-type'], 'MultiPolygon'],
			],
			paint: {
				'fill-color': ['coalesce', ['get', 'fillColor'], ['get', 'color'], '#1d4ed8'],
				'fill-opacity': collapseAwareOpacity(
					['coalesce', ['get', 'fillOpacity'], 0.15] as Expression,
					options,
				) as maplibregl.DataDrivenPropertyValueSpecification<number>,
			},
		},
		{
			id: ids['polygon-stroke'],
			type: 'line',
			source: sourceId,
			layout,
			filter: [
				'any',
				['==', ['geometry-type'], 'Polygon'],
				['==', ['geometry-type'], 'MultiPolygon'],
			],
			paint: {
				'line-color': [
					'coalesce',
					['get', 'strokeColor'],
					['get', 'fillColor'],
					['get', 'color'],
					'#1d4ed8',
				],
				'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
				'line-opacity': collapseAwareOpacity(
					['coalesce', ['get', 'strokeOpacity'], 1] as Expression,
					options,
				) as maplibregl.DataDrivenPropertyValueSpecification<number>,
			},
		},
		{
			id: ids.line,
			type: 'line',
			source: sourceId,
			layout,
			filter: [
				'all',
				lineGeometryFilter as unknown as Expression,
				SOLID_LINE_DASH_FILTER as unknown as Expression,
			],
			paint: linePaint,
		},
		{
			id: ids['line-dashed'],
			type: 'line',
			source: sourceId,
			layout,
			filter: [
				'all',
				lineGeometryFilter as unknown as Expression,
				['==', ['get', 'lineDash'], 'dashed'],
			],
			paint: { ...linePaint, 'line-dasharray': [4, 2] },
		},
		{
			id: ids['line-dotted'],
			type: 'line',
			source: sourceId,
			layout,
			filter: [
				'all',
				lineGeometryFilter as unknown as Expression,
				['==', ['get', 'lineDash'], 'dotted'],
			],
			paint: { ...linePaint, 'line-dasharray': [1, 2] },
		},
		{
			id: ids['line-arrow'],
			type: 'symbol',
			source: sourceId,
			filter: ['==', ['get', 'meta'], 'arrowhead'],
			layout: {
				...layout,
				'icon-image': LINE_ARROW_IMAGE_ID,
				'icon-size': [
					'interpolate',
					['linear'],
					['coalesce', ['get', 'strokeWidth'], 2],
					1,
					0.48,
					4,
					0.62,
					10,
					0.82,
				],
				'icon-rotate': ['get', 'arrowBearing'],
				'icon-rotation-alignment': 'map',
				'icon-pitch-alignment': 'map',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
			paint: {
				'icon-color': ['coalesce', ['get', 'strokeColor'], '#1d4ed8'],
				...(options.opacityMultiplierProperty
					? {
							'icon-opacity':
								strokeMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
						}
					: { 'icon-opacity': ['coalesce', ['get', 'strokeOpacity'], 1] }),
			},
		},
		{
			id: ids.point,
			type: 'circle',
			source: sourceId,
			layout,
			filter: [
				'all',
				pointGeometryFilter,
				['!=', ['get', 'featureType'], 'annotation'],
				['!=', ['get', 'meta'], 'arrowhead'],
			],
			paint: {
				'circle-radius': [
					'case',
					hasDisplayIconFilter(),
					displayIconDiscRadiusExpression() as unknown as Expression,
					['coalesce', ['get', 'radius'], 6],
				],
				'circle-color': ['coalesce', ['get', 'color'], ['get', 'fillColor'], '#1d4ed8'],
				'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
				'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
				...(options.opacityMultiplierProperty
					? {
							'circle-opacity':
								fillMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
							'circle-stroke-opacity':
								strokeMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
						}
					: {}),
			},
		},
		{
			id: ids['point-icon'],
			type: 'symbol',
			source: sourceId,
			filter: [
				'all',
				pointGeometryFilter,
				['!=', ['get', 'featureType'], 'annotation'],
				['!=', ['get', 'meta'], 'arrowhead'],
				hasDisplayIconFilter(),
			],
			layout: {
				...layout,
				'icon-image': displayIconImageExpression(),
				'icon-size': displayIconSizeExpression(),
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
			paint: {
				'icon-color': displayIconColorExpression(),
				...(options.opacityMultiplierProperty
					? {
							'icon-opacity':
								fillMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
						}
					: {}),
			},
		},
		{
			id: ids['annotation-anchor'],
			type: 'circle',
			source: sourceId,
			layout,
			filter: [
				'all',
				['==', ['geometry-type'], 'Point'],
				['==', ['get', 'featureType'], 'annotation'],
			],
			paint: {
				'circle-radius': 4,
				'circle-color': ['coalesce', ['get', 'color'], ['get', 'fillColor'], '#f59e0b'],
				'circle-stroke-width': 2,
				'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#fff'],
				...(options.opacityMultiplierProperty
					? {
							'circle-opacity':
								fillMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
							'circle-stroke-opacity':
								strokeMultiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
						}
					: {}),
			},
		},
	]

	if (textFont) {
		layers.push(
			{
				id: ids['annotation-text'],
				type: 'symbol',
				source: sourceId,
				filter: [
					'all',
					['==', ['geometry-type'], 'Point'],
					['==', ['get', 'featureType'], 'annotation'],
				],
				layout: {
					...layout,
					'text-field': ['coalesce', ['get', 'text'], 'Annotation'],
					'text-font': [...textFont],
					'text-size': ['coalesce', ['get', 'textFontSize'], 14],
					'text-anchor': 'top',
					'text-offset': [0, 0.8],
					'text-allow-overlap': true,
					'text-ignore-placement': true,
				},
				paint: {
					'text-color': ['coalesce', ['get', 'textColor'], '#1f2937'],
					'text-halo-color': ['coalesce', ['get', 'textHaloColor'], '#ffffff'],
					'text-halo-width': ['coalesce', ['get', 'textHaloWidth'], 1.5],
					...(options.opacityMultiplierProperty
						? {
								'text-opacity':
									multiplier as maplibregl.DataDrivenPropertyValueSpecification<number>,
							}
						: {}),
				},
			},
			{
				id: ids.label,
				type: 'symbol',
				source: sourceId,
				filter: [
					'all',
					['has', 'label'],
					['!=', ['get', 'featureType'], 'annotation'],
					['!=', ['get', 'meta'], 'arrowhead'],
					['!=', ['geometry-type'], 'LineString'],
					['!=', ['geometry-type'], 'MultiLineString'],
				],
				layout: {
					...layout,
					'text-field': ['get', 'label'],
					'text-font': [...textFont],
					'text-size': 12,
					'text-anchor': pointLabelAnchorExpression() as unknown as Expression,
					'text-radial-offset': pointLabelRadialOffsetExpression(12),
					'text-allow-overlap': false,
					'text-ignore-placement': false,
				},
				paint: {
					'text-color': '#374151',
					'text-halo-color': '#ffffff',
					'text-halo-width': 1.5,
					'text-opacity': collapseAwareOpacity(
						1,
						options,
					) as maplibregl.DataDrivenPropertyValueSpecification<number>,
				},
			},
			{
				id: ids['line-label'],
				type: 'symbol',
				source: sourceId,
				filter: ['all', ['has', 'label'], lineGeometryFilter],
				layout: {
					...layout,
					'symbol-placement': 'line-center',
					'text-field': ['get', 'label'],
					'text-font': [...textFont],
					'text-size': 12,
					'text-rotation-alignment': 'map',
					'text-keep-upright': true,
					'text-allow-overlap': true,
					'text-ignore-placement': true,
				},
				paint: {
					'text-color': '#374151',
					'text-halo-color': '#ffffff',
					'text-halo-width': 1.5,
					'text-opacity': collapseAwareOpacity(
						1,
						options,
					) as maplibregl.DataDrivenPropertyValueSpecification<number>,
				},
			},
		)
	}

	return Object.freeze(layers)
}

export function buildPresentationLayerBundle(
	materialized: MaterializedPresentationLayer,
	textFont: readonly string[] = FALLBACK_TEXT_FONT_STACK,
): readonly EarthlyFeatureLayerSpecification[] {
	return buildEarthlyFeatureLayerBundle({
		sourceId: materialized.sourceId,
		ids: presentationLayerBundleIds(materialized.carrierId, materialized.layer.id),
		textFont,
		visible: materialized.layer.visible,
		opacityMultiplierProperty: PRESENTATION_PROPERTY_KEYS.opacityMultiplier,
		collapseToPointProperty: PRESENTATION_COLLAPSE_TO_POINT_PROPERTY,
	})
}
