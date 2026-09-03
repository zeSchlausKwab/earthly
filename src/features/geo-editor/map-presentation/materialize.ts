import { bbox as turfBbox, pointOnFeature } from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, Point, Position } from 'geojson'
import {
	getPresentationFeatureId,
	parseMapPresentationSource,
	selectPresentationFeatures,
	type MapPresentationLayerV1,
} from '@/lib/map-presentation'
import { collectLineArrowFeatures } from '../utils/lineArrows'
import {
	PRESENTATION_PROPERTY_KEYS,
	presentationFeatureRenderId,
	presentationGeometryChoiceId,
	presentationInstanceId,
	presentationSourceId,
	readPresentationFeatureProvenance,
} from './ids'

export const PRESENTATION_COLLAPSE_TO_POINT_PROPERTY = 'collapseToPointProxy'

const GEOMETRY_PROXY_MAX_DIMENSION_PX = 24
const GEOMETRY_PROXY_MAX_AREA_PX = 400
const LINE_PROXY_MAX_LENGTH_PX = 18

export interface GeometryProjectionMap {
	project(coordinates: [number, number]): { readonly x: number; readonly y: number }
}

export function isPointGeometryType(type: string | undefined): boolean {
	return type === 'Point' || type === 'MultiPoint'
}

export function isAnnotationFeature(feature: Feature): boolean {
	return (feature.properties as Record<string, unknown> | undefined)?.featureType === 'annotation'
}

function shouldRenderGeometryAsPointProxy(feature: Feature): boolean {
	return !isPointGeometryType(feature.geometry?.type) && !isAnnotationFeature(feature)
}

function getProjectedLineLengthPx(map: GeometryProjectionMap, coordinates: Position[]): number {
	let total = 0
	for (let index = 1; index < coordinates.length; index += 1) {
		const previous = coordinates[index - 1]
		const current = coordinates[index]
		if (!previous || !current) continue
		const previousLongitude = previous[0]
		const previousLatitude = previous[1]
		const currentLongitude = current[0]
		const currentLatitude = current[1]
		if (
			typeof previousLongitude !== 'number' ||
			typeof previousLatitude !== 'number' ||
			typeof currentLongitude !== 'number' ||
			typeof currentLatitude !== 'number'
		) {
			continue
		}

		const previousPoint = map.project([previousLongitude, previousLatitude])
		const currentPoint = map.project([currentLongitude, currentLatitude])
		total += Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y)
	}
	return total
}

function getGeometryProjectedLengthPx(
	map: GeometryProjectionMap,
	geometry: Geometry,
): number | null {
	if (geometry.type === 'LineString') {
		return getProjectedLineLengthPx(map, geometry.coordinates)
	}
	if (geometry.type === 'MultiLineString') {
		return geometry.coordinates.reduce(
			(total, line) => total + getProjectedLineLengthPx(map, line),
			0,
		)
	}
	return null
}

/** Existing tiny-geometry heuristic, shared by author and presentation sources. */
export function shouldCollapseGeometryToPointProxy(
	map: GeometryProjectionMap,
	feature: Feature,
): boolean {
	if (!shouldRenderGeometryAsPointProxy(feature)) return false

	try {
		const [west, south, east, north] = turfBbox(feature)
		if (
			typeof west !== 'number' ||
			typeof south !== 'number' ||
			typeof east !== 'number' ||
			typeof north !== 'number' ||
			![west, south, east, north].every((value) => Number.isFinite(value)) ||
			east < west ||
			north < south
		) {
			return false
		}

		const northWest = map.project([west, north])
		const southEast = map.project([east, south])
		const width = Math.abs(southEast.x - northWest.x)
		const height = Math.abs(southEast.y - northWest.y)
		const area = width * height
		const maxDimension = Math.max(width, height)
		const projectedLength = feature.geometry
			? getGeometryProjectedLengthPx(map, feature.geometry)
			: null

		if (projectedLength !== null) {
			return (
				Number.isFinite(projectedLength) &&
				projectedLength <= LINE_PROXY_MAX_LENGTH_PX &&
				maxDimension <= GEOMETRY_PROXY_MAX_DIMENSION_PX
			)
		}

		return (
			Number.isFinite(maxDimension) &&
			Number.isFinite(area) &&
			maxDimension <= GEOMETRY_PROXY_MAX_DIMENSION_PX &&
			area <= GEOMETRY_PROXY_MAX_AREA_PX
		)
	} catch {
		return false
	}
}

/** Build a styled point proxy without losing source or presentation identity. */
export function buildGeometryProxyFeature(feature: Feature): Feature<Point> | null {
	if (!shouldRenderGeometryAsPointProxy(feature)) return null

	try {
		const representative = pointOnFeature(feature)
		const sourceBbox = turfBbox(feature)
		const properties = (feature.properties ?? {}) as Record<string, unknown>
		const color =
			typeof properties.color === 'string'
				? properties.color
				: typeof properties.fillColor === 'string'
					? properties.fillColor
					: typeof properties.strokeColor === 'string'
						? properties.strokeColor
						: undefined
		const strokeColor =
			typeof properties.strokeColor === 'string' ? properties.strokeColor : '#ffffff'
		const presentationRenderId = properties[PRESENTATION_PROPERTY_KEYS.renderId]
		const proxyId = `${
			typeof presentationRenderId === 'string'
				? presentationRenderId
				: (feature.id ?? properties.featureId ?? 'feature')
		}:geometry-proxy`
		return {
			type: 'Feature',
			id: proxyId,
			geometry: representative.geometry,
			properties: {
				...properties,
				...(color ? { color } : {}),
				proxyFeature: true,
				sourceGeometryType: feature.geometry?.type ?? 'Unknown',
				proxySourceBbox: sourceBbox,
				strokeColor,
				radius: typeof properties.radius === 'number' ? properties.radius : 5,
				[PRESENTATION_COLLAPSE_TO_POINT_PROPERTY]: false,
				...(typeof presentationRenderId === 'string'
					? { [PRESENTATION_PROPERTY_KEYS.renderId]: proxyId }
					: {}),
			},
		}
	} catch {
		return null
	}
}

export interface PresentationSourceEventIdentity {
	readonly id: string
	readonly pubkey: string
	readonly datasetId: string
}

/**
 * Runtime-neutral renderer input. `PresentationLayerResolution` is
 * structurally compatible with `layer`, `featureCollection`, and
 * `sourceEvent`, so the resolver can feed this without a renderer dependency.
 */
export interface PresentationLayerMaterializationInput {
	readonly carrierId: string
	readonly layer: MapPresentationLayerV1
	readonly featureCollection: FeatureCollection
	readonly sourceEvent?: PresentationSourceEventIdentity
	readonly presentationAuthor?: string
}

export interface MaterializedPresentationLayer {
	readonly carrierId: string
	readonly layer: MapPresentationLayerV1
	readonly instanceId: string
	readonly sourceId: string
	readonly featureCollection: FeatureCollection
	readonly matchedFeatureIds: readonly string[]
	readonly missingFeatureIds: readonly string[]
	/** Author features only; derived arrowheads are excluded. */
	readonly sourceFeatureCount: number
}

function materializeFeature(
	feature: Feature,
	input: PresentationLayerMaterializationInput,
	sourceFeatureId: string,
	occurrence: number,
): Feature<Geometry> {
	const parsedSource = parseMapPresentationSource(input.layer.source)
	const renderId = presentationFeatureRenderId({
		carrierId: input.carrierId,
		layerId: input.layer.id,
		sourceFeatureId,
		occurrence,
	})
	const dataAuthor = input.sourceEvent?.pubkey ?? parsedSource?.pubkey
	const sourceDatasetId = input.sourceEvent?.datasetId ?? parsedSource?.identifier

	return {
		...feature,
		id: renderId,
		geometry: feature.geometry as Geometry,
		properties: {
			...(feature.properties ?? {}),
			...(input.layer.style ?? {}),
			// Compatibility identities used by the existing inspect/focus path.
			featureId: sourceFeatureId,
			...(sourceDatasetId ? { datasetId: sourceDatasetId } : {}),
			...(input.sourceEvent ? { sourceEventId: input.sourceEvent.id } : {}),
			// Renderer-owned values are written last, so source data cannot spoof them.
			[PRESENTATION_PROPERTY_KEYS.carrierId]: input.carrierId,
			[PRESENTATION_PROPERTY_KEYS.layerId]: input.layer.id,
			[PRESENTATION_PROPERTY_KEYS.source]: input.layer.source,
			[PRESENTATION_PROPERTY_KEYS.sourceFeatureId]: sourceFeatureId,
			[PRESENTATION_PROPERTY_KEYS.occurrence]: occurrence,
			[PRESENTATION_PROPERTY_KEYS.renderId]: renderId,
			[PRESENTATION_PROPERTY_KEYS.opacityMultiplier]: input.layer.opacityMultiplier,
			[PRESENTATION_COLLAPSE_TO_POINT_PROPERTY]: false,
			...(dataAuthor ? { [PRESENTATION_PROPERTY_KEYS.dataAuthor]: dataAuthor } : {}),
			...(input.presentationAuthor
				? { [PRESENTATION_PROPERTY_KEYS.presentationAuthor]: input.presentationAuthor }
				: {}),
		},
	}
}

/**
 * Convert one resolved presentation instance into its own immutable render
 * collection. The selector is applied again as a defensive, non-widening
 * boundary: an empty or stale selector can never accidentally render the
 * source's complete collection.
 */
export function materializePresentationLayer(
	input: PresentationLayerMaterializationInput,
): MaterializedPresentationLayer {
	const selection = selectPresentationFeatures(input.featureCollection, input.layer.featureIds)
	const occurrences = new Map<string, number>()
	const materializedFeatures = selection.featureCollection.features.flatMap((feature, index) => {
		if (!feature.geometry) return []
		const sourceFeatureId = getPresentationFeatureId(feature) ?? `@anonymous:${index}`
		const occurrence = occurrences.get(sourceFeatureId) ?? 0
		occurrences.set(sourceFeatureId, occurrence + 1)
		return [materializeFeature(feature, input, sourceFeatureId, occurrence)]
	})
	const arrows = collectLineArrowFeatures(materializedFeatures)

	return Object.freeze({
		carrierId: input.carrierId,
		layer: input.layer,
		instanceId: presentationInstanceId(input.carrierId, input.layer.id),
		sourceId: presentationSourceId(input.carrierId, input.layer.id),
		featureCollection: {
			...selection.featureCollection,
			features: [...materializedFeatures, ...arrows],
		},
		matchedFeatureIds: selection.matchedFeatureIds,
		missingFeatureIds: selection.missingFeatureIds,
		sourceFeatureCount: materializedFeatures.length,
	})
}

/** Preserve authored bottom-to-top order; never reverse the layer list. */
export function materializePresentationLayers(
	inputs: readonly PresentationLayerMaterializationInput[],
): readonly MaterializedPresentationLayer[] {
	return Object.freeze(inputs.map(materializePresentationLayer))
}

/**
 * Derive the zoom-dependent render collection for one instance. Author
 * geometries and their proxy share choice provenance, but use distinct render
 * ids. Arrowheads disappear with a collapsed line rather than lingering at an
 * endpoint. The baseline materialization is never mutated.
 */
export function materializePresentationLayerForViewport(
	materialized: MaterializedPresentationLayer,
	map: GeometryProjectionMap,
	geometryPointProxyEnabled: boolean,
): MaterializedPresentationLayer {
	if (!geometryPointProxyEnabled) return materialized

	const sourceFeatures = materialized.featureCollection.features.slice(
		0,
		materialized.sourceFeatureCount,
	)
	const derivedFeatures = materialized.featureCollection.features.slice(
		materialized.sourceFeatureCount,
	)
	const collapsedChoices = new Set<string>()
	const proxies: Feature<Point>[] = []

	const renderedSourceFeatures = sourceFeatures.map((feature) => {
		if (!shouldCollapseGeometryToPointProxy(map, feature)) return feature
		const proxy = buildGeometryProxyFeature(feature)
		const provenance = readPresentationFeatureProvenance(feature.properties)
		if (!proxy || !provenance) return feature

		collapsedChoices.add(presentationGeometryChoiceId(provenance))
		proxies.push(proxy)
		return {
			...feature,
			properties: {
				...(feature.properties ?? {}),
				[PRESENTATION_COLLAPSE_TO_POINT_PROPERTY]: true,
			},
		}
	})

	const visibleDerivedFeatures = derivedFeatures.filter((feature) => {
		const provenance = readPresentationFeatureProvenance(feature.properties)
		return !provenance || !collapsedChoices.has(presentationGeometryChoiceId(provenance))
	})

	return Object.freeze({
		...materialized,
		featureCollection: {
			...materialized.featureCollection,
			features: [...renderedSourceFeatures, ...visibleDerivedFeatures, ...proxies],
		},
	})
}
