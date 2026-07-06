/**
 * Wave-0 Nyquist RED baseline — pins the throttled publish loop + the
 * fresh-per-session unlinkable throwaway key (BEACON-01, D-01 / D-02 / D-05)
 * BEFORE Plan 03 implements `useBeaconPublisher`.
 *
 * The two genuinely net-new, footgun-prone behaviours pinned here:
 *
 *   1. Throttle (D-01/D-02, Pitfall P-4): a fix that moved < 25 m AND < 30 s since
 *      the last publish does NOT publish; a fix that moved >= 25 m OR a heartbeat
 *      >= 30 s DOES publish; a coincident fix + interval publishes ONCE (single
 *      `lastPublishedAt` guard shared by both paths). The thresholds are named
 *      constants (`BEACON_HEARTBEAT_MS` / `BEACON_DISTANCE_FLOOR_M` /
 *      `BEACON_STALE_FACTOR` / `BEACON_STALE_THRESHOLD_S`), and the staleness
 *      threshold equals `(BEACON_HEARTBEAT_MS/1000) * BEACON_STALE_FACTOR`.
 *
 *   2. Fresh per-session key (D-05): starting a session mints a FRESH secp256k1
 *      key (two consecutive Starts ⇒ different pubkeys — unlinkable) and the
 *      session key is NEVER written to localStorage/IndexedDB.
 *
 * The geolocation mock fixture (`src/test/geolocationMock.ts`, Task 1) drives the
 * fixes. Clock discipline: the publish-decision compares epoch-seconds /
 * heartbeat-ms explicitly (the heartbeat interval is the ONLY ms value — P-1).
 *
 * RED-BASELINE: `useBeaconPublisher` + the `BEACON_*` constants + the pure
 * `shouldPublishBeacon` decision helper do not exist yet (land in Plan 03). The
 * cases below MUST fail now on the missing symbols. Do NOT implement them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installGeolocationMock, type GeolocationMockController } from '@/test/geolocationMock'

let geo: GeolocationMockController

beforeEach(() => {
	geo = installGeolocationMock()
})

afterEach(() => {
	geo.uninstall()
})

describe('useBeaconPublisher — named throttle constants (no magic numbers)', () => {
	test('the BEACON_* constants exist and the staleness threshold derives from the heartbeat', async () => {
		const {
			BEACON_HEARTBEAT_MS,
			BEACON_DISTANCE_FLOOR_M,
			BEACON_STALE_FACTOR,
			BEACON_STALE_THRESHOLD_S,
		} = await import('@/features/geo-editor/hooks/useBeaconPublisher')

		expect(BEACON_HEARTBEAT_MS).toBe(30_000)
		expect(BEACON_DISTANCE_FLOOR_M).toBe(25)
		expect(BEACON_STALE_FACTOR).toBe(4)
		// Derived, not a separate magic number (keeps cadence + staleness in sync).
		expect(BEACON_STALE_THRESHOLD_S).toBe((BEACON_HEARTBEAT_MS / 1000) * BEACON_STALE_FACTOR)
	})
})

describe('useBeaconPublisher — throttle decision (BEACON-01, D-01/D-02, Pitfall P-4)', () => {
	test('a fix that moved < floor AND < heartbeat does NOT publish; >= floor OR >= heartbeat DOES', async () => {
		const { shouldPublishBeacon, BEACON_HEARTBEAT_MS } = await import(
			'@/features/geo-editor/hooks/useBeaconPublisher'
		)

		const last = { coords: [16.3738, 48.2082] as [number, number], at: 1_000_000 }

		// Stationary, 10s after last publish ⇒ below both floors ⇒ NO publish.
		expect(
			shouldPublishBeacon(
				last,
				{ coords: [16.3738, 48.2082], at: last.at + 10_000 },
				BEACON_HEARTBEAT_MS,
			),
		).toBe(false)

		// Moved far (~hundreds of m), only 5s elapsed ⇒ distance floor crossed ⇒ publish.
		expect(
			shouldPublishBeacon(
				last,
				{ coords: [16.38, 48.2082], at: last.at + 5_000 },
				BEACON_HEARTBEAT_MS,
			),
		).toBe(true)

		// Stationary but >= heartbeat elapsed ⇒ time floor crossed ⇒ publish.
		expect(
			shouldPublishBeacon(
				last,
				{ coords: [16.3738, 48.2082], at: last.at + BEACON_HEARTBEAT_MS },
				BEACON_HEARTBEAT_MS,
			),
		).toBe(true)

		// No prior publish ⇒ always publish the first fix.
		expect(
			shouldPublishBeacon(null, { coords: [16.3738, 48.2082], at: last.at }, BEACON_HEARTBEAT_MS),
		).toBe(true)
	})

	test('a coincident fix + heartbeat interval publishes exactly ONCE (single lastPublishedAt guard)', async () => {
		const { createBeaconThrottle, BEACON_HEARTBEAT_MS } = await import(
			'@/features/geo-editor/hooks/useBeaconPublisher'
		)

		let publishes = 0
		const throttle = createBeaconThrottle(() => {
			publishes++
		})

		const at = 1_000_000
		const coords: [number, number] = [16.3738, 48.2082]
		// The fix path and the interval path fire on the same tick — both call the
		// shared guard, which must allow only ONE publish for that timestamp.
		throttle.onFix(coords, at + BEACON_HEARTBEAT_MS) // fix that is also due
		throttle.onHeartbeat(at + BEACON_HEARTBEAT_MS) // interval coincides

		expect(publishes).toBe(1)
	})
})

describe('useBeaconPublisher — fresh, never-persisted throwaway key (D-05)', () => {
	test('two consecutive Starts mint DIFFERENT pubkeys (unlinkable sessions)', async () => {
		const { startBeaconSession } = await import('@/features/geo-editor/hooks/useBeaconPublisher')

		const a = await startBeaconSession()
		const b = await startBeaconSession()

		const pkA = await a.signer.getPublicKey()
		const pkB = await b.signer.getPublicKey()
		expect(pkA).not.toBe(pkB)
		expect(typeof pkA).toBe('string')
		expect(pkA.length).toBe(64)
	})

	test('the session key is NEVER written to localStorage during a session', async () => {
		const { startBeaconSession } = await import('@/features/geo-editor/hooks/useBeaconPublisher')

		const writes: { key: string; value: string }[] = []
		const realSetItem = globalThis.localStorage?.setItem?.bind(globalThis.localStorage)
		const storage = (globalThis.localStorage ?? {}) as Storage
		const spied = {
			...storage,
			setItem(key: string, value: string) {
				writes.push({ key, value })
				realSetItem?.(key, value)
			},
		} as Storage
		Object.defineProperty(globalThis, 'localStorage', {
			value: spied,
			configurable: true,
			writable: true,
		})

		try {
			const session = await startBeaconSession()
			const pubkey = await session.signer.getPublicKey()
			// drive a fix through the session so any "persist key" path would have run.
			geo.emitFix({ longitude: 16.3738, latitude: 48.2082 })
			// No localStorage write may carry the throwaway pubkey (or its secret).
			expect(writes.every((w) => !w.value.includes(pubkey))).toBe(true)
		} finally {
			Object.defineProperty(globalThis, 'localStorage', {
				value: storage,
				configurable: true,
				writable: true,
			})
		}
	})
})

describe('useBeaconPublisher — no orphaned publish loop (CR-01 unmount / CR-02 re-Start)', () => {
	// The hook funnels its watch + heartbeat through one `openBeaconWatch` handle
	// and calls `teardown()` on Stop, on unmount (useEffect cleanup, CR-01), and
	// before minting a new session in `startBeacon` (CR-02 Adjust / double-Start).
	// These pin the primitive that guarantee relies on: teardown must release BOTH
	// OS resources, and a torn-down loop must stop delivering fixes — otherwise an
	// orphaned loop keeps publishing GPS under the throwaway key with no reachable
	// Stop (a direct D-05 privacy breach).

	test('teardown() releases BOTH the geolocation watch and the heartbeat interval (unmount cleanup)', async () => {
		const { openBeaconWatch, BEACON_HEARTBEAT_MS } = await import(
			'@/features/geo-editor/hooks/useBeaconPublisher'
		)

		let clearedIntervalId: unknown = 'not-cleared'
		const handle = openBeaconWatch({
			geolocation: navigator.geolocation,
			onFix: () => {},
			onError: () => {},
			onHeartbeat: () => {},
			heartbeatMs: BEACON_HEARTBEAT_MS,
			watchOptions: {},
			setIntervalFn: () => 4242 as unknown as ReturnType<typeof setInterval>,
			clearIntervalFn: (id) => {
				clearedIntervalId = id
			},
		})

		expect(geo.activeWatchCount()).toBe(1)

		handle.teardown()

		// Watch cleared (no more GPS reads) AND the heartbeat interval cleared (no
		// more republishes) — the two resources CR-01 leaked on unmount.
		expect(geo.clearWatchCount()).toBe(1)
		expect(geo.activeWatchCount()).toBe(0)
		expect(clearedIntervalId).toBe(4242)
	})

	test('a torn-down loop stops delivering fixes; a fresh loop after teardown leaves exactly one active watch (Adjust / double Start)', async () => {
		const { openBeaconWatch, BEACON_HEARTBEAT_MS } = await import(
			'@/features/geo-editor/hooks/useBeaconPublisher'
		)
		const noopTimers = {
			setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
			clearIntervalFn: () => {},
		}

		const fixesA: number[] = []
		const fixesB: number[] = []

		// Session A starts, then the hook tears it down before re-Starting (CR-02).
		const a = openBeaconWatch({
			geolocation: navigator.geolocation,
			onFix: () => fixesA.push(1),
			onError: () => {},
			onHeartbeat: () => {},
			heartbeatMs: BEACON_HEARTBEAT_MS,
			watchOptions: {},
			...noopTimers,
		})
		a.teardown()

		// Session B starts on the same geolocation.
		openBeaconWatch({
			geolocation: navigator.geolocation,
			onFix: () => fixesB.push(1),
			onError: () => {},
			onHeartbeat: () => {},
			heartbeatMs: BEACON_HEARTBEAT_MS,
			watchOptions: {},
			...noopTimers,
		})

		// Only B is live — A was released, so it can NOT still be broadcasting GPS.
		expect(geo.activeWatchCount()).toBe(1)

		geo.emitFix({ longitude: 16.3738, latitude: 48.2082 })

		expect(fixesA).toHaveLength(0)
		expect(fixesB).toHaveLength(1)
	})

	test('teardown() is idempotent — Stop followed by an unmount cleanup clears once', async () => {
		const { openBeaconWatch, BEACON_HEARTBEAT_MS } = await import(
			'@/features/geo-editor/hooks/useBeaconPublisher'
		)
		let clearIntervalCalls = 0
		const handle = openBeaconWatch({
			geolocation: navigator.geolocation,
			onFix: () => {},
			onError: () => {},
			onHeartbeat: () => {},
			heartbeatMs: BEACON_HEARTBEAT_MS,
			watchOptions: {},
			setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
			clearIntervalFn: () => {
				clearIntervalCalls++
			},
		})

		handle.teardown()
		handle.teardown()

		expect(geo.clearWatchCount()).toBe(1)
		expect(clearIntervalCalls).toBe(1)
	})
})
