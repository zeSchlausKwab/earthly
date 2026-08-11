import {
	point as turfPoint,
	distance as turfDistance,
	bearing as turfBearing,
	midpoint as turfMidpoint,
	lineString as turfLineString,
	pointToLineDistance as turfPointToLineDistance,
	transformRotate,
	lineSlice,
	polygon as turfPolygon,
	booleanPointInPolygon,
	buffer as turfBuffer,
} from '@turf/turf'
import type { Position } from 'geojson'
import { nearestPointOnRenderedSegment } from '../../api/webMercator'

const isCoordinateNumber = (value: unknown): value is number =>
	typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value)

export const isValidPosition = (position: any): position is Position =>
	Array.isArray(position) &&
	position.length >= 2 &&
	isCoordinateNumber(position[0]) &&
	isCoordinateNumber(position[1])

export function distance(point1: Position, point2: Position): number {
	const from = turfPoint(point1)
	const to = turfPoint(point2)
	return turfDistance(from, to, { units: 'meters' })
}

export function bearing(point1: Position, point2: Position): number {
	const from = turfPoint(point1)
	const to = turfPoint(point2)
	return turfBearing(from, to)
}

export function midpoint(point1: Position, point2: Position): Position {
	const from = turfPoint(point1)
	const to = turfPoint(point2)
	const mid = turfMidpoint(from, to)
	return mid.geometry.coordinates as Position
}

export function pointToLineDistance(point: Position, line: Position[]): number {
	if (!isValidPosition(point)) {
		return Infinity
	}

	const sanitizedLine = (line || []).filter(isValidPosition)
	if (sanitizedLine.length < 2) {
		return Infinity
	}

	const pt = turfPoint(point)
	const lineFeature = turfLineString(sanitizedLine)
	return turfPointToLineDistance(pt, lineFeature, { units: 'meters' })
}

export function nearestPointOnLine(point: Position, line: Position[]): Position {
	if (!isValidPosition(point)) {
		return point
	}

	const sanitizedLine = (line || []).filter(isValidPosition)
	if (sanitizedLine.length < 2) {
		return point
	}

	let nearest = point
	let nearestDistance = Infinity
	for (let index = 0; index < sanitizedLine.length - 1; index += 1) {
		const start = sanitizedLine[index]
		const end = sanitizedLine[index + 1]
		if (!start || !end) continue
		const candidate = nearestPointOnRenderedSegment(point, start, end)
		if (candidate.squaredProjectedDistance < nearestDistance) {
			nearest = candidate.position
			nearestDistance = candidate.squaredProjectedDistance
		}
	}
	return nearest
}

export function closestVertex(
	point: Position,
	vertices: Position[],
): { index: number; distance: number } {
	if (!isValidPosition(point)) {
		return { index: -1, distance: Infinity }
	}

	let minDistance = Infinity
	let closestIndex = -1

	vertices.forEach((vertex, index) => {
		if (!isValidPosition(vertex)) {
			return
		}
		const dist = distance(point, vertex)
		if (dist < minDistance) {
			minDistance = dist
			closestIndex = index
		}
	})

	return { index: closestIndex, distance: minDistance }
}

export function pixelDistance(map: any, point1: Position, point2: Position): number {
	if (!isValidPosition(point1) || !isValidPosition(point2)) {
		return Infinity
	}
	const p1 = map.project(point1)
	const p2 = map.project(point2)
	return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
}

export function rotatePoint(point: Position, center: Position, angle: number): Position {
	const pt = turfPoint(point)
	const rotated = transformRotate(pt, angle, { pivot: center })
	return rotated.geometry.coordinates as Position
}

export function rotateGeometry(geometry: any, center: Position, angle: number): any {
	return transformRotate(geometry, angle, { pivot: center })
}

export function splitLineAtPoint(line: Position[], point: Position): [Position[], Position[]] {
	const lineFeature = turfLineString(line)
	const pt = turfPoint(point)
	const nearest = turfNearestPointOnLine(lineFeature, pt)
	const sliced = lineSlice(turfPoint(line[0]), nearest, lineFeature)
	const remaining = lineSlice(nearest, turfPoint(line[line.length - 1]), lineFeature)

	return [sliced.geometry.coordinates as Position[], remaining.geometry.coordinates as Position[]]
}

export function isPointInPolygon(point: Position, polygon: Position[][]): boolean {
	const pt = turfPoint(point)
	const poly = turfPolygon(polygon)
	return booleanPointInPolygon(pt, poly)
}

export function bufferPoint(
	point: Position,
	radius: number,
	units: 'meters' | 'kilometers' = 'meters',
): Position[][] {
	const pt = turfPoint(point)
	const buffered = turfBuffer(pt, radius, { units })
	return buffered?.geometry.coordinates as Position[][]
}

export function generateId(): string {
	return `feature_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
