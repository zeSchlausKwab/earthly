import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export type EarthlyPanel =
	| 'Datasets'
	| 'Contexts'
	| 'Field sessions'
	| 'Private groups'
	| 'Stories'
	| 'Sightings'
	| 'Beacons'
	| 'Profile'
	| 'Posts'
	| 'Sync & delivery'
	| 'Wallet'
	| 'Settings'
	| 'Help'

export const openPanelTask: AiTaskMetadata = {
	id: 'navigation.open-panel',
	summary: 'Open an Earthly browse or account panel on desktop or mobile.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Changes the current route and opens the mobile navigation drawer'],
	viewports: 'both',
}

const desktopRoutes: Record<EarthlyPanel, string> = {
	Datasets: '/datasets',
	Contexts: '/contexts',
	'Field sessions': '/field-sessions',
	'Private groups': '/private-groups',
	Stories: '/stories',
	Sightings: '/sightings',
	Beacons: '/beacons',
	Profile: '/user',
	Posts: '/posts',
	'Sync & delivery': '/delivery',
	Wallet: '/wallet',
	Settings: '/settings',
	Help: '/help',
}

export async function openPanel(earthly: EarthlySession, panel: EarthlyPanel): Promise<void> {
	// Unified vocabulary (audit P2 #8): Posts is labeled "Local posts" on both
	// viewports; the mobile dock's beacon destination is labeled "Live".
	const visibleLabel =
		panel === 'Posts'
			? 'Local posts'
			: earthly.isMobile && panel === 'Beacons'
				? 'Live beacons'
				: earthly.isMobile && panel === 'Profile'
					? 'My entities'
					: panel
	if (!earthly.isMobile) {
		const desktopLabel = panel === 'Profile' ? 'My Entities' : visibleLabel
		await earthly.page.getByRole('button', { name: desktopLabel, exact: true }).click()
		await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
		return
	}

	await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	await expect(drawer).toBeVisible()
	await drawer.getByRole('button', { name: new RegExp(`^${visibleLabel}(?:\\s|$)`) }).click()
	await expect(
		drawer
			.locator('h2:visible')
			.filter({ hasText: new RegExp(`^${visibleLabel}$`) })
			.first(),
	).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
}
