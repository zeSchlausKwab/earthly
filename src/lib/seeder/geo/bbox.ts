/**
 * Bounding-box helpers for the seeding pipeline — one implementation shared by
 * every scenario (previously duplicated across the seed scripts).
 *
 * Geometry traversal delegates to `bboxFromGeometry` in `@/lib/geo/bbox`, the
 * app's own implementation, so seeds and runtime always agree.
 */

import type { Feature } from 'geojson'
import { bboxFromGeometry } from '@/lib/geo/bbox'

export { bboxFromGeometry }

/** `[west, south, east, north]` — same shape as the app's GeoBoundingBox. */
export type BoundingBox = [number, number, number, number]

/** Bounding box across many features. Empty/degenerate input yields a world-inverted box. */
export function bboxFromFeatures(features: Feature[]): BoundingBox {
	let west = 180
	let east = -180
	let south = 90
	let north = -90
	for (const feature of features) {
		const box = bboxFromGeometry(feature.geometry)
		if (!box) continue
		if (box[0] < west) west = box[0]
		if (box[1] < south) south = box[1]
		if (box[2] > east) east = box[2]
		if (box[3] > north) north = box[3]
	}
	return [west, south, east, north]
}

/** Serialize a bbox for the `bbox` tag: `west,south,east,north`. */
export function bboxTag(bbox: BoundingBox): string {
	return `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`
}

/** A tiny bbox around a point so discovery tags are present + non-degenerate. */
export function pointBbox([lon, lat]: [number, number], radius = 0.0005): BoundingBox {
	return [lon - radius, lat - radius, lon + radius, lat + radius]
}
