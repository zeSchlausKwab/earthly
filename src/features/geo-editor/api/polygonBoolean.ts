import {
	area,
	booleanPointInPolygon,
	booleanValid,
	difference,
	featureCollection,
	intersect,
	polygon,
	union,
} from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { EditorFeature } from '../core/types'
import { validateGeometryFeatures } from './geometryValidation'

export type PolygonBooleanOperation = 'intersection' | 'difference' | 'union'
export type PolygonGeometry = Polygon | MultiPolygon

/** Bounds both clipping and the quadratic topology checks before they run. */
export const POLYGON_BOOLEAN_MAX_VERTICES = 10_000
export const POLYGON_BOOLEAN_MAX_BYTES = 1024 * 1024
export const POLYGON_BOOLEAN_MAX_MASKS = 50

export class PolygonBooleanError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'PolygonBooleanError'
	}
}

function checkedPolygon(feature: Feature, label: string): Feature<PolygonGeometry> {
	const geometry = feature.geometry
	if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
		throw new PolygonBooleanError(`${label} must be a Polygon or MultiPolygon.`)
	}
	const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
	if (!Array.isArray(parts) || parts.length === 0) {
		throw new PolygonBooleanError(`${label} has no polygon components.`)
	}
	let vertices = 0
	for (const rings of parts) {
		if (!Array.isArray(rings) || rings.length === 0) {
			throw new PolygonBooleanError(`${label} has an empty polygon component.`)
		}
		for (const ring of rings) {
			if (!Array.isArray(ring) || ring.length < 4) {
				throw new PolygonBooleanError(`${label} has an invalid ring.`)
			}
			vertices += ring.length
			if (vertices > POLYGON_BOOLEAN_MAX_VERTICES) {
				throw new PolygonBooleanError(
					`Polygon Boolean inputs are limited to ${POLYGON_BOOLEAN_MAX_VERTICES} positions. Simplify the polygons first.`,
				)
			}
			for (const position of ring) {
				if (
					!Array.isArray(position) ||
					position.length !== 2 ||
					!position.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
					Math.abs(position[0] ?? Infinity) > 180 ||
					Math.abs(position[1] ?? Infinity) > 90
				) {
					throw new PolygonBooleanError(`${label} needs finite 2D [longitude, latitude] positions.`)
				}
			}
			const first = ring[0]
			const last = ring.at(-1)
			if (first?.[0] !== last?.[0] || first?.[1] !== last?.[1]) {
				throw new PolygonBooleanError(`${label} has an unclosed polygon ring.`)
			}
			// A crossing of the date line is ambiguous in planar clipping. Require
			// already split components rather than silently clipping the other hemisphere.
			for (let index = 1; index < ring.length; index++) {
				if (Math.abs((ring[index]?.[0] ?? 0) - (ring[index - 1]?.[0] ?? 0)) > 180) {
					throw new PolygonBooleanError(`${label} crosses the antimeridian. Split it there first.`)
				}
			}
		}
	}
	return { type: 'Feature', geometry, properties: {} }
}

function assertTopology(feature: Feature<PolygonGeometry>, label: string): void {
	const parts =
		feature.geometry.type === 'Polygon'
			? [feature.geometry.coordinates]
			: feature.geometry.coordinates
	for (const rings of parts) {
		const part = polygon(rings)
		if (!booleanValid(part) || area(part) <= 0) {
			throw new PolygonBooleanError(`${label} has invalid or degenerate polygon topology.`)
		}
		const outerRing = rings[0]
		if (!outerRing) throw new PolygonBooleanError(`${label} has no outer ring.`)
		const shell = polygon([outerRing])
		for (const hole of rings.slice(1)) {
			if (!hole[0] || !booleanPointInPolygon(hole[0], shell, { ignoreBoundary: true })) {
				throw new PolygonBooleanError(`${label} has a hole outside its outer ring.`)
			}
		}
		for (let index = 1; index < rings.length; index++) {
			for (let other = index + 1; other < rings.length; other++) {
				const firstHole = rings[index]
				const otherHole = rings[other]
				if (
					firstHole &&
					otherHole &&
					intersect(featureCollection([polygon([firstHole]), polygon([otherHole])]))
				) {
					throw new PolygonBooleanError(`${label} has overlapping polygon holes.`)
				}
			}
		}
	}
	const report = validateGeometryFeatures([{ ...feature, id: label } as EditorFeature])
	if (report.invalidRings || report.withSelfIntersections) {
		throw new PolygonBooleanError(`${label} has invalid or self-intersecting polygon topology.`)
	}
}

export interface PolygonBooleanResult {
	geometry: PolygonGeometry | null
	emptyResult: boolean
	inputVertices: number
	outputVertices: number
}

function countPositions(feature: Feature<PolygonGeometry>): number {
	return (
		feature.geometry.type === 'Polygon'
			? [feature.geometry.coordinates]
			: feature.geometry.coordinates
	).reduce((sum, rings) => sum + rings.reduce((count, ring) => count + ring.length, 0), 0)
}

/**
 * Pure polygon clipping for manual and AI authoring. Masks are combined by union:
 * intersection keeps the source inside ANY mask; difference subtracts ALL masks.
 * No input features, properties, ids, or coordinates are mutated or consumed.
 * Empty results are explicit and never imply deleting a source feature.
 */
export function performPolygonBoolean(
	source: Feature,
	masks: readonly Feature[],
	operation: PolygonBooleanOperation,
): PolygonBooleanResult {
	if (!['intersection', 'difference', 'union'].includes(operation)) {
		throw new PolygonBooleanError('operation must be intersection, difference, or union.')
	}
	if (masks.length === 0 || masks.length > POLYGON_BOOLEAN_MAX_MASKS) {
		throw new PolygonBooleanError(
			`Provide between 1 and ${POLYGON_BOOLEAN_MAX_MASKS} mask polygons.`,
		)
	}
	const polygons = [
		checkedPolygon(source, 'Source'),
		...masks.map((mask, index) => checkedPolygon(mask, `Mask ${index + 1}`)),
	]
	const inputVertices = polygons.reduce((count, feature) => count + countPositions(feature), 0)
	if (inputVertices > POLYGON_BOOLEAN_MAX_VERTICES) {
		throw new PolygonBooleanError(
			`Polygon Boolean inputs are limited to ${POLYGON_BOOLEAN_MAX_VERTICES} positions in total. Simplify the polygons first.`,
		)
	}
	if (new TextEncoder().encode(JSON.stringify(polygons)).length > POLYGON_BOOLEAN_MAX_BYTES) {
		throw new PolygonBooleanError(
			'Polygon Boolean input geometry exceeds 1 MiB. Simplify it first.',
		)
	}
	polygons.forEach((feature, index) => {
		assertTopology(feature, index === 0 ? 'Source' : `Mask ${index}`)
	})
	try {
		const sourcePolygon = polygons[0]
		if (!sourcePolygon) throw new PolygonBooleanError('The source polygon is unavailable.')
		const maskPolygons = polygons.slice(1)
		const combinedMasks =
			maskPolygons.length === 1 ? maskPolygons[0] : union(featureCollection(maskPolygons))
		if (!combinedMasks) throw new PolygonBooleanError('The masks have no polygonal area.')
		const inputs = featureCollection([sourcePolygon, combinedMasks])
		const result =
			operation === 'intersection'
				? intersect(inputs)
				: operation === 'difference'
					? difference(inputs)
					: union(inputs)
		if (!result) return { geometry: null, emptyResult: true, inputVertices, outputVertices: 0 }
		const output = checkedPolygon(result, 'Result')
		assertTopology(output, 'Result')
		if (new TextEncoder().encode(JSON.stringify(output)).length > POLYGON_BOOLEAN_MAX_BYTES) {
			throw new PolygonBooleanError('Polygon Boolean result exceeds the 1 MiB geometry budget.')
		}
		return {
			geometry: structuredClone(output.geometry),
			emptyResult: false,
			inputVertices,
			outputVertices: countPositions(output),
		}
	} catch (error) {
		if (error instanceof PolygonBooleanError) throw error
		throw new PolygonBooleanError(
			`Polygon Boolean operation failed: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}
