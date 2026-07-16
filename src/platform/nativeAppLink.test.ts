import { describe, expect, test } from 'bun:test'
import { earthlyAppLinkNavigationTarget, earthlyRouteFromAppLink } from './nativeAppLink'

describe('Android App Link routing', () => {
	test('keeps Earthly paths and invite query parameters under the WebView origin', () => {
		expect(
			earthlyRouteFromAppLink(
				'https://earthly.city/privategroup/workspace-1?private-invite=token%2Bvalue',
			),
		).toBe('/privategroup/workspace-1?private-invite=token%2Bvalue')
		expect(earthlyRouteFromAppLink('https://earthly.city/fieldsession/survey-1')).toBe(
			'/fieldsession/survey-1',
		)
	})

	test('rejects unowned origins, credentials, fragments, and oversized links', () => {
		expect(earthlyRouteFromAppLink('https://evil.example/privategroup/workspace-1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city.evil.example/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://user@earthly.city/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city/privategroup/1#secret')).toBeNull()
		expect(earthlyRouteFromAppLink(`https://earthly.city/${'a'.repeat(33 * 1024)}`)).toBeNull()
	})

	test('does not reload a route already opened from the retained Android launch URL', () => {
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/private-groups',
				'/private-groups',
			),
		).toBeNull()
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/field-sessions?tab=nearby',
				'/field-sessions?tab=nearby',
			),
		).toBeNull()
	})

	test('navigates once when an Android App Link targets a different route', () => {
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/field-sessions',
				'/private-groups',
			),
		).toBe('/field-sessions')
	})
})
