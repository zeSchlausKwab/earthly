import { describe, expect, test } from 'bun:test'
import { resolveMobileViewportLayout } from './mobileViewport'

describe('resolveMobileViewportLayout', () => {
	test('raises a fixed sheet above an occluding iOS keyboard', () => {
		expect(
			resolveMobileViewportLayout({
				layoutHeight: 800,
				visualHeight: 480,
				visualOffsetTop: 0,
				baselineHeight: 800,
				editableFocused: true,
			}),
		).toEqual({ keyboardOpen: true, fixedBottomInsetPx: 320, usableHeightPx: 472 })
	})

	test('does not double-raise a sheet when Android resizes the layout viewport', () => {
		expect(
			resolveMobileViewportLayout({
				layoutHeight: 480,
				visualHeight: 480,
				visualOffsetTop: 0,
				baselineHeight: 800,
				editableFocused: true,
			}),
		).toEqual({ keyboardOpen: true, fixedBottomInsetPx: 0, usableHeightPx: 472 })
	})

	test('does not mistake an orientation change for a keyboard without an editable focus', () => {
		expect(
			resolveMobileViewportLayout({
				layoutHeight: 480,
				visualHeight: 480,
				visualOffsetTop: 0,
				baselineHeight: 800,
				editableFocused: false,
			}).keyboardOpen,
		).toBe(false)
	})
})
