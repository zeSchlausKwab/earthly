import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { GeoEditor, EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import { useChatStore } from '@/features/chat/store'
import {
	isExternalToolExecutionActive,
	retainChatToolExecution,
} from '@/features/chat/tools/externalExecution'
import { releaseToolExecutionRun } from '@/features/chat/tools/executionTarget'
import { registry } from '@/features/chat/tools/registry'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	resolvePendingDiff,
	subscribePendingDiffs,
	type PendingDiffEntry,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { undoPendingDiff } from '@/features/chat/safeEditing/targetBoundUndo'
import { createBrowserToolService } from './service'
import type { BrowserTool } from './platform'
import { featurePage } from './mapContext'
import { useWebMcpStore } from './state'
import { BROWSER_EDITOR_TOOLS, BROWSER_EXTERNAL_TOOLS } from './catalog'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'

const initialEditor = useEditorStore.getState()
const initialChat = useChatStore.getState()
const initialBridge = useWebMcpStore.getState()
let editor: GeoEditor
let controller: AbortController
let tools: BrowserTool[]
const line: EditorFeature = {
	type: 'Feature',
	id: 'line',
	geometry: {
		type: 'LineString',
		coordinates: [
			[10, 40],
			[11, 41],
			[12, 40],
		],
	},
	properties: { name: 'Flow' },
}

beforeEach(() => {
	editor = createHeadlessEditor()
	editor.setFeatures([line])
	const collectionMeta = createDefaultCollectionMeta()
	useEditorStore.setState({
		editor,
		features: [line],
		collectionMeta,
		selectedFeatureIds: [],
		activeWorkspaceId: 'workspace',
		activeGeoEditDraftId: 'draft',
		pendingHydratedDraftId: null,
		workspaces: {
			workspace: {
				id: 'workspace',
				sourceId: 'scratch:map',
				label: 'Map',
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: 'draft',
				chatSessionId: null,
				createdAt: 1,
				updatedAt: 1,
			},
		},
		geoEditDrafts: {
			draft: {
				persistenceVersion: 2,
				id: 'draft',
				sourceId: 'scratch:map',
				name: '',
				description: '',
				collectionMeta,
				features: [line],
				selectedFeatureIds: [],
				publishChannel: { kind: 'public' },
				contextRefs: [],
				blobReferences: [],
				createdAt: 1,
				updatedAt: 1,
			},
		},
	})
	useChatStore.setState({ isStreaming: false, safetyLevel: 3 })
	setSafetyLevelProvider(() => useChatStore.getState().safetyLevel)
	useWebMcpStore.setState({
		enabled: true,
		externalQueriesEnabled: false,
		panelOpen: false,
		activities: [],
	})
	controller = new AbortController()
	tools = createBrowserToolService(controller.signal)
})

afterEach(() => {
	controller.abort()
	releaseToolExecutionRun()
	clearPendingDiffs()
	editor.destroy()
	useEditorStore.setState(initialEditor, true)
	useChatStore.setState(initialChat, true)
	useWebMcpStore.setState(initialBridge, true)
})

async function call(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
	const tool = tools.find((item) => item.name === name)
	if (!tool) throw new Error(`Missing ${name}`)
	return (await tool.execute(input, { signal })) as Record<string, unknown>
}

function nextReview(): Promise<PendingDiffEntry> {
	return new Promise((resolve) => {
		const unsubscribe = subscribePendingDiffs(() => {
			const diff = getAllPendingDiffs().find((entry) => entry.status === 'pending')
			if (diff) {
				unsubscribe()
				resolve(diff)
			}
		})
	})
}

describe('desktop agent editor bridge', () => {
	test('advertises local geometry, styling and image callouts, with no remote or publishing grants', () => {
		expect(tools).toHaveLength(BROWSER_EDITOR_TOOLS.length + 7)
		expect(tools.some((tool) => tool.name === 'earthly_extrude_line')).toBe(true)
		expect(tools.some((tool) => tool.name === 'earthly_add_feature_callout')).toBe(true)
		expect(tools.some((tool) => /publish|run_code|query_osm|fetch_url/.test(tool.name))).toBe(false)
	})
	test('advertised contracts use native tools and supported document targets', () => {
		const sharedStorySchema = JSON.stringify(registry.get('write_story_draft')?.schema)
		for (const externalQueries of [false, true]) {
			const catalog = createBrowserToolService(controller.signal, () => null, externalQueries)
			for (const tool of catalog) {
				const contract = JSON.stringify({ description: tool.description, schema: tool.inputSchema })
				expect(contract).not.toMatch(
					/\b(get_editor_state|get_working_set|create_map_draft|read_entity|run_code|workingTarget|storyReference)\b/,
				)
				for (const reference of contract.match(/\bearthly_[a-z_]+\b/g) ?? []) {
					if (!catalog.some((candidate) => candidate.name === reference)) {
						expect(BROWSER_EXTERNAL_TOOLS.map((name) => `earthly_${name}`)).toContain(reference)
						expect(tool.description).toContain('External queries')
					}
				}
			}
			const readStory = catalog.find((tool) => tool.name === 'earthly_read_story_draft')
			expect(readStory?.description).toContain('draftTarget')
			expect(readStory?.description).toContain('earthly_list_local_drafts')
			expect(readStory?.description).not.toContain('published Story')
		}
		expect(JSON.stringify(registry.get('write_story_draft')?.schema)).toBe(sharedStorySchema)
	})
	test('camera and framing are reversible view changes and reads keep activity closed', async () => {
		const map = await call('earthly_get_map')
		expect(useWebMcpStore.getState().panelOpen).toBe(false)
		const result = await call('earthly_set_map_view', {
			mapToken: map.mapToken,
			center: [44, 36],
			zoom: 5,
			bearing: 10,
			pitch: 20,
		})
		expect(result.ok).toBe(true)
		expect(result.camera).toMatchObject({ center: [44, 36], zoom: 5, bearing: 10, pitch: 20 })
		expect(result.mapToken).toBe(map.mapToken)
		expect(
			(await call('earthly_set_map_view', { mapToken: map.mapToken, center: [200, 36] })).ok,
		).toBe(false)
		const fitted = await call('earthly_fit_map_view', { mapToken: map.mapToken, scope: 'dataset' })
		expect(fitted.fittedBbox).toEqual([10, 40, 12, 41])
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(getAllPendingDiffs()).toHaveLength(0)
	})
	test('Map details are reviewed before applying and metadata has exact Undo', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const map = await call('earthly_get_map')
		const review = nextReview()
		const pending = call('earthly_set_dataset_metadata', {
			mapToken: map.mapToken,
			name: 'Historical regions',
			description: 'Digitized source',
			properties: { year: 1986 },
		})
		const diff = await review
		expect(diff.metadataChanges?.find((change) => change.field === 'name')?.after).toBe(
			'Historical regions',
		)
		expect(useEditorStore.getState().geoEditDrafts.draft?.name).toBe('')
		resolvePendingDiff(diff.id, 'cancelled')
		expect((await pending).cancelled).toBe(true)
		useChatStore.setState({ safetyLevel: 3 })
		const result = await call('earthly_set_dataset_metadata', {
			mapToken: map.mapToken,
			name: 'Historical regions',
		})
		expect(result.ok).toBe(true)
		expect(result.mapToken).not.toBe(map.mapToken)
		expect(useEditorStore.getState().geoEditDrafts.draft?.name).toBe('Historical regions')
		const applied = getAllPendingDiffs().find((entry) => entry.status === 'applied')
		if (!applied) throw new Error('Missing metadata Undo')
		expect(undoPendingDiff(applied.id)).toBe('undone')
		expect(useEditorStore.getState().geoEditDrafts.draft?.name).toBe('')
	})
	test('network routing imports through review while external queries are off', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const map = await call('earthly_get_map')
		const review = nextReview()
		const pending = call('earthly_route_over_network', {
			mapToken: map.mapToken,
			network: 'editor_lines',
			from: [10, 40],
			to: [12, 40],
			toEditor: true,
		})
		const diff = await review
		expect(editor.getAllFeatures()).toHaveLength(1)
		resolvePendingDiff(diff.id, 'applied')
		const result = await pending
		expect(result.cancelled).toBe(false)
		expect(editor.getAllFeatures()).toHaveLength(2)
		expect(undoPendingDiff(diff.id)).toBe('undone')
		expect(editor.getAllFeatures()).toHaveLength(1)
	})
	test('circles and buffers honor the preview gate', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const map = await call('earthly_get_map')
		for (const [name, args] of [
			['draw_circle', { center: [11, 40], radius: 500, units: 'meters' }],
			['buffer_feature', { featureId: 'line', distance: 500, units: 'meters' }],
		] as const) {
			const review = nextReview()
			const pending = call(`earthly_${name}`, { ...args, mapToken: map.mapToken })
			const diff = await review
			expect(editor.getAllFeatures()).toHaveLength(1)
			resolvePendingDiff(diff.id, 'cancelled')
			expect((await pending).cancelled).toBe(true)
			expect(editor.getAllFeatures()).toHaveLength(1)
		}
	})
	test('external grant controls discovery, direct calls and admin-boundary requests', async () => {
		const map = await call('earthly_get_map')
		expect(
			(
				await call('earthly_get_reference_boundaries', {
					mapToken: map.mapToken,
					level: 'admin1',
					names: ['Erbil'],
				})
			).code,
		).toBe('external_queries_disabled')
		useWebMcpStore.setState({ externalQueriesEnabled: true })
		tools = createBrowserToolService(controller.signal)
		expect(tools).toHaveLength(BROWSER_EDITOR_TOOLS.length + BROWSER_EXTERNAL_TOOLS.length + 7)
		expect(tools.some((tool) => tool.name === 'earthly_valhalla_route')).toBe(true)
		const next = await call('earthly_get_map')
		useWebMcpStore.setState({ externalQueriesEnabled: false })
		expect(
			(await call('earthly_search_location', { mapToken: next.mapToken, query: 'Erbil' })).code,
		).toBe('external_queries_disabled')
	})
	test('remote geometry is reviewed, can be cancelled, and revocation blocks its commit', async () => {
		const original = registry.get('valhalla_route')
		if (!original) throw new Error('Missing routing tool')
		try {
			registry.set('valhalla_route', {
				...original,
				handler: () => ({ feature: { ...line, id: 'remote-route' } }),
			})
			useWebMcpStore.setState({ externalQueriesEnabled: true })
			tools = createBrowserToolService(controller.signal)
			useChatStore.setState({ safetyLevel: 1 })
			const map = await call('earthly_get_map')
			const review = nextReview()
			const pending = call('earthly_valhalla_route', {
				mapToken: map.mapToken,
				locations: [
					{ lat: 40, lon: 10 },
					{ lat: 40, lon: 12 },
				],
				toEditor: true,
			})
			const diff = await review
			expect(editor.getAllFeatures()).toHaveLength(1)
			useWebMcpStore.setState({ externalQueriesEnabled: false })
			resolvePendingDiff(diff.id, 'applied')
			expect((await pending).code).toBe('external_queries_disabled')
			expect(editor.getAllFeatures()).toHaveLength(1)
		} finally {
			registry.set('valhalla_route', original)
		}
	})
	test('host redirects cannot invoke tools outside the curated grant', async () => {
		const original = registry.get('find_features')
		if (!original) throw new Error('Missing search tool')
		try {
			for (const redirectTool of ['run_code', 'write_story_draft']) {
				registry.set('find_features', {
					...original,
					handler: () => ({
						ok: false,
						kind: 'tool_redirect',
						toolName: 'find_features',
						message: 'test',
						redirectTool,
						redirectArguments: { code: 'throw new Error()' },
					}),
				})
				tools = createBrowserToolService(controller.signal)
				const map = await call('earthly_get_map')
				expect(
					(await call('earthly_find_features', { mapToken: map.mapToken, predicate: { all: [] } }))
						.code,
				).toBe('tool_not_granted')
			}
		} finally {
			registry.set('find_features', original)
		}
	})
	test('returns full GeoJSON and refuses missing, invalid, or stale arguments before writes', async () => {
		const map = await call('earthly_get_map')
		const page = await call('earthly_read_features', { mapToken: map.mapToken, limit: 1 })
		expect((page.geojson as GeoJSON.FeatureCollection).features[0]?.geometry).toEqual(line.geometry)
		expect(page.nextOffset).toBeNull()
		expect((await call('earthly_extrude_line', { featureId: 'line', width: 100 })).code).toBe(
			'invalid_arguments',
		)
		expect((await call('earthly_read_features', { mapToken: map.mapToken, limit: 0 })).code).toBe(
			'invalid_arguments',
		)
		expect(
			(await call('earthly_extrude_line', { mapToken: 'wrong', featureId: 'line', width: 100 }))
				.code,
		).toBe('stale_map')
		expect(editor.getAllFeatures()).toHaveLength(1)
	})
	test('timestamp-only autosaves retain the token; selection invalidates it', async () => {
		const before = await call('earthly_get_map')
		useEditorStore.getState().saveGeoEditDraft('draft', {})
		expect((await call('earthly_get_map')).mapToken).toBe(before.mapToken)
		useEditorStore.getState().setSelectedFeatureIds(['line'])
		expect((await call('earthly_get_map')).mapToken).not.toBe(before.mapToken)
	})
	test('commits extrusion through shared execution and attaches an exact Undo', async () => {
		const map = await call('earthly_get_map')
		const result = await call('earthly_extrude_line', {
			mapToken: map.mapToken,
			featureId: 'line',
			shape: 'arrow',
			width: 500,
			units: 'meters',
		})
		expect(result.ok).not.toBe(false)
		expect(result.mapToken).not.toBe(map.mapToken)
		expect(useEditorStore.getState().geoEditDrafts.draft?.features).toHaveLength(2)
		const diff = getAllPendingDiffs()[0]
		expect(diff?.commit).toBeDefined()
		if (!diff) throw new Error('Expected a desktop agent edit preview')
		expect(undoPendingDiff(diff.id)).toBe('undone')
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(isExternalToolExecutionActive()).toBe(false)
	})
	test('preview holds writes; agent cancellation settles the gate and releases execution', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const map = await call('earthly_get_map')
		const review = nextReview()
		const abort = new AbortController()
		const pending = call(
			'earthly_extrude_line',
			{ mapToken: map.mapToken, featureId: 'line', width: 500 },
			abort.signal,
		)
		const diff = await review
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(isExternalToolExecutionActive()).toBe(true)
		useChatStore.getState().cancelStream()
		useChatStore.getState().reset()
		expect(getAllPendingDiffs().find((item) => item.id === diff.id)?.status).toBe('pending')
		expect((await call('earthly_get_map')).code).toBe('editor_busy')
		abort.abort()
		expect((await pending).code).toBe('cancelled')
		expect(getAllPendingDiffs().find((item) => item.id === diff.id)?.status).toBe('cancelled')
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(isExternalToolExecutionActive()).toBe(false)
		expect((await call('earthly_get_map')).ok).toBe(true)
	})
	test('refuses a map changed while approval was pending without overwriting the user', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const map = await call('earthly_get_map')
		const review = nextReview()
		const pending = call('earthly_extrude_line', {
			mapToken: map.mapToken,
			featureId: 'line',
			width: 500,
		})
		const diff = await review
		useEditorStore.getState().setSelectedFeatureIds(['line'])
		resolvePendingDiff(diff.id, 'applied')
		expect((await pending).sideEffectsApplied).toBe(false)
		expect(editor.getAllFeatures()).toHaveLength(1)
		expect(useEditorStore.getState().selectedFeatureIds).toEqual(['line'])
		expect(getAllPendingDiffs()[0]?.status).toBe('failed')
	})
	test('revoking access before approval prevents persistence and streaming chat blocks calls', async () => {
		useChatStore.setState({ isStreaming: true })
		expect((await call('earthly_get_map')).code).toBe('editor_busy')
		useChatStore.setState({ isStreaming: false, safetyLevel: 1 })
		const map = await call('earthly_get_map')
		const review = nextReview()
		const pending = call('earthly_extrude_line', {
			mapToken: map.mapToken,
			featureId: 'line',
			width: 500,
		})
		const diff = await review
		useWebMcpStore.setState({ enabled: false })
		resolvePendingDiff(diff.id, 'applied')
		expect((await pending).ok).toBe(false)
		expect(editor.getAllFeatures()).toHaveLength(1)
	})
	test('feature pages preserve image URLs and stop on count and byte budgets', () => {
		const media = {
			...line,
			properties: {
				callout: { media: [{ url: 'https://example.test/photo.png', type: 'image' }] },
			},
		}
		expect(featurePage([media, { ...line, id: 'second' }], { limit: 1 }).nextOffset).toBe(1)
		expect(featurePage([media], {}).geojson.features[0]?.properties).toEqual(media.properties)
		const large = { ...line, properties: { text: 'x'.repeat(300_000) } }
		expect(featurePage([large, large], {}).geojson.features).toHaveLength(1)
		expect(() => featurePage([{ ...line, properties: { text: 'x'.repeat(600_000) } }], {})).toThrow(
			'512 KiB',
		)
	})
	test('a cancelled chat still unwinding blocks browser calls until its lease is released', async () => {
		const release = retainChatToolExecution()
		try {
			expect((await call('earthly_get_map')).code).toBe('editor_busy')
		} finally {
			release()
		}
		expect((await call('earthly_get_map')).ok).toBe(true)
	})
	test('an account change invalidates the session grant before any map data is read', async () => {
		let owner = 'first'
		tools = createBrowserToolService(controller.signal, () => owner)
		owner = 'second'
		expect((await call('earthly_get_map')).code).toBe('account_changed')
		expect(useWebMcpStore.getState().activities).toHaveLength(0)
	})
	test('live registry replacement cannot turn a granted local tool into a remote call', async () => {
		const map = await call('earthly_get_map')
		const original = registry.get('extrude_line')
		if (!original) throw new Error('Missing extrusion tool')
		let invoked = false
		try {
			registry.set('extrude_line', {
				...original,
				kind: 'remote-mcp',
				handler: () => {
					invoked = true
					return {}
				},
			})
			expect(
				(
					await call('earthly_extrude_line', {
						mapToken: map.mapToken,
						featureId: 'line',
						width: 100,
					})
				).code,
			).toBe('tool_changed')
			expect(invoked).toBe(false)
			expect(() => createBrowserToolService(controller.signal)).toThrow(
				'Expected a local editor tool',
			)
		} finally {
			registry.set('extrude_line', original)
		}
	})
})
