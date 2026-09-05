import type { FeatureCollection, Geometry, Position } from 'geojson'

interface ThumbnailShape {
	points: [number, number][]
	closed: boolean
}

/** A bounded, local-only preview: browsing never downloads blobs or builds a map instance. */
export function geometryThumbnail(
	collection: FeatureCollection | null | undefined,
): ThumbnailShape[] {
	const shapes: ThumbnailShape[] = []
	let remaining = 512
	function add(coordinates: Position[], closed = false) {
		if (remaining <= 0 || shapes.length >= 64 || coordinates.length === 0) return
		const points: [number, number][] = []
		const count = Math.min(coordinates.length, 48, remaining)
		for (let index = 0; index < count; index++) {
			const position =
				coordinates[Math.round((index * (coordinates.length - 1)) / Math.max(1, count - 1))]
			const x = position?.[0]
			const y = position?.[1]
			if (
				typeof x === 'number' &&
				Number.isFinite(x) &&
				typeof y === 'number' &&
				Number.isFinite(y)
			) {
				points.push([x, -y])
			}
		}
		remaining -= count
		if (points.length) shapes.push({ points, closed })
	}
	function visit(geometry: Geometry | null, depth = 0) {
		if (!geometry || remaining <= 0 || shapes.length >= 64 || depth > 8) return
		switch (geometry.type) {
			case 'Point':
				add([geometry.coordinates])
				break
			case 'MultiPoint':
				for (const point of geometry.coordinates.slice(0, 64)) add([point])
				break
			case 'LineString':
				add(geometry.coordinates)
				break
			case 'MultiLineString':
				for (const line of geometry.coordinates.slice(0, 64)) add(line)
				break
			case 'Polygon':
				for (const ring of geometry.coordinates.slice(0, 64)) add(ring, true)
				break
			case 'MultiPolygon':
				for (const polygon of geometry.coordinates.slice(0, 64)) {
					for (const ring of polygon.slice(0, 64)) add(ring, true)
				}
				break
			case 'GeometryCollection':
				for (const child of geometry.geometries.slice(0, 64)) visit(child, depth + 1)
		}
	}
	for (const feature of collection?.features.slice(0, 64) ?? []) visit(feature.geometry)
	if (!shapes.length) return []
	const points = shapes.flatMap((shape) => shape.points)
	const minX = Math.min(...points.map(([x]) => x))
	const maxX = Math.max(...points.map(([x]) => x))
	const minY = Math.min(...points.map(([, y]) => y))
	const maxY = Math.max(...points.map(([, y]) => y))
	const scale = Math.min(32 / (maxX - minX || 1), 20 / (maxY - minY || 1))
	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	return shapes.map((shape) => ({
		closed: shape.closed,
		points: shape.points.map(([x, y]) => [20 + (x - centerX) * scale, 14 + (y - centerY) * scale]),
	}))
}
