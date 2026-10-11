import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openPublicMapTask: AiTaskMetadata = {
	id: 'navigation.open-public-map',
	summary: 'Open a public map or configured iframe and wait for its geometry to render.',
	preconditions: [
		'Public map plugin is running on the loopback base URL',
		'A published inline map URL is available',
	],
	sideEffects: ['Reads the map from the configured relays'],
	viewports: 'both',
}

export async function openPublicMap(earthly: EarthlySession, url: string): Promise<void> {
	const target = new URL(url, earthly.environment.baseURL)
	if (target.origin !== earthly.environment.baseURL)
		throw new Error('Public map task requires its loopback base URL')
	await earthly.page.goto(target.href, { waitUntil: 'domcontentloaded' })
	await expect(earthly.page.getByRole('region', { name: 'Interactive map' })).toBeVisible()
	await expect(earthly.page.getByText('Map ready', { exact: true })).toBeVisible()
}
