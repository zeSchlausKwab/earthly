import { describe, expect, it } from 'bun:test'
import {
	BUNDLED_DISPLAY_ICON_IDS,
	DISPLAY_ICON_PROPERTY,
	FALLBACK_ICON_IMAGE_ID,
	displayIconColorExpression,
	displayIconDiscRadiusExpression,
	displayIconImageExpression,
	displayIconSizeExpression,
	getDisplayIconSvg,
	hasDisplayIconFilter,
	isBundledDisplayIcon,
	lucideIconId,
	parseDisplayIcon,
	pointLabelAnchorExpression,
	pointLabelRadialOffsetExpression,
	validateDisplayIconValue,
} from './displayIcon'
import { LUCIDE_ICON_NAMES } from './lucideIcons'

describe('displayIcon ids and parsing', () => {
	it('exposes every bundled icon as a lucide:<name> id', () => {
		expect(BUNDLED_DISPLAY_ICON_IDS.length).toBe(LUCIDE_ICON_NAMES.length)
		for (const id of BUNDLED_DISPLAY_ICON_IDS) {
			expect(id).toMatch(/^lucide:[a-z0-9-]+$/)
		}
		expect(BUNDLED_DISPLAY_ICON_IDS).toContain('lucide:anchor')
	})

	it('parseDisplayIcon splits namespace and name on the first colon', () => {
		expect(parseDisplayIcon('lucide:anchor')).toEqual({ namespace: 'lucide', name: 'anchor' })
		expect(parseDisplayIcon('https://example.org/icon.svg')).toEqual({
			namespace: 'https',
			name: '//example.org/icon.svg',
		})
	})

	it('parseDisplayIcon rejects non-strings and malformed ids', () => {
		expect(parseDisplayIcon(undefined)).toBeNull()
		expect(parseDisplayIcon(7)).toBeNull()
		expect(parseDisplayIcon('anchor')).toBeNull()
		expect(parseDisplayIcon(':anchor')).toBeNull()
		expect(parseDisplayIcon('lucide:')).toBeNull()
	})

	it('isBundledDisplayIcon accepts only the bundled set', () => {
		expect(isBundledDisplayIcon('lucide:anchor')).toBe(true)
		expect(isBundledDisplayIcon('lucide:not-a-real-icon')).toBe(false)
		expect(isBundledDisplayIcon('other:anchor')).toBe(false)
		expect(isBundledDisplayIcon(42)).toBe(false)
	})

	it('getDisplayIconSvg returns SVG markup for bundled ids only', () => {
		expect(getDisplayIconSvg(lucideIconId('anchor'))?.startsWith('<svg')).toBe(true)
		expect(getDisplayIconSvg('lucide:not-a-real-icon')).toBeNull()
		expect(getDisplayIconSvg('other:anchor')).toBeNull()
	})
})

describe('validateDisplayIconValue', () => {
	it('returns valid bundled ids unchanged', () => {
		expect(validateDisplayIconValue('lucide:anchor')).toBe('lucide:anchor')
		for (const id of BUNDLED_DISPLAY_ICON_IDS) {
			expect(validateDisplayIconValue(id)).toBe(id)
		}
	})

	it('rejects non-string values with the expected format hint', () => {
		expect(() => validateDisplayIconValue(7)).toThrow(/lucide:anchor/)
		expect(() => validateDisplayIconValue('')).toThrow(/non-empty string/)
	})

	it('rejects foreign namespaces and mentions remote URLs are not supported yet', () => {
		expect(() => validateDisplayIconValue('https://example.org/icon.svg')).toThrow(
			/Remote icon URLs are not supported yet/,
		)
		expect(() => validateDisplayIconValue('anchor')).toThrow(/lucide:<name>/)
	})

	it('rejects unknown lucide names and lists the accepted set', () => {
		expect(() => validateDisplayIconValue('lucide:not-a-real-icon')).toThrow(/Accepted icons:/)
		expect(() => validateDisplayIconValue('lucide:not-a-real-icon')).toThrow(/lucide:anchor/)
	})
})

describe('MapLibre expression builders', () => {
	it('hasDisplayIconFilter tests the canonical property', () => {
		expect(hasDisplayIconFilter()).toEqual(['has', DISPLAY_ICON_PROPERTY])
	})

	it('icon-image coalesces the feature icon with the registered fallback', () => {
		expect(displayIconImageExpression()).toEqual([
			'coalesce',
			['image', ['get', DISPLAY_ICON_PROPERTY]],
			['image', FALLBACK_ICON_IMAGE_ID],
		])
	})

	// 2.4 px-per-radius-unit ÷ 48 logical glyph px ≈ 0.05.
	const ICON_SIZE_FACTOR = 2.4 / 48

	it('icon-size scales off the radius style property (glyph ≈ 2.4 × radius px)', () => {
		expect(displayIconSizeExpression()).toEqual([
			'*',
			['coalesce', ['get', 'radius'], 6],
			ICON_SIZE_FACTOR,
		])
	})

	it('icon-size active boost wraps the base expression in an active case', () => {
		const base = ['*', ['coalesce', ['get', 'radius'], 6], ICON_SIZE_FACTOR]
		expect(displayIconSizeExpression({ activeBoost: true })).toEqual([
			'case',
			['==', ['get', 'active'], true],
			['*', base, 1.25],
			base,
		])
	})

	it('icon-color tints the SDF glyph with strokeColor, white fallback', () => {
		expect(displayIconColorExpression()).toEqual(['coalesce', ['get', 'strokeColor'], '#ffffff'])
	})

	it('icon-color activeColor overrides the tint while the feature is active', () => {
		expect(displayIconColorExpression({ activeColor: '#ffffff' })).toEqual([
			'case',
			['==', ['get', 'active'], true],
			'#ffffff',
			['coalesce', ['get', 'strokeColor'], '#ffffff'],
		])
	})

	it('disc radius scales the point radius up so the glyph + ring fit', () => {
		expect(displayIconDiscRadiusExpression()).toEqual([
			'*',
			['coalesce', ['get', 'radius'], 6],
			1.75,
		])
	})

	it('disc radius active boost matches the icon-size active boost', () => {
		const base = ['*', ['coalesce', ['get', 'radius'], 6], 1.75]
		expect(displayIconDiscRadiusExpression({ activeBoost: true })).toEqual([
			'case',
			['==', ['get', 'active'], true],
			['*', base, 1.25],
			base,
		])
	})

	it('point labels anchor below the marker, non-points stay centered', () => {
		const isPoint = [
			'any',
			['==', ['geometry-type'], 'Point'],
			['==', ['geometry-type'], 'MultiPoint'],
		]
		expect(pointLabelAnchorExpression()).toEqual(['case', isPoint, 'top', 'center'])
	})

	it('label radial offset clears the icon disc for iconed points and the circle for plain ones', () => {
		const isPoint = [
			'any',
			['==', ['geometry-type'], 'Point'],
			['==', ['geometry-type'], 'MultiPoint'],
		]
		const radius = ['coalesce', ['get', 'radius'], 6]
		expect(pointLabelRadialOffsetExpression(12)).toEqual([
			'case',
			['all', isPoint, ['has', DISPLAY_ICON_PROPERTY]],
			['/', ['+', ['*', radius, 1.75], 4], 12],
			isPoint,
			['/', ['+', radius, 4], 12],
			0,
		])
	})
})
