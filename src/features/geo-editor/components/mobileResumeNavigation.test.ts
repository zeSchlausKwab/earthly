import { describe, expect, test } from 'bun:test'
import {
	mobileObjectNavigationState,
	mobileResumeDestination,
	mobileResumeNavigationStatus,
	mobileResumeRouteKey,
} from './mobileResumeNavigation'

describe('compact mobile Resume navigation', () => {
	test('waits for the actual destination route and abandons a superseded Resume', () => {
		expect(mobileResumeNavigationStatus('old-thread', 'old-thread', 'story-edit')).toBe('waiting')
		expect(mobileResumeNavigationStatus('story-edit', 'old-thread', 'story-edit')).toBe('arrived')
		expect(mobileResumeNavigationStatus('other-map', 'old-thread', 'story-edit')).toBe('cancelled')
		const route = {
			sidebarView: 'edit' as const,
			focusType: 'none' as const,
			tab: 'details' as const,
			edit: true,
		}
		expect(mobileResumeRouteKey({ ...route, privateGroupId: 'circle-a' })).not.toBe(
			mobileResumeRouteKey({ ...route, privateGroupId: 'circle-b' }),
		)
	})
	test('restores existing Story/Atlas edit destinations without old Thread parameters', () => {
		expect(mobileResumeDestination('story', { storyAddress: 'naddr-story' })).toBe(
			'/story/naddr-story/edit',
		)
		expect(mobileResumeDestination('context', { atlasAddress: 'naddr-atlas' })).toBe(
			'/atlas/naddr-atlas/edit',
		)
	})

	test('new and transient editors clear the old object Thread without recreating editor state', () => {
		expect(mobileResumeDestination('story')).toBe('/browse/stories')
		expect(mobileResumeDestination('context')).toBe('/context-editor')
		expect(mobileResumeDestination('sighting')).toBe('/browse/sightings')
		expect(mobileResumeDestination('beacon')).toBe('/beacons')
	})

	test('Map Resume retains its persisted audience rather than the previously inspected route', () => {
		expect(mobileResumeDestination('dataset', { publishChannel: { kind: 'public' } })).toBe('/edit')
		expect(
			mobileResumeDestination('dataset', {
				publishChannel: { kind: 'private-group', id: 'circle/a' },
			}),
		).toBe('/circle/circle%2Fa/edit')
		expect(
			mobileResumeDestination('dataset', {
				publishChannel: { kind: 'field-session', id: 'nearby/a' },
			}),
		).toBe('/nearby/nearby%2Fa/edit')
	})

	test('only a rendered inspector Thread receives Thread layout and content', () => {
		expect(mobileObjectNavigationState(true, 'chat', 'thread')).toEqual({
			activeTab: 'thread',
			showThread: true,
		})
		for (const panel of ['edit', 'chat', 'map-stack']) {
			expect(mobileObjectNavigationState(false, panel, 'thread')).toEqual({
				activeTab: 'details',
				showThread: false,
			})
		}
		expect(mobileObjectNavigationState(true, 'edit', 'thread')).toEqual({
			activeTab: 'details',
			showThread: false,
		})
		expect(mobileObjectNavigationState(true, 'edit', 'comments')).toEqual({
			activeTab: 'comments',
			showThread: false,
		})
	})
})
