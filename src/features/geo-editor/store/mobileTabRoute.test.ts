import { describe, expect, test } from 'bun:test'
import { mobileTabToView, viewToMobileTab } from './mobileTabRoute'
import type { MobilePanelTab, SidebarViewMode } from './types'

// Audit P1 #6: mobile destinations and sidebar views are the same set of
// destinations under two names. These assertions pin the mapping so a new
// view/tab added on one side without the other fails loudly here.

const ALL_TABS: MobilePanelTab[] = [
	'datasets',
	'map-stack',
	'contexts',
	'context-editor',
	'edit',
	'sightings',
	'beacons',
	'stories',
	'chat',
	'profile',
	'posts',
	'wallet',
	'settings',
	'help',
]

const ALL_VIEWS: SidebarViewMode[] = [
	'datasets',
	'map-stack',
	'contexts',
	'context-editor',
	'stories',
	'sightings',
	'beacons',
	'combined',
	'edit',
	'posts',
	'settings',
	'help',
	'user',
	'wallet',
	'chat',
]

describe('mobileTabRoute — tab↔view mapping', () => {
	test('every mobile tab round-trips through its sidebar view', () => {
		for (const tab of ALL_TABS) {
			expect(viewToMobileTab(mobileTabToView(tab))).toBe(tab)
		}
	})

	test('profile ↔ user is the only rename', () => {
		expect(mobileTabToView('profile')).toBe('user')
		expect(viewToMobileTab('user')).toBe('profile')
	})

	test('combined is the only view without a mobile tab', () => {
		for (const view of ALL_VIEWS) {
			if (view === 'combined') {
				expect(viewToMobileTab(view)).toBeNull()
			} else {
				expect(viewToMobileTab(view)).not.toBeNull()
			}
		}
	})
})
