import { describe, expect, it } from 'bun:test'
import { InvalidStyleOptionError, normalizeStyleOptions } from './styleOptions'

describe('normalizeStyleOptions (UAT styling gap-closure)', () => {
	it('passes canonical color keys through unchanged', () => {
		expect(normalizeStyleOptions({ color: '#ff0000' })).toEqual({ color: '#ff0000' })
		expect(normalizeStyleOptions({ fillColor: '#00ff00' })).toEqual({ fillColor: '#00ff00' })
		expect(normalizeStyleOptions({ strokeColor: '#0000ff' })).toEqual({ strokeColor: '#0000ff' })
	})

	it('normalizes forgiving aliases to canonical renderer keys', () => {
		expect(normalizeStyleOptions({ fill: '#ff0000' })).toEqual({ fillColor: '#ff0000' })
		expect(normalizeStyleOptions({ stroke: '#0000ff' })).toEqual({ strokeColor: '#0000ff' })
		expect(normalizeStyleOptions({ width: 4 })).toEqual({ strokeWidth: 4 })
		expect(normalizeStyleOptions({ opacity: 0.5 })).toEqual({ fillOpacity: 0.5 })
	})

	it('accepts numeric/metadata keys and the full set together', () => {
		expect(
			normalizeStyleOptions({
				fillColor: '#abc',
				strokeColor: '#def',
				fillOpacity: 0.3,
				strokeOpacity: 0.9,
				strokeWidth: 2,
				radius: 8,
				label: 'A',
				name: 'B',
				description: 'C',
			}),
		).toEqual({
			fillColor: '#abc',
			strokeColor: '#def',
			fillOpacity: 0.3,
			strokeOpacity: 0.9,
			strokeWidth: 2,
			radius: 8,
			label: 'A',
			name: 'B',
			description: 'C',
		})
	})

	it('ignores reserved primitive keys (units/steps) and undefined values', () => {
		expect(normalizeStyleOptions({ units: 'meters', steps: 64, color: '#fff' })).toEqual({
			color: '#fff',
		})
		expect(normalizeStyleOptions({ color: undefined, fillColor: '#fff' })).toEqual({
			fillColor: '#fff',
		})
	})

	it('rejects an unknown option with a clear error listing accepted names', () => {
		let caught: unknown
		try {
			normalizeStyleOptions({ bogus: 'x' })
		} catch (err) {
			caught = err
		}
		expect(caught).toBeInstanceOf(InvalidStyleOptionError)
		expect((caught as Error).message).toContain("Unknown option 'bogus'")
		expect((caught as Error).message).toContain('fillColor')
		expect((caught as Error).message).toContain('strokeColor')
	})

	it('rejects bad values rather than injecting garbage', () => {
		expect(() => normalizeStyleOptions({ color: 123 as unknown as string })).toThrow(
			InvalidStyleOptionError,
		)
		expect(() => normalizeStyleOptions({ fillOpacity: 5 })).toThrow(InvalidStyleOptionError)
		expect(() => normalizeStyleOptions({ fillOpacity: -1 })).toThrow(InvalidStyleOptionError)
		expect(() => normalizeStyleOptions({ strokeWidth: 0 })).toThrow(InvalidStyleOptionError)
		expect(() => normalizeStyleOptions({ strokeWidth: Number.NaN })).toThrow(
			InvalidStyleOptionError,
		)
		expect(() => normalizeStyleOptions({ label: '' })).toThrow(InvalidStyleOptionError)
	})

	it('returns an empty patch for no style options', () => {
		expect(normalizeStyleOptions({})).toEqual({})
		expect(normalizeStyleOptions({ units: 'kilometers' })).toEqual({})
	})
})
