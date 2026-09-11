import { describe, expect, test } from 'bun:test'
import {
	normalizeEarthlySearch,
	parseEarthlyRoute,
	parseOnSearch,
	serializeOnSearch,
} from './routeContract'

describe('Earthly route state', () => {
	test('distinguishes an explicit Browse catalog from the bare phone map', () => {
		expect(parseEarthlyRoute('/').browseOpen).toBeUndefined()
		for (const kind of ['maps', 'stories', 'atlases', 'sightings', 'people']) {
			expect(parseEarthlyRoute(`/browse/${kind}`)).toMatchObject({
				kind: 'browse',
				browseKind: kind,
				browseOpen: true,
			})
		}
		expect(parseEarthlyRoute('/in/atlas').browseOpen).toBe(true)
	})

	test('parses the new object, edit, tab, and ambient grammar', () => {
		expect(
			parseEarthlyRoute('/story/naddr1story/edit', {
				on: 'ww1-battles,bcn-spots,ww1-battles',
				live: '1',
				in: 'western-front',
				tab: 'thread',
			}),
		).toEqual({
			kind: 'story',
			id: 'naddr1story',
			edit: true,
			tab: 'thread',
			on: ['ww1-battles', 'bcn-spots'],
			live: true,
			in: 'western-front',
		})
	})

	test('keeps /read distinct from the in-app Story route', () => {
		expect(parseEarthlyRoute('/read/naddr1story').kind).toBe('reader')
		expect(parseEarthlyRoute('/story/naddr1story').kind).toBe('story')
	})

	test('turns the aggregate Live surface on for Sighting and Live object routes', () => {
		expect(parseEarthlyRoute('/sighting/naddr1sighting').live).toBe(true)
		expect(parseEarthlyRoute('/live/naddr1beacon').live).toBe(true)
	})

	test('turns a comment suffix into the comments tab', () => {
		expect(parseEarthlyRoute('/map/naddr1map/comment/comment%20id')).toMatchObject({
			kind: 'map',
			id: 'naddr1map',
			commentId: 'comment id',
			tab: 'comments',
		})
	})

	test('models /in as the canonical Browse lens destination', () => {
		expect(parseEarthlyRoute('/in/naddr1atlas')).toMatchObject({
			kind: 'browse',
			browseKind: 'maps',
			in: 'naddr1atlas',
		})
	})

	test('bounds and deterministically serializes ambient overlays', () => {
		expect(parseOnSearch(' a, b,a,, c ')).toEqual(['a', 'b', 'c'])
		expect(serializeOnSearch(['a', 'b', 'a'])).toBe('a,b')
	})

	test('normalizes owned search keys while retaining legacy map query state', () => {
		expect(
			normalizeEarthlySearch({
				on: 'a,a,b',
				live: '0',
				in: ' atlas ',
				tab: 'invalid',
				ms: 'legacy-stack',
			}),
		).toEqual({ on: 'a,b', in: 'atlas', ms: 'legacy-stack' })
	})
})
