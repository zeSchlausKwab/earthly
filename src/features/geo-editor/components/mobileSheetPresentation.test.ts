import { describe, expect, test } from 'bun:test'
import {
	mobileSheetCloseLabel,
	mobileSheetChromeClassName,
	mobileSheetInnerSurfaceClassName,
	mobileSheetSurfaceClassName,
	mobileWorkspaceHeaderActionRowClassName,
	mobileWorkspaceTabHitAreaClassName,
	mobileWorkspaceTabVisualClassName,
} from './mobileSheetPresentation'

describe('mobile sheet presentation', () => {
	test('uses a strongly translucent surface without weakening the opaque state', () => {
		const translucent = mobileSheetSurfaceClassName(true)
		const opaque = mobileSheetSurfaceClassName(false)

		expect(translucent).toContain('bg-card/20')
		expect(translucent).toContain('backdrop-blur-md')
		expect(translucent.split(' ')).not.toContain('bg-card')
		expect(opaque.split(' ')).toContain('bg-card')
		expect(opaque).not.toContain('bg-card/')
	})

	test('keeps every sheet chrome surface glass instead of painting an opaque header', () => {
		expect(mobileSheetChromeClassName(true)).toContain('bg-card/10')
		expect(mobileSheetInnerSurfaceClassName(true)).toContain('bg-card/10')
		expect(mobileSheetChromeClassName(false).split(' ')).toContain('bg-card')
		expect(mobileSheetInnerSurfaceClassName(false).split(' ')).toContain('bg-card')
	})

	test('keeps the workspace close label stable without erasing specific sheet names', () => {
		expect(mobileSheetCloseLabel(true, 'Edit')).toBe('Close map workspace')
		expect(mobileSheetCloseLabel(false, 'Datasets')).toBe('Close Datasets')
	})

	test('draws compact tabs inside 44px touch targets', () => {
		const hitArea = mobileWorkspaceTabHitAreaClassName()
		const activeGlass = mobileWorkspaceTabVisualClassName(true, true)

		expect(hitArea).toContain('min-h-11')
		expect(hitArea).toContain('min-w-11')
		expect(activeGlass).toContain('h-8')
		expect(activeGlass).toContain('bg-background/35')
		expect(activeGlass).not.toContain('min-h-11')
	})

	test('keeps editor actions in a collision-free row that vanishes when empty', () => {
		const actionRow = mobileWorkspaceHeaderActionRowClassName(true)

		expect(actionRow).toContain('empty:hidden')
		expect(actionRow).toContain('min-h-11')
		expect(actionRow).toContain('justify-end')
		expect(actionRow).toContain('[&_button]:min-h-11')
		expect(actionRow).toContain('bg-card/10')
	})
})
