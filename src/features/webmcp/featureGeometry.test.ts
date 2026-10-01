import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import type { GeoEditor, EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import { useChatStore } from '@/features/chat/store'
import {
	releaseToolExecutionRun,
	projectDurableFeatures,
} from '@/features/chat/tools/executionTarget'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	resolvePendingDiff,
	subscribePendingDiffs,
	type PendingDiffEntry,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { undoPendingDiff } from '@/features/chat/safeEditing/targetBoundUndo'
import { createBrowserToolService } from './service'
import { useWebMcpStore } from './state'
import type { BrowserTool } from './platform'

const originalEditor = useEditorStore.getState()
const originalChat = useChatStore.getState()
const originalBridge = useWebMcpStore.getState()
let editor: GeoEditor
let controller: AbortController
let tools: BrowserTool[]
const replacement: GeoJSON.LineString = {
	type: 'LineString',
	coordinates: [
		[40, -20],
		[50, -10],
	],
}
const intercontinental: GeoJSON.LineString = {
	type: 'LineString',
	coordinates: [
		[56.55, 26.5],
		[57.1, 25.5],
		[59, 24],
		[60.4, 22.7],
		[60, 18],
		[58, 12],
		[55, 5],
		[49, -4],
		[44, -13],
		[40, -21],
		[36, -28],
		[29, -35],
		[20, -37],
		[13, -35],
		[5, -28],
		[-2, -17],
		[-7, -3],
		[-13, 14],
		[-16, 29],
		[-12, 41],
		[-7, 47],
		[-3, 50],
	],
}

beforeEach(() => {
	editor = createHeadlessEditor()
	editor.setFeatures([
		{
			type: 'Feature',
			id: 'route',
			geometry: intercontinental,
			properties: {
				name: 'Flow',
				strokeColor: '#33aabb',
				importSource: 'original-authoring',
				sourceUrl: 'https://example.com/source',
				customProperties: { source: 'Keep this source' },
				'earthly:callouts': [
					{
						id: 'route-photo',
						text: 'Image caption',
						media: [{ url: 'https://example.com/photo.jpg' }],
					},
				],
			},
		},
		...Array.from(
			{ length: 42 },
			(_, index): EditorFeature => ({
				type: 'Feature',
				id: `original-${index}`,
				geometry: { type: 'Point', coordinates: [index, 0] },
				properties: { name: `Original ${index}`, customProperties: { ordinal: index } },
			}),
		),
	] as EditorFeature[])
	const features = structuredClone(durableFeatures())
	const collectionMeta = createDefaultCollectionMeta()
	useEditorStore.setState({
		editor,
		features,
		collectionMeta,
		selectedFeatureIds: [],
		activeWorkspaceId: 'geometry-workspace',
		activeGeoEditDraftId: 'geometry-draft',
		pendingHydratedDraftId: null,
		workspaces: {
			'geometry-workspace': {
				id: 'geometry-workspace',
				sourceId: 'scratch:geometry',
				label: 'Geometry Map',
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: 'geometry-draft',
				chatSessionId: null,
				createdAt: 1,
				updatedAt: 1,
			},
		},
		geoEditDrafts: {
			'geometry-draft': {
				persistenceVersion: 2,
				id: 'geometry-draft',
				sourceId: 'scratch:geometry',
				name: '',
				description: '',
				collectionMeta,
				features,
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
	clearPendingDiffs()
	controller = new AbortController()
	tools = createBrowserToolService(controller.signal, () => null)
})
afterEach(() => {
	controller.abort()
	releaseToolExecutionRun()
	clearPendingDiffs()
	editor.destroy()
	useEditorStore.setState(originalEditor, true)
	useChatStore.setState(originalChat, true)
	useWebMcpStore.setState(originalBridge, true)
	setSafetyLevelProvider(() => useChatStore.getState().safetyLevel)
})

function durableFeatures() {
	return projectDurableFeatures(editor.getAllFeatures())
}

async function call(name: string, args: Record<string, unknown> = {}) {
	const tool = tools.find((candidate) => candidate.name === name)
	if (!tool) throw new Error(`Missing native tool ${name}`)
	return (await tool.execute(args)) as Record<string, unknown>
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

describe('native feature-scoped geometry edits', () => {
	test('requires current mapToken and persists one feature without altering properties or the other 42', async () => {
		const map = await call('earthly_get_map')
		const before = structuredClone(durableFeatures())
		expect(
			(await call('earthly_update_feature_geometry', { featureId: 'route', geometry: replacement }))
				.code,
		).toBe('invalid_arguments')
		expect(
			(
				await call('earthly_update_feature_geometry', {
					mapToken: 'stale',
					featureId: 'route',
					geometry: replacement,
				})
			).code,
		).toBe('stale_map')
		expect(
			(
				await call('earthly_update_feature_geometry', {
					mapToken: map.mapToken,
					featureId: 'route',
					geometry: replacement,
					properties: { name: 'Overwrite' },
				})
			).code,
		).toBe('invalid_arguments')
		expect(durableFeatures()).toEqual(before)
		const result = await call('earthly_update_feature_geometry', {
			mapToken: map.mapToken,
			featureId: 'route',
			geometry: replacement,
		})
		expect(result).toMatchObject({ cancelled: false, featureId: 'route', counts: { updated: 1 } })
		expect(result.mapToken).not.toBe(map.mapToken)
		expect(durableFeatures()).toHaveLength(43)
		expect(durableFeatures().find((feature) => feature.id === 'route')?.properties).toEqual(
			before[0]?.properties,
		)
		expect(editor.getFeature('route')?.geometry).toEqual(replacement)
		expect(durableFeatures().slice(1)).toEqual(before.slice(1))
		expect(
			projectDurableFeatures(
				useEditorStore.getState().geoEditDrafts['geometry-draft']?.features ?? [],
			),
		).toEqual(durableFeatures())
		const diff = getAllPendingDiffs()[0]!
		expect(diff.commit).toBeDefined()
		expect(undoPendingDiff(diff.id)).toBe('undone')
		expect(durableFeatures()).toEqual(before)
		expect(
			projectDurableFeatures(
				useEditorStore.getState().geoEditDrafts['geometry-draft']?.features ?? [],
			),
		).toEqual(before)
	})

	test('rejects incomplete replacement geometry before persistence', async () => {
		const map = await call('earthly_get_map')
		const before = structuredClone(durableFeatures())
		for (const geometry of [
			{ type: 'Point', coordinates: [200, 0] },
			{ type: 'LineString', coordinates: [[0, 0]] },
			{
				type: 'Polygon',
				coordinates: [
					[
						[0, 0],
						[1, 0],
						[0, 1],
						[1, 1],
					],
				],
			},
		]) {
			expect(
				await call('earthly_update_feature_geometry', {
					mapToken: map.mapToken,
					featureId: 'route',
					geometry,
				}),
			).toMatchObject({ ok: false, sideEffectsApplied: false })
			expect(durableFeatures()).toEqual(before)
			expect(
				projectDurableFeatures(
					useEditorStore.getState().geoEditDrafts['geometry-draft']?.features ?? [],
				),
			).toEqual(before)
		}
	})

	test('holds the edit for review and preserves a Map that changes before approval', async () => {
		useChatStore.setState({ safetyLevel: 1 })
		const before = structuredClone(durableFeatures())
		const map = await call('earthly_get_map')
		const review = nextReview()
		const pending = call('earthly_update_feature_geometry', {
			mapToken: map.mapToken,
			featureId: 'route',
			geometry: replacement,
		})
		const diff = await review
		expect(durableFeatures()).toEqual(before)
		useEditorStore.getState().setSelectedFeatureIds(['route'])
		resolvePendingDiff(diff.id, 'applied')
		expect(await pending).toMatchObject({ ok: false, sideEffectsApplied: false })
		expect(editor.getFeature('route')?.geometry).toEqual(before[0]?.geometry)
		expect(durableFeatures().slice(1)).toEqual(before.slice(1))
		expect(useEditorStore.getState().selectedFeatureIds).toEqual(['route'])
	})

	test('native extrusion creates a valid long-path arrow through the same undoable authoring surface', async () => {
		const before = structuredClone(durableFeatures())
		const map = await call('earthly_get_map')
		const result = await call('earthly_extrude_line', {
			mapToken: map.mapToken,
			featureId: 'route',
			shape: 'arrow',
			width: 75,
			units: 'kilometers',
			arrowHeadWidth: 123.75,
			arrowHeadLength: 150,
		})
		expect(result.ok).not.toBe(false)
		expect(result.cancelled).toBe(false)
		expect(result.resultFeatureIds).toHaveLength(1)
		const arrow = editor.getFeature((result.resultFeatureIds as string[])[0]!)!
		expect(arrow.geometry.type).toBe('Polygon')
		expect(arrow.properties?.['earthly:callouts']).toEqual(
			before[0]?.properties?.['earthly:callouts'],
		)
		expect(result.validation).toMatchObject({ topology: { status: 'ok' } })
		expect(durableFeatures().slice(0, 43)).toEqual(before)
		expect(undoPendingDiff(getAllPendingDiffs()[0]!.id)).toBe('undone')
		expect(durableFeatures()).toEqual(before)
	})
})
