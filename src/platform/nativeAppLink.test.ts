import { describe, expect, test } from 'bun:test'
import {
	earthlyAppLinkNavigationTarget,
	earthlyRouteFromAppLink,
	navigateToEarthlyAppLinkInPlace,
} from './nativeAppLink'

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

	test('rejects unowned origins, credentials, fragments, unsafe paths, and oversized links', () => {
		expect(earthlyRouteFromAppLink('https://evil.example/privategroup/workspace-1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city.evil.example/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://user@earthly.city/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city/privategroup/1#secret')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city//evil.example/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink('https://earthly.city/\\evil.example/privategroup/1')).toBeNull()
		expect(earthlyRouteFromAppLink(`https://earthly.city/${'a'.repeat(33 * 1024)}`)).toBeNull()
	})

	test('does not reload a route already opened from the retained Android launch URL', () => {
		expect(
			earthlyAppLinkNavigationTarget('https://earthly.city/private-groups', '/private-groups'),
		).toBeNull()
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/field-sessions?tab=nearby',
				'/field-sessions?tab=nearby',
			),
		).toBeNull()
	})

	test('does not replay a retained launch URL after Earthly adds runtime route state', () => {
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/field-sessions',
				'/field-sessions?ms=sighting-layer%3Aall%2Cbeacon-layer%3Aall',
			),
		).toBeNull()
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/private-groups?tab=invites',
				'/private-groups?tab=invites&ms=sighting-layer%3Aall&ex=dataset%7Cone&iso=dataset%3Atwo',
			),
		).toBeNull()
	})

	test('treats removal of non-runtime query state as navigation', () => {
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/privategroup/workspace-1',
				'/privategroup/workspace-1?private-invite=secret&ms=sighting-layer%3Aall',
			),
		).toBe('/privategroup/workspace-1')
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/private-groups',
				'/private-groups?unexpected=state',
			),
		).toBe('/private-groups')
	})

	test('still applies map-stack state explicitly carried by the incoming link', () => {
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/private-groups?ms=shared-stack',
				'/private-groups?ms=current-stack',
			),
		).toBe('/private-groups?ms=shared-stack')
	})

	test('navigates once when an Android App Link targets a different route', () => {
		expect(
			earthlyAppLinkNavigationTarget('https://earthly.city/field-sessions', '/private-groups'),
		).toBe('/field-sessions')
		expect(
			earthlyAppLinkNavigationTarget(
				'https://earthly.city/private-groups?tab=invites',
				'/private-groups?tab=settings&ms=sighting-layer%3Aall',
			),
		).toBe('/private-groups?tab=invites')
	})

	test('applies a warm App Link in place without reloading the WebView', () => {
		const pushedRoutes: string[] = []
		const dispatchedEvents: string[] = []
		const target = {
			location: { pathname: '/field-sessions', search: '?ms=nearby' },
			history: {
				pushState: (_data: unknown, _unused: string, route?: string | URL | null) => {
					pushedRoutes.push(String(route))
				},
			},
			dispatchEvent: (event: Event) => {
				dispatchedEvents.push(event.type)
				return true
			},
		}

		expect(
			navigateToEarthlyAppLinkInPlace('https://earthly.city/private-groups?tab=invites', target),
		).toBe(true)
		expect(pushedRoutes).toEqual(['/private-groups?tab=invites'])
		expect(dispatchedEvents).toEqual(['popstate'])
	})

	test('leaves the current screen intact when WebView history rejects the route', () => {
		const dispatchedEvents: string[] = []
		const target = {
			location: { pathname: '/field-sessions', search: '' },
			history: {
				pushState: () => {
					throw new DOMException('Cross-origin history update', 'SecurityError')
				},
			},
			dispatchEvent: (event: Event) => {
				dispatchedEvents.push(event.type)
				return true
			},
		}

		expect(navigateToEarthlyAppLinkInPlace('https://earthly.city/private-groups', target)).toBe(
			false,
		)
		expect(dispatchedEvents).toEqual([])
	})
})
