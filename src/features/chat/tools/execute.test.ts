import { afterEach, describe, expect, it } from 'bun:test'
import { registerDatasetDraftEnsurer } from '@/features/geo-editor/authoringTaskBridge'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { executeToolCall } from './execute'
import { prepareMapToolFeaturesForEditor } from './helpers'
import { type ToolEntry, register, registry, unregister } from './registry'

const routeResult = {
	feature: {
		type: 'Feature' as const,
		id: 'tour-route',
		properties: { name: 'One-day tour' },
		geometry: {
			type: 'LineString' as const,
			coordinates: [
				[2.35, 48.85],
				[2.29, 48.86],
			],
		},
	},
}

describe('tool-result geometry authoring lifecycle', () => {
	const productionRouteEntry = registry.get('valhalla_route')
	const productionIsochroneEntry = registry.get('valhalla_isochrone')
	let unregisterEnsurer: (() => void) | null = null

	afterEach(() => {
		unregisterEnsurer?.()
		unregisterEnsurer = null
		useEditorStore.getState().setEditor(null)
		if (productionRouteEntry) register(productionRouteEntry)
		if (productionIsochroneEntry) register(productionIsochroneEntry)
	})

	it('establishes a recoverable authoring target before a toEditor tool result mutates geometry', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		let authoringTargetReady = false
		unregisterEnsurer = registerDatasetDraftEnsurer(() => {
			authoringTargetReady = true
		})

		const fixtureEntry: ToolEntry = {
			name: 'valhalla_route',
			kind: 'remote-mcp',
			schema: productionRouteEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_route',
					description: 'Return fixture route geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => routeResult,
		}
		register(fixtureEntry)

		const result = await executeToolCall({
			id: 'route-call',
			type: 'function',
			function: {
				name: 'valhalla_route',
				arguments: JSON.stringify({ toEditor: true }),
			},
		})

		expect(authoringTargetReady).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(JSON.parse(result.content).editorImport.importedCount).toBe(1)
	})

	it('imports isochrones as quiet cool-blue background overlays', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		unregisterEnsurer = registerDatasetDraftEnsurer(() => {})

		const fixtureEntry: ToolEntry = {
			name: 'valhalla_isochrone',
			kind: 'remote-mcp',
			schema: productionIsochroneEntry?.schema ?? {
				type: 'function',
				function: {
					name: 'valhalla_isochrone',
					description: 'Return fixture isochrone geometry.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => ({
				feature: {
					type: 'Feature',
					id: 'cycle-catchment',
					properties: { name: '20-minute bicycle catchment', fillColor: '#facc15' },
					geometry: {
						type: 'Polygon',
						coordinates: [
							[
								[-8.7, 41.1],
								[-8.5, 41.1],
								[-8.5, 41.2],
								[-8.7, 41.1],
							],
						],
					},
				},
			}),
		}
		register(fixtureEntry)

		await executeToolCall({
			id: 'isochrone-call',
			type: 'function',
			function: {
				name: 'valhalla_isochrone',
				arguments: JSON.stringify({ toEditor: true }),
			},
		})

		expect(editor.getAllFeatures()[0]?.properties).toMatchObject({
			fillColor: '#38bdf8',
			fillOpacity: 0.1,
			strokeColor: '#0284c7',
			strokeOpacity: 0.6,
			strokeWidth: 2,
		})
	})
})

describe('OSM point import styling', () => {
	it('assigns semantic icons and distinct fallback colors to common POI categories', () => {
		const features = prepareMapToolFeaturesForEditor('query_osm_nearby', [
			{
				type: 'Feature',
				properties: { leisure: 'park' },
				geometry: { type: 'Point', coordinates: [-8.64, 41.16] },
			},
			{
				type: 'Feature',
				properties: { tags: { shop: 'supermarket' } },
				geometry: { type: 'Point', coordinates: [-8.63, 41.16] },
			},
			{
				type: 'Feature',
				properties: { railway: 'station' },
				geometry: { type: 'Point', coordinates: [-8.62, 41.16] },
			},
		])

		expect(features.map((feature) => feature.properties?.displayIcon)).toEqual([
			'lucide:trees',
			'lucide:store',
			'lucide:train-front',
		])
		expect(new Set(features.map((feature) => feature.properties?.color)).size).toBe(3)
	})

	it('preserves an explicit icon and color supplied by the model', () => {
		const [feature] = prepareMapToolFeaturesForEditor('query_osm_bbox', [
			{
				type: 'Feature',
				properties: {
					shop: 'supermarket',
					displayIcon: 'lucide:star',
					color: '#be123c',
				},
				geometry: { type: 'Point', coordinates: [-8.63, 41.16] },
			},
		])

		expect(feature?.properties).toMatchObject({
			displayIcon: 'lucide:star',
			color: '#be123c',
		})
	})
})

describe('tool redirect execution', () => {
	it('follows one structured redirect without spending another model round', async () => {
		register({
			name: 'test_redirect_source',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'test_redirect_source',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => ({
				ok: false,
				kind: 'tool_redirect',
				toolName: 'test_redirect_source',
				message: 'Use structured reader',
				redirectTool: 'test_redirect_target',
				redirectArguments: { title: 'Rome' },
			}),
		})
		register({
			name: 'test_redirect_target',
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: 'test_redirect_target',
					description: 'fixture',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: (args) => ({ ok: true, title: args.title }),
		})
		try {
			const result = await executeToolCall({
				id: 'redirect-call',
				type: 'function',
				function: { name: 'test_redirect_source', arguments: '{}' },
			})
			expect(JSON.parse(result.content)).toEqual({ ok: true, title: 'Rome' })
		} finally {
			unregister('test_redirect_source')
			unregister('test_redirect_target')
		}
	})
})
