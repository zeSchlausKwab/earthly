import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openDiscoverTask: AiTaskMetadata = {
	id: 'navigation.open-discover',
	summary: 'Open the global Discover atlas without changing the current map route.',
	preconditions: ['Earthly is ready'],
	sideEffects: ['Opens the Discover dialog'],
	viewports: 'both',
}

export async function openDiscover(earthly: EarthlySession): Promise<void> {
	const dialog = earthly.page.getByRole('dialog', { name: 'Discover Earthly' })
	if (await dialog.isVisible()) return

	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
		const navigation = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
		await navigation.getByRole('button', { name: /^Discover(?:\s|$)/ }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Discover', exact: true }).click()
	}
	await expect(dialog).toBeVisible()
}
