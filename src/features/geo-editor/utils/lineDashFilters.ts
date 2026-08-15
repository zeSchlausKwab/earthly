import type { FilterSpecification } from 'maplibre-gl'

const PATTERNED_LINE_DASH_VALUES = ['dashed', 'dotted'] as const

export function usesSolidLineLayer(lineDash: unknown): boolean {
	return !PATTERNED_LINE_DASH_VALUES.includes(
		lineDash as (typeof PATTERNED_LINE_DASH_VALUES)[number],
	)
}

/**
 * Only the two named patterned values need dedicated MapLibre layers.
 * Everything else, including legacy/model-authored values such as an empty
 * string or "4,4", must fall back to the solid layer instead of disappearing.
 */
export const SOLID_LINE_DASH_FILTER: FilterSpecification = [
	'all',
	['!=', ['get', 'lineDash'], 'dashed'],
	['!=', ['get', 'lineDash'], 'dotted'],
]
