import type { Position } from 'geojson'

/** GeoJSON's Position is number[], so validate it before treating it as a coordinate. */
export function isFinitePosition(
	position: Position | undefined,
): position is [number, number, ...number[]] {
	return (
		Array.isArray(position) &&
		position.length >= 2 &&
		Number.isFinite(position[0]) &&
		Number.isFinite(position[1]) &&
		position.every(Number.isFinite)
	)
}
