import { describe, expect, it } from 'bun:test'
import {
	DEFAULT_SATELLITE_SETTINGS,
	getMapBackground,
	normalizeSatelliteSettings,
	resolveSatelliteComposition,
} from './satellite'

describe('saved satellite settings', () => {
	it('defaults invalid storage to disabled imagery', () => {
		for (const value of [null, 'enabled', [], {}, { enabled: 'yes', opacity: Number.NaN }]) {
			expect(normalizeSatelliteSettings(value)).toEqual(DEFAULT_SATELLITE_SETTINGS)
		}
	})

	it('bounds saved opacity and preserves explicit composition choices', () => {
		expect(normalizeSatelliteSettings({ enabled: true, opacity: 5, osmOverlay: false })).toEqual({
			enabled: true,
			mode: 'combined',
			opacity: 1,
			osmOverlay: false,
		})
		expect(normalizeSatelliteSettings({ opacity: -2 }).opacity).toBe(0)
	})

	it('uses opaque satellite imagery while retaining the configurable Combined blend', () => {
		const settings = normalizeSatelliteSettings({
			enabled: true,
			mode: 'satellite',
			opacity: 0.6,
			osmOverlay: true,
		})
		expect(getMapBackground(DEFAULT_SATELLITE_SETTINGS)).toBe('osm')
		expect(getMapBackground(settings)).toBe('satellite')
		expect(resolveSatelliteComposition(settings)).toMatchObject({ opacity: 1, osmOverlay: false })
		expect(resolveSatelliteComposition({ ...settings, mode: 'combined' })).toMatchObject({
			opacity: 0.6,
			osmOverlay: true,
		})
	})
})
