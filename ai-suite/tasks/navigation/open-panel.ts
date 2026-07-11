import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export type EarthlyPanel =
	| 'Datasets'
	| 'Contexts'
	| 'Stories'
	| 'Sightings'
	| 'Beacons'
	| 'Profile'
	| 'Posts'
	| 'Wallet'
	| 'Settings'
	| 'Help'

export const openPanelTask: AiTaskMetadata = {
	id: 'navigation.open-panel',
	summary: 'Open an Earthly browse or account panel on desktop or mobile.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Changes the current route or mobile sheet tab'],
	viewports: 'both',
}

const desktopRoutes: Record<EarthlyPanel, string> = {
	Datasets: '/datasets',
	Contexts: '/contexts',
	Stories: '/stories',
	Sightings: '/sightings',
	Beacons: '/beacons',
	Profile: '/user',
	Posts: '/posts',
	Wallet: '/wallet',
	Settings: '/settings',
	Help: '/help',
}

export async function openPanel(earthly: EarthlySession, panel: EarthlyPanel): Promise<void> {
	if (!earthly.isMobile) {
		const desktopLabel =
			panel === 'Profile' ? 'My Entities' : panel === 'Posts' ? 'City Posts' : panel
		await earthly.page.getByRole('button', { name: desktopLabel, exact: true }).click()
		await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
		return
	}

	const directDock =
		panel === 'Sightings'
			? 'Map'
			: panel === 'Datasets'
				? 'Explore'
				: panel === 'Beacons'
					? 'Activity'
					: panel === 'Profile'
						? 'You'
						: null
	if (directDock) {
		await earthly.page.getByRole('button', { name: directDock, exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Explore', exact: true }).click()
		const visibleButtons = earthly.page.locator('button:visible')
		await visibleButtons
			.filter({ hasText: /^Datasets/ })
			.first()
			.click()
		await earthly.page
			.getByRole('button', { name: new RegExp(`^${panel}(?:\\s|$)`) })
			.last()
			.click()
	}
	await expect(
		earthly.page
			.locator('button:visible')
			.filter({ hasText: new RegExp(panel) })
			.first(),
	).toBeVisible()
}
