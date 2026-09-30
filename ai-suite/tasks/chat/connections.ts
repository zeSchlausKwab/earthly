import { expect } from '@playwright/test'
import { isLoopbackURL } from '../../core/environment'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from '../navigation/open-panel'

export const addChatConnectionTask: AiTaskMetadata = {
	id: 'chat.add-connection',
	summary: 'Add and select a named connection through chat settings using a loopback provider.',
	preconditions: ['Signed-in local test identity', 'Loopback provider and isolated relays'],
	sideEffects: ['Encrypts and publishes connection settings for the test identity'],
	viewports: 'both',
}

export async function addChatConnection(
	earthly: EarthlySession,
	connection: {
		presetId: string
		name: string
		baseUrl: string
		apiKey: string
		expectedPresetEndpoint?: string
	},
): Promise<void> {
	if (!isLoopbackURL(connection.baseUrl))
		throw new Error('Connection tasks require a loopback provider')
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat', exact: true })
	if (!(await panel.isVisible())) {
		await openPanel(earthly, 'Settings')
		await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	}
	await panel.getByRole('button', { name: 'New connection', exact: true }).click()
	await panel.getByLabel('Provider', { exact: true }).selectOption(connection.presetId)
	if (connection.expectedPresetEndpoint)
		await expect(panel.getByLabel('Endpoint', { exact: true })).toHaveValue(
			connection.expectedPresetEndpoint,
		)
	await panel.getByLabel('Connection name', { exact: true }).fill(connection.name)
	await panel.getByLabel('Endpoint', { exact: true }).fill(connection.baseUrl)
	await panel.getByLabel('API key', { exact: true }).fill(connection.apiKey)
	await panel.getByRole('button', { name: 'Add connection', exact: true }).click()
	await expect(
		panel.getByLabel('Connection', { exact: true }).locator('option:checked'),
	).toHaveText(connection.name)
}
