import type { Position } from 'geojson'

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

export interface RenderedSegmentProjection {
	position: Position
	fraction: number
	squaredProjectedDistance: number
}

/** Project a coordinate onto the straight Web Mercator segment MapLibre renders. */
export function nearestPointOnRenderedSegment(
	point: Position,
	segmentStart: Position,
	segmentEnd: Position,
): RenderedSegmentProjection {
	const [pointerX, pointerY] = toWebMercator(point)
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
	return {
		position: fromWebMercator(projected, segmentStart, segmentEnd, fraction),
		fraction,
		squaredProjectedDistance: (pointerX - projected[0]) ** 2 + (pointerY - projected[1]) ** 2,
	}
}
