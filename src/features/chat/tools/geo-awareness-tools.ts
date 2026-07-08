/**
 * Chat tools — geo-awareness primitives (docs/AI_GEO_AWARENESS.md §2 + §5).
 *
 * `registerGeoAwarenessTools(register)` installs two READ-ONLY tools via the
 * injected-register idiom (type-only import from `./registry` — Pitfall 4):
 *
 *   - `measure` — ONE operation-dispatched measurement tool (length | area |
 *     perimeter | distance | bearing | centroid | bbox | nearest_point) over
 *     featureIds / current selection / raw geometry. The math lives in the
 *     pure authoring-api module `geo-editor/api/measure.ts`.
 *   - `describe_location` — grounds a point or bbox in NAMED anchors (country,
 *     nearest city, on-land/on-water, distance to coast) from the bundled
 *     Natural Earth world layers. Text anchors are the cheapest grounding.
 */

import {
	MEASURE_OPERATIONS,
	type MeasureOperation,
	measureFeatures,
} from '@/features/geo-editor/api/measure'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	describeLocation,
	describeViewport,
	type WorldLayerBundle,
} from '@/lib/geo/describeLocation'
import { loadWorldLayer } from '@/lib/geo/worldData'
import { normalizeGeoJsonToFeatures } from './helpers'
// TYPE-ONLY import from the registry (never the value `register`) — Pitfall 4.
import type { ToolEntry } from './registry'
import { schemaFor } from './schemas'

function requireEditor() {
	const editor = useEditorStore.getState().editor
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}
	return editor
}

function toLonLatPair(value: unknown, label: string): [number, number] | undefined {
	if (value === undefined || value === null) return undefined
	if (
		!Array.isArray(value) ||
		value.length !== 2 ||
		typeof value[0] !== 'number' ||
		typeof value[1] !== 'number' ||
		!Number.isFinite(value[0]) ||
		!Number.isFinite(value[1])
	) {
		throw new Error(`${label} must be a [lon, lat] array of two finite numbers`)
	}
	return [value[0], value[1]]
}

/**
 * Resolve the measurement targets. Priority: raw `geometry` arg > explicit
 * `featureIds` > `selected: true` > every editor feature. Raw geometry needs
 * no editor at all (so `measure` works before the map is ready).
 */
function resolveMeasureTargets(args: Record<string, unknown>): EditorFeature[] {
	if (args.geometry !== undefined && args.geometry !== null) {
		const raw = typeof args.geometry === 'string' ? JSON.parse(args.geometry) : args.geometry
		return normalizeGeoJsonToFeatures(raw).map((feature, index) => ({
			...feature,
			id: String(feature.id ?? `input-${index}`),
			properties: feature.properties ?? {},
		})) as EditorFeature[]
	}
	const editor = requireEditor()
	const all = editor.getAllFeatures()
	if (Array.isArray(args.featureIds) && args.featureIds.length > 0) {
		const wanted = new Set(args.featureIds.map(String))
		const matched = all.filter((feature) => wanted.has(String(feature.id)))
		if (matched.length === 0) {
			throw new Error('None of the given featureIds exist in the editor.')
		}
		return matched
	}
	if (args.selected === true) {
		const selectedIds = new Set(useEditorStore.getState().selectedFeatureIds)
		const selected = all.filter((feature) => selectedIds.has(feature.id))
		if (selected.length === 0) {
			throw new Error('Nothing is selected on the map. Pass featureIds or geometry instead.')
		}
		return selected
	}
	return all
}

/** The world layers `describe_location` grounds against (best-effort load). */
async function loadDescribeBundle(): Promise<WorldLayerBundle> {
	const [land, countries, cities, coastline] = await Promise.allSettled([
		loadWorldLayer('land_50m'),
		loadWorldLayer('countries_110m'),
		loadWorldLayer('cities_110m'),
		loadWorldLayer('coastline_110m'),
	])
	const value = <T>(result: PromiseSettledResult<T>): T | null =>
		result.status === 'fulfilled' ? result.value : null
	return {
		land: value(land),
		countries: value(countries),
		cities: value(cities),
		coastline: value(coastline),
	}
}

export function registerGeoAwarenessTools(register: (entry: ToolEntry) => void): void {
	// --- measure — READ-ONLY measurement primitive -------------------------
	register({
		name: 'measure',
		kind: 'host-builtin',
		schema: schemaFor('measure'),
		handler: (args) => {
			const operation = String(args.operation ?? '') as MeasureOperation
			if (!MEASURE_OPERATIONS.includes(operation)) {
				throw new Error(
					`operation must be one of: ${MEASURE_OPERATIONS.join(', ')} (got "${String(args.operation)}")`,
				)
			}
			const from = toLonLatPair(args.from, 'from')
			const to = toLonLatPair(args.to, 'to')
			// distance/bearing between two explicit points never needs targets
			// (and must not fail when the editor is empty or not ready).
			const pointOnly = (operation === 'distance' || operation === 'bearing') && from && to
			const targets = pointOnly ? [] : resolveMeasureTargets(args)
			return measureFeatures(operation, targets, { from, to })
		},
	})

	// --- describe_location — READ-ONLY textual grounding --------------------
	register({
		name: 'describe_location',
		kind: 'host-builtin',
		schema: schemaFor('describe_location'),
		handler: async (args) => {
			const bundle = await loadDescribeBundle()
			if (!bundle.land && !bundle.countries && !bundle.cities && !bundle.coastline) {
				throw new Error('World reference layers are unavailable (offline?). Try again later.')
			}
			if (Array.isArray(args.bbox) && args.bbox.length === 4) {
				const bbox = args.bbox.map(Number) as [number, number, number, number]
				if (bbox.some((v) => !Number.isFinite(v))) {
					throw new Error('bbox must be [west, south, east, north] finite numbers')
				}
				return describeViewport(bundle, bbox)
			}
			const point = toLonLatPair(args.point, 'point')
			if (!point) {
				throw new Error('Provide either point: [lon, lat] or bbox: [west, south, east, north]')
			}
			return describeLocation(bundle, point)
		},
	})
}
