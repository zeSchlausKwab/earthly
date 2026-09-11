import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openDiscoverTask: AiTaskMetadata = {
	id: 'navigation.open-discover',
	summary: 'Open the global Discover atlas from the navigation available under Me.',
	preconditions: ['Earthly is ready'],
	sideEffects: ['Opens the Discover dialog'],
	viewports: 'both',
}

export async function openDiscover(earthly: EarthlySession): Promise<void> {
	const dialog = earthly.page.getByRole('dialog', { name: 'Discover Earthly' })
	if (await dialog.isVisible()) return

	await earthly.page.getByRole('button', { name: /^(Your account:|Sign in$)/ }).click()
	const menu = earthly.page.getByRole('dialog', { name: 'Me menu', exact: true })
	await menu.getByRole('button', { name: 'Discover', exact: true }).click()
	await expect(dialog).toBeVisible()
}
