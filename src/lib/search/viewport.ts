import { lonLatToWorldGeohash } from '@/lib/worldGeohash'
import type { SearchBBox } from './types'

/**
 * Lane 1 viewport queries (docs/GEO_SEARCH_REWRITE.md §4): cover the map
 * viewport with geohash cells and query them as a plain NIP-01 `#g` filter.
 * Events carry multi-precision `g` tags (tags.ts setGeohash), so any
 * precision is an exact tag match — on our relay AND any foreign relay that
 * indexes tags.
 */

/** Geohash cell size [lonDegrees, latDegrees] per precision 1..7. */
const CELL_DIMS: ReadonlyArray<readonly [number, number]> = [
	[45, 45],
	[11.25, 5.625],
	[1.40625, 1.40625],
	[0.3515625, 0.17578125],
	[0.0439453125, 0.0439453125],
	[0.010986328125, 0.0054931640625],
	[0.001373291015625, 0.001373291015625],
]

export const MAX_GEOHASH_PRECISION = CELL_DIMS.length

/**
 * Cover a bbox with geohash cells: the finest precision whose cover stays
 * within `maxCells`. Stable across small pans (cells snap to a fixed grid),
 * which makes client-side result caching effective.
 */
export function coverBboxWithGeohashes(bbox: SearchBBox, maxCells = 12): string[] {
	const [west, south, east, north] = bbox

	for (let precision = MAX_GEOHASH_PRECISION; precision >= 1; precision--) {
		const [cellW, cellH] = CELL_DIMS[precision - 1]
		const colStart = Math.floor((west + 180) / cellW)
		const colEnd = Math.floor((Math.min(east, 179.999999) + 180) / cellW)
		const rowStart = Math.floor((south + 90) / cellH)
		const rowEnd = Math.floor((Math.min(north, 89.999999) + 90) / cellH)
		const count = (colEnd - colStart + 1) * (rowEnd - rowStart + 1)
		if (count > maxCells && precision > 1) continue

		const cells: string[] = []
		for (let col = colStart; col <= colEnd; col++) {
			for (let row = rowStart; row <= rowEnd; row++) {
				const lon = (col + 0.5) * cellW - 180
				const lat = (row + 0.5) * cellH - 90
				cells.push(lonLatToWorldGeohash(precision, lon, lat))
			}
		}
		return [...new Set(cells)]
	}

	return []
}

/**
 * Map zoom level → geohash precision heuristic for consumers that want a
 * fixed precision instead of a cell budget.
 */
export function precisionForZoom(zoom: number): number {
	if (zoom >= 16) return 7
	if (zoom >= 13) return 6
	if (zoom >= 10) return 5
	if (zoom >= 7) return 4
	if (zoom >= 5) return 3
	if (zoom >= 3) return 2
	return 1
}
