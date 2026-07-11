/**
 * Per-feature style + metadata options for parametric primitives (UAT gap-closure).
 *
 * `authoring.circle` / `authoring.buffer` build a turf geometry with EMPTY
 * properties by default. Before this module, any `fill`/`stroke`/`color`/`name`
 * the caller (the AI, via `run_code`) passed was SILENTLY DROPPED — the model
 * drew 15 circles and could not color them, with no error to self-correct from.
 *
 * This module is the single normalize-and-validate seam that maps a forgiving,
 * model-reached-for option set onto the EXACT property keys the editor's renderer
 * honors (see `core/managers/LayerManager.ts`):
 *   - polygon fill:   `fillColor` | `color`            → fill-color
 *   - polygon/line:   `strokeColor` | `color`          → line-color
 *   - point:          `color`                          → circle-color
 *   - polygon fill:   `fillOpacity`                    → fill-opacity   (0..1)
 *   - line:           `strokeOpacity`                  → line-opacity   (0..1)
 *   - line/point:     `strokeWidth`                    → line/circle stroke width
 *   - point:          `radius`                         → circle-radius
 *   - point icon:     `displayIcon` (`lucide:<name>`)  → icon-image
 *   - feature label:  `label`                          → text-field
 *   - metadata:       `name` / `description`           → preserved (not rendered)
 *
 * Forgiving aliases the model is likely to reach for are normalized to the
 * canonical keys: `fill`→`fillColor`, `stroke`→`strokeColor`, `width`→
 * `strokeWidth`, `opacity`→`fillOpacity`. UNKNOWN options are REJECTED with a
 * clear, catchable error listing the accepted names so the model self-corrects
 * through the existing ToolError/retry loop instead of producing unstyled output.
 *
 * V5-style value validation (mirrors `primitives.ts`): colors must be strings,
 * opacities must be finite numbers in [0,1], widths/radii must be finite > 0.
 * Garbage is rejected, never injected into `properties`.
 */

import { validateDisplayIconValue } from '../icons/displayIcon'

/** Thrown when a style/metadata option is unknown or has an invalid value. */
export class InvalidStyleOptionError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InvalidStyleOptionError'
	}
}

/**
 * Canonical per-feature style + metadata keys the renderer honors. The accepted
 * option set is these keys PLUS the forgiving aliases below.
 */
export const CANONICAL_STYLE_KEYS = [
	'color',
	'fillColor',
	'strokeColor',
	'fillOpacity',
	'strokeOpacity',
	'strokeWidth',
	'radius',
	'label',
	'displayIcon',
	'name',
	'description',
] as const

/** Forgiving aliases → canonical key (model-reached-for CSS-ish names). */
const STYLE_ALIASES: Record<string, (typeof CANONICAL_STYLE_KEYS)[number]> = {
	fill: 'fillColor',
	stroke: 'strokeColor',
	width: 'strokeWidth',
	opacity: 'fillOpacity',
}

/** Canonical keys whose value must be a non-empty string color. */
const COLOR_KEYS = new Set(['color', 'fillColor', 'strokeColor'])
/** Canonical keys whose value must be a finite number in [0,1]. */
const OPACITY_KEYS = new Set(['fillOpacity', 'strokeOpacity'])
/** Canonical keys whose value must be a finite number > 0. */
const POSITIVE_NUMBER_KEYS = new Set(['strokeWidth', 'radius'])
/** Canonical keys whose value must be a string (metadata / label). */
const STRING_KEYS = new Set(['label', 'name', 'description'])

/**
 * Style + metadata options accepted by `makeCircle` / `makeBuffer` (alongside
 * `units` / `steps`). All optional; aliases are accepted at runtime too.
 */
export interface FeatureStyleOptions {
	/** Single color applied to fill (polygon) / stroke (line) / point as relevant. */
	color?: string
	/** Polygon fill color (overrides `color` for fill). Alias: `fill`. */
	fillColor?: string
	/** Line / point stroke color (overrides `color` for stroke). Alias: `stroke`. */
	strokeColor?: string
	/** Polygon fill opacity, 0..1. Alias: `opacity`. */
	fillOpacity?: number
	/** Line stroke opacity, 0..1. */
	strokeOpacity?: number
	/** Line / point stroke width, > 0. Alias: `width`. */
	strokeWidth?: number
	/** Point radius (px), > 0. */
	radius?: number
	/** Feature label text rendered on the map. */
	label?: string
	/**
	 * Point icon id, `lucide:<name>` from the bundled Lucide subset (e.g.
	 * `lucide:anchor`). Renders the point as an icon instead of a circle.
	 */
	displayIcon?: string
	/** Metadata: feature name (not rendered). */
	name?: string
	/** Metadata: feature description (not rendered). */
	description?: string
}

/** Aliases accepted at runtime in addition to the canonical keys. */
const ALIAS_OPTION_KEYS = Object.keys(STYLE_ALIASES)

const ACCEPTED_OPTION_NAMES = [...CANONICAL_STYLE_KEYS, ...ALIAS_OPTION_KEYS]

/**
 * Option keys that belong to the primitive itself (NOT style) — they are
 * consumed by `makeCircle`/`makeBuffer` and must not be treated as unknown.
 */
const RESERVED_PRIMITIVE_KEYS = new Set(['units', 'steps'])

function validateValue(canonicalKey: string, value: unknown): string | number {
	if (canonicalKey === 'displayIcon') {
		// Namespaced icon id — must be a bundled `lucide:<name>` (Phase 1). The
		// dedicated validator's message names the format, flags that remote
		// URLs are not supported yet, and lists the accepted ids.
		try {
			return validateDisplayIconValue(value)
		} catch (error) {
			throw new InvalidStyleOptionError(error instanceof Error ? error.message : String(error))
		}
	}
	if (COLOR_KEYS.has(canonicalKey) || STRING_KEYS.has(canonicalKey)) {
		if (typeof value !== 'string' || value.length === 0) {
			throw new InvalidStyleOptionError(
				`Style option '${canonicalKey}' must be a non-empty string (got ${String(value)}).`,
			)
		}
		return value
	}
	if (OPACITY_KEYS.has(canonicalKey)) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
			throw new InvalidStyleOptionError(
				`Style option '${canonicalKey}' must be a number in [0,1] (got ${String(value)}).`,
			)
		}
		return value
	}
	if (POSITIVE_NUMBER_KEYS.has(canonicalKey)) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
			throw new InvalidStyleOptionError(
				`Style option '${canonicalKey}' must be a finite number greater than 0 (got ${String(value)}).`,
			)
		}
		return value
	}
	// Should be unreachable: every canonical key is in exactly one validator set.
	throw new InvalidStyleOptionError(`Unsupported style option '${canonicalKey}'.`)
}

/**
 * Normalize + validate a forgiving style/metadata option bag into the editor's
 * canonical renderer property keys.
 *
 * - `units` / `steps` are ignored here (consumed by the primitive).
 * - Aliases (`fill`/`stroke`/`width`/`opacity`) are mapped to canonical keys.
 * - `undefined` values are skipped (so spreading partial option objects is safe).
 * - Any other key throws {@link InvalidStyleOptionError} listing accepted names,
 *   so the model self-corrects instead of silently producing unstyled geometry.
 * - Each accepted value is V5-validated; garbage throws rather than being injected.
 *
 * Returns a plain `properties` patch (possibly empty) ready to merge onto the
 * created feature BEFORE it flows through `addFeature` → `runInterceptors`.
 */
export function normalizeStyleOptions(
	options: Record<string, unknown> = {},
): Record<string, string | number> {
	const out: Record<string, string | number> = {}

	for (const [rawKey, value] of Object.entries(options)) {
		if (RESERVED_PRIMITIVE_KEYS.has(rawKey)) continue
		if (value === undefined) continue

		const canonicalKey = STYLE_ALIASES[rawKey] ?? rawKey
		if (!(CANONICAL_STYLE_KEYS as readonly string[]).includes(canonicalKey)) {
			throw new InvalidStyleOptionError(
				`Unknown option '${rawKey}'. Accepted options: ${ACCEPTED_OPTION_NAMES.join(', ')}, units, steps.`,
			)
		}

		// Later canonical key wins if both an alias and the canonical key are
		// supplied (e.g. `fill` then `fillColor`) — last writer in iteration order.
		out[canonicalKey] = validateValue(canonicalKey, value)
	}

	return out
}
