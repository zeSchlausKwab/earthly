import {
	area,
	booleanPointInPolygon,
	buffer as turfBuffer,
	distance as turfDistance,
	featureCollection,
	intersect,
	lineOffset,
	lineSplit,
	lineString,
	point,
	pointOnFeature,
	polygonToLine,
	polygonize,
} from '@turf/turf'
import type {
	Feature,
	GeoJsonProperties,
	Geometry,
	LineString,
	MultiLineString,
	MultiPolygon,
	Point,
	Polygon,
	Position,
} from 'geojson'
import { MAX_DISTANCE_METERS, type PrimitiveUnits } from './primitives'

export type GeometryOperationKind = 'split' | 'offset-polygon' | 'offset-line' | 'corridor'

export type GeometryOperationRequest =
	| {
			kind: 'split'
			cutter: Feature<Point | LineString | MultiLineString> | Point | LineString | MultiLineString
			/** Maximum distance used when projecting a point cutter onto a line. */
			pointSnapToleranceMeters?: number
	  }
	| {
			kind: 'offset-polygon'
			distance: number
			units?: PrimitiveUnits
			direction: 'outward' | 'inward'
	  }
	| {
			kind: 'offset-line'
			distance: number
			units?: PrimitiveUnits
			side: 'left' | 'right'
	  }
	| {
			kind: 'corridor'
			/** Total corridor width. Turf receives half this value on each side. */
			width: number
			units?: PrimitiveUnits
	  }

export interface GeometryOperationResult {
	kind: GeometryOperationKind
	sourceFeatureId?: string
	features: Feature[]
}

export class GeometryOperationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'GeometryOperationError'
	}
}

const METERS_PER_UNIT: Record<PrimitiveUnits, number> = {
	meters: 1,
	kilometers: 1000,
	miles: 1609.344,
}

function assertPositiveDistance(value: number, units: PrimitiveUnits, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new GeometryOperationError(`${label} must be a positive finite number.`)
	}
	if (value * METERS_PER_UNIT[units] >= MAX_DISTANCE_METERS) {
		throw new GeometryOperationError(`${label} is too large.`)
	}
	return value
}

function asCutterFeature(
	cutter: Feature<Point | LineString | MultiLineString> | Point | LineString | MultiLineString,
): Feature<Point | LineString | MultiLineString> {
	return cutter.type === 'Feature' ? cutter : { type: 'Feature', properties: {}, geometry: cutter }
}

function lineParts(geometry: LineString | MultiLineString): Array<Feature<LineString>> {
	if (geometry.type === 'LineString') {
		return [lineString(geometry.coordinates)]
	}
	return geometry.coordinates.map((coordinates) => lineString(coordinates))
}

function polygonParts(geometry: Polygon | MultiPolygon): Array<Feature<Polygon>> {
	const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
	return coordinates.map((part) => ({
		type: 'Feature',
		properties: {},
		geometry: { type: 'Polygon', coordinates: part },
	}))
}

function splitLinePartsByLine(
	parts: Array<Feature<LineString>>,
	splitter: Feature<LineString>,
): Array<Feature<LineString>> {
	return parts.flatMap((part) => {
		const split = lineSplit(part, splitter)
		return split.features.length > 0 ? (split.features as Array<Feature<LineString>>) : [part]
	})
}

const WEB_MERCATOR_RADIUS = 6_378_137
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066

function toWebMercator(position: Position): [number, number] {
	const longitude = Number(position[0])
	const latitude = Math.max(
		-WEB_MERCATOR_MAX_LATITUDE,
		Math.min(WEB_MERCATOR_MAX_LATITUDE, Number(position[1])),
	)
	return [
		WEB_MERCATOR_RADIUS * longitude * (Math.PI / 180),
		WEB_MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + latitude * (Math.PI / 360))),
	]
}

function fromWebMercator(
	position: [number, number],
	segmentStart: Position,
	segmentEnd: Position,
	fraction: number,
): Position {
	const longitude = (position[0] / WEB_MERCATOR_RADIUS) * (180 / Math.PI)
	const latitude =
		(2 * Math.atan(Math.exp(position[1] / WEB_MERCATOR_RADIUS)) - Math.PI / 2) * (180 / Math.PI)
	const dimensions = Math.max(segmentStart.length, segmentEnd.length)
	const result: Position = [longitude, latitude]
	for (let index = 2; index < dimensions; index += 1) {
		const startValue = Number(segmentStart[index])
		const endValue = Number(segmentEnd[index])
		if (Number.isFinite(startValue) && Number.isFinite(endValue)) {
			result.push(startValue + (endValue - startValue) * fraction)
		}
	}
	return result
}

interface NearestRenderedLinePoint {
	partIndex: number
	segmentIndex: number
	fraction: number
	position: Position
	distanceMeters: number
}

/** Project onto the Web Mercator segments users actually see on the map. */
function nearestRenderedLinePoint(
	parts: Array<Feature<LineString>>,
	cutter: Feature<Point>,
): NearestRenderedLinePoint | undefined {
	const cutterPosition = cutter.geometry.coordinates
	const [pointerX, pointerY] = toWebMercator(cutterPosition)
	let nearest: (NearestRenderedLinePoint & { squaredProjectedDistance: number }) | undefined

	parts.forEach((part, partIndex) => {
		part.geometry.coordinates.slice(0, -1).forEach((segmentStart, segmentIndex) => {
			const segmentEnd = part.geometry.coordinates[segmentIndex + 1]
			if (!segmentEnd) return
			const [startX, startY] = toWebMercator(segmentStart)
			const [endX, endY] = toWebMercator(segmentEnd)
			const dx = endX - startX
			const dy = endY - startY
			const denominator = dx * dx + dy * dy
			const fraction =
				denominator === 0
					? 0
					: Math.max(
							0,
							Math.min(1, ((pointerX - startX) * dx + (pointerY - startY) * dy) / denominator),
						)
			const projected: [number, number] = [startX + dx * fraction, startY + dy * fraction]
			const squaredProjectedDistance =
				(pointerX - projected[0]) ** 2 + (pointerY - projected[1]) ** 2
			if (nearest && squaredProjectedDistance >= nearest.squaredProjectedDistance) return
			const position = fromWebMercator(projected, segmentStart, segmentEnd, fraction)
			nearest = {
				partIndex,
				segmentIndex,
				fraction,
				position,
				distanceMeters: turfDistance(point(cutterPosition), point(position), { units: 'meters' }),
				squaredProjectedDistance,
			}
		})
	})

	return nearest
}

function splitLinePartAtRenderedPoint(
	part: Feature<LineString>,
	nearest: NearestRenderedLinePoint,
): [Feature<LineString>, Feature<LineString>] | undefined {
	const coordinates = part.geometry.coordinates
	const { segmentIndex, fraction, position } = nearest
	const epsilon = 1e-10
	let before: Position[]
	let after: Position[]

	if (fraction <= epsilon) {
		before = coordinates.slice(0, segmentIndex + 1)
		after = coordinates.slice(segmentIndex)
	} else if (fraction >= 1 - epsilon) {
		before = coordinates.slice(0, segmentIndex + 2)
		after = coordinates.slice(segmentIndex + 1)
	} else {
		before = [...coordinates.slice(0, segmentIndex + 1), position]
		after = [position, ...coordinates.slice(segmentIndex + 1)]
	}

	if (before.length < 2 || after.length < 2) return undefined
	return [lineString(before), lineString(after)]
}

function splitLineGeometry(
	target: Feature<LineString | MultiLineString>,
	cutter: Feature<Point | LineString | MultiLineString>,
	pointSnapToleranceMeters: number,
): Geometry[] {
	const originalParts = lineParts(target.geometry)
	let splitParts = originalParts

	if (cutter.geometry.type === 'Point') {
		const nearest = nearestRenderedLinePoint(originalParts, cutter as Feature<Point>)

		if (!nearest || nearest.distanceMeters > pointSnapToleranceMeters) {
			throw new GeometryOperationError(
				`The split point must be within ${pointSnapToleranceMeters} meters of the line.`,
			)
		}

		const selectedPart = originalParts[nearest.partIndex]
		if (!selectedPart) throw new GeometryOperationError('The target line has no usable part.')
		const split = splitLinePartAtRenderedPoint(selectedPart, nearest)
		if (!split) {
			throw new GeometryOperationError('The point must fall between the line endpoints.')
		}
		splitParts = [
			...originalParts.slice(0, nearest.partIndex),
			...split,
			...originalParts.slice(nearest.partIndex + 1),
		]
	} else {
		for (const cutterPart of lineParts(cutter.geometry)) {
			splitParts = splitLinePartsByLine(splitParts, cutterPart)
		}
	}

	if (splitParts.length <= originalParts.length) {
		throw new GeometryOperationError('The cutter does not cross the line.')
	}

	return splitParts.map((part) => part.geometry)
}

function polygonBoundaryParts(polygon: Feature<Polygon>): Array<Feature<LineString>> {
	const boundary = polygonToLine(polygon)
	if (boundary.type === 'FeatureCollection') {
		return boundary.features.flatMap((feature) =>
			feature.geometry.type === 'LineString'
				? [feature as Feature<LineString>]
				: feature.geometry.type === 'MultiLineString'
					? lineParts(feature.geometry)
					: [],
		)
	}
	if (boundary.geometry.type === 'LineString') {
		return [boundary as Feature<LineString>]
	}
	return lineParts(boundary.geometry)
}

function splitSinglePolygon(
	polygon: Feature<Polygon>,
	cutterParts: Array<Feature<LineString>>,
): { geometries: Polygon[]; didSplit: boolean } {
	const boundaryParts = polygonBoundaryParts(polygon)
	let nodedBoundary = boundaryParts
	for (const cutter of cutterParts) {
		nodedBoundary = splitLinePartsByLine(nodedBoundary, cutter)
	}

	const insideCutterSegments: Array<Feature<LineString>> = []
	for (const cutter of cutterParts) {
		let nodedCutter: Array<Feature<LineString>> = [cutter]
		for (const boundary of boundaryParts) {
			nodedCutter = splitLinePartsByLine(nodedCutter, boundary)
		}
		for (const segment of nodedCutter) {
			const representative = pointOnFeature(segment)
			if (booleanPointInPolygon(representative, polygon, { ignoreBoundary: true })) {
				insideCutterSegments.push(segment)
			}
		}
	}

	if (insideCutterSegments.length === 0) {
		return { geometries: [polygon.geometry], didSplit: false }
	}

	const faces = polygonize(featureCollection([...nodedBoundary, ...insideCutterSegments]))
	const clipped: Polygon[] = []
	const seen = new Set<string>()

	for (const face of faces.features) {
		const clippedFace = intersect(featureCollection([face, polygon]))
		if (!clippedFace || area(clippedFace) <= 0) continue
		const parts =
			clippedFace.geometry.type === 'Polygon'
				? [clippedFace.geometry]
				: clippedFace.geometry.type === 'MultiPolygon'
					? clippedFace.geometry.coordinates.map(
							(coordinates): Polygon => ({ type: 'Polygon', coordinates }),
						)
					: []
		for (const part of parts) {
			const key = JSON.stringify(part.coordinates)
			if (seen.has(key)) continue
			seen.add(key)
			clipped.push(part)
		}
	}

	if (clipped.length < 2) {
		return { geometries: [polygon.geometry], didSplit: false }
	}
	return { geometries: clipped, didSplit: true }
}

function splitPolygonGeometry(
	target: Feature<Polygon | MultiPolygon>,
	cutter: Feature<Point | LineString | MultiLineString>,
): Geometry[] {
	if (cutter.geometry.type === 'Point') {
		throw new GeometryOperationError('Polygons must be split with a line or polyline.')
	}
	const cutterParts = lineParts(cutter.geometry)
	const outputs: Polygon[] = []
	let didSplit = false
	for (const polygon of polygonParts(target.geometry)) {
		const result = splitSinglePolygon(polygon, cutterParts)
		outputs.push(...result.geometries)
		didSplit ||= result.didSplit
	}
	if (!didSplit) {
		throw new GeometryOperationError('The cutting line must cross the polygon completely.')
	}
	return outputs
}

function offsetPolygonGeometry(
	target: Feature<Polygon | MultiPolygon>,
	distance: number,
	units: PrimitiveUnits,
	direction: 'outward' | 'inward',
): Geometry[] {
	const magnitude = assertPositiveDistance(distance, units, 'Offset distance')
	const result = turfBuffer(target, direction === 'outward' ? magnitude : -magnitude, { units })
	if (!result?.geometry) {
		throw new GeometryOperationError(
			direction === 'inward'
				? 'The inset distance collapses the polygon completely.'
				: 'The polygon could not be offset.',
		)
	}
	return [result.geometry]
}

function offsetLineGeometry(
	target: Feature<LineString | MultiLineString>,
	distance: number,
	units: PrimitiveUnits,
	side: 'left' | 'right',
): Geometry[] {
	const magnitude = assertPositiveDistance(distance, units, 'Offset distance')
	// Turf defines a positive offset as the right side of line direction.
	const signedDistance = side === 'right' ? magnitude : -magnitude
	const outputs = lineParts(target.geometry).map(
		(part) => lineOffset(part, signedDistance, { units }).geometry,
	)
	return outputs.length === 1
		? outputs
		: [
				{
					type: 'MultiLineString',
					coordinates: outputs.map((geometry) => geometry.coordinates),
				} satisfies MultiLineString,
			]
}

function corridorGeometry(
	target: Feature<LineString | MultiLineString>,
	width: number,
	units: PrimitiveUnits,
): Geometry[] {
	const validWidth = assertPositiveDistance(width, units, 'Corridor width')
	const result = turfBuffer(target, validWidth / 2, { units })
	if (!result?.geometry) {
		throw new GeometryOperationError('The line could not be converted into a corridor.')
	}
	return [result.geometry]
}

function sourceIdOf(target: Feature): string | undefined {
	if (target.id != null) return String(target.id)
	const featureId = target.properties?.featureId
	return typeof featureId === 'string' && featureId ? featureId : undefined
}

function derivedFeature(target: Feature, geometry: Geometry, kind: GeometryOperationKind): Feature {
	const id = crypto.randomUUID()
	const sourceFeatureId = sourceIdOf(target)
	const properties: GeoJsonProperties = {
		...(target.properties ?? {}),
		meta: 'feature',
		featureId: id,
		'earthly:geometryOperation': kind,
		...(sourceFeatureId ? { 'earthly:derivedFrom': sourceFeatureId } : {}),
	}
	return { type: 'Feature', id, properties, geometry }
}

/**
 * Run one deterministic geometry operation without mutating the editor.
 * UI workflows and AI tools both consume this seam, then choose how to apply
 * the returned derived features (replace the source or keep it as a copy).
 */
export function performGeometryOperation(
	target: Feature,
	request: GeometryOperationRequest,
): GeometryOperationResult {
	if (!target.geometry) throw new GeometryOperationError('The target has no geometry.')

	let geometries: Geometry[]
	if (request.kind === 'split') {
		const cutter = asCutterFeature(request.cutter)
		if (target.geometry.type === 'LineString' || target.geometry.type === 'MultiLineString') {
			const tolerance = request.pointSnapToleranceMeters ?? 25
			if (!Number.isFinite(tolerance) || tolerance < 0) {
				throw new GeometryOperationError('Point snap tolerance must be a non-negative number.')
			}
			geometries = splitLineGeometry(
				target as Feature<LineString | MultiLineString>,
				cutter,
				tolerance,
			)
		} else if (target.geometry.type === 'Polygon' || target.geometry.type === 'MultiPolygon') {
			geometries = splitPolygonGeometry(target as Feature<Polygon | MultiPolygon>, cutter)
		} else {
			throw new GeometryOperationError('Only lines and polygons can be split.')
		}
	} else if (request.kind === 'offset-polygon') {
		if (target.geometry.type !== 'Polygon' && target.geometry.type !== 'MultiPolygon') {
			throw new GeometryOperationError('Polygon offset requires a Polygon or MultiPolygon.')
		}
		geometries = offsetPolygonGeometry(
			target as Feature<Polygon | MultiPolygon>,
			request.distance,
			request.units ?? 'meters',
			request.direction,
		)
	} else if (request.kind === 'offset-line') {
		if (target.geometry.type !== 'LineString' && target.geometry.type !== 'MultiLineString') {
			throw new GeometryOperationError('Parallel offset requires a LineString or MultiLineString.')
		}
		geometries = offsetLineGeometry(
			target as Feature<LineString | MultiLineString>,
			request.distance,
			request.units ?? 'meters',
			request.side,
		)
	} else {
		if (target.geometry.type !== 'LineString' && target.geometry.type !== 'MultiLineString') {
			throw new GeometryOperationError('A corridor requires a LineString or MultiLineString.')
		}
		geometries = corridorGeometry(
			target as Feature<LineString | MultiLineString>,
			request.width,
			request.units ?? 'meters',
		)
	}

	return {
		kind: request.kind,
		sourceFeatureId: sourceIdOf(target),
		features: geometries.map((geometry) => derivedFeature(target, geometry, request.kind)),
	}
}
