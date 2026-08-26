import { describe, expect, test } from 'bun:test'
import { parseCampaignDemoManifest } from './manifest'

const minimumManifest = {
	id: 'vienna-water-map',
	title: 'Map drinking water with Earthly AI',
	post: 'A useful map should stay editable.',
	prompts: [{ text: 'Map public drinking-water points around Vienna.' }],
	target: 'new-dataset',
}

describe('campaign demo manifest', () => {
	test('normalizes useful recording defaults', () => {
		expect(parseCampaignDemoManifest(minimumManifest)).toMatchObject({
			id: 'vienna-water-map',
			tour: ['chat'],
			target: 'new-dataset',
			xAccountTier: 'standard',
			startPath: '/',
			typingDelayMs: 28,
			actionDelayMs: 240,
			maxTurnMs: 180_000,
			safetyLevel: 1,
			prompts: [{ text: 'Map public drinking-water points around Vienna.', approvals: [] }],
		})
	})

	test('accepts follow-ups, approval, and result tours', () => {
		const manifest = parseCampaignDemoManifest({
			...minimumManifest,
			prompts: [
				{ text: 'Create a map.', approvals: ['edits'] },
				{ text: 'Add source notes.', approvals: ['edits', 'reference-publish'] },
			],
			tour: ['geometry', 'story'],
			target: 'new-dataset',
			videoAltText: 'Earthly AI creates and previews a geographic Story.',
		})

		expect(manifest.prompts).toHaveLength(2)
		expect(manifest.prompts[0]?.approvals).toEqual(['edits'])
		expect(manifest.prompts[1]?.approvals).toEqual(['edits', 'reference-publish'])
		expect(manifest.tour).toEqual(['geometry', 'story'])
	})

	test('normalizes the legacy singular edit flag', () => {
		const manifest = parseCampaignDemoManifest({
			...minimumManifest,
			target: 'new-dataset',
			prompts: [{ text: 'Create a map.', approveEdit: true }],
		})
		expect(manifest.prompts[0]?.approvals).toEqual(['edits'])
	})

	test('enforces standard and Premium X copy limits', () => {
		expect(() => parseCampaignDemoManifest({ ...minimumManifest, post: 'x'.repeat(281) })).toThrow(
			'at most 280',
		)
		expect(
			parseCampaignDemoManifest({
				...minimumManifest,
				xAccountTier: 'premium',
				post: 'x'.repeat(281),
			}).post,
		).toHaveLength(281)
		expect(() =>
			parseCampaignDemoManifest({
				...minimumManifest,
				xAccountTier: 'premium',
				post: 'x'.repeat(25_001),
			}),
		).toThrow('at most 25,000')
		expect(() =>
			parseCampaignDemoManifest({
				...minimumManifest,
				videoAltText: 'x'.repeat(1_001),
			}),
		).toThrow('at most 1,000')
	})

	test('rejects ambiguous or invalid approval policies', () => {
		expect(() =>
			parseCampaignDemoManifest({
				...minimumManifest,
				prompts: [{ text: 'Map it.', approvals: ['edits'], approveEdit: true }],
			}),
		).toThrow('cannot use both')
		expect(() =>
			parseCampaignDemoManifest({
				...minimumManifest,
				prompts: [{ text: 'Map it.', approvals: ['publish-everything'] }],
			}),
		).toThrow('reference-publish')
	})

	test('requires an explicit Dataset target for every recording', () => {
		expect(() =>
			parseCampaignDemoManifest({
				...minimumManifest,
				target: undefined,
			}),
		).toThrow('target is required')
	})

	test('rejects unsafe artifact ids and external start URLs', () => {
		expect(() => parseCampaignDemoManifest({ ...minimumManifest, id: '../demo' })).toThrow(
			'kebab-case',
		)
		expect(() =>
			parseCampaignDemoManifest({ ...minimumManifest, startPath: 'https://earthly.city' }),
		).toThrow('app-relative')
	})
})
