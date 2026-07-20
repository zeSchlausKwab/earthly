import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const installDeterministicGeolocationTask: AiTaskMetadata = {
	id: 'setup.deterministic-geolocation',
	summary:
		'Install a denied-then-granted browser geolocation fixture for repeatable permission recovery journeys.',
	preconditions: ['Fresh browser page', 'Location behavior is part of the journey under test'],
	sideEffects: ['Replaces navigator.geolocation in the current browser context'],
	viewports: 'both',
}

export const recoverDeviceLocationTask: AiTaskMetadata = {
	id: 'navigation.recover-device-location',
	summary:
		'Recover from a denied device-location attempt and center the map after granting access.',
	preconditions: ['Earthly is open', 'Deterministic geolocation starts in the denied state'],
	sideEffects: ['Starts map location tracking and changes the viewport'],
	viewports: 'both',
}

interface TestGeolocationController {
	grant(): void
}

declare global {
	interface Window {
		__earthlyTestGeolocation?: TestGeolocationController
	}
}

export interface DeterministicLocation {
	latitude: number
	longitude: number
	accuracy?: number
}

export async function installDeterministicGeolocation(
	earthly: EarthlySession,
	location: DeterministicLocation,
): Promise<void> {
	await earthly.page.addInitScript((fixtureLocation) => {
		let permission: 'denied' | 'granted' = 'denied'
		let nextWatchId = 1
		const activeWatches = new Set<number>()
		const coordinates = {
			latitude: fixtureLocation.latitude,
			longitude: fixtureLocation.longitude,
			accuracy: fixtureLocation.accuracy ?? 12,
			altitude: null,
			altitudeAccuracy: null,
			heading: null,
			speed: null,
			toJSON: () => ({}),
		}
		const position = {
			coords: coordinates,
			timestamp: Date.now(),
			toJSON: () => ({}),
		} as GeolocationPosition
		const deniedError = {
			code: 1,
			message: 'User denied Geolocation',
			PERMISSION_DENIED: 1,
			POSITION_UNAVAILABLE: 2,
			TIMEOUT: 3,
		} as GeolocationPositionError

		const geolocation: Geolocation = {
			getCurrentPosition(success, error) {
				queueMicrotask(() => {
					if (permission === 'granted') success(position)
					else error?.(deniedError)
				})
			},
			watchPosition(success, error) {
				const id = nextWatchId++
				activeWatches.add(id)
				queueMicrotask(() => {
					if (!activeWatches.has(id)) return
					if (permission === 'granted') success(position)
					else error?.(deniedError)
				})
				return id
			},
			clearWatch(id) {
				activeWatches.delete(id)
			},
		}

		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: geolocation,
		})
		window.__earthlyTestGeolocation = {
			grant: () => {
				permission = 'granted'
			},
		}
	}, location)
}

export async function attemptDeniedDeviceLocation(earthly: EarthlySession): Promise<void> {
	const locate = earthly.page.getByRole('button', { name: 'Track my location', exact: true })
	await locate.click()
	await expect(
		earthly.page.getByRole('button', { name: 'Retry location', exact: true }),
	).toBeVisible()
}

export async function grantAndTrackDeviceLocation(earthly: EarthlySession): Promise<void> {
	await earthly.page.evaluate(() => window.__earthlyTestGeolocation?.grant())
	await earthly.page.getByRole('button', { name: 'Retry location', exact: true }).click()
	await expect(
		earthly.page.getByRole('button', { name: 'Stop tracking location', exact: true }),
	).toBeVisible()
}

export async function stopDeviceLocationTracking(earthly: EarthlySession): Promise<void> {
	await earthly.page.getByRole('button', { name: 'Stop tracking location', exact: true }).click()
	await expect(
		earthly.page.getByRole('button', { name: 'Track my location', exact: true }),
	).toBeVisible()
}
