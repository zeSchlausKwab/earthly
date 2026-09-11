import { describe, expect, test } from 'bun:test'
import type { GeoEditorWorkspace } from '@/features/geo-editor/store'
import { workPublication } from './workPublication'

const target = {
	id: 'map:one',
	kind: 'dataset' as const,
	workspaceId: 'one',
	title: 'My Map',
	intent: 'create' as const,
}
const workspace: GeoEditorWorkspace = {
	id: 'one',
	label: 'My Map',
	sourceId: `dataset:${'a'.repeat(64)}:map-one`,
	datasetKey: `${'a'.repeat(64)}:map-one`,
	kind: 'dataset',
	activeDraftId: 'draft',
	chatSessionId: null,
	createdAt: 1,
	updatedAt: 1,
}

describe('conversation publication labels', () => {
	test('a local Map is not mistaken for a publication', () => {
		expect(workPublication(target)).toMatchObject({ label: 'Unpublished' })
		expect(workPublication(target).href).toBeUndefined()
	})
	test('a promoted Map remains published even though the conversation kept its create intent', () => {
		expect(workPublication(target, workspace)).toMatchObject({
			label: 'Published',
			href: expect.stringContaining('/map/naddr'),
		})
		expect(workPublication(target, workspace).description).toContain(
			'Further draft edits stay local',
		)
	})
	test('foreign proposal and unpromoted fork drafts do not claim publication', () => {
		expect(workPublication({ ...target, intent: 'propose' }, workspace).label).toBe(
			'Proposal draft',
		)
		expect(
			workPublication(
				{ ...target, intent: 'fork' },
				{ ...workspace, sourceId: `fork:${workspace.datasetKey}` },
			).label,
		).toBe('Copy draft')
	})
	test('Story publication follows its reconciled reference', () => {
		const story = {
			id: 'story:one',
			kind: 'story' as const,
			title: 'My Story',
			draftKey: 'one',
			intent: 'create' as const,
		}
		expect(workPublication(story).label).toBe('Unpublished')
		expect(workPublication({ ...story, storyReference: 'nostr:naddr1story' })).toMatchObject({
			label: 'Published',
			href: '/story/naddr1story',
		})
	})
})
