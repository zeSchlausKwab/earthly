import { expect } from '@playwright/test'
import type { AiSuiteChatSettings } from '../../core/chat-provider-settings'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from '../navigation/open-panel'

export const configureChatProviderTask: AiTaskMetadata = {
	id: 'chat.configure-provider',
	summary: 'Import an OpenAI-compatible chat-provider snapshot through Earthly settings.',
	preconditions: [
		'Signed-in local identity',
		'Provider endpoint is controlled or explicitly opted in',
	],
	sideEffects: ['Encrypts the provider snapshot to the active local test identity'],
	viewports: 'both',
}

export const openAiChatTask: AiTaskMetadata = {
	id: 'chat.open',
	summary: 'Open AI chat and wait until the configured model can accept a message.',
	preconditions: ['Earthly is open', 'A provider and model are configured'],
	sideEffects: ['Opens the assistant surface'],
	viewports: 'both',
}

export const sendAiChatMessageTask: AiTaskMetadata = {
	id: 'chat.send-message',
	summary: 'Send a user-visible prompt through the Earthly AI chat composer.',
	preconditions: ['AI chat is open', 'The configured model is available'],
	sideEffects: ['Adds a user message and starts a model request'],
	viewports: 'both',
}

export const startNewAiChatTask: AiTaskMetadata = {
	id: 'chat.start-new',
	summary: 'Start a distinct empty AI conversation while leaving the current Earthly task intact.',
	preconditions: ['AI chat is open'],
	sideEffects: ['Creates and selects a new local chat session'],
	viewports: 'both',
}

export const approveAiEditTask: AiTaskMetadata = {
	id: 'chat.approve-edit',
	summary: 'Approve a pending AI-proposed editor diff through its visible inline gate.',
	preconditions: ['AI chat shows a pending edit proposal'],
	sideEffects: ['Applies the proposed change to the canonical editor'],
	viewports: 'both',
}

export async function configureChatProvider(
	earthly: EarthlySession,
	settings: AiSuiteChatSettings,
): Promise<void> {
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const importField = earthly.page.getByPlaceholder('{ "provider": "lmstudio", ... }')
	await expect(importField).toBeVisible()
	await importField.fill(JSON.stringify(settings))
	await earthly.page.getByRole('button', { name: 'Import settings', exact: true }).click()
	await expect(earthly.page.getByText('Settings imported', { exact: true })).toBeVisible()
	await expect(importField).toHaveValue('')
	await expect(earthly.page.locator('#chat-provider-select')).toHaveValue(settings.provider)
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Object.keys(localStorage).some((key) => key.startsWith('earthly.chat-settings.v1.')),
			),
		)
		.toBe(true)
}

export async function openAiChat(earthly: EarthlySession): Promise<void> {
	const composer = earthly.page.getByPlaceholder('Type a message...')
	if (earthly.isMobile) {
		const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
		if (!(await drawer.isVisible()) || !(await composer.isVisible())) {
			if (!(await drawer.isVisible())) {
				await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
			}
			await drawer.getByRole('button', { name: /^AI chat(?:\s|$)/ }).click()
		}
		await expect(drawer).toBeVisible()
	} else {
		const showChat = earthly.page.getByRole('button', { name: 'Show AI chat', exact: true })
		if (await showChat.isVisible()) {
			await showChat.click()
		}
		await expect(
			earthly.page.getByRole('button', { name: 'Hide AI chat', exact: true }),
		).toBeVisible()
	}
	await expect(composer).toBeEnabled({ timeout: 15_000 })
}

export type AiChatSendOutcome = 'chat-visible' | 'chat-replaced-by-editor'

export interface NewAiChatResult {
	previousChatId: string
	newChatId: string
}

export async function startNewAiChat(earthly: EarthlySession): Promise<NewAiChatResult> {
	const chatSelector = earthly.page.getByRole('combobox', {
		name: 'Select conversation',
		exact: true,
	})
	const composer = earthly.page.getByPlaceholder('Type a message...')
	await expect(chatSelector).toBeEnabled()
	const previousChatId = await chatSelector.inputValue()
	await earthly.page.getByRole('button', { name: 'New conversation', exact: true }).click()
	await expect.poll(() => chatSelector.inputValue()).not.toBe(previousChatId)
	await expect(composer).toHaveValue('')
	return { previousChatId, newChatId: await chatSelector.inputValue() }
}

export async function sendAiChatMessage(
	earthly: EarthlySession,
	prompt: string,
): Promise<AiChatSendOutcome> {
	const composer = earthly.page.getByPlaceholder('Type a message...')
	await composer.fill(prompt)
	await composer.press('Enter')
	const visiblePrompt = earthly.page.getByText(prompt, { exact: true })
	const workspaceChip = earthly.page.getByText('Untitled draft', { exact: true }).first()
	const stopEditing = earthly.page.getByRole('button', { name: 'Stop editing', exact: true })
	const readOutcome = async (): Promise<AiChatSendOutcome | 'pending'> => {
		if (await visiblePrompt.isVisible()) return 'chat-visible'
		if (await stopEditing.isVisible()) return 'chat-replaced-by-editor'
		if ((await workspaceChip.isVisible()) && (await composer.inputValue()) === '') {
			return 'chat-replaced-by-editor'
		}
		return 'pending'
	}
	await expect.poll(readOutcome).not.toBe('pending')
	return (await readOutcome()) as AiChatSendOutcome
}

export async function approveAiEdit(earthly: EarthlySession): Promise<void> {
	const apply = earthly.page.getByRole('button', { name: 'Apply', exact: true })
	if (!(await apply.isVisible())) {
		const showDetails = earthly.page.getByText('Show details', { exact: true }).last()
		if (await showDetails.isVisible()) await showDetails.click()
	}
	await expect(apply).toBeVisible({ timeout: 15_000 })
	await apply.click()
	// Multi-tool runs may collapse their raw result cards after approval. The
	// status remains in the DOM for transcript fidelity even when it is hidden
	// inside the operation disclosure, while the actionable Apply control is gone.
	await expect(apply).toBeHidden()
	await expect(earthly.page.getByText('Applied', { exact: true })).toHaveCount(1)
}

export async function hideAiChat(earthly: EarthlySession): Promise<void> {
	if (earthly.isMobile) {
		const drawer = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
		await drawer.getByRole('button', { name: 'Close AI chat', exact: true }).click()
		await expect(drawer).toBeHidden()
		return
	}
	await earthly.page.getByRole('button', { name: 'Hide AI chat', exact: true }).click()
	await expect(
		earthly.page.getByRole('button', { name: 'Show AI chat', exact: true }),
	).toBeVisible()
}
