import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const copyCurrentShareLinkTask: AiTaskMetadata = {
	id: 'navigation.copy-current-share-link',
	summary: 'Copy the canonical link for the currently focused map entity through the Share UI.',
	preconditions: ['A public Earthly entity is focused', 'The Share action is visible'],
	sideEffects: ['Writes the canonical public URL to the browser clipboard'],
	viewports: 'both',
}

async function openSharePopover(earthly: EarthlySession): Promise<void> {
	if (await earthly.page.getByRole('heading', { name: 'Share this view', exact: true }).isVisible())
		return
	// The inspector's Share action remains reachable above the mobile sheet.
	const surface = earthly.isMobile
		? earthly.page.getByRole('region', { name: 'Map inspection', exact: true })
		: earthly.page.getByRole('main', { name: 'Map canvas', exact: true })
	const direct = surface.locator('button[aria-label="Share"][aria-haspopup="dialog"]').first()
	if (await direct.isVisible()) await direct.click()
	else {
		await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
		await earthly.page
			.getByRole('menuitem', { name: 'Share and export image', exact: true })
			.click()
	}
	await expect(
		earthly.page.getByRole('heading', { name: 'Share this view', exact: true }),
	).toBeVisible()
}

export const openDatasetEmbedTask: AiTaskMetadata = {
	id: 'navigation.open-dataset-embed',
	summary:
		'Open website embedding for the focused public dataset and start its compatibility check.',
	preconditions: [
		'A signed public dataset is focused',
		'PUBLIC_MAP_URL points to a loopback viewer',
	],
	sideEffects: ['Reads dataset compatibility from the configured map viewer'],
	viewports: 'both',
}

export async function openDatasetEmbed(earthly: EarthlySession): Promise<void> {
	await openSharePopover(earthly)
	await earthly.page.getByRole('tab', { name: 'Embed on a website', exact: true }).click()
	await expect(
		earthly.page.getByRole('region', { name: 'Embed dataset', exact: true }),
	).toBeVisible()
}

export async function copyCurrentShareLink(earthly: EarthlySession): Promise<string> {
	await earthly.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: earthly.environment.baseURL,
	})
	await openSharePopover(earthly)
	const shareTab = earthly.page.getByRole('tab', { name: 'Link and image', exact: true })
	if (await shareTab.isVisible()) await shareTab.click()
	await earthly.page.getByRole('button', { name: 'Copy link', exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible()
	const shareUrl = await earthly.page.evaluate(() => navigator.clipboard.readText())
	const parsed = new URL(shareUrl)
	if (!parsed.pathname.startsWith('/map/')) {
		throw new Error(`Share UI returned a non-Map route: ${parsed.pathname}`)
	}
	return shareUrl
}
