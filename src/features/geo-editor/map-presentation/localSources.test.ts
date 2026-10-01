import { describe, expect, test } from 'bun:test'
import {
	deriveStoryPresentationAuthorization,
	mapPresentationSourceKey,
	parseMapPresentation,
	resolvePresentationLayers,
} from '@/lib/map-presentation'
import { localMapReference } from '@/lib/nostr/story/localReferences'
import { useEditorStore, type GeoCollectionEditDraft, type GeoEditorWorkspace } from '../store'
import { createDefaultCollectionMeta } from '../utils'
import { localMapPresentationLabel, resolveLocalPresentationSources } from './localSources'
import { materializePresentationLayer } from './materialize'
import { readPresentationFeatureProvenance } from './ids'

const SOURCE = { kind: 'local-map' as const, workspaceId: 'work' }
const KEY = mapPresentationSourceKey(SOURCE)
const PRESENTATION = parseMapPresentation({
	version: 1,
	initialView: { center: [44, 36], zoom: 6 },
	layers: [
		{
			id: 'regions',
			source: SOURCE,
			featureIds: ['region', 'missing'],
			style: { fillColor: '#ff0000' },
		},
	],
})
const AUTHORIZATION = deriveStoryPresentationAuthorization(localMapReference('work'), {
	allowLocalDraftReferences: true,
})
const FEATURES: GeoCollectionEditDraft['features'] = [
	{
		type: 'Feature',
		id: 'region',
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[43, 35],
					[44, 35],
					[44, 36],
					[43, 35],
				],
			],
		},
		properties: { name: 'Region', fillColor: '#123456' },
	},
]
const DRAFT: GeoCollectionEditDraft = {
	persistenceVersion: 2,
	id: 'draft',
	sourceId: 'scratch:work',
	name: 'Overview',
	description: '',
	collectionMeta: { ...createDefaultCollectionMeta(), name: 'Overview' },
	features: FEATURES,
	selectedFeatureIds: [],
	publishChannel: { kind: 'public' },
	contextRefs: [],
	blobReferences: [],
	createdAt: 1,
	updatedAt: 2,
}
const WORKSPACE: GeoEditorWorkspace = {
	id: 'work',
	sourceId: DRAFT.sourceId,
	label: 'Overview',
	kind: 'scratch',
	datasetKey: null,
	activeDraftId: 'draft',
	chatSessionId: null,
	createdAt: 1,
	updatedAt: 2,
}
function options() {
	return {
		presentation: PRESENTATION,
		authorization: AUTHORIZATION,
		activeAccount: 'owner',
		hydratedAccount: 'owner',
		state: {
			...useEditorStore.getState(),
			workspaces: { work: WORKSPACE },
			geoEditDrafts: { draft: DRAFT },
			viewMode: 'view' as const,
			activeWorkspaceId: null,
			activeGeoEditDraftId: null,
			pendingHydratedDraftId: null,
		},
	}
}

describe('account-scoped local Map presentation resolution', () => {
	test('shows retained Map names before placeholder workspace labels', () => {
		const { state } = options()
		state.workspaces.work = { ...WORKSPACE, label: 'Untitled workspace' }
		expect(localMapPresentationLabel(state, 'work')).toBe('Overview')
		state.geoEditDrafts.draft = { ...DRAFT, name: ' ' }
		expect(localMapPresentationLabel(state, 'work')).toBe('Untitled workspace')
		expect(localMapPresentationLabel(state, 'missing')).toBe('Local Map')
	})
	test('resolves stable ids, selectors and styling without inventing a signed source event', () => {
		const input = options()
		const original = structuredClone(DRAFT)
		const sources = resolveLocalPresentationSources(input)
		const runtime = resolvePresentationLayers(PRESENTATION, AUTHORIZATION, sources)
		const layer = runtime.layers[0]!
		expect(layer.status).toBe('partial-missing')
		expect(layer.featureCollection.features.map((feature) => feature.id)).toEqual(['region'])
		expect(layer.missingFeatureIds).toEqual(['missing'])
		expect(layer.sourceEvent).toBeUndefined()
		const rendered = materializePresentationLayer({ carrierId: 'story:draft', ...layer })
		expect(rendered.featureCollection.features[0]?.properties?.fillColor).toBe('#ff0000')
		expect(
			readPresentationFeatureProvenance(rendered.featureCollection.features[0]?.properties)?.source,
		).toBe(KEY)
		expect(DRAFT).toEqual(original)
	})

	test('missing workspaces, stale draft bindings and account changes never substitute another Map', () => {
		const input = options()
		for (const denied of [
			{ ...input, activeAccount: 'another' },
			{ ...input, state: { ...input.state, workspaces: {} } },
			{ ...input, state: { ...input.state, geoEditDrafts: {} } },
			{
				...input,
				state: {
					...input.state,
					geoEditDrafts: { draft: { ...DRAFT, sourceId: 'another-source' } },
				},
			},
		])
			expect(resolveLocalPresentationSources(denied).get(KEY)?.status).toBe('missing-source')
	})

	test('unauthorized local sources are not read and public prose cannot grant access', () => {
		const input = options()
		const authorization = deriveStoryPresentationAuthorization(localMapReference('work'))
		expect(resolveLocalPresentationSources({ ...input, authorization }).size).toBe(0)
		expect(
			resolvePresentationLayers(PRESENTATION, authorization, new Map()).layers[0]?.status,
		).toBe('unauthorized-source')
	})

	test('uses exact live active draft edits and waits while that draft hydrates', () => {
		const input = options()
		const state = {
			...input.state,
			viewMode: 'edit' as const,
			activeWorkspaceId: 'work',
			activeGeoEditDraftId: 'draft',
			features: [{ ...FEATURES[0]!, properties: { name: 'Live edit' } }],
			collectionMeta: DRAFT.collectionMeta,
		}
		const live = resolveLocalPresentationSources({ ...input, state }).get(KEY)
		if (live?.status !== 'resolved') throw new Error('Expected live source')
		expect(live.featureCollection.features[0]?.properties?.name).toBe('Live edit')
		expect(
			resolveLocalPresentationSources({
				...input,
				state: { ...state, pendingHydratedDraftId: 'draft' },
			}).get(KEY)?.status,
		).toBe('loading')
	})
})
