import { describe, expect, test } from 'bun:test'
import { mobileDrawingCanFinish, mobileDrawingHint } from './mobileDrawingPresentation'
import { mobileSheetDetentHeight, MOBILE_BROWSE_PANEL_TABS } from './mobileSheetPresentation'

describe('phone drawing and Browse composition', () => {
	test('keeps unfinished geometry separate from completed feature undo', () => {
		expect(mobileDrawingCanFinish('draw_linestring', 1)).toBe(false)
		expect(mobileDrawingCanFinish('draw_linestring', 2)).toBe(true)
		expect(mobileDrawingCanFinish('draw_polygon', 2)).toBe(false)
		expect(mobileDrawingCanFinish('draw_polygon', 3)).toBe(true)
		expect(mobileDrawingCanFinish('select', 4)).toBe(false)
	})
	test('announces drawing guidance appropriate for each real tool', () => {
		expect(mobileDrawingHint('draw_polygon', 2, 0)).toBe('Tap corners, then Finish')
		expect(mobileDrawingHint('draw_linestring', 0, 0)).toBe('Tap the map to start')
		expect(mobileDrawingHint('draw_point', 0, 0)).toContain('add a point')
		expect(mobileDrawingHint('draw_annotation', 0, 0)).toContain('place a label')
		expect(mobileDrawingHint('select', 0, 0)).toContain('tap Ask for AI help')
	})
	test('uses a one-line edit peek and a half-viewport Browse detent', () => {
		expect(mobileSheetDetentHeight('peek', 812, true)).toBe(62)
		expect(mobileSheetDetentHeight('peek', 812)).toBe(96)
		expect(mobileSheetDetentHeight('half', 812)).toBe(406)
		expect(mobileSheetDetentHeight('half', 500, true, 64)).toBe(250)
		expect(mobileSheetDetentHeight('full', 812)).toBe(748)
		expect(mobileSheetDetentHeight('full', 500, false, 64)).toBe(424)
	})
	test('uses the same full detent with selection and safe-area clearance as layout', () => {
		const bottomInset = 52 + 44 + 34
		expect(mobileSheetDetentHeight('full', 812, true, bottomInset)).toBe(670)
		expect(mobileSheetDetentHeight('half', 812, true, bottomInset)).toBe(406)
		expect(mobileSheetDetentHeight('peek', 812, true, bottomInset)).toBe(62)
	})
	test('maps every Browse type to its retained catalog rather than profile navigation', () => {
		expect(MOBILE_BROWSE_PANEL_TABS).toEqual({
			maps: 'datasets',
			stories: 'stories',
			atlases: 'contexts',
			sightings: 'sightings',
			people: 'profile',
		})
	})
})
