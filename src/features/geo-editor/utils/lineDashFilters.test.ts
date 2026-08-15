import { describe, expect, it } from 'bun:test'
import { SOLID_LINE_DASH_FILTER, usesSolidLineLayer } from './lineDashFilters'

describe('solid line dash rendering filter', () => {
	it('expresses the same fallback contract in the MapLibre filter', () => {
		expect(SOLID_LINE_DASH_FILTER).toEqual([
			'all',
			['!=', ['get', 'lineDash'], 'dashed'],
			['!=', ['get', 'lineDash'], 'dotted'],
		])
	})

	it('renders absent and canonical solid values in the solid layer', () => {
		expect(usesSolidLineLayer(undefined)).toBe(true)
		expect(usesSolidLineLayer('solid')).toBe(true)
	})

	it('leaves canonical patterned values to their dedicated layers', () => {
		expect(usesSolidLineLayer('dashed')).toBe(false)
		expect(usesSolidLineLayer('dotted')).toBe(false)
	})

	it('renders legacy or model-authored noncanonical values as solid instead of hiding the line', () => {
		expect(usesSolidLineLayer('')).toBe(true)
		expect(usesSolidLineLayer('4,4')).toBe(true)
		expect(usesSolidLineLayer([4, 4])).toBe(true)
	})
})
