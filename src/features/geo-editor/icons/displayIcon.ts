/**
 * Canonical `displayIcon` style property (Phase 1: bundled Lucide icons).
 *
 * A Point feature may carry `properties.displayIcon` — a NAMESPACED icon id —
 * alongside the other canonical style keys (`color`, `radius`, …). Phase 1
 * accepts only ids from the bundled Lucide subset, in the form `lucide:<name>`
 * (e.g. `lucide:anchor`). The namespace prefix keeps the value forward-compatible:
 * Phase 2 can introduce a second namespace for remote `https://…` icon URLs
 * without changing the property shape.
 *
 * Rendering contract (see `core/managers/LayerManager.ts` + `hooks/useMapLayers.ts`):
 * iconed points render as an SVG-derived symbol INSTEAD of the plain circle,
 * and unknown/missing icons fall back to a visible marker image — a point with
 * a bad `displayIcon` must never vanish from the map.
 */

import type { DataDrivenPropertyValueSpecification, ExpressionSpecification } from 'maplibre-gl'
import { LUCIDE_ICONS, type LucideIconName } from './lucideIcons'

/** Feature property key carrying the icon id. */
export const DISPLAY_ICON_PROPERTY = 'displayIcon'

/** Phase-1 icon namespace (bundled Lucide subset). */
export const LUCIDE_NAMESPACE = 'lucide'

/** `lucide:anchor` → full style-image id (identical — icons register under their full id). */
export function lucideIconId(name: LucideIconName): string {
	return `${LUCIDE_NAMESPACE}:${name}`
}

/**
 * Style-image id of the always-registered fallback marker. Registered
 * synchronously on every map (see `registerDisplayIconImages.ts`) so the
 * `coalesce` in {@link displayIconImageExpression} can never come up empty.
 */
export const FALLBACK_ICON_IMAGE_ID = 'earthly:icon-fallback'

/** All bundled icon ids in `lucide:<name>` form, picker/registration order. */
export const BUNDLED_DISPLAY_ICON_IDS: string[] = Object.keys(LUCIDE_ICONS).map((name) =>
	lucideIconId(name as LucideIconName),
)

const BUNDLED_DISPLAY_ICON_ID_SET = new Set(BUNDLED_DISPLAY_ICON_IDS)

/**
 * Parse a `displayIcon` value into namespace + name. Returns null for anything
 * that is not a well-formed `<namespace>:<name>` string.
 */
export function parseDisplayIcon(value: unknown): { namespace: string; name: string } | null {
	if (typeof value !== 'string') return null
	const separator = value.indexOf(':')
	if (separator <= 0 || separator === value.length - 1) return null
	return { namespace: value.slice(0, separator), name: value.slice(separator + 1) }
}

/** True when the value is a bundled `lucide:<name>` id (Phase 1 valid set). */
export function isBundledDisplayIcon(value: unknown): value is string {
	return typeof value === 'string' && BUNDLED_DISPLAY_ICON_ID_SET.has(value)
}

/** Raw SVG markup for a bundled `lucide:<name>` id, or null when not bundled. */
export function getDisplayIconSvg(id: string): string | null {
	const parsed = parseDisplayIcon(id)
	if (!parsed || parsed.namespace !== LUCIDE_NAMESPACE) return null
	return (LUCIDE_ICONS as Record<string, string>)[parsed.name] ?? null
}

/**
 * Validate a `displayIcon` value, throwing a plain Error with a helpful,
 * self-correcting message. Callers (e.g. `api/styleOptions.ts`) wrap the
 * message in their own error type.
 */
export function validateDisplayIconValue(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(
			`Style option '${DISPLAY_ICON_PROPERTY}' must be a non-empty string icon id like 'lucide:anchor' (got ${String(value)}).`,
		)
	}
	const parsed = parseDisplayIcon(value)
	if (!parsed || parsed.namespace !== LUCIDE_NAMESPACE) {
		throw new Error(
			`Style option '${DISPLAY_ICON_PROPERTY}' must use the '${LUCIDE_NAMESPACE}:<name>' namespace, e.g. 'lucide:anchor' (got '${value}'). Remote icon URLs are not supported yet.`,
		)
	}
	if (!isBundledDisplayIcon(value)) {
		throw new Error(
			`Unknown icon '${value}'. Accepted icons: ${BUNDLED_DISPLAY_ICON_IDS.join(', ')}.`,
		)
	}
	return value
}

// ============================================================================
// MapLibre expression / filter builders (pure — shared by the editor's
// LayerManager and the view-mode layers in useMapLayers)
// ============================================================================

/** Filter clause: the feature carries a displayIcon. */
export function hasDisplayIconFilter(): ExpressionSpecification {
	return ['has', DISPLAY_ICON_PROPERTY]
}

/**
 * `icon-image` expression with the documented MapLibre fallback pattern:
 * resolve the feature's icon id if the image is registered, else the
 * always-registered fallback marker. Combined with the missing-image handler
 * this guarantees an iconed point is never invisible.
 */
export function displayIconImageExpression(): DataDrivenPropertyValueSpecification<string> {
	return [
		'coalesce',
		['image', ['get', DISPLAY_ICON_PROPERTY]],
		['image', FALLBACK_ICON_IMAGE_ID],
	] as unknown as DataDrivenPropertyValueSpecification<string>
}

/**
 * `icon-size` expression scaled off the point's `radius` style property so an
 * icon reads at roughly the footprint of the circle it replaces (radius 6 →
 * icon-size 0.75 ≈ 18px for the 24px Lucide glyphs). `activeBoost` grows the
 * icon when the editor marks the feature active, mirroring the circle layer's
 * selected-state radius bump.
 */
export function displayIconSizeExpression(options?: {
	activeBoost?: boolean
}): DataDrivenPropertyValueSpecification<number> {
	const base: ExpressionSpecification = ['*', ['coalesce', ['get', 'radius'], 6], 0.125]
	if (!options?.activeBoost) {
		return base as unknown as DataDrivenPropertyValueSpecification<number>
	}
	return [
		'case',
		['==', ['get', 'active'], true],
		['*', base, 1.25],
		base,
	] as unknown as DataDrivenPropertyValueSpecification<number>
}

/**
 * Opacity expression for the circle layers: hide the plain circle when the
 * point renders as an icon. The circle stays in the layer (opacity 0) so the
 * editor's `queryRenderedFeatures` hit-testing and existing interaction
 * bindings keep working unchanged.
 */
export function circleOpacityHidingIconedPoints(): DataDrivenPropertyValueSpecification<number> {
	return [
		'case',
		hasDisplayIconFilter(),
		0,
		1,
	] as unknown as DataDrivenPropertyValueSpecification<number>
}
