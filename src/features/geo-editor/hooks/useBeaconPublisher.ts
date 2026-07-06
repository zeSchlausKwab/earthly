/**
 * `useBeaconPublisher` — the throttled `watchPosition` publish loop + the
 * per-session throwaway identity (BEACON-01 / BEACON-02, D-01 / D-02 / D-05).
 *
 * This is the one genuinely net-new live subsystem of the milestone. It owns its
 * OWN `navigator.geolocation.watchPosition` session (separate from the locate
 * button in `map.tsx`) and, on each qualifying fix, republishes the SAME
 * replaceable kind-37521 event via the Plan-02 `updateBeacon` lifecycle. A
 * heartbeat `setInterval` keeps a stationary beacon live (D-02), and a single
 * `lastPublished` guard shared by the fix path AND the interval prevents a
 * coincident fix+tick from double-publishing (Pitfall P-4).
 *
 * Identity model (the milestone's highest privacy surface, D-05):
 *   - anonymous (DEFAULT): a FRESH secp256k1 key is minted per Start
 *     (`new PrivateKeySigner(generateSecretKey())`), held in a React ref / memory
 *     ONLY — never localStorage / IndexedDB. Two Starts ⇒ unlinkable pubkeys.
 *   - my-account (explicit opt-in): the active account signs instead.
 * Stop publishes the final `status:'ended'` event (Plan-02 `stopBeacon`) then
 * DISCARDS the session signer + secret key.
 *
 * Clock discipline (Pitfall P-1): the publish decision compares epoch-ms
 * timestamps via the heartbeat (the only ms value); the staleness threshold
 * exported here is epoch-SECONDS and re-exported from the data layer so the
 * banner (Plan 05) and the throttle stay in sync.
 */

import type { Point } from 'geojson'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveAccount } from 'applesauce-react/hooks'
import { PrivateKeySigner } from 'applesauce-signers'
import { generateSecretKey } from 'nostr-tools'
import { castEvent } from 'applesauce-core/casts'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { eventStore } from '@/lib/nostr'
import {
	BEACON_DISTANCE_FLOOR_M,
	BEACON_HEARTBEAT_MS,
	BEACON_STALE_FACTOR,
	BEACON_STALE_THRESHOLD_S,
	type BeaconVisibility,
	LiveBeacon,
	stopBeacon,
	updateBeacon,
} from '@/lib/nostr/live-beacon'
import { generateShortDTag } from '@/lib/nostr/dTag'
import type { SignerLike } from '@/lib/nostr/entityFactory'

// Re-export the cadence constants from the data layer so the throttle + the
// Plan-01 test contract import them from a single source (NEVER redefined here).
export {
	BEACON_DISTANCE_FLOOR_M,
	BEACON_HEARTBEAT_MS,
	BEACON_STALE_FACTOR,
	BEACON_STALE_THRESHOLD_S,
}

/** Earth mean radius in metres (haversine). */
const EARTH_RADIUS_M = 6_371_008.8

/**
 * Great-circle distance in METRES between two `[lon, lat]` coordinates. Pure;
 * no turf dependency so the throttle decision is trivially unit-testable.
 */
export function haversineMeters(
	[lon1, lat1]: [number, number],
	[lon2, lat2]: [number, number],
): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180
	const dLat = toRad(lat2 - lat1)
	const dLon = toRad(lon2 - lon1)
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
	return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** A published-fix record — the single guard shared by the fix + heartbeat paths. */
export interface LastPublished {
	coords: [number, number]
	/** Epoch ms of the publish (compared against the heartbeat interval, P-1). */
	at: number
}

/** A candidate fix the throttle decides on. */
export interface BeaconFix {
	coords: [number, number]
	/** Epoch ms of the fix. */
	at: number
}

/**
 * Pure throttle decision (D-01 / D-02, Pitfall P-4). Publish iff there is no
 * prior publish, OR the candidate moved `>= BEACON_DISTANCE_FLOOR_M` from the
 * last publish, OR `>= heartbeatMs` elapsed since the last publish. Otherwise
 * skip — a jittery sub-floor fix inside the heartbeat window never floods.
 */
export function shouldPublishBeacon(
	last: LastPublished | null,
	next: BeaconFix,
	heartbeatMs: number,
): boolean {
	if (last === null) return true
	if (next.at - last.at >= heartbeatMs) return true
	return haversineMeters(last.coords, next.coords) >= BEACON_DISTANCE_FLOOR_M
}

/** The throttle handle — both paths funnel through the SAME `lastPublished` guard. */
export interface BeaconThrottle {
	/** A geolocation fix arrived. */
	onFix(coords: [number, number], at: number): void
	/** The heartbeat interval ticked (republishes the last fix if due). */
	onHeartbeat(at: number): void
	/** The current guard (for teardown / inspection). */
	last(): LastPublished | null
	/** Reset the guard (e.g. on a new session). */
	reset(): void
}

/**
 * Build a throttle that calls `onPublish(coords, at)` at most once per
 * qualifying instant. A coincident fix + heartbeat on the SAME timestamp
 * publishes EXACTLY ONCE because both paths consult — and advance — the single
 * `lastPublished` guard (Pitfall P-4).
 */
export function createBeaconThrottle(
	onPublish: (coords: [number, number], at: number) => void,
): BeaconThrottle {
	let lastPublished: LastPublished | null = null
	let lastFix: [number, number] | null = null

	const tryPublish = (coords: [number, number], at: number) => {
		if (!shouldPublishBeacon(lastPublished, { coords, at }, BEACON_HEARTBEAT_MS)) return
		lastPublished = { coords, at }
		onPublish(coords, at)
	}

	return {
		onFix(coords, at) {
			lastFix = coords
			tryPublish(coords, at)
		},
		onHeartbeat(at) {
			if (!lastFix) return
			tryPublish(lastFix, at)
		},
		last() {
			return lastPublished
		},
		reset() {
			lastPublished = null
			lastFix = null
		},
	}
}

/** Caller's choice of signing identity (D-05). */
export type BeaconIdentity = 'anonymous' | 'my-account'

/** A live publish session — the signer + secret live in memory ONLY. */
export interface BeaconSession {
	/** The signer used for every heartbeat (throwaway OR the active account). */
	signer: SignerLike
	/**
	 * The raw throwaway secret key for the anonymous branch — held in memory only,
	 * NEVER persisted, discarded at Stop. Undefined for the my-account branch.
	 */
	sk?: Uint8Array
	/** The stable session `d` — preserved across every heartbeat (no fork). */
	d: string
}

/**
 * Mint a fresh publish session. `anonymous` (DEFAULT) generates a brand-new
 * secp256k1 key — two Starts are unlinkable, and the secret is NEVER written to
 * any datastore. `my-account` reuses a provided active-account signer instead.
 */
export async function startBeaconSession(
	identity: BeaconIdentity = 'anonymous',
	accountSigner?: SignerLike,
): Promise<BeaconSession> {
	if (identity === 'my-account') {
		if (!accountSigner) {
			throw new Error('startBeaconSession: my-account identity requires an active account signer.')
		}
		return { signer: accountSigner, d: generateShortDTag() }
	}
	// anonymous: fresh, in-memory-only throwaway key (D-05).
	const sk = generateSecretKey()
	return { signer: new PrivateKeySigner(sk), sk, d: generateShortDTag() }
}

/** Geolocation sub-state surfaced to the banner (Plan 05). */
export type BeaconSubState = 'idle' | 'searching' | 'tracking' | 'permission-denied' | 'error'

/** What `useBeaconPublisher` exposes to the banner / control panel. */
export interface UseBeaconPublisher {
	/** True while a session is active. */
	isLive: boolean
	/** The geolocation sub-state (banner copy). */
	subState: BeaconSubState
	/** The current session (or null when idle). */
	session: BeaconSession | null
	/**
	 * The latest published beacon cast to a `LiveBeacon` (or null before the first
	 * fix publishes / after Stop). Lets the controller open the read/share view of
	 * the user's OWN live beacon — the share naddr carries the throwaway pubkey.
	 */
	liveBeacon: LiveBeacon | null
	/** Start a beacon: mint the signer, own a watch, begin heartbeating. */
	startBeacon(args: {
		content: Partial<{ geometry: Point; label: string }>
		expiration?: number
		visibility: BeaconVisibility
		identity?: BeaconIdentity
	}): Promise<void>
	/** Stop a beacon: publish the final `status:'ended'`, discard the session. */
	stopBeacon(): Promise<void>
}

/** The watchPosition options — mirror the locate button (`map.tsx:947`). */
const WATCH_OPTIONS: PositionOptions = {
	enableHighAccuracy: true,
	timeout: 10000,
	maximumAge: 5000,
}

/** A running beacon loop's OS resources — a geolocation watch + a heartbeat interval. */
export interface BeaconLoopHandle {
	/** Release the watch AND the heartbeat interval. Idempotent (safe to double-call). */
	teardown(): void
}

/**
 * Acquire the beacon publish loop's OS resources: a `watchPosition` subscription
 * feeding `onFix`/`onError` and a heartbeat `setInterval` calling `onHeartbeat`.
 * Returns a `teardown()` that releases BOTH — the single choke point the hook
 * invokes on Stop, on unmount (CR-01), and before a re-Start (CR-02) so a loop can
 * never outlive its owner still publishing GPS under the throwaway key (D-05).
 *
 * The geolocation + timer functions are injected (defaulting to the platform
 * globals) so the teardown / anti-orphan invariant is unit-testable without React
 * or a real GPS — the same pure-helper testability as `createBeaconThrottle`.
 */
export function openBeaconWatch(args: {
	geolocation: Pick<Geolocation, 'watchPosition' | 'clearWatch'>
	onFix(coords: [number, number], at: number): void
	onError(error: GeolocationPositionError): void
	onHeartbeat(at: number): void
	heartbeatMs: number
	watchOptions: PositionOptions
	now?: () => number
	setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
	clearIntervalFn?: (id: ReturnType<typeof setInterval>) => void
}): BeaconLoopHandle {
	const now = args.now ?? Date.now
	const setIntervalImpl = args.setIntervalFn ?? setInterval
	const clearIntervalImpl = args.clearIntervalFn ?? clearInterval

	const watchId = args.geolocation.watchPosition(
		(pos) => args.onFix([pos.coords.longitude, pos.coords.latitude], now()),
		(err) => args.onError(err),
		args.watchOptions,
	)
	const intervalId = setIntervalImpl(() => args.onHeartbeat(now()), args.heartbeatMs)

	let released = false
	return {
		teardown() {
			if (released) return
			released = true
			args.geolocation.clearWatch(watchId)
			clearIntervalImpl(intervalId)
		},
	}
}

/**
 * Own a throttled `watchPosition` publish loop under a per-session throwaway (or
 * own-account) signer. The hook is the BEACON-01 publish discipline + the D-05
 * privacy boundary in one place.
 */
export function useBeaconPublisher(): UseBeaconPublisher {
	const activeAccount = useActiveAccount()
	const [isLive, setIsLive] = useState(false)
	const [subState, setSubState] = useState<BeaconSubState>('idle')
	// The latest published beacon (cast), surfaced so the controller can open the
	// owner's read/share view. Set on each publish, cleared on teardown.
	const [liveBeacon, setLiveBeacon] = useState<LiveBeacon | null>(null)

	// All mutable session machinery lives in a ref — the secret key is in memory
	// ONLY and never leaves this closure (D-05).
	const sessionRef = useRef<BeaconSession | null>(null)
	const throttleRef = useRef<BeaconThrottle | null>(null)
	const loopRef = useRef<BeaconLoopHandle | null>(null)
	const lastEventRef = useRef<NostrEvent | null>(null)
	const lastFixRef = useRef<[number, number] | null>(null)
	const optionsRef = useRef<{ expiration?: number; visibility: BeaconVisibility } | null>(null)

	const teardown = useCallback(() => {
		// Release the watch + heartbeat via the single loop handle (idempotent).
		loopRef.current?.teardown()
		loopRef.current = null
		// Discard the session — drop the signer AND the secret key (D-05).
		sessionRef.current = null
		throttleRef.current = null
		lastEventRef.current = null
		lastFixRef.current = null
		optionsRef.current = null
		setLiveBeacon(null)
	}, [])

	// CR-01: if the hook unmounts while a beacon is live (SPA route change,
	// StrictMode remount), stop the watch + heartbeat so a session can never
	// outlive the component — otherwise the orphaned loop keeps publishing GPS
	// under the throwaway key with no reachable Stop (D-05 privacy boundary).
	useEffect(() => teardown, [teardown])

	const publishFix = useCallback(async (coords: [number, number]) => {
		const session = sessionRef.current
		const opts = optionsRef.current
		if (!session || !opts) return
		try {
			const signed = await updateBeacon(
				{
					existing: lastEventRef.current ?? undefined,
					content: {
						geometry: { type: 'Point', coordinates: coords },
						status: 'live',
					},
					expiration: opts.expiration,
					visibility: opts.visibility,
				},
				session.signer,
			)
			lastEventRef.current = signed
			// Surface the just-published beacon so the controller can open the owner's
			// read/share view. The event we just built conforms, but guard the cast.
			try {
				setLiveBeacon(castEvent(signed, LiveBeacon, eventStore))
			} catch {
				// Non-conforming cast — leave the prior liveBeacon; the useBeacons
				// subscription still surfaces it via the relay round-trip.
			}
		} catch (err) {
			console.error('useBeaconPublisher: heartbeat publish failed', err)
			setSubState('error')
		}
	}, [])

	const startBeacon = useCallback<UseBeaconPublisher['startBeacon']>(
		async ({ content, expiration, visibility, identity = 'anonymous' }) => {
			if (typeof navigator === 'undefined' || !navigator.geolocation) {
				setSubState('error')
				return
			}

			// CR-02: never orphan a live session. Adjust / double-Start would otherwise
			// overwrite the refs below and leave the PREVIOUS watch + heartbeat +
			// throwaway signer running — publishing GPS under a key the UI can no
			// longer Stop. Tear the prior session down before minting a new one.
			teardown()

			const session = await startBeaconSession(
				identity,
				identity === 'my-account' ? (activeAccount as unknown as SignerLike) : undefined,
			)
			sessionRef.current = session
			optionsRef.current = { expiration, visibility }
			lastEventRef.current = null

			// The throttle funnels the fix path AND the heartbeat through one guard.
			const throttle = createBeaconThrottle((coords) => {
				void publishFix(coords)
			})
			throttleRef.current = throttle

			// If a starting geometry was supplied, seed the first fix immediately.
			if (content.geometry) {
				const seed = content.geometry.coordinates as [number, number]
				lastFixRef.current = seed
				throttle.onFix(seed, Date.now())
			}

			setSubState('searching')

			// Own a SEPARATE watch (NOT the locate button's) + a heartbeat keepalive
			// (D-02), funnelled through one teardown handle so Stop / unmount / re-Start
			// all release both resources (CR-01 / CR-02).
			loopRef.current = openBeaconWatch({
				geolocation: navigator.geolocation,
				onFix: (coords, at) => {
					lastFixRef.current = coords
					setSubState('tracking')
					throttle.onFix(coords, at)
				},
				onError: (error) => {
					if (error.code === error.PERMISSION_DENIED) {
						// Hard stop — the user denied location; surface honestly + tear down.
						setSubState('permission-denied')
						teardown()
						setIsLive(false)
						return
					}
					// POSITION_UNAVAILABLE / TIMEOUT — do NOT republish a stale point; let
					// staleness take over honestly (the marker greys out). Banner shows
					// "searching…" (Pitfall P-3 / T-12-03-FROZEN).
					setSubState('searching')
				},
				onHeartbeat: (at) => throttle.onHeartbeat(at),
				heartbeatMs: BEACON_HEARTBEAT_MS,
				watchOptions: WATCH_OPTIONS,
			})

			setIsLive(true)
		},
		[activeAccount, publishFix, teardown],
	)

	const stop = useCallback<UseBeaconPublisher['stopBeacon']>(async () => {
		const session = sessionRef.current
		const lastEvent = lastEventRef.current
		// Publish the final status:'ended' BEFORE discarding the signer (BEACON-02).
		if (session && lastEvent) {
			try {
				await stopBeacon(lastEvent, session.signer)
			} catch (err) {
				// A failed ended-publish must not freeze the marker as live — surface
				// the error; the marker degrades to STALE via staleness regardless of
				// status (P-3 / T-12-03-STOPFAIL).
				console.error('useBeaconPublisher: stop publish failed', err)
				setSubState('error')
			}
		}
		teardown()
		setIsLive(false)
		setSubState('idle')
	}, [teardown])

	return {
		isLive,
		subState,
		session: sessionRef.current,
		liveBeacon,
		startBeacon,
		stopBeacon: stop,
	}
}
