/**
 * THE canonical geohash implementation for the seeding pipeline.
 *
 * The retired seed scripts once carried copies of this encoder. The unified
 * seeder imports it from here and nowhere else.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

/** Encode a lat/lon pair as a geohash of the given precision. */
export function encodeGeohash(lat: number, lon: number, precision = 5): string {
	let geohash = ''
	let even = true
	const latRange: [number, number] = [-90, 90]
	const lonRange: [number, number] = [-180, 180]

	while (geohash.length < precision) {
		let ch = 0
		for (let bit = 0; bit < 5; bit++) {
			if (even) {
				const mid = (lonRange[0] + lonRange[1]) / 2
				if (lon >= mid) {
					ch |= 1 << (4 - bit)
					lonRange[0] = mid
				} else {
					lonRange[1] = mid
				}
			} else {
				const mid = (latRange[0] + latRange[1]) / 2
				if (lat >= mid) {
					ch |= 1 << (4 - bit)
					latRange[0] = mid
				} else {
					latRange[1] = mid
				}
			}
			even = !even
		}
		geohash += BASE32[ch]
	}

	return geohash
}

/** Geohash of the center of a `[west, south, east, north]` bounding box. */
export function geohashFromBbox(bbox: [number, number, number, number], precision = 5): string {
	const lat = (bbox[1] + bbox[3]) / 2
	const lon = (bbox[0] + bbox[2]) / 2
	return encodeGeohash(lat, lon, precision)
}
