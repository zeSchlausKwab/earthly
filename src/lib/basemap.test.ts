import { describe, expect, it } from 'bun:test'

import { basemapStyleUrl, resolveBasemapStyles } from './basemap'

describe('basemap style preferences', () => {
	it('resolves auto to Liberty in light mode and Dark in dark mode', () => {
		expect(resolveBasemapStyles('auto')).toEqual({
			light: 'https://tiles.openfreemap.org/styles/liberty',
			dark: 'https://tiles.openfreemap.org/styles/dark',
		})
	})

	it('pins explicit styles across both theme slots', () => {
		const liberty = basemapStyleUrl('liberty')

		expect(resolveBasemapStyles('liberty')).toEqual({
			light: liberty,
			dark: liberty,
		})
	})
})
