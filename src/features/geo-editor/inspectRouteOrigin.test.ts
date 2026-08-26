import { describe, expect, test } from 'bun:test'
import {
	consumeInAppInspectRoute,
	inspectRouteKey,
	markInAppInspectRoute,
} from './inspectRouteOrigin'

describe('ephemeral entity inspect route origin', () => {
	test('an in-app Beacon inspection is consumed once instead of hydrating Map Stack', () => {
		const pending = { current: null as string | null }
		const routeKey = inspectRouteKey('beacon', 'naddr1beacon')

		markInAppInspectRoute(pending, null, routeKey)

		expect(consumeInAppInspectRoute(pending, routeKey)).toBe(true)
		expect(pending.current).toBeNull()
		expect(consumeInAppInspectRoute(pending, routeKey)).toBe(false)
	})

	test('a direct shared-link landing is not consumed and keeps route add/isolate behavior', () => {
		const pending = { current: null as string | null }

		expect(consumeInAppInspectRoute(pending, inspectRouteKey('beacon', 'naddr1shared'))).toBe(false)
	})

	test('hydrating an already-current Sighting route does not masquerade as an in-app open', () => {
		const pending = { current: null as string | null }
		const routeKey = inspectRouteKey('sighting', 'naddr1sighting')

		markInAppInspectRoute(pending, routeKey, routeKey)

		expect(pending.current).toBeNull()
		expect(consumeInAppInspectRoute(pending, routeKey)).toBe(false)
	})

	test('a pending Beacon open cannot suppress a different routed entity', () => {
		const pending = { current: null as string | null }
		markInAppInspectRoute(pending, null, inspectRouteKey('beacon', 'naddr1first'))

		expect(consumeInAppInspectRoute(pending, inspectRouteKey('sighting', 'naddr1second'))).toBe(
			false,
		)
		expect(pending.current).toBeNull()
	})
})
