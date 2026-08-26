import { describe, expect, test } from 'bun:test'
import {
	isDatasetMapInteractionEnabled,
	type DatasetMapInteractionState,
} from './mobileDatasetInteraction'

const activeDatasetTask = Object.freeze({
	draftGeometryVisible: true,
	viewMode: 'edit' as const,
	stance: 'author' as const,
})

function interactionFor(override: Partial<DatasetMapInteractionState> = {}): boolean {
	return isDatasetMapInteractionEnabled({
		...activeDatasetTask,
		isMobile: true,
		mobilePanelOpen: true,
		mobilePanelTab: 'edit',
		mobileEntitySurface: 'dataset',
		...override,
	})
}

describe('Dataset map interaction gate', () => {
	test('Edit -> Chat/Stack -> Edit pauses and restores gestures without changing task state', () => {
		const taskBefore = { ...activeDatasetTask }
		const sequence = ['edit', 'chat', 'map-stack', 'edit'] as const

		expect(sequence.map((mobilePanelTab) => interactionFor({ mobilePanelTab }))).toEqual([
			true,
			false,
			false,
			true,
		])
		expect(activeDatasetTask).toEqual(taskBefore)
	})

	test('an open Edit sheet only grants gestures to its selected Dataset surface', () => {
		expect(interactionFor({ mobileEntitySurface: 'dataset' })).toBe(true)
		expect(interactionFor({ mobileEntitySurface: 'story' })).toBe(false)
		expect(interactionFor({ mobileEntitySurface: 'inspector' })).toBe(false)
	})

	test('a closed mobile sheet leaves the retained Dataset task usable on the bare map', () => {
		expect(
			interactionFor({
				mobilePanelOpen: false,
				mobilePanelTab: 'chat',
				mobileEntitySurface: 'story',
			}),
		).toBe(true)
	})

	test('desktop authoring is unchanged by dormant mobile presentation state', () => {
		expect(
			interactionFor({
				isMobile: false,
				mobilePanelTab: 'chat',
				mobileEntitySurface: 'story',
			}),
		).toBe(true)
	})

	test('task and visibility guards still fail closed', () => {
		expect(interactionFor({ draftGeometryVisible: false })).toBe(false)
		expect(interactionFor({ viewMode: 'view' })).toBe(false)
		expect(interactionFor({ stance: 'focus' })).toBe(false)
	})
})
