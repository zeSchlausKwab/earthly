import { describe, expect, test } from 'bun:test'
import { shouldSeedAggregateLayers } from './aggregateLayerSeed'

const genericLanding = {
	stance: 'browse' as const,
	stackUrlHydrated: true,
	hasSharedStack: false,
	route: { focusType: 'none' as const },
}

describe('aggregate layer landing defaults', () => {
	test('seeds sightings and beacons on the generic landing', () => {
		expect(shouldSeedAggregateLayers(genericLanding)).toBe(true)
	})

	test('does not seed aggregate layers on a focused dataset landing', () => {
		expect(
			shouldSeedAggregateLayers({
				...genericLanding,
				route: { focusType: 'geoevent', naddr: 'naddr1dataset' },
			}),
		).toBe(false)
	})

	test('does not seed aggregate layers on a focused or scoped context landing', () => {
		expect(
			shouldSeedAggregateLayers({
				...genericLanding,
				route: { focusType: 'mapcontext', naddr: 'naddr1context' },
			}),
		).toBe(false)
		expect(
			shouldSeedAggregateLayers({
				...genericLanding,
				route: { focusType: 'none', contextNaddr: 'naddr1context' },
			}),
		).toBe(false)
	})

	test('keeps shared stacks and authoring sessions authoritative', () => {
		expect(shouldSeedAggregateLayers({ ...genericLanding, hasSharedStack: true })).toBe(false)
		expect(shouldSeedAggregateLayers({ ...genericLanding, stance: 'author' })).toBe(false)
	})
})
