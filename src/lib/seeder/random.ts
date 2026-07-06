/**
 * Randomness + Vienna geometry helpers shared by the fixture scenarios
 * (full / sightings / minimal). Canonical uses real-world data instead.
 */

import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson'
import type { BoundingBox } from './geo/bbox'

/** Crypto-backed uniform random in [0, 1) — plain bun script, crypto is fine. */
export function rand(): number {
	const buf = new Uint32Array(1)
	crypto.getRandomValues(buf)
	return (buf[0] ?? 0) / 0x100000000
}

export function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(rand() * arr.length)] as T
}

/** Element at `i % arr.length` — safe round-robin over a non-empty roster. */
export function nth<T>(arr: readonly T[], i: number): T {
	return arr[((i % arr.length) + arr.length) % arr.length] as T
}

// ── Vienna ────────────────────────────────────────────────────────────────────

export const VIENNA_BBOX: BoundingBox = [16.2, 48.1, 16.5, 48.3]
export const VIENNA_CENTROID: [number, number] = [16.3738, 48.2082]

export function jitter(center: [number, number], spread = 0.05): [number, number] {
	return [center[0] + (rand() - 0.5) * 2 * spread, center[1] + (rand() - 0.5) * 2 * spread]
}

/** A random-shape feature (point / 3-pt line / small quad) near `center`. */
export function featureNear(
	center: [number, number],
	properties: Record<string, unknown>,
): Feature<Geometry> {
	const [lon, lat] = jitter(center)
	const shape = rand()
	let geometry: Geometry
	if (shape < 0.6) {
		geometry = { type: 'Point', coordinates: [lon, lat] }
	} else if (shape < 0.85) {
		geometry = {
			type: 'LineString',
			coordinates: [
				[lon, lat],
				[lon + 0.004, lat + 0.002],
				[lon + 0.008, lat - 0.001],
			],
		}
	} else {
		const d = 0.003
		geometry = {
			type: 'Polygon',
			coordinates: [
				[
					[lon, lat],
					[lon + d, lat],
					[lon + d, lat + d],
					[lon, lat + d],
					[lon, lat],
				],
			],
		}
	}
	return { type: 'Feature', geometry, properties }
}

/** A small quad polygon around a point (the "area where I saw it" case). */
export function quadAround([lon, lat]: [number, number], d = 0.0015): Polygon {
	return {
		type: 'Polygon',
		coordinates: [
			[
				[lon, lat],
				[lon + d, lat],
				[lon + d, lat + d],
				[lon, lat + d],
				[lon, lat],
			],
		],
	}
}

export function fc(features: Feature<Geometry>[]): FeatureCollection {
	return { type: 'FeatureCollection', features }
}
