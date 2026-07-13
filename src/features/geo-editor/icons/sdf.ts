/**
 * Signed-distance-field generation for displayIcon images.
 *
 * MapLibre images registered with `{ sdf: true }` accept the data-driven
 * `icon-color` paint property — the renderer reads the ALPHA channel as an
 * encoded signed distance and fills everything "inside" the shape with the
 * tint color. This module converts a rasterized alpha mask (a Lucide glyph
 * drawn on a transparent canvas) into that encoding.
 *
 * Implementation follows the @mapbox/tiny-sdf approach (implemented inline —
 * no runtime dependency): a two-pass Felzenszwalb & Huttenlocher 1D Euclidean
 * distance transform over an "outer" and an "inner" grid, with antialiased
 * edge pixels seeded fractionally. The signed distance `d` (positive OUTSIDE
 * the shape, negative inside) is packed into alpha as
 * `255 - 255 * (d / radius + cutoff)`, so the shape edge (d = 0) sits at
 * `255 * (1 - cutoff)` — the 0.75 threshold MapLibre's SDF shader expects
 * when `cutoff` is 0.25.
 */

const INF = 1e20

/** One 1D pass of the Felzenszwalb/Huttenlocher squared-distance transform. */
function edt1d(
	grid: Float64Array,
	offset: number,
	stride: number,
	length: number,
	f: Float64Array,
	v: Uint16Array,
	z: Float64Array,
): void {
	v[0] = 0
	z[0] = -INF
	z[1] = INF
	f[0] = grid[offset]

	for (let q = 1, k = 0, s = 0; q < length; q++) {
		f[q] = grid[offset + q * stride]
		const q2 = q * q
		do {
			const r = v[k]
			s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2
		} while (s <= z[k] && --k > -1)

		k++
		v[k] = q
		z[k] = s
		z[k + 1] = INF
	}

	for (let q = 0, k = 0; q < length; q++) {
		while (z[k + 1] < q) k++
		const r = v[k]
		grid[offset + q * stride] = f[r] + (q - r) * (q - r)
	}
}

/** In-place 2D squared Euclidean distance transform (columns, then rows). */
function edt(grid: Float64Array, width: number, height: number): void {
	const size = Math.max(width, height)
	const f = new Float64Array(size)
	const v = new Uint16Array(size)
	const z = new Float64Array(size + 1)
	for (let x = 0; x < width; x++) edt1d(grid, x, width, height, f, v, z)
	for (let y = 0; y < height; y++) edt1d(grid, y * width, 1, width, f, v, z)
}

export interface SdfOptions {
	/**
	 * Distance (in raster px) mapped onto the full alpha range. Larger values
	 * spread the field further outside the shape (needed for halos) and soften
	 * edges at a given shader gamma.
	 */
	radius: number
	/**
	 * Fraction of the alpha range reserved for the OUTSIDE of the shape. With
	 * the MapLibre-conventional 0.25, the shape edge lands at alpha ≈ 191
	 * (0.75 × 255), matching the SDF shader's fill threshold.
	 */
	cutoff: number
}

/**
 * Convert a rasterized RGBA alpha mask into an SDF-encoded RGBA buffer
 * suitable for `map.addImage(id, { width, height, data }, { sdf: true })`.
 * Only the input's alpha channel is read; the output's RGB is zero (valid
 * premultiplied form — the SDF shader samples alpha only).
 */
export function alphaMaskToSdfData(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
	options: SdfOptions,
): Uint8ClampedArray {
	const { radius, cutoff } = options
	const n = width * height
	const gridOuter = new Float64Array(n)
	const gridInner = new Float64Array(n)

	for (let i = 0; i < n; i++) {
		const a = rgba[i * 4 + 3] / 255
		if (a >= 1) {
			gridOuter[i] = 0
			gridInner[i] = INF
		} else if (a <= 0) {
			gridOuter[i] = INF
			gridInner[i] = 0
		} else {
			// Antialiased edge pixel: seed a fractional sub-pixel distance.
			const d = 0.5 - a
			gridOuter[i] = d > 0 ? d * d : 0
			gridInner[i] = d < 0 ? d * d : 0
		}
	}

	edt(gridOuter, width, height)
	edt(gridInner, width, height)

	const out = new Uint8ClampedArray(n * 4)
	for (let i = 0; i < n; i++) {
		const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i])
		// Uint8ClampedArray clamps to 0..255 on assignment.
		out[i * 4 + 3] = Math.round(255 - 255 * (d / radius + cutoff))
	}
	return out
}
