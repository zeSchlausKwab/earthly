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
 * iconed points render as a tintable SDF glyph ON TOP of the circle layer —
 * the circle becomes a backing disc (`color` fill) with a ring
 * (`strokeColor`), and the glyph is tinted black/white for automatic contrast
 * against the disc. Unknown/missing icons fall back to a
 * visible marker image — a point with a bad `displayIcon` must never vanish
 * from the map.
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

/**
 * Logical px of the glyph box inside registered displayIcon images. The
 * raster geometry in `registerDisplayIconImages.ts` derives from this, and
 * {@link displayIconSizeExpression} converts "desired glyph px" into an
 * `icon-size` factor with it. Keep the three in sync.
 */
export const DISPLAY_ICON_GLYPH_LOGICAL_PX = 48

/** Rendered glyph size ≈ point `radius` × this (px per radius unit). */
const DISPLAY_ICON_GLYPH_PER_RADIUS = 2.4

/**
 * Backing-disc radius = point `radius` × this. Sized so the glyph
 * (2.4 × radius px, Lucide content inset ~1/12 per side) sits comfortably
 * inside the disc with the `strokeColor` ring visible around it.
 */
const DISPLAY_ICON_DISC_RADIUS_FACTOR = 1.75

/** Selected-state boost shared by the glyph and its backing disc. */
const DISPLAY_ICON_ACTIVE_BOOST = 1.25

const DISPLAY_ICON_LIGHT_GLYPH_COLOR = '#ffffff'
const DISPLAY_ICON_DARK_GLYPH_COLOR = '#111827'
const DISPLAY_ICON_DEFAULT_DISC_COLOR = '#3bb2d0'
const DISPLAY_ICON_BRIGHTNESS_THRESHOLD = 160

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
 * `icon-size` expression scaled off the point's `radius` style property so the
 * glyph tracks the disc it sits on (radius 6 → 2.4 × 6 = 14.4px glyph inside a
 * 10.5px-radius disc). `activeBoost` grows the glyph when the editor marks the
 * feature active, mirroring the disc's selected-state boost in
 * {@link displayIconDiscRadiusExpression}.
 */
export function displayIconSizeExpression(options?: {
	activeBoost?: boolean
}): DataDrivenPropertyValueSpecification<number> {
	const factor = DISPLAY_ICON_GLYPH_PER_RADIUS / DISPLAY_ICON_GLYPH_LOGICAL_PX
	const base: ExpressionSpecification = ['*', ['coalesce', ['get', 'radius'], 6], factor]
	if (!options?.activeBoost) {
		return base as unknown as DataDrivenPropertyValueSpecification<number>
	}
	return [
		'case',
		['==', ['get', 'active'], true],
		['*', base, DISPLAY_ICON_ACTIVE_BOOST],
		base,
	] as unknown as DataDrivenPropertyValueSpecification<number>
}

/**
 * Pick the same black/white icon contrast used by the MapLibre expression for
 * static renderers. CSS colors outside the common #rgb/#rrggbb forms safely
 * fall back to white; MapLibre itself handles its complete color vocabulary.
 */
export function contrastingDisplayIconColor(value: unknown): string {
	if (typeof value !== 'string') return DISPLAY_ICON_LIGHT_GLYPH_COLOR
	const hex = value.trim()
	const expanded = /^#[0-9a-f]{3}$/iu.test(hex)
		? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
		: hex
	if (!/^#[0-9a-f]{6}$/iu.test(expanded)) return DISPLAY_ICON_LIGHT_GLYPH_COLOR
	const red = Number.parseInt(expanded.slice(1, 3), 16)
	const green = Number.parseInt(expanded.slice(3, 5), 16)
	const blue = Number.parseInt(expanded.slice(5, 7), 16)
	const brightness = red * 0.299 + green * 0.587 + blue * 0.114
	return brightness > DISPLAY_ICON_BRIGHTNESS_THRESHOLD
		? DISPLAY_ICON_DARK_GLYPH_COLOR
		: DISPLAY_ICON_LIGHT_GLYPH_COLOR
}

/**
 * `icon-color` paint expression for the SDF glyph (and fallback dot): derive
 * black/white from the actual `color`-filled backing disc. Ring styling remains
 * independent, so `color === strokeColor` can no longer erase the glyph.
 * `activeColor`, when given,
 * overrides the tint while the editor marks the feature active (the disc turns
 * selection-blue, so the glyph flips to a fixed high-contrast color).
 */
export function displayIconColorExpression(options?: {
	activeColor?: string
}): DataDrivenPropertyValueSpecification<string> {
	const rgba: ExpressionSpecification = [
		'to-rgba',
		['to-color', ['coalesce', ['get', 'color'], DISPLAY_ICON_DEFAULT_DISC_COLOR]],
	]
	const component = (index: number): ExpressionSpecification => ['at', index, ['var', 'icon_bg']]
	const brightness: ExpressionSpecification = [
		'+',
		['*', component(0), 0.299],
		['*', component(1), 0.587],
		['*', component(2), 0.114],
	]
	const base: ExpressionSpecification = [
		'let',
		'icon_bg',
		rgba,
		[
			'case',
			['>', brightness, DISPLAY_ICON_BRIGHTNESS_THRESHOLD],
			DISPLAY_ICON_DARK_GLYPH_COLOR,
			DISPLAY_ICON_LIGHT_GLYPH_COLOR,
		],
	]
	if (!options?.activeColor) {
		return base as unknown as DataDrivenPropertyValueSpecification<string>
	}
	return [
		'case',
		['==', ['get', 'active'], true],
		options.activeColor,
		base,
	] as unknown as DataDrivenPropertyValueSpecification<string>
}

/** Point-geometry test shared by the label-placement builders. */
const IS_POINT_GEOMETRY: ExpressionSpecification = [
	'any',
	['==', ['geometry-type'], 'Point'],
	['==', ['geometry-type'], 'MultiPoint'],
]

/**
 * `text-anchor` for feature-label layers: point features hang their label BELOW
 * the marker ('top' anchor = text below the anchor point) so the glyph/circle
 * stays readable; line/polygon labels keep the centered placement.
 */
export function pointLabelAnchorExpression(): DataDrivenPropertyValueSpecification<string> {
	return [
		'case',
		IS_POINT_GEOMETRY,
		'top',
		'center',
	] as unknown as DataDrivenPropertyValueSpecification<string>
}

/**
 * `text-radial-offset` (ems) clearing the marker under a below-anchored label:
 * iconed points clear their backing disc (radius × disc factor), plain points
 * their circle, both plus stroke + breathing room. Zero for non-points, whose
 * labels stay centered.
 */
export function pointLabelRadialOffsetExpression(
	textSizePx = 12,
): DataDrivenPropertyValueSpecification<number> {
	const radius: ExpressionSpecification = ['coalesce', ['get', 'radius'], 6]
	const clearancePx = 4 // default stroke width (2) + gap
	return [
		'case',
		['all', IS_POINT_GEOMETRY, hasDisplayIconFilter()],
		['/', ['+', ['*', radius, DISPLAY_ICON_DISC_RADIUS_FACTOR], clearancePx], textSizePx],
		IS_POINT_GEOMETRY,
		['/', ['+', radius, clearancePx], textSizePx],
		0,
	] as unknown as DataDrivenPropertyValueSpecification<number>
}

/**
 * `circle-radius` branch for ICONED points: the circle layer doubles as the
 * icon's backing disc (`circle-color` = feature fill, `circle-stroke-color` =
 * ring), so it renders larger than the point's plain-circle footprint to fit
 * the glyph plus a visible ring. `activeBoost` mirrors the glyph's
 * selected-state boost so the disc/glyph proportions stay constant.
 */
export function displayIconDiscRadiusExpression(options?: {
	activeBoost?: boolean
}): DataDrivenPropertyValueSpecification<number> {
	const base: ExpressionSpecification = [
		'*',
		['coalesce', ['get', 'radius'], 6],
		DISPLAY_ICON_DISC_RADIUS_FACTOR,
	]
	if (!options?.activeBoost) {
		return base as unknown as DataDrivenPropertyValueSpecification<number>
	}
	return [
		'case',
		['==', ['get', 'active'], true],
		['*', base, DISPLAY_ICON_ACTIVE_BOOST],
		base,
	] as unknown as DataDrivenPropertyValueSpecification<number>
}
