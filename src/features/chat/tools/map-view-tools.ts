import {
	BASEMAP_STYLE_OPTIONS,
	getBasemapStyle,
	setBasemapStyle,
	type BasemapStyleId,
} from '@/lib/basemap'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	getExecutionFeatures,
	getExecutionSelectedFeatureIds,
	isToolExecutionTargetRendered,
} from './executionTarget'
import { getFeatureCollectionBbox } from './helpers'
import type { ToolEntry } from './registry'
import type { ToolExecutionContext, ToolJsonSchema } from './types'

function visibleEditor(context?: ToolExecutionContext) {
	const editor = useEditorStore.getState().editor
	if (!editor || (context?.run && !isToolExecutionTargetRendered(context.run, editor)))
		throw new Error('Open the exact Map bound to this request before changing its view.')
	context?.signal?.throwIfAborted()
	context?.assertBeforeCommit?.()
	return editor
}

export function getMapPresentation() {
	return {
		camera: useEditorStore.getState().editor?.getMapCamera() ?? null,
		basemap: {
			style: getBasemapStyle(),
			availableStyles: BASEMAP_STYLE_OPTIONS,
			source: useEditorStore.getState().mapSource,
		},
	}
}

export function registerMapViewTools(register: (entry: ToolEntry) => void): void {
	const add = (
		name: string,
		description: string,
		properties: Record<string, ToolJsonSchema>,
		handler: ToolEntry['handler'],
		required?: string[],
	) =>
		register({
			name,
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: { name, description, parameters: { type: 'object', properties, required } },
			},
			handler,
		})
	add(
		'set_map_view',
		'Set the visible map camera immediately. Coordinates are [longitude, latitude]. Does not change Map geometry or metadata. Read get_editor_state to inspect the current view.',
		{
			center: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
			zoom: { type: 'number', minimum: 0, maximum: 22 },
			bearing: { type: 'number', minimum: -180, maximum: 180 },
			pitch: { type: 'number', minimum: 0, maximum: 60 },
		},
		(args, context) => {
			const editor = visibleEditor(context)
			const center = args.center as [number, number] | undefined
			if (
				center &&
				(center.length !== 2 ||
					!center.every(Number.isFinite) ||
					Math.abs(center[0]) > 180 ||
					Math.abs(center[1]) > 85.051129)
			)
				throw new Error('center must be [longitude, latitude] within the Web Mercator map extent.')
			const camera: { center?: [number, number]; zoom?: number; bearing?: number; pitch?: number } =
				{}
			if (center) camera.center = center
			for (const [key, min, max] of [
				['zoom', 0, 22],
				['bearing', -180, 180],
				['pitch', 0, 60],
			] as const) {
				if (args[key] === undefined) continue
				const value = args[key]
				if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
					throw new Error(`Invalid ${key}.`)
				camera[key] = value
			}
			if (!Object.keys(camera).length) throw new Error('Provide center, zoom, bearing or pitch.')
			editor.setMapCamera(camera)
			return { ok: true, ...getMapPresentation() }
		},
	)
	add(
		'fit_map_view',
		'Frame all dataset features, the selection, specific feature IDs or explicit bounds. Camera changes do not modify the draft. Dateline bounds may use west > east.',
		{
			scope: { type: 'string', enum: ['dataset', 'selection', 'features', 'bounds'] },
			featureIds: { type: 'array', items: { type: 'string' } },
			bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
			padding: { type: 'number', minimum: 0, maximum: 256 },
			maxZoom: { type: 'number', minimum: 0, maximum: 22 },
		},
		(args, context) => {
			const editor = visibleEditor(context)
			const scope = args.scope ?? 'dataset'
			let bbox: [number, number, number, number] | null
			if (scope === 'bounds') bbox = args.bbox as typeof bbox
			else {
				if (!['dataset', 'selection', 'features'].includes(String(scope)))
					throw new Error('Invalid fit scope.')
				const ids = scope === 'selection' ? getExecutionSelectedFeatureIds() : args.featureIds
				if (scope === 'features' && (!Array.isArray(ids) || !ids.length))
					throw new Error('Provide featureIds for scope=features.')
				const idSet = Array.isArray(ids) ? new Set(ids) : null
				const features = getExecutionFeatures().filter(
					(feature) => scope === 'dataset' || idSet?.has(feature.id),
				)
				bbox = getFeatureCollectionBbox(features)
			}
			if (
				bbox?.length !== 4 ||
				!bbox.every(Number.isFinite) ||
				Math.abs(bbox[0]) > 180 ||
				Math.abs(bbox[2]) > 180 ||
				Math.abs(bbox[1]) > 90 ||
				Math.abs(bbox[3]) > 90 ||
				bbox[1] > bbox[3]
			)
				throw new Error(
					'No usable bounds. Supply [west, south, east, north] or a nonempty feature set.',
				)
			const padding = typeof args.padding === 'number' ? args.padding : 48
			const maxZoom = typeof args.maxZoom === 'number' ? args.maxZoom : 15
			if (
				!Number.isFinite(padding) ||
				padding < 0 ||
				padding > 256 ||
				!Number.isFinite(maxZoom) ||
				maxZoom < 0 ||
				maxZoom > 22
			)
				throw new Error('Invalid fit padding or maxZoom.')
			editor.fitMapBounds(bbox, padding, maxZoom)
			return { ok: true, fittedBbox: bbox, ...getMapPresentation() }
		},
	)
	add(
		'set_basemap_style',
		'Choose an existing Earthly basemap style. Auto follows the theme. Applies to the default basemap only; saves the same preference as Map settings. Does not modify draft geometry.',
		{
			style: { type: 'string', enum: BASEMAP_STYLE_OPTIONS.map((option) => option.id) },
		},
		(args, context) => {
			visibleEditor(context)
			if (useEditorStore.getState().mapSource.type !== 'default')
				throw new Error('Basemap styles apply only to the default map source.')
			if (!BASEMAP_STYLE_OPTIONS.some((option) => option.id === args.style))
				throw new Error('Choose a supported basemap style.')
			setBasemapStyle(args.style as BasemapStyleId)
			return { ok: true, ...getMapPresentation() }
		},
		['style'],
	)
}
