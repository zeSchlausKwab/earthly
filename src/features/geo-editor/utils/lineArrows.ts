import { bearing } from '@turf/turf'
import type { Feature, LineString, MultiLineString, Point, Position } from 'geojson'

type LineFeature = Feature<LineString | MultiLineString>
export type LineArrowFeature = Feature<
	Point,
	{
		meta: 'arrowhead'
		sourceFeatureId: string
		arrowBearing: number
		strokeColor?: string
		strokeWidth?: number
		strokeOpacity?: number
		active?: boolean
	}
>

function samePosition(left: Position, right: Position): boolean {
	return left[0] === right[0] && left[1] === right[1]
}

function firstDistinctSegment(coordinates: Position[]): [Position, Position] | null {
	const first = coordinates[0]
	if (!first) return null
	for (let index = 1; index < coordinates.length; index += 1) {
		const next = coordinates[index]
		if (next && !samePosition(first, next)) return [first, next]
	}
	return null
}

function lastDistinctSegment(coordinates: Position[]): [Position, Position] | null {
	const last = coordinates.at(-1)
	if (!last) return null
	for (let index = coordinates.length - 2; index >= 0; index -= 1) {
		const previous = coordinates[index]
		if (previous && !samePosition(previous, last)) return [previous, last]
	}
	return null
}

/**
 * Project `arrowStart` / `arrowEnd` line properties into endpoint Point
 * features suitable for a rotating MapLibre symbol layer.
 */
export function lineArrowFeatures(feature: LineFeature): LineArrowFeature[] {
	const properties = feature.properties as Record<string, unknown> | null
	const arrowStart = properties?.arrowStart === true
	const arrowEnd = properties?.arrowEnd === true
	if (!arrowStart && !arrowEnd) return []

	const sourceFeatureId = String(feature.id ?? properties?.featureId ?? properties?.id ?? 'line')
	const lines =
		feature.geometry.type === 'LineString'
			? [feature.geometry.coordinates]
			: feature.geometry.coordinates
	const arrows: LineArrowFeature[] = []

	lines.forEach((coordinates, lineIndex) => {
		const common = {
			meta: 'arrowhead' as const,
			sourceFeatureId,
			strokeColor: typeof properties?.strokeColor === 'string' ? properties.strokeColor : undefined,
			strokeWidth: typeof properties?.strokeWidth === 'number' ? properties.strokeWidth : undefined,
			strokeOpacity:
				typeof properties?.strokeOpacity === 'number' ? properties.strokeOpacity : undefined,
			active: properties?.active === true ? true : undefined,
		}

		if (arrowStart) {
			const segment = firstDistinctSegment(coordinates)
			if (segment) {
				arrows.push({
					type: 'Feature',
					id: `${sourceFeatureId}:arrow-start:${lineIndex}`,
					geometry: { type: 'Point', coordinates: segment[0] },
					properties: {
						...common,
						// Start arrows point out of the line: second coordinate → first.
						arrowBearing: bearing(segment[1], segment[0]),
					},
				})
			}
		}

		if (arrowEnd) {
			const segment = lastDistinctSegment(coordinates)
			if (segment) {
				arrows.push({
					type: 'Feature',
					id: `${sourceFeatureId}:arrow-end:${lineIndex}`,
					geometry: { type: 'Point', coordinates: segment[1] },
					properties: {
						...common,
						arrowBearing: bearing(segment[0], segment[1]),
					},
				})
			}
		}
	})

	return arrows
}

export function collectLineArrowFeatures(features: Feature[]): LineArrowFeature[] {
	return features.flatMap((feature) => {
		if (feature.geometry?.type !== 'LineString' && feature.geometry?.type !== 'MultiLineString') {
			return []
		}
		return lineArrowFeatures(feature as LineFeature)
	})
}
