import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { isToolError } from './errors'
import { advertise, dispatch, type ToolEntry, register, registry, unregister } from './registry'

const TEST_TOOL: ToolEntry = {
	name: 'test_echo_tool',
	kind: 'host-builtin',
	schema: {
		type: 'function',
		function: {
			name: 'test_echo_tool',
			description: 'Echo back the provided value.',
			parameters: { type: 'object', properties: {} },
		},
	},
	handler: (args) => ({ echoed: (args as { value?: unknown }).value }),
}

describe('tool registry', () => {
	beforeEach(() => {
		register(TEST_TOOL)
	})

	afterEach(() => {
		unregister(TEST_TOOL.name)
	})

	it('dispatches a registered handler and returns its result', async () => {
		const result = await dispatch('test_echo_tool', { value: 42 })
		expect(isToolError(result)).toBe(false)
		expect(result).toEqual({ echoed: 42 })
	})

	it('returns a structured unknown_tool ToolError for an unknown name (INFRA-01)', async () => {
		const result = await dispatch('definitely_not_a_tool', {})
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('unknown_tool')
		expect(result.toolName).toBe('definitely_not_a_tool')
		// Not null, not a silent no-op.
		expect(result).not.toBeNull()
	})

	it('wraps a throwing handler into a handler_error ToolError (D-16)', async () => {
		register({
			name: 'test_thrower',
			kind: 'remote-mcp',
			origin: 'server-pubkey-xyz',
			schema: {
				type: 'function',
				function: {
					name: 'test_thrower',
					description: 'Always throws.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				throw new Error('boom')
			},
		})
		const result = await dispatch('test_thrower', {})
		unregister('test_thrower')
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
		expect(result.toolName).toBe('test_thrower')
		expect(result.message).toContain('boom')
		expect(result.origin).toBe('server-pubkey-xyz')
	})

	it('advertise() derives the tool list from live registry state (D-04/D-06)', () => {
		const advertised = advertise()
		const names = advertised.map((tool) => tool.function.name)
		expect(names).toContain('test_echo_tool')

		unregister('test_echo_tool')
		const afterUnregister = advertise().map((tool) => tool.function.name)
		expect(afterUnregister).not.toContain('test_echo_tool')
		register(TEST_TOOL) // restore for afterEach symmetry
	})

	it('every advertised schema resolves to a registered handler (no orphans, INFRA-01)', () => {
		const advertised = advertise()
		for (const tool of advertised) {
			expect(registry.has(tool.function.name)).toBe(true)
		}
	})

	it('advertises the full migrated tool surface (~30 tools)', () => {
		// The production registry self-populates via module side effects on import.
		const advertised = advertise()
		expect(advertised.length).toBeGreaterThanOrEqual(28)
		const names = advertised.map((tool) => tool.function.name)
		// A representative sample across every kind.
		expect(names).toContain('write_geojson_to_editor') // editor write via authoring
		expect(names).toContain('add_feature_to_editor')
		expect(names).toContain('get_editor_state') // host-builtin
		expect(names).toContain('search_location') // remote-mcp
		expect(names).toContain('valhalla_route') // remote-mcp
		expect(names).toContain('route_over_network') // host pathfinding over line networks
		expect(names).toContain('get_reference_boundaries') // source-selecting boundary facade
		expect(names).toContain('editor_set_mode') // editor command (self-registered)
		expect(names).toContain('editor_undo')
	})

	it('every registered entry carries a non-empty kind (D-03)', () => {
		for (const tool of advertise()) {
			const entry = registry.get(tool.function.name)
			expect(entry).toBeDefined()
			expect(entry?.kind).toBeTruthy()
		}
	})
})

describe('set_dataset_metadata host-builtin + get_editor_state datasetMetadata (DATA-*)', () => {
	afterEach(() => {
		useEditorStore.getState().setEditor(null)
		useEditorStore.setState({
			collectionMeta: { name: '', description: '', color: '#1d4ed8', customProperties: {} },
			activeGeoEditDraftId: null,
		})
	})

	it('registers as a host-builtin and is advertised', () => {
		expect(registry.get('set_dataset_metadata')?.kind).toBe('host-builtin')
		expect(advertise().map((t) => t.function.name)).toContain('set_dataset_metadata')
	})

	it('dispatch sets dataset name/description and merges properties into collectionMeta', async () => {
		useEditorStore.getState().setEditor(createHeadlessEditor())
		useEditorStore.setState({
			collectionMeta: { name: '', description: '', color: '#1d4ed8', customProperties: {} },
			activeGeoEditDraftId: null,
		})

		const result = await dispatch('set_dataset_metadata', {
			name: 'Tool Set',
			description: 'desc',
			properties: { source: 'osm', n: 3, bad: { nested: true } },
		})
		expect(isToolError(result)).toBe(false)
		expect((result as { ok: boolean }).ok).toBe(true)

		const meta = useEditorStore.getState().collectionMeta
		expect(meta.name).toBe('Tool Set')
		expect(meta.description).toBe('desc')
		// Only primitive property values are kept; the nested object is dropped.
		expect(meta.customProperties).toEqual({ source: 'osm', n: 3 })
	})

	it('errors (not a silent no-op) when the editor is not ready', async () => {
		useEditorStore.getState().setEditor(null)
		const result = await dispatch('set_dataset_metadata', { name: 'x' })
		expect(isToolError(result)).toBe(true)
	})

	it('get_editor_state surfaces the current datasetMetadata (compact + full)', async () => {
		useEditorStore.getState().setEditor(createHeadlessEditor())
		useEditorStore.setState({
			collectionMeta: {
				name: 'Visible Name',
				description: 'Visible Desc',
				color: '#abcdef',
				customProperties: { k: 'v' },
			},
		})

		const compact = (await dispatch('get_editor_state', {})) as {
			datasetMetadata?: { name: string; description: string }
		}
		expect(compact.datasetMetadata?.name).toBe('Visible Name')
		expect(compact.datasetMetadata?.description).toBe('Visible Desc')

		const full = (await dispatch('get_editor_state', { detail: 'full' })) as {
			datasetMetadata?: { name: string; customProperties: Record<string, unknown> }
		}
		expect(full.datasetMetadata?.name).toBe('Visible Name')
		expect(full.datasetMetadata?.customProperties).toEqual({ k: 'v' })
	})

	it('get_editor_state reports fresh serialized dataset bytes after a geometry mutation', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		const detailedFeatures = [
			{
				type: 'Feature',
				id: 'route',
				geometry: {
					type: 'LineString',
					coordinates: Array.from({ length: 120 }, (_, index) => [index / 1000, 0]),
				},
				properties: { kind: 'road' },
			},
		]
		editor.setFeatures(detailedFeatures)
		useEditorStore.setState({ features: detailedFeatures })

		const before = (await dispatch('get_editor_state', {})) as {
			datasetSize?: { serializedBytes: number; limitBytes: number; overLimit: boolean }
		}
		expect(before.datasetSize?.serializedBytes).toBeGreaterThan(0)

		editor.updateFeature('route', {
			type: 'Feature',
			id: 'route',
			geometry: {
				type: 'LineString',
				coordinates: [
					[0, 0],
					[0.119, 0],
				],
			},
			properties: { kind: 'road' },
		})
		useEditorStore.setState({ features: editor.getAllFeatures() })

		const after = (await dispatch('get_editor_state', {})) as {
			datasetSize?: { serializedBytes: number; limitBytes: number; overLimit: boolean }
		}
		expect(after.datasetSize?.serializedBytes).toBeLessThan(
			before.datasetSize?.serializedBytes ?? 0,
		)
		expect(after.datasetSize?.limitBytes).toBeGreaterThan(0)
		expect(after.datasetSize?.overLimit).toBe(false)
	})
})

describe('authoring-primitive tools: draw_circle + buffer_feature (TOOLS-01 / D-14)', () => {
	afterEach(() => {
		useEditorStore.getState().setEditor(null)
	})

	it('registers both tools with kind:authoring-primitive and advertises them', () => {
		expect(registry.get('draw_circle')?.kind).toBe('authoring-primitive')
		expect(registry.get('buffer_feature')?.kind).toBe('authoring-primitive')
		const names = advertise().map((tool) => tool.function.name)
		expect(names).toContain('draw_circle')
		expect(names).toContain('buffer_feature')
	})

	it('schemas require radius/distance and expose an explicit units enum (D-14, no magic default)', () => {
		const circle = registry.get('draw_circle')?.schema.function
		expect(circle?.parameters.required).toContain('radius')
		expect(circle?.parameters.properties.units?.enum).toEqual(['meters', 'kilometers', 'miles'])

		const buffer = registry.get('buffer_feature')?.schema.function
		expect(buffer?.parameters.required).toContain('distance')
		expect(buffer?.parameters.properties.units?.enum).toEqual(['meters', 'kilometers', 'miles'])
	})

	it('dispatch(draw_circle) reaches authoring and draws a feature (criterion #4)', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)

		const result = await dispatch('draw_circle', {
			center: [13.4, 52.5],
			radius: 500,
			units: 'meters',
		})
		expect(isToolError(result)).toBe(false)
		expect((result as { ok: boolean }).ok).toBe(true)
		expect((result as { featureId: string }).featureId).toBeTruthy()
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(editor.getAllFeatures()[0]?.geometry.type).toBe('Polygon')
	})

	it('dispatch(buffer_feature) buffers an existing feature via authoring (criterion #4)', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)
		const drawn = (await dispatch('draw_circle', {
			center: [13.4, 52.5],
			radius: 300,
			units: 'meters',
		})) as { featureId: string }

		const result = await dispatch('buffer_feature', {
			featureId: drawn.featureId,
			distance: 100,
			units: 'meters',
		})
		expect(isToolError(result)).toBe(false)
		const typed = result as { ok: boolean; sourceFeatureId: string; bufferedFeatureId: string }
		expect(typed.ok).toBe(true)
		expect(typed.sourceFeatureId).toBe(drawn.featureId)
		expect(typed.bufferedFeatureId).toBeTruthy()
		expect(typed.bufferedFeatureId).not.toBe(drawn.featureId)
		expect(editor.getAllFeatures()).toHaveLength(2)
	})

	it('dispatch(buffer_feature) on a missing id → structured ToolError, not a crash (D-16/T-02-16)', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)

		const result = await dispatch('buffer_feature', {
			featureId: 'does-not-exist',
			distance: 100,
			units: 'meters',
		})
		expect(isToolError(result)).toBe(true)
		if (!isToolError(result)) throw new Error('expected ToolError')
		expect(result.kind).toBe('handler_error')
		expect(result.toolName).toBe('buffer_feature')
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	it('dispatch(draw_circle) with a non-finite radius → structured ToolError (D-14/V5)', async () => {
		const editor = createHeadlessEditor()
		useEditorStore.getState().setEditor(editor)

		const result = await dispatch('draw_circle', {
			center: [13.4, 52.5],
			radius: Number.NaN,
			units: 'meters',
		})
		expect(isToolError(result)).toBe(true)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})
})
