import { describe, expect, test } from 'bun:test'
import {
	getMapEditPresentation,
	mapDraftSourceId,
	mapIntentAllowsPublication,
	resolveMapAuthoringIntent,
} from './mapProposalPresentation'

describe('Map authoring intent', () => {
	test('defaults legacy owner edits and public foreign proposals without changing explicit intent', () => {
		expect(resolveMapAuthoringIntent(undefined, true)).toBe('edit')
		expect(resolveMapAuthoringIntent(undefined, false)).toBe('propose')
		expect(resolveMapAuthoringIntent(undefined, false, true)).toBe('fork')
		expect(resolveMapAuthoringIntent('fork', false)).toBe('fork')
		expect(getMapEditPresentation(false, 'fork')).toEqual({
			actionLabel: 'Fork map',
			workspaceStatus: 'fork',
		})
	})

	test('forks and proposals have separate retained draft identities', () => {
		expect(mapDraftSourceId('owner:map', 'propose')).toBe('dataset:owner:map')
		expect(mapDraftSourceId('owner:map', 'fork')).toBe('fork:owner:map')
	})

	test('foreign publication follows the selected intent, while owner edit retains publish-as-new', () => {
		for (const action of ['update', 'copy', 'propose'] as const) {
			expect(mapIntentAllowsPublication('propose', action, false, false)).toBe(action === 'propose')
			expect(mapIntentAllowsPublication('fork', action, false, false)).toBe(action === 'copy')
			expect(mapIntentAllowsPublication('edit', action, true, false)).toBe(action !== 'propose')
			expect(mapIntentAllowsPublication('edit', action, false, false)).toBe(false)
		}
	})

	test('private and nearby proposals stay unavailable without reducing scoped copies or owner updates', () => {
		expect(mapIntentAllowsPublication('propose', 'propose', false, true)).toBe(false)
		expect(mapIntentAllowsPublication('fork', 'copy', false, true)).toBe(true)
		expect(mapIntentAllowsPublication('edit', 'update', true, true)).toBe(true)
	})
})
