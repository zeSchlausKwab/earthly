import { describe, expect, mock, test } from 'bun:test'
import type { Article } from '@/lib/nostr/article'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { RetainedDatasetSurfaceTarget } from '../store'
import {
	attemptConversationEditTargetRestore,
	CHAT_EDIT_TARGET_UNAVAILABLE_MESSAGE,
	mobileWorkspacePanelUsesKeyboardViewport,
	resolveActiveConversationEditTarget,
	resolveInfoPanelViewState,
	resolveMobileDatasetSurfaceTitle,
	resolveMobileEditPanelPresentation,
	resolveMobileStorySurfaceTitle,
	resolveMobileWorkspaceTabKey,
	type InfoPanelViewState,
} from './mobileEditPanelPresentation'

const emptyViews = (): InfoPanelViewState => ({
	viewDataset: null,
	viewContext: null,
	viewStory: null,
	viewSighting: null,
	viewBeacon: null,
})

describe('mobile workspace interaction helpers', () => {
	test('keeps keyboard avoidance active for Chat and Edit only', () => {
		expect(mobileWorkspacePanelUsesKeyboardViewport('chat')).toBe(true)
		expect(mobileWorkspacePanelUsesKeyboardViewport('edit')).toBe(true)
		expect(mobileWorkspacePanelUsesKeyboardViewport('map-stack')).toBe(false)
	})

	test('supports wrapping arrow keys plus Home and End', () => {
		expect(resolveMobileWorkspaceTabKey('map-stack', 'ArrowLeft')).toBe('chat')
		expect(resolveMobileWorkspaceTabKey('chat', 'ArrowRight')).toBe('map-stack')
		expect(resolveMobileWorkspaceTabKey('edit', 'Home')).toBe('map-stack')
		expect(resolveMobileWorkspaceTabKey('edit', 'End')).toBe('chat')
		expect(resolveMobileWorkspaceTabKey('edit', 'Enter')).toBeNull()
	})

	test('uses the retained local Story title when no published Story is attached', () => {
		expect(resolveMobileStorySurfaceTitle(null, '  AI-authored local atlas  ')).toBe(
			'AI-authored local atlas',
		)
		expect(resolveMobileStorySurfaceTitle('Published title', 'Local title')).toBe('Published title')
		expect(resolveMobileStorySurfaceTitle(null, ' ')).toBe('Untitled story')
	})

	test('uses a renamed unsaved Dataset draft before its stale workspace label', () => {
		const retainedTarget = {
			workspace: { label: 'Untitled workspace' },
			draft: {
				name: 'Dataset A — exact mobile Chat target',
				collectionMeta: { name: 'Dataset A — exact mobile Chat target' },
			},
		} as RetainedDatasetSurfaceTarget

		expect(resolveMobileDatasetSurfaceTitle(retainedTarget)).toBe(
			'Dataset A — exact mobile Chat target',
		)
	})
})

describe('resolveActiveConversationEditTarget', () => {
	test('prefers the immutable run target only for the active conversation', () => {
		expect(
			resolveActiveConversationEditTarget(
				'chat-a',
				{
					chatId: 'chat-a',
					target: { entityType: 'dataset', workspaceId: 'workspace-run' },
				},
				[{ id: 'chat-a', targetWorkspaceId: 'workspace-session' }],
			),
		).toEqual({ entityType: 'dataset', workspaceId: 'workspace-run' })
	})

	test('uses the visible session binding when another conversation owns the run', () => {
		expect(
			resolveActiveConversationEditTarget(
				'chat-a',
				{
					chatId: 'chat-b',
					target: { entityType: 'dataset', workspaceId: 'workspace-b' },
				},
				[{ id: 'chat-a', targetWorkspaceId: 'workspace-a' }],
			),
		).toEqual({ entityType: 'dataset', workspaceId: 'workspace-a' })
	})

	test('fails closed when the matching run has no writable target', () => {
		expect(
			resolveActiveConversationEditTarget(
				'chat-a',
				{
					chatId: 'chat-a',
					target: { entityType: null, workspaceId: null },
				},
				[{ id: 'chat-a', targetWorkspaceId: 'workspace-stale' }],
			),
		).toBeNull()
	})

	test('keeps Chat selected and announces recovery when exact restoration is stale', async () => {
		const openTarget = mock(async (_workspaceId: string) => false)
		const announceUnavailable = mock(() => {})

		expect(
			await attemptConversationEditTargetRestore(
				{ entityType: 'dataset', workspaceId: 'stale-workspace' },
				openTarget,
				announceUnavailable,
			),
		).toBe(false)
		expect(openTarget).toHaveBeenCalledWith('stale-workspace')
		expect(announceUnavailable).toHaveBeenCalledTimes(1)
		expect(CHAT_EDIT_TARGET_UNAVAILABLE_MESSAGE).toContain('Choose New map or Use current in Chat')
	})
})

describe('resolveMobileEditPanelPresentation', () => {
	test('describes inspected entities without implying edit mode', () => {
		expect(resolveMobileEditPanelPresentation({ hasViewedDataset: true })).toEqual({
			label: 'Dataset',
			intent: 'inspect',
		})
		expect(resolveMobileEditPanelPresentation({ hasViewedSighting: true })).toEqual({
			label: 'Sighting',
			intent: 'inspect',
		})
	})

	test('describes create and edit tasks as authoring', () => {
		expect(resolveMobileEditPanelPresentation({ hasRetainedDataset: true })).toEqual({
			label: 'Edit dataset',
			intent: 'author',
		})
		expect(resolveMobileEditPanelPresentation({ storyEditorMode: 'create' })).toEqual({
			label: 'New story',
			intent: 'author',
		})
		expect(resolveMobileEditPanelPresentation({ beaconControlMode: 'adjust' })).toEqual({
			label: 'Adjust live location',
			intent: 'author',
		})
	})

	test('uses the currently surfaced entity editor before a retained Dataset', () => {
		expect(
			resolveMobileEditPanelPresentation({
				hasRetainedDataset: true,
				storyEditorMode: 'edit',
			}),
		).toEqual({ label: 'Edit story', intent: 'author' })
	})

	test('uses the explicit mobile surface when several editors are retained', () => {
		expect(
			resolveMobileEditPanelPresentation({
				surface: 'dataset',
				hasRetainedDataset: true,
				storyEditorMode: 'edit',
			}),
		).toEqual({ label: 'Edit dataset', intent: 'author' })
		expect(
			resolveMobileEditPanelPresentation({
				surface: 'story',
				hasRetainedDataset: true,
				storyEditorMode: 'edit',
			}),
		).toEqual({ label: 'Edit story', intent: 'author' })
	})

	test('names the explicit Inspector subject without treating it as writable', () => {
		expect(
			resolveMobileEditPanelPresentation({
				surface: 'inspector',
				inspectionKind: 'context',
				hasRetainedDataset: true,
			}),
		).toEqual({ label: 'Context', intent: 'inspect' })
	})

	test('prefers an active authoring task over a stale viewed entity', () => {
		expect(
			resolveMobileEditPanelPresentation({
				hasViewedDataset: true,
				sightingEditorMode: 'edit',
			}),
		).toEqual({ label: 'Edit sighting', intent: 'author' })
	})
})

describe('resolveInfoPanelViewState', () => {
	test('uses an exact retained Inspector subject and clears stale per-kind views', () => {
		const retainedDataset = { id: 'retained-dataset' } as unknown as GeoDataset
		const staleStory = { id: 'stale-story' } as unknown as Article

		expect(
			resolveInfoPanelViewState(
				{ kind: 'dataset', entity: retainedDataset },
				{ ...emptyViews(), viewStory: staleStory },
			),
		).toEqual({ ...emptyViews(), viewDataset: retainedDataset })
	})

	test('preserves desktop route-owned views when no override is supplied', () => {
		const context = { id: 'route-context' } as unknown as MapContext
		const fallback = { ...emptyViews(), viewContext: context }

		expect(resolveInfoPanelViewState(undefined, fallback)).toBe(fallback)
	})
})
