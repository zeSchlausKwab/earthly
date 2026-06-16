/**
 * Authoring-primitive AI tools (TOOLS-01 / D-14): `draw_circle` + `buffer_feature`.
 *
 * These are the first tools built ON TOP of the Authoring API. Each handler
 * resolves the active editor, constructs the geometry-only `Authoring` facade,
 * and dispatches into `authoring.circle` / `authoring.buffer` — it NEVER touches
 * `editor.*` directly (the A3 boundary). The OpenAI schemas expose an explicit
 * `units` enum (D-14: meters canonical, the model must state the unit) and
 * REQUIRE the radius/distance (no magic default radius).
 *
 * Error contract (D-16): a degenerate buffer, an unknown feature id, a
 * non-finite/negative/zero/absurd radius, or a missing editor all surface as a
 * thrown `Error`, which `registry.dispatch` wraps into a structured
 * `ToolError(handler_error)` fed back to the model loop — never a crash, never a
 * silent no-op.
 */

import { createAuthoring, type PrimitiveUnits } from '@/features/geo-editor/api'
import { useEditorStore } from '@/features/geo-editor/store'
import type { ToolEntry } from './registry'
import type { Tool } from './types'

const UNITS_ENUM: PrimitiveUnits[] = ['meters', 'kilometers', 'miles']

/** Resolve the active editor + Authoring facade, or throw a model-facing error. */
function resolveAuthoring() {
	const { editor } = useEditorStore.getState()
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}
	return createAuthoring(editor)
}

/** Coerce + validate the `units` arg; default meters (D-14). */
function parseUnits(value: unknown): PrimitiveUnits {
	if (typeof value === 'string' && (UNITS_ENUM as string[]).includes(value)) {
		return value as PrimitiveUnits
	}
	return 'meters'
}

const drawCircleSchema: Tool = {
	type: 'function',
	function: {
		name: 'draw_circle',
		description:
			'Draw a parametric circle on the map around a center point with an explicit radius. Always state the units. The radius is required — there is no default. Returns the created feature id.',
		parameters: {
			type: 'object',
			properties: {
				center: {
					type: 'array',
					description: 'Circle center as [longitude, latitude].',
				},
				radius: {
					type: 'number',
					description:
						'Circle radius in the given units. Required, must be a positive finite number.',
				},
				units: {
					type: 'string',
					description: "Distance units for the radius. Default 'meters'.",
					enum: UNITS_ENUM,
				},
			},
			required: ['center', 'radius', 'units'],
		},
	},
}

const bufferFeatureSchema: Tool = {
	type: 'function',
	function: {
		name: 'buffer_feature',
		description:
			'Buffer (expand) an existing editor feature by id (preferred) or a raw GeoJSON geometry, by an explicit distance. Always state the units. The distance is required — there is no default. Returns the source feature id (when buffering by id) and the new buffered feature id.',
		parameters: {
			type: 'object',
			properties: {
				featureId: {
					type: 'string',
					description:
						'Id of an existing editor feature to buffer (preferred). Provide this OR geojson.',
				},
				geojson: {
					type: 'object',
					description:
						'Raw GeoJSON Feature or Geometry to buffer when no editor feature id is available. Provide this OR featureId.',
				},
				distance: {
					type: 'number',
					description:
						'Buffer distance in the given units. Required, must be a positive finite number.',
				},
				units: {
					type: 'string',
					description: "Distance units for the buffer. Default 'meters'.",
					enum: UNITS_ENUM,
				},
			},
			required: ['distance', 'units'],
		},
	},
}

/**
 * Register `draw_circle` + `buffer_feature` (kind:'authoring-primitive').
 *
 * `register` is INJECTED by the caller rather than imported from `./registry`.
 * registry.ts imports this module (for the bootstrap), so importing `register`
 * back here at runtime forms a circular import. Under Bun's dev HMR bundler that
 * cycle leaves the `./registry` module reference null at bootstrap time, crashing
 * with "Cannot read properties of null (reading 'register')". Passing `register`
 * in keeps the edge one-way (registry → primitives-tools) and only a type import
 * remains here (erased at runtime).
 */
export function registerPrimitiveTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'draw_circle',
		kind: 'authoring-primitive',
		schema: drawCircleSchema,
		handler: (args) => {
			const center = args.center
			if (
				!Array.isArray(center) ||
				center.length < 2 ||
				typeof center[0] !== 'number' ||
				typeof center[1] !== 'number'
			) {
				throw new Error('center must be a [longitude, latitude] number pair.')
			}
			const radius = args.radius
			if (typeof radius !== 'number') {
				throw new Error('radius must be a number.')
			}
			const authoring = resolveAuthoring()
			// authoring.circle validates radius (V5) and throws on a bad value, which
			// the registry wraps into a structured ToolError (D-16).
			const result = authoring.circle([center[0], center[1]], radius, {
				units: parseUnits(args.units),
			})
			if (!result.ok) {
				throw new Error('Failed to draw circle (invalid input).')
			}
			return {
				ok: true,
				featureId: result.featureIds[0],
				featureIds: result.featureIds,
				counts: result.counts,
			}
		},
	})

	register({
		name: 'buffer_feature',
		kind: 'authoring-primitive',
		schema: bufferFeatureSchema,
		handler: (args) => {
			const distance = args.distance
			if (typeof distance !== 'number') {
				throw new Error('distance must be a number.')
			}
			const featureId = args.featureId
			const geojson = args.geojson
			const target =
				typeof featureId === 'string' && featureId
					? featureId
					: (geojson as GeoJSON.Feature | GeoJSON.Geometry | undefined)
			if (target === undefined) {
				throw new Error('Provide either a featureId or a geojson geometry to buffer.')
			}
			const authoring = resolveAuthoring()
			// authoring.buffer validates distance (throws on a bad value) and returns
			// { ok:false } for an unknown id (T-02-16) or a degenerate buffer (T-02-15);
			// surface that as a structured tool error (D-16).
			const result = authoring.buffer(target, distance, { units: parseUnits(args.units) })
			if (!result.ok) {
				throw new Error(
					typeof featureId === 'string'
						? `Could not buffer feature '${featureId}' — it does not exist or the buffer is degenerate.`
						: 'Could not buffer the provided geometry — the buffer is degenerate.',
				)
			}
			const sourceId = typeof featureId === 'string' && featureId ? featureId : null
			return {
				ok: true,
				sourceFeatureId: sourceId,
				// When buffering by id, featureIds[0] is the source and the rest are new.
				bufferedFeatureId: sourceId ? result.featureIds[1] : result.featureIds[0],
				featureIds: result.featureIds,
				counts: result.counts,
			}
		},
	})
}
