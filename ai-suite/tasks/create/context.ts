import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from '../navigation/open-panel'

export interface ContextInput {
	name: string
	description: string
}

export const createContextTask: AiTaskMetadata = {
	id: 'create.context',
	summary: 'Create and publish an Atlas through the Atlases navigation.',
	preconditions: ['Signed-in local development persona', 'Earthly is open'],
	sideEffects: ['Publishes a Context event to the local development relay'],
	viewports: 'both',
}

export async function createContext(earthly: EarthlySession, input: ContextInput): Promise<void> {
	await openPanel(earthly, 'Atlases')
	await earthly.page.getByRole('button', { name: 'New Atlas', exact: true }).click()
	await expect(
		earthly.page.getByRole('heading', { name: 'Create Atlas', exact: true }),
	).toBeVisible()
	await earthly.page.getByPlaceholder('Roman ruins in Carinthia').fill(input.name)
	const editor = earthly.page.locator('.ProseMirror[contenteditable="true"]:visible').first()
	await editor.fill(input.description)
	await earthly.page.getByRole('button', { name: 'Create Atlas', exact: true }).click()
	await expect(
		earthly.page.getByRole('heading', { name: 'Create Atlas', exact: true }),
	).toBeHidden()
	if (earthly.isMobile) {
		await openPanel(earthly, 'Atlases')
	}
	await expect(earthly.page.getByText(input.name, { exact: true }).first()).toBeVisible()
}
