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
	summary: 'Open an Earthly browse or account panel on desktop or mobile.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Changes the current route and opens the matching mobile drawer or sheet'],
	viewports: 'both',
}

const desktopRoutes: Record<EarthlyPanel, string> = {
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
	const navigationLabel =
		earthly.isMobile && panel === 'Sync & delivery'
			? 'Inbox & delivery'
			: panel === 'Beacons'
				? 'Live positions'
				: panel
	const headingLabel = panel === 'Beacons' ? 'Live positions' : panel
	if (!earthly.isMobile) {
		if (panel === 'Settings') {
			await earthly.page.getByRole('button', { name: 'Me', exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
			await earthly.page.getByRole('button', { name: 'Settings', exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/settings')
			return
		}
		if (panel === 'Local drafts') {
			await earthly.page.getByRole('button', { name: /^Drafts(?:\s|$)/ }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/drafts')
			return
		}
		if (panel === 'Circles' || panel === 'Nearby') {
			await earthly.page.getByRole('button', { name: 'Me', exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
			await earthly.page.getByRole('button', { name: panel, exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
			return
		}
		if (panel === 'Sync & delivery') {
			await earthly.page.getByRole('button', { name: 'Me', exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/me')
			await earthly.page.getByRole('button', { name: panel, exact: true }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
			return
		}
		if (panel === 'Shelf') {
			await earthly.page.getByRole('button', { name: /^(?:Show|Hide) Shelf$/ }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/shelf')
			return
		}
		if (panel === 'Maps' || panel === 'Stories' || panel === 'Atlases' || panel === 'Sightings') {
			const browse = earthly.page.getByRole('button', { name: 'Browse', exact: true })
			if ((await browse.getAttribute('aria-current')) !== 'page') await browse.click()
			await earthly.page.getByRole('tab', { name: new RegExp(`^${panel}(?:\\s|$)`) }).click()
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
			return
		}
		await earthly.page.getByRole('button', { name: navigationLabel, exact: true }).click()
		await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
		return
	}

	const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
	if (!(await drawer.isVisible())) {
		const me = earthly.page.getByRole('button', { name: 'Me', exact: true })
		if (await me.isVisible()) await me.click()
		else await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
		await expect(drawer).toBeVisible()
	}
	if (panel === 'Me') {
		const heading = drawer.locator('h2:visible').filter({ hasText: /^Me$/ }).first()
		if (await heading.isVisible()) {
			await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
			return
		}
	}
	const backToMenu = drawer.getByRole('button', { name: 'Back to menu', exact: true })
	if (await backToMenu.isVisible()) await backToMenu.click()
	await drawer.getByRole('button', { name: new RegExp(`^${navigationLabel}(?:\\s|$)`) }).click()
	if (panel === 'Shelf') {
		await expect(
			earthly.page.getByRole('dialog', { name: 'Shelf panel', exact: true }),
		).toBeVisible()
		await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
		return
	}
	await expect(
		drawer
			.locator('h2:visible')
			.filter({ hasText: new RegExp(`^${headingLabel}$`) })
			.first(),
	).toBeVisible()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe(desktopRoutes[panel])
}
