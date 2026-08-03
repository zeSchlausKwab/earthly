import { describe, expect, test } from 'bun:test'
import { defaultCalloutDisplayMode, resolveCalloutLayout } from './layout'

describe('responsive map callout layout', () => {
	test('keeps readable screen-space dimensions across zoom-independent layout passes', () => {
		const [layout] = resolveCalloutLayout(
			[
				{
					key: 'one',
					anchor: { x: 300, y: 200 },
					preferredSide: 'right',
					offset: [0, 0],
					fullSize: { width: 280, height: 140 },
				},
			],
			{ width: 800, height: 500 },
		)
		expect(layout?.mode).toBe('full')
		expect(layout?.card.width).toBe(280)
		expect(layout?.card.height).toBe(140)
	})

	test('compacts overlapping cards instead of dropping authored content', () => {
		const layouts = resolveCalloutLayout(
			['a', 'b', 'c'].map((key) => ({
				key,
				anchor: { x: 160, y: 120 },
				preferredSide: 'right' as const,
				offset: [0, 0] as [number, number],
				fullSize: { width: 250, height: 150 },
			})),
			{ width: 360, height: 260 },
		)
		expect(layouts).toHaveLength(3)
		expect(layouts.some((item) => item.mode !== 'full')).toBe(true)
	})

	test('forces the selected card to full and lays it out first', () => {
		const layouts = resolveCalloutLayout(
			[
				{
					key: 'background',
					anchor: { x: 200, y: 150 },
					preferredSide: 'right',
					offset: [0, 0],
					fullSize: { width: 220, height: 120 },
				},
				{
					key: 'selected',
					anchor: { x: 200, y: 150 },
					preferredSide: 'right',
					offset: [0, 0],
					fullSize: { width: 220, height: 120 },
					priority: true,
				},
			],
			{ width: 600, height: 400 },
		)
		expect(layouts[0]?.key).toBe('selected')
		expect(layouts[0]?.mode).toBe('full')
	})

	test('starts with compact cards when the current zoom is too small for readable text', () => {
		const initialMode = defaultCalloutDisplayMode({
			zoom: 3.75,
			viewport: { width: 1200, height: 800 },
			calloutCount: 2,
		})
		const [layout] = resolveCalloutLayout(
			[
				{
					key: 'zoomed-out',
					anchor: { x: 500, y: 350 },
					preferredSide: 'right',
					offset: [0, 0],
					fullSize: { width: 248, height: 92 },
					initialMode,
				},
			],
			{ width: 1200, height: 800 },
		)

		expect(initialMode).toBe('compact')
		expect(layout?.mode).toBe('compact')
	})

	test('smallifies dense callout fields before they begin overlapping', () => {
		expect(
			defaultCalloutDisplayMode({
				zoom: 8,
				viewport: { width: 900, height: 600 },
				calloutCount: 6,
			}),
		).toBe('compact')
	})

	test('lets a local collapse-all preference skip directly to markers', () => {
		const [layout] = resolveCalloutLayout(
			[
				{
					key: 'collapsed-by-user',
					anchor: { x: 300, y: 200 },
					preferredSide: 'right',
					offset: [0, 0],
					fullSize: { width: 248, height: 92 },
					initialMode: 'collapsed',
				},
			],
			{ width: 800, height: 500 },
		)

		expect(layout?.mode).toBe('collapsed')
	})
})
