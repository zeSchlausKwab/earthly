import { bboxFromGeometry } from './bbox'

const EARTH_RADIUS_KM = 6371

/**
 * Great-circle diagonal of a geometry's bounding box, in kilometers.
 * Used as the "how big is this shape really?" signal for the implausible-scale
 * guardrail (workflow audit P1): a casual click-click at world zoom produces a
 * span of thousands of km, while genuine local mapping stays well below it.
 * Returns 0 for points and unmeasurable geometries.
 */
export function bboxDiagonalKm(geometry: unknown): number {
	const bbox = bboxFromGeometry(geometry)
	if (!bbox) return 0
	const [west, south, east, north] = bbox
	const toRad = (deg: number) => (deg * Math.PI) / 180
	const dLat = toRad(north - south)
	const dLon = toRad(east - west)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(south)) * Math.cos(toRad(north)) * Math.sin(dLon / 2) ** 2
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Span (bbox diagonal) above which a freshly drawn shape is treated as
 *  implausibly large for hand-drawn local mapping and worth a warning. */
export const IMPLAUSIBLE_SPAN_KM = 500
