/**
 * Curated @turf/turf subset exposed INSIDE the sandbox boundary (D-02).
 *
 * The model's untrusted code gets exactly this geometry/math surface and the
 * plain JS built-ins (Math, JSON, Array, …) — nothing else. The set is the
 * RESEARCH-verified function list (`### Curated turf surface (D-02)`), each
 * confirmed `typeof 'function'` in `@turf/turf@7.3.5` on 2026-06-18.
 *
 * Two boundary-safety properties matter here:
 *  - The object is `Object.freeze`d so code inside the boundary can't mutate or
 *    extend the curated surface to smuggle in extra capability.
 *  - The DoS distance cap (`MAX_DISTANCE_METERS`) is RE-EXPORTED from the
 *    Authoring API barrel (`@/features/geo-editor/api`), reusing the single
 *    source of truth in `primitives.ts` — it is NOT redefined as a literal here.
 *    A sandbox loop that asks for absurd geometry can be rejected against this
 *    cap before turf burns CPU (RESEARCH Security Domain / T-04-05).
 *
 * This module is PURE: no DOM, no Worker, no editor import — so it bundles
 * cleanly INTO the worker boundary alongside the QuickJS engine.
 */

import {
	along,
	area,
	bearing,
	booleanPointInPolygon,
	buffer,
	centroid,
	circle,
	destination,
	distance,
	length,
	lineString,
	nearestPointOnLine,
	point,
} from '@turf/turf'
import { MAX_DISTANCE_METERS } from '@/features/geo-editor/api'

/**
 * Reused DoS distance cap (D-02 / T-04-05). Re-exported from the Authoring API
 * barrel — the single source of truth is `primitives.ts`; the literal is NOT
 * redefined here. The boundary range-checks distance-bearing turf calls against
 * this cap BEFORE invoking turf so an absurd radius can't burn CPU — enforcement
 * lives in {@link assertSandboxDistanceWithinCap}, called from the worker's turf
 * wrapper (WR-01).
 *
 * Kept as a SEPARATE export (not a key on `curatedTurf`) so the injected `turf`
 * global stays exactly the curated FUNCTIONS — a guard value doesn't belong on
 * the callable surface.
 */
export const SANDBOX_MAX_DISTANCE_METERS = MAX_DISTANCE_METERS

/**
 * Curated turf functions that take a radius/distance argument at index 1, with an
 * optional `units` field on their trailing options object. These are the ops a
 * sandbox loop can abuse to make turf generate absurd geometry and burn CPU on the
 * worker thread (which the in-VM interrupt cannot preempt — WR-02), so the boundary
 * range-checks the distance against {@link SANDBOX_MAX_DISTANCE_METERS} BEFORE
 * invoking turf (WR-01 / T-04-05).
 *
 * turf's own default unit for these is `kilometers`; the cap is in meters, so the
 * raw arg is normalized to meters with the per-call units before comparison.
 */
const DISTANCE_BEARING_OPS = new Set(['circle', 'buffer', 'destination', 'along'])

/** Meters per supported turf length unit (mirrors primitives.ts; turf defaults to km). */
const METERS_PER_TURF_UNIT: Record<string, number> = {
	meters: 1,
	metres: 1,
	kilometers: 1000,
	kilometres: 1000,
	miles: 1609.344,
	nauticalmiles: 1852,
	feet: 0.3048,
	inches: 0.0254,
	yards: 0.9144,
	centimeters: 0.01,
	centimetres: 0.01,
	millimeters: 0.001,
	millimetres: 0.001,
}

/** Thrown by {@link assertSandboxDistanceWithinCap} when a turf distance arg is out of bounds (WR-01). */
export class SandboxDistanceCapError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SandboxDistanceCapError'
	}
}

/**
 * Range-check a distance-bearing turf call against the DoS cap BEFORE turf runs
 * (WR-01). No-op for any op that does not carry a distance arg. For
 * `circle`/`buffer`/`destination`/`along` the index-1 argument is the
 * radius/distance: reject NaN / Infinity / ≤ 0, and reject any value whose
 * meter-equivalent is at or above {@link SANDBOX_MAX_DISTANCE_METERS}. Units are
 * read from the trailing options object (turf default: `kilometers`).
 *
 * Throws {@link SandboxDistanceCapError}; the worker's turf wrapper catches it and
 * surfaces a `__turf_error__:` marker the sandbox code can see.
 */
export function assertSandboxDistanceWithinCap(op: string, args: unknown[]): void {
	if (!DISTANCE_BEARING_OPS.has(op)) return

	const distance = args[1]
	if (typeof distance !== 'number' || !Number.isFinite(distance)) {
		throw new SandboxDistanceCapError(
			`turf.${op}: distance must be a finite number (got ${String(distance)}).`,
		)
	}
	if (distance <= 0) {
		throw new SandboxDistanceCapError(
			`turf.${op}: distance must be greater than 0 (got ${distance}).`,
		)
	}

	// `destination(origin, distance, bearing, options)` keeps options at index 3;
	// the others keep options at index 2. Scan the tail for the first plain object
	// carrying a `units` field rather than hard-coding per-op positions.
	let units = 'kilometers'
	for (let i = 2; i < args.length; i++) {
		const opt = args[i]
		if (opt && typeof opt === 'object' && typeof (opt as { units?: unknown }).units === 'string') {
			units = (opt as { units: string }).units
			break
		}
	}

	const metersPerUnit = METERS_PER_TURF_UNIT[units] ?? 1000
	const meters = distance * metersPerUnit
	if (meters >= SANDBOX_MAX_DISTANCE_METERS) {
		throw new SandboxDistanceCapError(
			`turf.${op}: distance ${distance} ${units} (~${Math.round(meters)} m) exceeds the ${SANDBOX_MAX_DISTANCE_METERS} m DoS cap.`,
		)
	}
}

/**
 * The frozen curated turf surface. Keys are exactly the RESEARCH-verified
 * function set — this is what is injected as the boundary's `turf` global.
 */
export const curatedTurf = Object.freeze({
	circle,
	distance,
	buffer,
	area,
	length,
	bearing,
	destination,
	point,
	lineString,
	along,
	nearestPointOnLine,
	booleanPointInPolygon,
	centroid,
})

export type CuratedTurf = typeof curatedTurf
