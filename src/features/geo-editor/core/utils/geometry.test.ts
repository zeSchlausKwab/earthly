import { describe, expect, it } from 'bun:test'
import { nearestPointOnLine } from './geometry'

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
