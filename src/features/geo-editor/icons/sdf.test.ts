import { describe, expect, it } from 'bun:test'
import { alphaMaskToSdfData } from './sdf'

/** Build an RGBA buffer from a per-pixel alpha (0..255) callback. */
function maskFromAlpha(
	width: number,
	height: number,
	alphaAt: (x: number, y: number) => number,
): Uint8ClampedArray {
	const data = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			data[(y * width + x) * 4 + 3] = alphaAt(x, y)
		}
	}
	return data
}

function sdfAlphaAt(sdf: Uint8ClampedArray, width: number, x: number, y: number): number {
	return sdf[(y * width + x) * 4 + 3]
}

const OPTIONS = { radius: 8, cutoff: 0.25 }
/** Shape edge (signed distance 0) encodes as 255 × (1 − cutoff). */
const EDGE_ALPHA = 255 * (1 - OPTIONS.cutoff)

describe('alphaMaskToSdfData', () => {
	// 16×16 canvas with a fully opaque 8×8 square at [4,12).
	const SIZE = 16
	const inSquare = (x: number, y: number) => x >= 4 && x < 12 && y >= 4 && y < 12
	const squareMask = maskFromAlpha(SIZE, SIZE, (x, y) => (inSquare(x, y) ? 255 : 0))
	const sdf = alphaMaskToSdfData(squareMask, SIZE, SIZE, OPTIONS)

	it('encodes inside pixels above the edge threshold and outside pixels below it', () => {
		// Square center: 4px from the nearest edge → deep inside.
		expect(sdfAlphaAt(sdf, SIZE, 8, 8)).toBeGreaterThan(EDGE_ALPHA)
		// One pixel outside the square boundary → just below the edge value.
		expect(sdfAlphaAt(sdf, SIZE, 3, 8)).toBeLessThan(EDGE_ALPHA)
		expect(sdfAlphaAt(sdf, SIZE, 3, 8)).toBeGreaterThan(0)
	})

	it('matches exact distances for a binary mask', () => {
		// Center of the 8×8 square is 4px inside the nearest edge:
		// alpha = 255 − 255 × (−4/8 + 0.25) = 255 × 1.25 → clamped to 255.
		expect(sdfAlphaAt(sdf, SIZE, 8, 8)).toBe(255)
		// 2px outside the left edge (x=2, boundary at x=4):
		// alpha = 255 − 255 × (2/8 + 0.25) = 127.5 → rounds to 128.
		expect(sdfAlphaAt(sdf, SIZE, 2, 8)).toBe(128)
		// Corner-adjacent diagonal distance: pixel (2,2) is √8 from corner (4,4).
		const expected = Math.round(255 - 255 * (Math.sqrt(8) / OPTIONS.radius + OPTIONS.cutoff))
		expect(sdfAlphaAt(sdf, SIZE, 2, 2)).toBe(expected)
	})

	it('decays monotonically away from the shape and bottoms out at 0 beyond the radius', () => {
		let previous = Number.POSITIVE_INFINITY
		for (let x = 8; x >= 0; x--) {
			const alpha = sdfAlphaAt(sdf, SIZE, x, 8)
			expect(alpha).toBeLessThanOrEqual(previous)
			previous = alpha
		}
		// 4px outside the nearest inside pixel: 255 − 255 × (4/8 + 0.25) ≈ 64.
		expect(sdfAlphaAt(sdf, SIZE, 0, 8)).toBe(64)
	})

	it('bottoms out at 0 beyond radius × (1 − cutoff) from the shape', () => {
		// Single opaque pixel at the center; (0,8) is 8px away with radius 8:
		// 255 − 255 × (8/8 + 0.25) < 0 → clamped to 0.
		const dot = maskFromAlpha(SIZE, SIZE, (x, y) => (x === 8 && y === 8 ? 255 : 0))
		const dotSdf = alphaMaskToSdfData(dot, SIZE, SIZE, OPTIONS)
		expect(sdfAlphaAt(dotSdf, SIZE, 0, 8)).toBe(0)
	})

	it('seeds antialiased edge pixels between the binary extremes', () => {
		const soft = maskFromAlpha(SIZE, SIZE, (x, y) => {
			if (inSquare(x, y)) return 255
			// Half-covered pixels ringing the square edge.
			return x >= 3 && x < 13 && y >= 3 && y < 13 ? 128 : 0
		})
		const softSdf = alphaMaskToSdfData(soft, SIZE, SIZE, OPTIONS)
		const edgePixel = sdfAlphaAt(softSdf, SIZE, 3, 8)
		// A ~50% covered pixel sits on the shape edge.
		expect(edgePixel).toBeGreaterThan(EDGE_ALPHA - 20)
		expect(edgePixel).toBeLessThan(EDGE_ALPHA + 20)
	})

	it('writes zeroed RGB (premultiplied-safe) and only encodes alpha', () => {
		for (let i = 0; i < sdf.length; i += 4) {
			expect(sdf[i]).toBe(0)
			expect(sdf[i + 1]).toBe(0)
			expect(sdf[i + 2]).toBe(0)
		}
	})
})
