import { describe, expect, test } from 'bun:test'
import { resolveMobileEditPanelPresentation } from './mobileEditPanelPresentation'

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
		expect(resolveMobileEditPanelPresentation({ storyEditorMode: 'create' })).toEqual({
			label: 'New story',
			intent: 'author',
		})
		expect(resolveMobileEditPanelPresentation({ beaconControlMode: 'adjust' })).toEqual({
			label: 'Adjust live location',
			intent: 'author',
		})
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
