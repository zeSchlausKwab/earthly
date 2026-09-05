import { describe, expect, test } from 'bun:test'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { createViewModeSlice } from './viewModeSlice'
import { routeStateFromEarthlyRoute } from '../hooks/useRouting'
import { parseEarthlyRoute } from '@/router/routeContract'
import { nip19 } from 'nostr-tools'
import type { EditorState } from './types'

function createViewModeHarness(options?: { retainedDataset?: boolean }): {
	getState: () => EditorState
} {
	let state = {} as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state as EditorState) : update
		state = { ...state, ...partial }
	}
	const get = () => state as EditorState
	state = {
		...createViewModeSlice(set as never, get as never, {} as never),
		mapStackEntries: {},
		activeWorkspaceId: options?.retainedDataset ? 'workspace-1' : null,
		activeGeoEditDraftId: options?.retainedDataset ? 'draft-1' : null,
		workspaces: options?.retainedDataset
			? {
					'workspace-1': {
						id: 'workspace-1',
						sourceId: 'dataset:owner:map',
						activeDraftId: 'draft-1',
					},
				}
			: {},
		geoEditDrafts: options?.retainedDataset
			? { 'draft-1': { id: 'draft-1', sourceId: 'dataset:owner:map' } }
			: {},
	} as EditorState
	return { getState: () => state }
}

describe('retained inspection subject', () => {
	test('explicit Browse routes open a half-height sheet while home restores the bare map', () => {
		const harness = createViewModeHarness({ retainedDataset: true })
		for (const [kind, tab] of [
			['maps', 'datasets'],
			['stories', 'stories'],
			['atlases', 'contexts'],
			['sightings', 'sightings'],
			['people', 'profile'],
		] as const) {
			harness
				.getState()
				.applyRouteState(routeStateFromEarthlyRoute(parseEarthlyRoute(`/browse/${kind}`)), {
					syncMobileTab: true,
				})
			expect(harness.getState().mobilePanelOpen).toBe(true)
			expect(harness.getState().mobileSidebarOpen).toBe(false)
			expect(harness.getState().mobilePanelTab).toBe(tab)
			expect(harness.getState().mobilePanelSnap).toBe('half')
			expect(harness.getState().stance).toBe('browse')
			expect(harness.getState().activeWorkspaceId).toBe('workspace-1')
		}
		harness
			.getState()
			.applyRouteState(routeStateFromEarthlyRoute(parseEarthlyRoute('/')), { syncMobileTab: true })
		expect(harness.getState().mobilePanelOpen).toBe(false)
		expect(harness.getState().mobileSidebarOpen).toBe(false)
	})

	test('selecting a new kind clears stale visible subjects atomically', () => {
		const harness = createViewModeHarness()
		const dataset = { id: 'dataset-1' } as GeoDataset
		const context = { id: 'context-1' } as MapContext
		const story = { id: 'story-1' } as Article

		harness.getState().setViewDataset(dataset)
		expect(harness.getState().inspectionSubject).toEqual({ kind: 'dataset', entity: dataset })

		harness.getState().setViewContext(context)
		expect(harness.getState().viewDataset).toBeNull()
		expect(harness.getState().inspectionSubject).toEqual({ kind: 'context', entity: context })

		harness.getState().setViewStory(story)
		expect(harness.getState().viewContext).toBeNull()
		expect(harness.getState().inspectionSubject).toEqual({ kind: 'story', entity: story })
	})

	test('catalog routing hides but does not forget the Inspector subject', () => {
		const harness = createViewModeHarness()
		const context = { id: 'context-1' } as MapContext
		harness.getState().setViewContext(context)

		harness.getState().applyRouteState({ sidebarView: 'datasets', focusType: 'none' })

		expect(harness.getState().viewContext).toBeNull()
		expect(harness.getState().inspectionSubject).toEqual({ kind: 'context', entity: context })

		harness.getState().setInspectionSubject(harness.getState().inspectionSubject)
		expect(harness.getState().viewContext).toBe(context)
	})

	test('a Context scope does not implicitly reopen the Context inspector', () => {
		const harness = createViewModeHarness()
		const context = { id: 'context-1' } as MapContext
		harness.getState().setViewContext(context)

		harness.getState().applyRouteState({
			sidebarView: 'datasets',
			focusType: 'none',
			contextNaddr: 'naddr-scope-only',
		})

		expect(harness.getState().viewContext).toBeNull()
		expect(harness.getState().inspectionSubject).toEqual({ kind: 'context', entity: context })
		expect(harness.getState().activeContextScopeNaddr).toBe('naddr-scope-only')
	})

	test('a retained draft authors only on the explicit Dataset edit surface', () => {
		const harness = createViewModeHarness({ retainedDataset: true })

		harness.getState().applyRouteState({ sidebarView: 'edit', focusType: 'none' })
		expect(harness.getState().viewMode).toBe('edit')
		expect(harness.getState().stance).toBe('author')

		harness.getState().applyRouteState({ sidebarView: 'datasets', focusType: 'none' })
		expect(harness.getState().viewMode).toBe('view')
		expect(harness.getState().stance).toBe('browse')
	})

	test('opens a routed object Thread in the full-height mobile Thread sheet', () => {
		const harness = createViewModeHarness()
		harness.getState().applyRouteState(
			{
				sidebarView: 'datasets',
				focusType: 'geoevent',
				naddr: 'naddr1map',
				tab: 'thread',
			},
			{ syncMobileTab: true },
		)

		expect(harness.getState().mobilePanelOpen).toBe(true)
		expect(harness.getState().mobilePanelTab).toBe('chat')
		expect(harness.getState().mobilePanelSnap).toBe('full')
	})

	test('an explicit Map edit route activates only its matching retained working copy', () => {
		const harness = createViewModeHarness({ retainedDataset: true })
		const pubkey = 'a'.repeat(64)
		const state = harness.getState()
		const workspace = state.workspaces['workspace-1']
		const draft = state.geoEditDrafts['draft-1']
		if (!workspace || !draft) throw new Error('Expected a retained working copy')
		workspace.sourceId = `dataset:${pubkey}:map`
		draft.sourceId = `dataset:${pubkey}:map`
		const address = nip19.naddrEncode({ kind: 37515, pubkey, identifier: 'map' })
		state.applyRouteState(routeStateFromEarthlyRoute(parseEarthlyRoute(`/map/${address}/edit`)))
		expect(harness.getState().stance).toBe('author')
		expect(harness.getState().viewMode).toBe('edit')
		const otherAddress = nip19.naddrEncode({ kind: 37515, pubkey, identifier: 'other' })
		state.applyRouteState(
			routeStateFromEarthlyRoute(parseEarthlyRoute(`/map/${otherAddress}/edit`)),
		)
		expect(harness.getState().stance).toBe('focus')
		expect(harness.getState().viewMode).toBe('view')
		state.applyRouteState(routeStateFromEarthlyRoute(parseEarthlyRoute(`/map/${address}`)))
		expect(harness.getState().viewMode).toBe('view')
	})

	test('restores a local draft Thread from its edit route without changing the working copy', () => {
		const harness = createViewModeHarness({ retainedDataset: true })
		harness
			.getState()
			.applyRouteState(
				{ sidebarView: 'edit', focusType: 'none', tab: 'thread' },
				{ syncMobileTab: true },
			)
		expect(harness.getState().viewMode).toBe('edit')
		expect(harness.getState().mobilePanelOpen).toBe(true)
		expect(harness.getState().mobilePanelTab).toBe('chat')
		expect(harness.getState().mobilePanelSnap).toBe('full')
	})
})
