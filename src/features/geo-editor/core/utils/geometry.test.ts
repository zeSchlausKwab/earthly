import { describe, expect, it } from 'bun:test'
import { nearestPointOnLine, splitLineAtPoint } from './geometry'

it('splits a line at the closest point without losing either endpoint', () => {
	const [before, after] = splitLineAtPoint([[0, 0], [2, 0]], [1, 0.5])
	expect(before[0]).toEqual([0, 0])
	expect(after.at(-1)).toEqual([2, 0])
	expect(before.at(-1)?.[0]).toBeCloseTo(1, 3)
	expect(before.at(-1)).toEqual(after[0])
})

describe('nearestPointOnLine', () => {
	it('projects onto the rendered Web Mercator edge used by MapLibre snapping', () => {
		const nearest = nearestPointOnLine(
			[5, 15.01],
			[
				[-20, 15],
				[30, 15],
			],
		)

		expect(nearest[0]).toBeCloseTo(5, 7)
		expect(nearest[1]).toBeCloseTo(15, 7)
	})
})
