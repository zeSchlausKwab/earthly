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

export async function copyCurrentShareLink(earthly: EarthlySession): Promise<string> {
	await earthly.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: earthly.environment.baseURL,
	})
	const direct = earthly.page.locator('button[aria-label="Share"][aria-haspopup="dialog"]').first()
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
	await earthly.page.getByRole('button', { name: 'Copy link', exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible()
	const shareUrl = await earthly.page.evaluate(() => navigator.clipboard.readText())
	const parsed = new URL(shareUrl)
	if (!parsed.pathname.startsWith('/map/')) {
		throw new Error(`Share UI returned a non-Map route: ${parsed.pathname}`)
	}
	return shareUrl
}
