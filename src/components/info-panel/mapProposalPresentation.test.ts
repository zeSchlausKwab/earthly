import { describe, expect, test } from 'bun:test'
import { getMapEditPresentation } from './mapProposalPresentation'

describe('Map proposal presentation', () => {
	test('describes a non-owner working copy as proposal authoring', () => {
		expect(getMapEditPresentation(false)).toEqual({
			actionLabel: 'Propose changes',
			workspaceStatus: 'proposing',
		})
	})

	test('uses the map vocabulary for owner editing', () => {
		expect(getMapEditPresentation(true)).toEqual({
			actionLabel: 'Edit map',
			workspaceStatus: null,
		})
	})
})
