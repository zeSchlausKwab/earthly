/**
 * Parametric geometry primitives (TOOLS-01 / D-13/D-14/D-15).
 *
 * Pure turf wrappers — `makeCircle` and `makeBuffer` — that the Authoring API
 * (`authoring.circle` / `authoring.buffer`) draws and returns structured
 * `MutationResult`s for. They live in the standalone-lib `api/` layer (D-07
 * boundary: nothing from chat / the tool registry / Nostr), so the primitives
 * are shippable + sandbox-confinable independent of the AI tool layer.
 *
 * Binding decisions:
 * - **D-14 meters canonical:** distance/radius is numeric + a `units` param,
 *   default `'meters'` (turf's own default is `'kilometers'` — we override). NO
 *   magic default radius: the caller MUST supply a finite, positive value.
 * - **V5 / T-02-14 (DoS):** radius/distance is validated (finite, > 0) and
 *   bounded by a sane upper cap BEFORE turf runs, so an unbounded / NaN /
 *   Infinity value can't make turf generate huge geometry and freeze the main
 *   thread. Rejection throws `InvalidPrimitiveArgError` — never silent geometry.
 * - **T-02-15 (degenerate buffer):** turf `buffer` returns `undefined` for
 *   degenerate / empty input; `makeBuffer` returns it un-coerced so the
 *   Authoring API can null-check → `{ ok:false }` and the tool surfaces a
 *   structured `ToolError` (D-16), never a crash.
 */

import { buffer as turfBuffer, circle as turfCircle } from '@turf/turf'
import type { Feature, Geometry, Polygon } from 'geojson'
import { type FeatureStyleOptions, normalizeStyleOptions } from './styleOptions'

/** Distance units exposed to callers + the AI tool schema (D-14). */
export type PrimitiveUnits = 'meters' | 'kilometers' | 'miles'

/** Meters is canonical (D-14). */
export const DEFAULT_UNITS: PrimitiveUnits = 'meters'

/**
 * Upper bound on circle/buffer distance, expressed in meters (V5 / T-02-14).
 *
 * 40,075,000 m is the Earth's equatorial circumference — any radius beyond that
 * is geometrically meaningless and only serves to make turf burn CPU generating
 * a degenerate ring. We reject at-or-above it. `kilometers`/`miles` inputs are
 * normalized to meters before the comparison so the cap is unit-independent.
 */
export const MAX_DISTANCE_METERS = 40_075_000

const METERS_PER_UNIT: Record<PrimitiveUnits, number> = {
	meters: 1,
	kilometers: 1000,
	miles: 1609.344,
}

/** Thrown when a radius/distance fails finite/positive/bounded validation (V5). */
export class InvalidPrimitiveArgError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InvalidPrimitiveArgError'
	}
}

/**
 * Validate a radius/distance against D-14 (no magic default) + V5 (DoS bound).
 *
 * Rejects NaN / Infinity / negative / zero and any value whose meter-equivalent
 * is at or above {@link MAX_DISTANCE_METERS}. Returns the original numeric value
 * on success (callers pass it straight to turf in the requested units).
 */
function validateDistance(value: number, units: PrimitiveUnits, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new InvalidPrimitiveArgError(`${label} must be a finite number (got ${String(value)}).`)
	}
	if (value <= 0) {
		throw new InvalidPrimitiveArgError(`${label} must be greater than 0 (got ${value}).`)
	}
	const meters = value * METERS_PER_UNIT[units]
	if (meters >= MAX_DISTANCE_METERS) {
		throw new InvalidPrimitiveArgError(
			`${label} is too large: ${value} ${units} (~${Math.round(meters)} m) exceeds the ${MAX_DISTANCE_METERS} m cap.`,
		)
	}
	return value
}

/**
 * Options accepted by {@link makeCircle}: the primitive params (`units`/`steps`)
 * plus the per-feature style + metadata set (UAT gap-closure). Style options are
 * normalized to the editor's canonical renderer property keys and attached to the
 * resulting feature's `properties`; unknown options throw
 * {@link InvalidStyleOptionError}.
 */
export interface MakeCircleOptions extends FeatureStyleOptions {
	units?: PrimitiveUnits
	/** turf step count (ring resolution); defaults to turf's own default (64). */
	steps?: number
}

/**
 * Build a circle Polygon around `center` with the given `radius` (D-13/D-14).
 *
 * `center` is `[lon, lat]`. `radius` is validated (finite, > 0, bounded) before
 * turf runs — there is NO default radius (D-14). The resulting ring has
 * `steps + 1` coordinates (turf closes the ring). Any style/metadata options
 * (`color`/`fillColor`/`strokeColor`/…) are normalized to the editor's canonical
 * property keys and merged onto the feature's `properties` so it renders styled.
 * Throws {@link InvalidPrimitiveArgError} on an invalid radius, or
 * {@link InvalidStyleOptionError} on an unknown / invalid style option.
 */
export function makeCircle(
	center: [number, number],
	radius: number,
	options: MakeCircleOptions = {},
): Feature<Polygon> {
	const units = options.units ?? DEFAULT_UNITS
	const validRadius = validateDistance(radius, units, 'radius')
	// Normalize/validate style BEFORE turf runs so a bad style option fails fast
	// (and consistently) rather than after geometry is generated.
	const styleProps = normalizeStyleOptions(options)
	const steps = options.steps
	const feature = turfCircle(center, validRadius, {
		units,
		...(typeof steps === 'number' && Number.isFinite(steps) && steps > 0
			? { steps: Math.floor(steps) }
			: {}),
	})
	feature.properties = { ...(feature.properties ?? {}), ...styleProps }
	return feature
}

/**
 * Options accepted by {@link makeBuffer}: the primitive `units` plus the
 * per-feature style + metadata set (UAT gap-closure). Style options are
 * normalized to the editor's canonical renderer property keys and attached to the
 * buffered feature's `properties`; unknown options throw
 * {@link InvalidStyleOptionError}.
 */
export interface MakeBufferOptions extends FeatureStyleOptions {
	units?: PrimitiveUnits
}

/**
 * Buffer a geometry/feature by `distance` (D-15 raw-geometry path).
 *
 * `distance` is validated (finite, > 0, bounded) before turf runs. Returns the
 * buffered `Feature`, OR `undefined` when turf cannot produce geometry for the
 * input (degenerate / empty) — the value is NOT coerced (T-02-15); the caller
 * (`authoring.buffer`) null-checks it into a `{ ok:false }` MutationResult. Any
 * style/metadata options are normalized and merged onto the buffered feature's
 * `properties`. Throws {@link InvalidPrimitiveArgError} on an invalid distance,
 * or {@link InvalidStyleOptionError} on an unknown / invalid style option.
 */
export function makeBuffer(
	geom: Feature | Geometry,
	distance: number,
	options: MakeBufferOptions = {},
): Feature | undefined {
	const units = options.units ?? DEFAULT_UNITS
	const validDistance = validateDistance(distance, units, 'distance')
	// Normalize/validate style BEFORE turf runs so a bad style option fails fast.
	const styleProps = normalizeStyleOptions(options)
	// turf `buffer` accepts a Feature or a bare Geometry; wrap a bare Geometry in
	// a Feature so the single-feature overload is selected and the result is a
	// Feature (not a FeatureCollection).
	const input: Feature =
		(geom as Feature).type === 'Feature'
			? (geom as Feature)
			: { type: 'Feature', geometry: geom as Geometry, properties: {} }
	const buffered = turfBuffer(input, validDistance, { units })
	// turf returns `undefined` OR a Feature with a null geometry for degenerate
	// input (e.g. an empty GeometryCollection). Both are "no usable buffer" — treat
	// them identically so the caller's null-check yields a structured no-op
	// (T-02-15) instead of forwarding a geometry-less Feature into addFeature.
	if (!buffered || buffered.geometry == null) return undefined
	buffered.properties = { ...(buffered.properties ?? {}), ...styleProps }
	return buffered
}
