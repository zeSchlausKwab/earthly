import { describe, expect, test } from 'bun:test'
import { resolveToolbarLayout, TOOLBAR_SHORTCUT_PRIORITY } from './useResponsiveToolbar'

const metrics = { buttonWidth: 32, menuGap: 2, rowGap: 4, searchExtra: 112, authoring: true }
const layoutAt = (budget: number) => resolveToolbarLayout({ ...metrics, budget })

describe('measured toolbar shortcut allocation', () => {
	test('does not allocate space that belongs to pinned controls', () => {
		for (const budget of [-100, 0, 1, 34]) {
			expect(layoutAt(budget)).toEqual({
				releasedCount: 0,
				inlineCallout: false,
				compactSearch: true,
			})
		}
	})
	test('releases exactly one shortcut per available button slot, including partial groups', () => {
		for (let count = 1; count <= TOOLBAR_SHORTCUT_PRIORITY.length; count++) {
			expect(layoutAt(count * 34).releasedCount).toBe(count - 1)
			expect(layoutAt(count * 34 + 1).releasedCount).toBe(count)
		}
		expect(TOOLBAR_SHORTCUT_PRIORITY.slice(0, 6)).toEqual([
			'select',
			'draw_point',
			'draw_linestring',
			'draw_polygon',
			'undo',
			'redo',
		])
	})
	test('uses actual font-scaled button and gap measurements', () => {
		expect(
			resolveToolbarLayout({ ...metrics, buttonWidth: 40, menuGap: 2.5, budget: 171 })
				.releasedCount,
		).toBe(4)
		expect(layoutAt(171).releasedCount).toBe(5)
	})
	test('reclaims shortcuts on shrink without hysteresis or wrapping', () => {
		for (const budget of [700, 120, 350, 40, 500, 0, 1000]) {
			const layout = layoutAt(budget)
			const occupied =
				layout.releasedCount * 34 +
				(layout.inlineCallout ? 36 : 0) +
				(layout.compactSearch ? 0 : 112)
			expect(occupied).toBeLessThanOrEqual(budget)
			if (layout.releasedCount < TOOLBAR_SHORTCUT_PRIORITY.length) {
				expect(budget - occupied).toBeLessThanOrEqual(34)
			}
		}
	})
	test('gives shortcuts priority over expanding the location search field', () => {
		expect(layoutAt(544)).toMatchObject({ releasedCount: 15, compactSearch: true })
		expect(layoutAt(581)).toMatchObject({
			releasedCount: 16,
			inlineCallout: true,
			compactSearch: true,
		})
		expect(layoutAt(693)).toEqual({ releasedCount: 16, inlineCallout: true, compactSearch: false })
	})
	test('inspection allocates no editing shortcuts and can use the search field', () => {
		expect(resolveToolbarLayout({ ...metrics, authoring: false, budget: 113 })).toEqual({
			releasedCount: 0,
			inlineCallout: false,
			compactSearch: false,
		})
	})
})
