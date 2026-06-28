/**
 * Reusable `navigator.geolocation` / `watchPosition` mock fixture (test-only).
 *
 * The beacon publish loop (`useBeaconPublisher`, Plan 03) owns its own
 * `watchPosition` session — a clone of the locate-button pattern in
 * `src/components/ui/map.tsx:912-948`. To unit-test the throttle/heartbeat
 * decisions without a real GPS, tests install this controllable mock: it
 * replaces `navigator.geolocation` with a `watchPosition`/`clearWatch`/
 * `getCurrentPosition` triple wired to a controller that lets a test
 * `emitFix({ longitude, latitude, accuracy })`, `emitError({ code })`, and
 * assert that `clearWatch` was called.
 *
 * The success/error/options shape mirrors the production `watchPosition` call
 * at `map.tsx:920-948` (a `GeolocationPosition`-like `{ coords, timestamp }`
 * success arg and a `GeolocationPositionError`-like `{ code, message }` error
 * arg), and the three NIP-spec geolocation error codes
 * (`PERMISSION_DENIED` / `POSITION_UNAVAILABLE` / `TIMEOUT`) are exposed so a
 * test can drive the permission/error branches the beacon work must add.
 */

/** The three standard `GeolocationPositionError` numeric codes. */
export const PERMISSION_DENIED = 1
export const POSITION_UNAVAILABLE = 2
export const TIMEOUT = 3

/** A coordinate fix a test can emit through `watchPosition`'s success callback. */
export interface MockFix {
	longitude: number
	latitude: number
	/** Reported accuracy in metres (defaults to a plausible consumer-GPS value). */
	accuracy?: number
}

/** An error a test can emit through `watchPosition`'s error callback. */
export interface MockGeoError {
	code: number
	message?: string
}

/** A registered `watchPosition` subscription (one per active watch id). */
interface Watch {
	id: number
	success: PositionCallback
	error?: PositionErrorCallback
	options?: PositionOptions
}

/** The controller a test drives to simulate GPS behaviour. */
export interface GeolocationMockController {
	/** Push a position fix to every active `watchPosition` success callback. */
	emitFix(fix: MockFix): void
	/** Push an error to every active `watchPosition` error callback. */
	emitError(error: MockGeoError): void
	/** How many times `clearWatch` has been called. */
	clearWatchCount(): number
	/** Whether `clearWatch` was ever called. */
	wasCleared(): boolean
	/** Number of currently-active (not-yet-cleared) watches. */
	activeWatchCount(): number
	/** The options passed to the most recent `watchPosition` call (or undefined). */
	lastOptions(): PositionOptions | undefined
	/** Restore the original `navigator.geolocation` (call in test teardown). */
	uninstall(): void
}

function buildPosition(fix: MockFix): GeolocationPosition {
	return {
		coords: {
			longitude: fix.longitude,
			latitude: fix.latitude,
			accuracy: fix.accuracy ?? 10,
			altitude: null,
			altitudeAccuracy: null,
			heading: null,
			speed: null,
			toJSON() {
				return this
			},
		},
		timestamp: Date.now(),
		toJSON() {
			return this
		},
	} as unknown as GeolocationPosition
}

function buildError(error: MockGeoError): GeolocationPositionError {
	return {
		code: error.code,
		message: error.message ?? '',
		PERMISSION_DENIED,
		POSITION_UNAVAILABLE,
		TIMEOUT,
	} as unknown as GeolocationPositionError
}

/**
 * Install a controllable `navigator.geolocation` mock and return the controller.
 * Idempotent per call — each install captures the prior descriptor so
 * `uninstall()` restores it exactly.
 */
export function installGeolocationMock(): GeolocationMockController {
	const watches = new Map<number, Watch>()
	let nextId = 1
	let clearCount = 0
	let lastOpts: PositionOptions | undefined

	const geolocation: Geolocation = {
		watchPosition(
			success: PositionCallback,
			error?: PositionErrorCallback | null,
			options?: PositionOptions,
		): number {
			const id = nextId++
			lastOpts = options
			watches.set(id, { id, success, error: error ?? undefined, options })
			return id
		},
		clearWatch(id: number): void {
			clearCount++
			watches.delete(id)
		},
		getCurrentPosition(
			success: PositionCallback,
			_error?: PositionErrorCallback | null,
			_options?: PositionOptions,
		): void {
			// One-shot: tests drive fixes via emitFix; getCurrentPosition is a no-op
			// placeholder unless a test wires it explicitly.
			void success
		},
	}

	const target = globalThis.navigator as Navigator | undefined
	const original = target ? Object.getOwnPropertyDescriptor(target, 'geolocation') : undefined

	if (target) {
		Object.defineProperty(target, 'geolocation', {
			value: geolocation,
			configurable: true,
			writable: true,
		})
	} else {
		Object.defineProperty(globalThis, 'navigator', {
			value: { geolocation } as Navigator,
			configurable: true,
			writable: true,
		})
	}

	return {
		emitFix(fix: MockFix): void {
			const position = buildPosition(fix)
			for (const watch of watches.values()) watch.success(position)
		},
		emitError(error: MockGeoError): void {
			const positionError = buildError(error)
			for (const watch of watches.values()) watch.error?.(positionError)
		},
		clearWatchCount(): number {
			return clearCount
		},
		wasCleared(): boolean {
			return clearCount > 0
		},
		activeWatchCount(): number {
			return watches.size
		},
		lastOptions(): PositionOptions | undefined {
			return lastOpts
		},
		uninstall(): void {
			if (!target) return
			if (original) {
				Object.defineProperty(target, 'geolocation', original)
			} else {
				Reflect.deleteProperty(target as unknown as Record<string, unknown>, 'geolocation')
			}
		},
	}
}
