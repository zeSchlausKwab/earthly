import { expect, type Locator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from './open-panel'

export const openMapSettingsTask: AiTaskMetadata = {
	id: 'navigation.open-map-settings',
	summary: 'Open map composition controls through More or the mobile Settings Map tab.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Opens map settings; mobile navigation retains any working copy'],
	viewports: 'both',
}

export async function openMapSettings(earthly: EarthlySession): Promise<Locator> {
	const page = earthly.page
	let settings: Locator
	if (earthly.isMobile) {
		if (new URL(page.url()).pathname !== '/settings') await openPanel(earthly, 'Settings')
		await page.getByRole('tab', { name: 'Map', exact: true }).click()
		settings = page.getByRole('tabpanel', { name: 'Map', exact: true })
	} else {
		await page.getByRole('button', { name: 'More tools', exact: true }).click()
		await page.getByRole('menuitem', { name: 'Map settings', exact: true }).click()
		settings = page.getByRole('dialog', { name: 'Map settings', exact: true })
	}
	await expect(settings).toBeVisible()
	await expect(settings.getByText('Map Source', { exact: true })).toBeVisible()
	return settings
}
