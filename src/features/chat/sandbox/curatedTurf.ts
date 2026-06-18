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
 * redefined here. The boundary range-checks generated geometry against this
 * before invoking turf so an absurd radius can't burn CPU.
 *
 * Kept as a SEPARATE export (not a key on `curatedTurf`) so the injected `turf`
 * global stays exactly the curated FUNCTIONS — a guard value doesn't belong on
 * the callable surface.
 */
export const SANDBOX_MAX_DISTANCE_METERS = MAX_DISTANCE_METERS

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
