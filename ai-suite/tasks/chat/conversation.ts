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
	summary: 'Open AI chat and wait until the configured model and composer are ready.',
	preconditions: ['Earthly is open', 'A provider and model are configured'],
	sideEffects: ['Opens the assistant surface'],
	viewports: 'both',
}

export const sendAiChatMessageTask: AiTaskMetadata = {
	id: 'chat.send-message',
	summary: 'Send a user-visible prompt through the Earthly AI chat composer.',
	preconditions: [
		'AI chat is open',
		'The configured model is available',
		'The conversation has an explicit Dataset editing target',
	],
	sideEffects: ['Adds a user message and starts a model request'],
	viewports: 'both',
}

export const composeAiChatMessageTask: AiTaskMetadata = {
	id: 'chat.compose-message',
	summary: 'Type a prompt into the AI chat composer without dispatching it.',
	preconditions: ['AI chat is open', 'The configured model is available'],
	sideEffects: ['Updates the active conversation composer draft'],
	viewports: 'both',
}

export const attemptTargetRequiredAiChatSendTask: AiTaskMetadata = {
	id: 'chat.attempt-target-required-send',
	summary: 'Attempt to send a composed prompt while the conversation still requires a target.',
	preconditions: ['AI chat is open', 'A prompt is composed', 'No authoring target is selected'],
	sideEffects: ['None; the prompt remains in the composer and no user turn is added'],
	viewports: 'both',
}

export const switchAiChatTask: AiTaskMetadata = {
	id: 'chat.switch',
	summary: 'Switch to an existing AI conversation without changing its authoring target.',
	preconditions: ['AI chat is open', 'The target conversation exists'],
	sideEffects: ['Selects a different local chat session'],
	viewports: 'both',
}

export const waitForAiChatCompletionTask: AiTaskMetadata = {
	id: 'chat.wait-for-completion',
	summary: 'Wait for the current AI turn to finish and leave its final answer visible.',
	preconditions: ['An AI chat turn is in progress'],
	sideEffects: ['Scrolls the final assistant answer into view'],
	viewports: 'both',
}

export const completeAiChatTurnTask: AiTaskMetadata = {
	id: 'chat.complete-turn',
	summary: 'Finish an AI turn while approving only the explicitly allowed interactive gates.',
	preconditions: ['An AI chat turn is in progress'],
	sideEffects: ['May apply repeated editor diffs or publish a referenced Dataset version'],
	viewports: 'both',
}

export const selectAiChatTargetTask: AiTaskMetadata = {
	id: 'chat.select-target',
	summary: 'Explicitly bind a conversation to a new or currently visible Dataset edit.',
	preconditions: ['AI chat is open'],
	sideEffects: ['May create a local Dataset draft or bind the conversation to the visible edit'],
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

function chatRegion(earthly: EarthlySession) {
	return earthly.page.getByRole('region', { name: 'AI chat', exact: true })
}

function chatComposer(earthly: EarthlySession) {
	return chatRegion(earthly).locator('textarea')
}

function chatSelector(earthly: EarthlySession) {
	return chatRegion(earthly).getByRole('combobox', {
		name: 'Select conversation',
		exact: true,
	})
}

function chatSendButton(earthly: EarthlySession) {
	return chatComposer(earthly).locator('xpath=ancestor::form').locator('button[type="submit"]')
}

function targetRequiredLabel(earthly: EarthlySession) {
	return chatRegion(earthly)
		.getByText(/^(?:Editing target required|Target required)$/)
		.first()
}

function openTargetButton(earthly: EarthlySession) {
	return chatRegion(earthly)
		.getByRole('button', { name: /^Open .+ in geometry editor$/ })
		.first()
}

async function boundTargetName(earthly: EarthlySession): Promise<string | null> {
	const openTarget = openTargetButton(earthly)
	if (!(await openTarget.isVisible())) return null
	const label = await openTarget.getAttribute('aria-label')
	return label?.match(/^Open (.+) in geometry editor$/)?.[1] ?? null
}

export interface AiChatSurfaceSnapshot {
	chatId: string
	prompt: string
	sendEnabled: boolean
	targetRequired: boolean
	targetName: string | null
	userMessageCount: number
}

/** Read the user-visible Chat identity/composer state without reaching into app stores. */
export async function aiChatSurfaceSnapshot(
	earthly: EarthlySession,
): Promise<AiChatSurfaceSnapshot> {
	return {
		chatId: await chatSelector(earthly).inputValue(),
		prompt: await chatComposer(earthly).inputValue(),
		sendEnabled: await chatSendButton(earthly).isEnabled(),
		targetRequired: await targetRequiredLabel(earthly).isVisible(),
		targetName: await boundTargetName(earthly),
		userMessageCount: await chatRegion(earthly).getByTitle('Copy user message').count(),
	}
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
	const panel = chatRegion(earthly)
	const composer = chatComposer(earthly)
	if (earthly.isMobile) {
		const navigation = earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
		if (!(await panel.isVisible())) {
			if (!(await navigation.isVisible())) {
				await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
			}
			await navigation.getByRole('button', { name: /^AI chat(?:\s|$)/ }).click()
		}
		await expect(
			earthly.page.getByRole('dialog', { name: 'AI chat panel', exact: true }),
		).toBeVisible()
	} else {
		if (!(await panel.isVisible())) {
			const assistant = earthly.page.locator('[data-tour="assistant-sidebar"]')
			const side = await assistant.getAttribute('data-side')
			if (side === 'left') {
				await earthly.page
					.getByRole('button', {
						name: /^(?:Show AI chat on the left|AI chat is working; show it on the left)$/,
					})
					.click()
			} else {
				await earthly.page
					.getByRole('button', {
						name: /^(?:Show AI chat on the right|AI chat is working; show it on the right)$/,
					})
					.click()
			}
		}
	}
	await expect(panel).toBeVisible()
	await expect(composer).toBeEnabled({ timeout: 15_000 })
}

export type AiChatSendOutcome = 'chat-visible'

export interface NewAiChatResult {
	previousChatId: string
	newChatId: string
}

export type AiChatTarget = 'new-dataset' | 'current-dataset'

export async function selectAiChatTarget(
	earthly: EarthlySession,
	target: AiChatTarget,
): Promise<string> {
	const panel = chatRegion(earthly)
	const action = panel.getByRole('button', {
		name: target === 'new-dataset' ? 'New map' : /^Use current(?: edit)?$/,
		exact: target === 'new-dataset',
	})
	await expect(action).toBeVisible()
	await action.click()
	await expect(openTargetButton(earthly)).toBeVisible()
	await expect(targetRequiredLabel(earthly)).toBeHidden()
	const targetName = await boundTargetName(earthly)
	if (!targetName) throw new Error('The selected Chat Dataset target has no accessible name.')
	return targetName
}

export async function startNewAiChat(earthly: EarthlySession): Promise<NewAiChatResult> {
	const panel = chatRegion(earthly)
	const selector = chatSelector(earthly)
	const composer = chatComposer(earthly)
	await expect(selector).toBeEnabled()
	const previousChatId = await selector.inputValue()
	await panel.getByRole('button', { name: 'New conversation', exact: true }).click()
	await expect.poll(() => selector.inputValue()).not.toBe(previousChatId)
	await expect(composer).toHaveValue('')
	await expect(targetRequiredLabel(earthly)).toBeVisible()
	return { previousChatId, newChatId: await selector.inputValue() }
}

export async function switchAiChat(earthly: EarthlySession, chatId: string): Promise<void> {
	const selector = chatSelector(earthly)
	await expect(selector).toBeEnabled()
	await selector.selectOption(chatId)
	await expect(selector).toHaveValue(chatId)
}

export async function composeAiChatMessage(
	earthly: EarthlySession,
	prompt: string,
	options: { typingDelayMs?: number } = {},
): Promise<void> {
	const composer = chatComposer(earthly)
	if (options.typingDelayMs && options.typingDelayMs > 0) {
		await composer.fill('')
		await composer.pressSequentially(prompt, { delay: options.typingDelayMs })
	} else {
		await composer.fill(prompt)
	}
	await expect(composer).toHaveValue(prompt)
}

/**
 * Exercise Enter while the active conversation has no target. The task owns
 * the composer/transcript selectors; the scenario separately proves no model
 * request crossed the deterministic provider boundary.
 */
export async function attemptTargetRequiredAiChatSend(earthly: EarthlySession): Promise<void> {
	const before = await aiChatSurfaceSnapshot(earthly)
	if (!before.prompt) throw new Error('Compose a prompt before attempting a target-required send.')
	await expect(targetRequiredLabel(earthly)).toBeVisible()
	await expect(chatSendButton(earthly)).toBeDisabled()
	await chatComposer(earthly).press('Enter')
	await expect(chatComposer(earthly)).toHaveValue(before.prompt)
	await expect(chatRegion(earthly).getByTitle('Copy user message')).toHaveCount(
		before.userMessageCount,
	)
}

export async function dispatchComposedAiChatMessage(
	earthly: EarthlySession,
): Promise<AiChatSendOutcome> {
	const panel = chatRegion(earthly)
	const composer = chatComposer(earthly)
	const prompt = await composer.inputValue()
	if (!prompt.trim()) throw new Error('Compose a prompt before dispatching it.')
	const userMessages = panel.getByTitle('Copy user message')
	const userMessageCountBefore = await userMessages.count()
	await expect(chatSendButton(earthly)).toBeEnabled()
	await composer.press('Enter')
	await expect.poll(() => userMessages.count()).toBeGreaterThan(userMessageCountBefore)
	await expect(userMessages.last()).toBeVisible()
	await expect(composer).toHaveValue('')
	return 'chat-visible'
}

export async function sendAiChatMessage(
	earthly: EarthlySession,
	prompt: string,
	options: { typingDelayMs?: number } = {},
): Promise<AiChatSendOutcome> {
	await composeAiChatMessage(earthly, prompt, options)
	return dispatchComposedAiChatMessage(earthly)
}

export async function waitForAiChatCompletion(
	earthly: EarthlySession,
	assistantMessageCountBefore: number,
	options: { timeoutMs?: number } = {},
): Promise<void> {
	const timeout = options.timeoutMs ?? 150_000
	const assistantMessages = chatRegion(earthly).getByTitle('Copy assistant message')
	const composer = chatComposer(earthly)

	await expect
		.poll(() => assistantMessages.count(), { timeout })
		.toBeGreaterThan(assistantMessageCountBefore)
	await expect(composer).toBeEnabled({ timeout })
	await assistantMessages.last().scrollIntoViewIfNeeded()
}

export async function approveAiEdit(
	earthly: EarthlySession,
	options: { timeoutMs?: number } = {},
): Promise<void> {
	const panel = chatRegion(earthly)
	const apply = panel.getByRole('button', { name: 'Apply', exact: true }).last()
	if (!(await apply.isVisible())) {
		const showDetails = panel.getByText('Show details', { exact: true }).last()
		if (await showDetails.isVisible()) await showDetails.click()
	}
	await expect(apply).toBeVisible({ timeout: options.timeoutMs ?? 15_000 })
	const appliedStatuses = panel.getByText('Applied', { exact: true })
	const appliedCountBefore = await appliedStatuses.count()
	await apply.click()
	await expect.poll(() => appliedStatuses.count()).toBeGreaterThan(appliedCountBefore)
}

export type AiChatApprovalKind = 'edits' | 'reference-publish'

type TurnCheckpoint = 'waiting' | 'edit-gate' | 'reference-publish-gate' | 'complete'

async function approveDatasetReferencePublish(
	earthly: EarthlySession,
	timeoutMs: number,
): Promise<void> {
	const dialog = earthly.page.getByRole('alertdialog')
	await expect(dialog).toContainText('Publish changes to reference this Dataset?', {
		timeout: timeoutMs,
	})
	await dialog.getByRole('button', { name: 'Publish and continue', exact: true }).click()

	let result: 'waiting' | 'complete' | `error:${string}` = 'waiting'
	await expect
		.poll(
			async () => {
				if (!(await dialog.isVisible())) {
					result = 'complete'
					return result
				}
				const alert = dialog.getByRole('alert')
				if (await alert.isVisible()) {
					result = `error:${(await alert.textContent())?.trim() || 'Dataset publication failed.'}`
					return result
				}
				result = 'waiting'
				return result
			},
			{ timeout: timeoutMs },
		)
		.not.toBe('waiting')
	if (result.startsWith('error:')) throw new Error(result.slice('error:'.length))
}

/**
 * Finish one turn without guessing at consequential UI. Every listed approval
 * must appear at least once; repeated gates of that kind are handled until the
 * owning conversation reaches its final assistant answer.
 */
export async function completeAiChatTurn(
	earthly: EarthlySession,
	assistantMessageCountBefore: number,
	options: { approvals?: readonly AiChatApprovalKind[]; timeoutMs?: number } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 150_000
	const deadline = Date.now() + timeoutMs
	const requiredApprovals = new Set(options.approvals ?? [])
	const observedApprovals = new Set<AiChatApprovalKind>()
	const panel = chatRegion(earthly)
	const composer = chatComposer(earthly)
	const assistantMessages = panel.getByTitle('Copy assistant message')
	const apply = panel.getByRole('button', { name: 'Apply', exact: true })
	const referencePublish = earthly.page.getByRole('button', {
		name: 'Publish and continue',
		exact: true,
	})
	const remaining = () => Math.max(1, deadline - Date.now())

	for (;;) {
		const observed: { checkpoint: TurnCheckpoint } = { checkpoint: 'waiting' }
		await expect
			.poll(
				async () => {
					if (await apply.last().isVisible()) observed.checkpoint = 'edit-gate'
					else if (await referencePublish.isVisible()) {
						observed.checkpoint = 'reference-publish-gate'
					} else if (
						(await assistantMessages.count()) > assistantMessageCountBefore &&
						(await composer.isEnabled())
					) {
						observed.checkpoint = 'complete'
					} else observed.checkpoint = 'waiting'
					return observed.checkpoint
				},
				{ timeout: remaining() },
			)
			.not.toBe('waiting')

		if (observed.checkpoint === 'edit-gate') {
			if (!requiredApprovals.has('edits')) {
				throw new Error('The turn requested an edit approval not allowed by this approval policy.')
			}
			observedApprovals.add('edits')
			await approveAiEdit(earthly, { timeoutMs: remaining() })
			continue
		}
		if (observed.checkpoint === 'reference-publish-gate') {
			if (!requiredApprovals.has('reference-publish')) {
				throw new Error(
					'The turn requested Dataset publication not allowed by this approval policy.',
				)
			}
			observedApprovals.add('reference-publish')
			await approveDatasetReferencePublish(earthly, remaining())
			continue
		}

		const missing = [...requiredApprovals].filter((kind) => !observedApprovals.has(kind))
		if (missing.length > 0) {
			throw new Error(`Expected approval gate(s) did not appear: ${missing.join(', ')}.`)
		}
		await assistantMessages.last().scrollIntoViewIfNeeded()
		return
	}
}

export async function hideAiChat(earthly: EarthlySession): Promise<void> {
	const panel = chatRegion(earthly)
	if (!(await panel.isVisible())) return
	if (earthly.isMobile) {
		const chatPanel = earthly.page.getByRole('dialog', { name: 'AI chat panel', exact: true })
		await chatPanel.getByRole('button', { name: 'Close AI chat', exact: true }).click()
		await expect(chatPanel).toBeHidden()
		return
	}
	const assistant = earthly.page.locator('[data-tour="assistant-sidebar"]')
	if ((await assistant.getAttribute('data-side')) === 'left') {
		await earthly.page.getByRole('button', { name: 'Hide AI chat', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Hide AI chat', exact: true }).click()
	}
	await expect(panel).toBeHidden()
}
