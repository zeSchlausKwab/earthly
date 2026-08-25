import { describe, expect, test } from 'bun:test'
import {
	hasActiveInspectSubject,
	replayInspectionSubject,
	resolveActiveInspectEntity,
} from './AppSidebar'

// Phase 13 (13-uat, finding B): a shared /beacon/:naddr deep link resolved the
// beacon and called handleInspectBeacon (setting viewBeacon), but AppSidebar omitted
// beacon from BOTH the catalog-override guard (hasInspectSubject) and the show-panel
// switch — so the beacons LIST won the race and the inspect panel never opened. These
// pin the exact regression: beacon MUST count as an inspect subject, and MUST resolve
// to the 'beacon' entity (checked FIRST, mirroring currentSurface).

const EMPTY = {
	contextEditorMode: 'none',
	storyEditorMode: 'none',
	sightingEditorMode: 'none',
	beaconControlMode: 'none',
} as const

describe('hasActiveInspectSubject — beacon is an inspect subject (13-uat)', () => {
	test('no subject → false (catalog list is allowed through)', () => {
		expect(hasActiveInspectSubject({ ...EMPTY })).toBe(false)
	})

	// The regression: a deep-linked/inspected beacon must be an inspect subject so the
	// catalog-override guard does NOT snap back to the beacons LIST.
	test('viewBeacon set → true', () => {
		expect(hasActiveInspectSubject({ ...EMPTY, viewBeacon: { id: 'b1' } })).toBe(true)
	})

	test("beaconControlMode 'create' → true (Share live location control)", () => {
		expect(hasActiveInspectSubject({ ...EMPTY, beaconControlMode: 'create' })).toBe(true)
	})

	test("beaconControlMode 'adjust' → true", () => {
		expect(hasActiveInspectSubject({ ...EMPTY, beaconControlMode: 'adjust' })).toBe(true)
	})

	// Parity: the other kinds still count (no regression to existing behavior).
	test('viewSighting / viewStory / viewContext / viewDataset each → true', () => {
		expect(hasActiveInspectSubject({ ...EMPTY, viewSighting: { id: 's' } })).toBe(true)
		expect(hasActiveInspectSubject({ ...EMPTY, viewStory: { id: 's' } })).toBe(true)
		expect(hasActiveInspectSubject({ ...EMPTY, viewContext: { id: 'c' } })).toBe(true)
		expect(hasActiveInspectSubject({ ...EMPTY, viewDataset: { id: 'd' } })).toBe(true)
	})
})

describe('resolveActiveInspectEntity — beacon resolves to full panel (13-uat)', () => {
	test('no subject → null (catalog list)', () => {
		expect(resolveActiveInspectEntity({ ...EMPTY })).toBeNull()
	})

	// The regression: viewBeacon must resolve to the 'beacon' entity so the show-panel
	// effect fires setShowEntityAsFullPanel(true) → BeaconViewPanel instead of the list.
	test('viewBeacon → beacon', () => {
		expect(resolveActiveInspectEntity({ ...EMPTY, viewBeacon: { id: 'b1' } })).toBe('beacon')
	})

	test("beaconControlMode 'create' → beacon", () => {
		expect(resolveActiveInspectEntity({ ...EMPTY, beaconControlMode: 'create' })).toBe('beacon')
	})

	// Beacon is checked FIRST — mirroring currentSurface / returnToCurrentSurface.
	test('beacon wins over a co-present sighting subject (checked first)', () => {
		expect(
			resolveActiveInspectEntity({
				...EMPTY,
				viewBeacon: { id: 'b1' },
				viewSighting: { id: 's1' },
			}),
		).toBe('beacon')
	})

	// Parity for the other kinds (order preserved: sighting → story → context → geometry).
	test('other kinds resolve to their entity', () => {
		expect(resolveActiveInspectEntity({ ...EMPTY, viewSighting: { id: 's' } })).toBe('sighting')
		expect(resolveActiveInspectEntity({ ...EMPTY, viewStory: { id: 's' } })).toBe('story')
		expect(resolveActiveInspectEntity({ ...EMPTY, viewContext: { id: 'c' } })).toBe('context')
		expect(resolveActiveInspectEntity({ ...EMPTY, viewDataset: { id: 'd' } })).toBe('geometry')
	})

	test('an inspected dataset wins over a retained Story editor', () => {
		expect(
			resolveActiveInspectEntity({
				...EMPTY,
				storyEditorMode: 'edit',
				viewDataset: { id: 'dataset' },
			}),
		).toBe('geometry')
	})

	test('the normalized subject wins over stale hook-local Beacon/Sighting views', () => {
		expect(
			resolveActiveInspectEntity({
				...EMPTY,
				inspectionSubject: {
					kind: 'dataset',
					entity: { id: 'dataset' } as never,
				},
				viewBeacon: { id: 'stale-beacon' },
				viewSighting: { id: 'stale-sighting' },
			}),
		).toBe('geometry')
	})
})

describe('replayInspectionSubject — Inspector recall restores entity routing', () => {
	test('replays the same retained Beacon object on every recall', () => {
		const beacon = { id: 'beacon-1' } as never
		const calls: unknown[] = []

		replayInspectionSubject(
			{ kind: 'beacon', entity: beacon },
			{ beacon: (entity) => calls.push(entity) },
		)
		replayInspectionSubject(
			{ kind: 'beacon', entity: beacon },
			{ beacon: (entity) => calls.push(entity) },
		)

		expect(calls).toEqual([beacon, beacon])
	})

	test('replays the same retained Sighting object even when hook-local state can already hold it', () => {
		const sighting = { id: 'sighting-1' } as never
		const calls: unknown[] = []

		replayInspectionSubject(
			{ kind: 'sighting', entity: sighting },
			{ sighting: (entity) => calls.push(entity) },
		)
		replayInspectionSubject(
			{ kind: 'sighting', entity: sighting },
			{ sighting: (entity) => calls.push(entity) },
		)

		expect(calls).toEqual([sighting, sighting])
	})
})
