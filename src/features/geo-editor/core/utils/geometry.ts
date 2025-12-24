import * as turf from '@turf/turf';
import type { Position } from 'geojson';

const isCoordinateNumber = (value: unknown): value is number =>
	typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);

export const isValidPosition = (position: any): position is Position =>
	Array.isArray(position) && position.length >= 2 && isCoordinateNumber(position[0]) && isCoordinateNumber(position[1]);

export function distance(point1: Position, point2: Position): number {
	const from = turf.point(point1);
	const to = turf.point(point2);
	return turf.distance(from, to, { units: 'meters' });
}

export function bearing(point1: Position, point2: Position): number {
	const from = turf.point(point1);
	const to = turf.point(point2);
	return turf.bearing(from, to);
}

export function midpoint(point1: Position, point2: Position): Position {
	const from = turf.point(point1);
	const to = turf.point(point2);
	const mid = turf.midpoint(from, to);
	return mid.geometry.coordinates as Position;
}

export function pointToLineDistance(point: Position, line: Position[]): number {
	if (!isValidPosition(point)) {
		return Infinity;
	}

	const sanitizedLine = (line || []).filter(isValidPosition);
	if (sanitizedLine.length < 2) {
		return Infinity;
	}

	const pt = turf.point(point);
	const lineFeature = turf.lineString(sanitizedLine);
	return turf.pointToLineDistance(pt, lineFeature, { units: 'meters' });
}

export function nearestPointOnLine(point: Position, line: Position[]): Position {
	if (!isValidPosition(point)) {
		return point;
	}

	const sanitizedLine = (line || []).filter(isValidPosition);
	if (sanitizedLine.length < 2) {
		return point;
	}

	try {
		const pt = turf.point(point);
		const lineFeature = turf.lineString(sanitizedLine);
		const nearest = turf.nearestPointOnLine(lineFeature, pt);
		return nearest.geometry.coordinates as Position;
	} catch {
		return point;
	}
}

export function closestVertex(point: Position, vertices: Position[]): { index: number; distance: number } {
	if (!isValidPosition(point)) {
		return { index: -1, distance: Infinity };
	}

	let minDistance = Infinity;
	let closestIndex = -1;

	vertices.forEach((vertex, index) => {
		if (!isValidPosition(vertex)) {
			return;
		}
		const dist = distance(point, vertex);
		if (dist < minDistance) {
			minDistance = dist;
			closestIndex = index;
		}
	});

	return { index: closestIndex, distance: minDistance };
}

export function pixelDistance(map: any, point1: Position, point2: Position): number {
	if (!isValidPosition(point1) || !isValidPosition(point2)) {
		return Infinity;
	}
	const p1 = map.project(point1);
	const p2 = map.project(point2);
	return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

export function rotatePoint(point: Position, center: Position, angle: number): Position {
	const pt = turf.point(point);
	const rotated = turf.transformRotate(pt, angle, { pivot: center });
	return rotated.geometry.coordinates as Position;
}

export function rotateGeometry(geometry: any, center: Position, angle: number): any {
	return turf.transformRotate(geometry, angle, { pivot: center });
}

export function splitLineAtPoint(line: Position[], point: Position): [Position[], Position[]] {
	const lineFeature = turf.lineString(line);
	const pt = turf.point(point);
	const nearest = turf.nearestPointOnLine(lineFeature, pt);
	const sliced = turf.lineSlice(turf.point(line[0]), nearest, lineFeature);
	const remaining = turf.lineSlice(nearest, turf.point(line[line.length - 1]), lineFeature);

	return [sliced.geometry.coordinates as Position[], remaining.geometry.coordinates as Position[]];
}

export function isPointInPolygon(point: Position, polygon: Position[][]): boolean {
	const pt = turf.point(point);
	const poly = turf.polygon(polygon);
	return turf.booleanPointInPolygon(pt, poly);
}

export function bufferPoint(point: Position, radius: number, units: 'meters' | 'kilometers' = 'meters'): Position[][] {
	const pt = turf.point(point);
	const buffered = turf.buffer(pt, radius, { units });
	return buffered?.geometry.coordinates as Position[][];
}

export function generateId(): string {
	return `feature_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
