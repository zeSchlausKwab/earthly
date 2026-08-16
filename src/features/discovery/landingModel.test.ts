import { describe, expect, test } from 'bun:test'
import type { RouteState } from '@/features/geo-editor/hooks/useRouting'
import {
	isRenderableDiscoveryDataset,
	isLandingDatasetCandidate,
	normalizeDiscoveryText,
	selectLatestEligibleDataset,
	selectRecentDiscoveryItems,
	shouldAutoOpenDiscover,
	shouldSeedLandingDataset,
} from './landingModel'
import {
	DISCOVER_WELCOME_STORAGE_KEY,
	hasSeenDiscoverWelcome,
	markDiscoverWelcomeSeen,
} from './welcomeState'

const featured = 'a'.repeat(64)
const options = { featuredPubkeys: [featured], allowUnfeaturedFallback: false }
const rootRoute: RouteState = { focusType: 'none', sidebarView: 'datasets' }
const rootGuard = {
	pathname: '/',
	search: '',
	hash: '',
	route: rootRoute,
	stance: 'browse' as const,
	stackUrlHydrated: true,
	catalogSettled: true,
	activeDraftId: null,
	activeWorkspaceId: null,
	hasEditorFeatures: false,
	hasDraftStackEntry: false,
	mapStackSize: 0,
}

const dataset = (id: string, created_at: number, pubkey = featured) => ({
	id,
	pubkey,
	created_at,
	dTag: `map-${id}`,
	featureCollection: { features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] },
	blobReferences: [],
})

describe('Discover content selection', () => {
	test('normalizes untrusted display text without assuming JSON field types', () => {
		expect(normalizeDiscoveryText(42, 20)).toBeUndefined()
		expect(normalizeDiscoveryText({ title: 'map' }, 20)).toBeUndefined()
		expect(normalizeDiscoveryText('  Atlas notes  ', 20)).toBe('Atlas notes')
		expect(normalizeDiscoveryText('A deliberately long title', 12)).toBe('A deliberat…')
	})

	test('chooses the newest renderable featured dataset without mutating input', () => {
		const events = [dataset('older', 2), dataset('newest', 8), dataset('middle', 5)]
		const original = events.slice()
		expect(selectLatestEligibleDataset(events, options)?.id).toBe('newest')
		expect(events).toEqual(original)
	})

	test('lists blob-backed maps but only seeds one that can be framed immediately', () => {
		const unfeatured = dataset('unfeatured', 20, 'b'.repeat(64))
		const empty = { ...dataset('empty', 15), featureCollection: { features: [] } }
		const blob = {
			...dataset('blob', 10),
			featureCollection: { features: [] },
			blobReferences: [{ url: 'https://example.test/map.geojson' }],
		}
		const framedBlob = { ...blob, id: 'framed-blob', boundingBox: [-10, -5, 10, 5] }
		expect(isRenderableDiscoveryDataset(empty)).toBe(false)
		expect(isRenderableDiscoveryDataset(blob)).toBe(true)
		expect(isLandingDatasetCandidate(blob)).toBe(false)
		expect(isLandingDatasetCandidate(framedBlob)).toBe(true)
		expect(selectLatestEligibleDataset([unfeatured, empty, blob, framedBlob], options)?.id).toBe(
			'framed-blob',
		)
	})

	test('sorts deterministically and caps each recent list', () => {
		const events = [dataset('z', 4), dataset('b', 9), dataset('a', 9), dataset('old', 1)]
		expect(selectRecentDiscoveryItems(events, options, 3).map((event) => event.id)).toEqual([
			'a',
			'b',
			'z',
		])
	})

	test('only falls back to uncurated relay content when explicitly enabled', () => {
		const event = dataset('local', 1, 'c'.repeat(64))
		expect(
			selectRecentDiscoveryItems([event], {
				featuredPubkeys: [],
				allowUnfeaturedFallback: false,
			}),
		).toEqual([])
		expect(
			selectRecentDiscoveryItems([event], {
				featuredPubkeys: [],
				allowUnfeaturedFallback: true,
			}),
		).toEqual([event])
	})
})

describe('plain landing guards', () => {
	test('allows the first unscoped root landing', () => {
		expect(shouldAutoOpenDiscover(rootGuard)).toBe(true)
		expect(shouldSeedLandingDataset(rootGuard)).toBe(true)
	})

	test('waits for the catalog and refuses shared, routed, or restored state', () => {
		expect(shouldSeedLandingDataset({ ...rootGuard, catalogSettled: false })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, search: '?ms=dataset:x' })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, pathname: '/stories' })).toBe(false)
		expect(
			shouldSeedLandingDataset({
				...rootGuard,
				route: { ...rootRoute, privateGroupId: 'private-1' },
			}),
		).toBe(false)
		expect(
			shouldSeedLandingDataset({
				...rootGuard,
				route: { ...rootRoute, fieldSessionId: 'field-1' },
			}),
		).toBe(false)
		expect(
			shouldSeedLandingDataset({
				...rootGuard,
				route: { focusType: 'story', sidebarView: 'stories', naddr: 'naddr1story' },
			}),
		).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, activeDraftId: 'draft-1' })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, activeWorkspaceId: 'workspace-1' })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, hasEditorFeatures: true })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, hasDraftStackEntry: true })).toBe(false)
		expect(shouldSeedLandingDataset({ ...rootGuard, mapStackSize: 1 })).toBe(false)
	})
})

describe('Discover welcome persistence', () => {
	test('is versioned independently from the guided tour', () => {
		const values = new Map<string, string>()
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		}
		expect(hasSeenDiscoverWelcome(storage)).toBe(false)
		markDiscoverWelcomeSeen(storage)
		expect(values.get(DISCOVER_WELCOME_STORAGE_KEY)).toBe('seen')
		expect(hasSeenDiscoverWelcome(storage)).toBe(true)
	})
})
