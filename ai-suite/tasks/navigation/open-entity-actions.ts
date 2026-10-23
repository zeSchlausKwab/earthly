import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openEntityActionsTask: AiTaskMetadata = {
	id: 'navigation.open-entity-actions',
	summary: 'Open the social and edit actions for a named catalog row.',
	preconditions: ['The named entity is visible in the catalog'],
	sideEffects: ['Opens the row action popover'],
	viewports: 'both',
}

export async function openEntityActions(earthly: EarthlySession, title: string) {
	await earthly.page
		.getByRole('button', { name: `More actions for ${title}`, exact: true })
		.first()
		.click()
	const actions = earthly.page.getByRole('dialog', { name: 'Entity actions', exact: true })
	await expect(actions).toBeVisible()
	return actions
}
