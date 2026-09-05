import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export type EarthlyPanel =
	| 'Local drafts'
	| 'Maps'
	| 'Shelf'
	| 'Atlases'
	| 'Nearby'
	| 'Circles'
	| 'Stories'
	| 'Sightings'
	| 'Beacons'
	| 'Me'
	| 'Posts'
	| 'Sync & delivery'
	| 'Wallet'
	| 'Settings'
	| 'Help'

export const openPanelTask: AiTaskMetadata = {
	id: 'navigation.open-panel',
	summary: 'Open a Browse or account destination through the visible shell controls.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Changes route; leaving mobile drawing keeps the working copy'],
	viewports: 'both',
}

const routes: Record<EarthlyPanel, string> = {
	'Local drafts': '/drafts',
	Maps: '/browse/maps',
	Shelf: '/shelf',
	Atlases: '/browse/atlases',
	Nearby: '/me/nearby',
	Circles: '/me/circles',
	Stories: '/browse/stories',
	Sightings: '/browse/sightings',
	Beacons: '/beacons',
	Me: '/me',
	Posts: '/posts',
	'Sync & delivery': '/delivery',
	Wallet: '/wallet',
	Settings: '/settings',
	Help: '/help',
}

export async function openPanel(earthly: EarthlySession, panel: EarthlyPanel): Promise<void> {
	const page = earthly.page
	const browsePanel = ['Maps', 'Stories', 'Atlases', 'Sightings'].includes(panel)
	const me = page.getByRole('button', { name: 'Me', exact: true })
	if (earthly.isMobile && !(await me.isVisible())) {
		// Done exits drawing without discarding the retained working copy.
		await page.getByRole('button', { name: /^Done/ }).click()
		await expect(me).toBeVisible()
	}
	const menu = page.getByRole('dialog', { name: 'Me menu', exact: true })
	if (browsePanel) {
		if (await menu.isVisible()) await page.keyboard.press('Escape')
		await page.getByRole('button', { name: 'Browse', exact: true }).click()
		await page.getByRole('tab', { name: new RegExp(`^${panel}(?:\\s|$)`) }).click()
	} else if (!earthly.isMobile && panel === 'Local drafts') {
		if (await menu.isVisible()) await page.keyboard.press('Escape')
		await page.getByRole('button', { name: /^Drafts(?:\s|$)/ }).click()
	} else {
		if (!(await menu.isVisible())) await me.click()
		await expect(menu).toBeVisible()
		const label =
			panel === 'Me'
				? 'Profile'
				: panel === 'Local drafts'
					? 'Drafts'
					: panel === 'Nearby'
						? 'Nearby sessions'
						: panel === 'Beacons'
							? 'Live positions'
							: panel === 'Help'
								? 'Help & tour'
								: panel
		await menu.getByRole('button', { name: new RegExp(`^${label}(?:\\s|$)`) }).click()
		await expect(menu).toBeHidden()
	}
	await expect.poll(() => new URL(page.url()).pathname).toBe(routes[panel])
}
