import { expect } from '@playwright/test'
import type { AiSuiteChatSettings } from '../../core/chat-provider-settings'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from '../navigation/open-panel'
import { switchMobileWorkspacePanel } from '../navigation/mobile-workspace'
import { startDataset } from '../create/dataset'
import { setThreadWorkingSetOpen, threadWorkSnapshot } from './working-set'

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
	summary: 'Open the current work Thread and wait until its model and composer are ready.',
	preconditions: ['Earthly is open', 'A provider and model are configured'],
	sideEffects: ['Opens the retained Thread surface without changing write permissions'],
	viewports: 'both',
}

export const setAiThreadSettingsOpenTask: AiTaskMetadata = {
	id: 'chat.set-settings-open',
	summary: 'Expand or collapse Thread settings without changing its conversation or composer.',
	preconditions: ['AI Thread is visible'],
	sideEffects: ['Changes only the local settings disclosure'],
	viewports: 'both',
}

export const sendAiChatMessageTask: AiTaskMetadata = {
	id: 'chat.send-message',
	summary: 'Send a user-visible prompt through the Earthly AI chat composer.',
	preconditions: ['AI chat is open', 'The configured model is available'],
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
	sideEffects: [
		'May apply repeated editor diffs, create a Story edit target, or publish a referenced Dataset version',
	],
	viewports: 'both',
}

export const selectAiChatTargetTask: AiTaskMetadata = {
	id: 'chat.select-target',
	summary: 'Explicitly add a new or currently visible Map working copy to a Thread.',
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
	return earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
}

/** Read only the persisted authoring identity behind the selected Thread. */
export function persistedThreadSnapshot(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const stored = JSON.parse(localStorage.getItem('chat-store') ?? '{}') as {
			state?: {
				activeChatId?: string
				chatSessions?: Array<{
					id: string
					threadKey: string | null
					targetWorkspaceId: string | null
				}>
			}
		}
		const active = stored.state?.chatSessions?.find(
			(chat) => chat.id === stored.state?.activeChatId,
		)
		return active
			? { id: active.id, threadKey: active.threadKey, targetWorkspaceId: active.targetWorkspaceId }
			: null
	})
}

function chatComposer(earthly: EarthlySession) {
	return chatRegion(earthly).locator('textarea')
}

function chatSelector(earthly: EarthlySession) {
	return chatRegion(earthly).getByRole('combobox', {
		name: 'Select work Thread',
		exact: true,
	})
}

function chatSendButton(earthly: EarthlySession) {
	return chatComposer(earthly).locator('xpath=ancestor::form').locator('button[type="submit"]')
}

export interface AiChatSurfaceSnapshot {
	chatId: string
	prompt: string
	sendEnabled: boolean
	targetRequired: boolean
	targetName: string | null
	userMessageCount: number
}

/** Read composer state plus the persisted Thread's authoring identity, never credentials. */
export async function aiChatSurfaceSnapshot(
	earthly: EarthlySession,
): Promise<AiChatSurfaceSnapshot> {
	// During a run the composer intentionally replaces its submit button with
	// Stop. evaluateAll receives an empty array immediately in that state instead
	// of waiting for a submit locator that cannot appear until the run finishes.
	const sendEnabled = await chatSendButton(earthly).evaluateAll((buttons) =>
		buttons.some((button) => {
			if (!(button instanceof HTMLButtonElement) || button.disabled) return false
			const style = getComputedStyle(button)
			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				button.getClientRects().length > 0
			)
		}),
	)
	const work = await threadWorkSnapshot(earthly)
	return {
		chatId: work.id,
		prompt: await chatComposer(earthly).inputValue(),
		sendEnabled,
		targetRequired: false,
		targetName: work.outputs.find((item) => item.kind === 'dataset')?.title ?? null,
		userMessageCount: await chatRegion(earthly).getByTitle('Copy user message').count(),
	}
}

export async function configureChatProvider(
	earthly: EarthlySession,
	settings: AiSuiteChatSettings,
): Promise<void> {
	await openPanel(earthly, 'Settings')
	const settingsSurface = earthly.isMobile
		? earthly.page.getByRole('dialog', { name: 'Earthly navigation' })
		: earthly.page.getByRole('complementary', { name: 'Margin' })
	await settingsSurface.getByRole('tab', { name: 'Chat', exact: true }).click()
	const importField = settingsSurface.getByPlaceholder('{ "provider": "lmstudio", ... }')
	await expect(importField).toBeVisible()
	await importField.fill(JSON.stringify(settings))
	await settingsSurface.getByRole('button', { name: 'Import settings', exact: true }).click()
	await expect(earthly.page.getByText('Settings imported', { exact: true })).toBeVisible()
	await expect(importField).toHaveValue('')
	await expect(settingsSurface.locator('#chat-provider-select')).toHaveValue(settings.provider)
	await expect
		.poll(() =>
			earthly.page.evaluate(async (expected) => {
				// The envelope may already contain defaults. Wait for this import's
				// debounced encrypted save, not just for any storage key to exist.
				// Return only a boolean; never put decrypted credentials in diagnostics.
				const signer = (
					window as unknown as {
						nostr: {
							getPublicKey(): Promise<string>
							nip44?: { decrypt(pubkey: string, ciphertext: string): Promise<string> }
							nip04?: { decrypt(pubkey: string, ciphertext: string): Promise<string> }
						}
					}
				).nostr
				try {
					const pubkey = await signer.getPublicKey()
					const raw = localStorage.getItem(`earthly.chat-settings.v1.${pubkey}`)
					if (!raw) return false
					const envelope = JSON.parse(raw) as { scheme: 'nip04' | 'nip44'; ciphertext: string }
					const cipher = signer[envelope.scheme]
					if (!cipher) return false
					const saved = JSON.parse(await cipher.decrypt(pubkey, envelope.ciphertext)) as Record<
						string,
						unknown
					>
					return Object.entries(expected).every(
						([key, value]) => JSON.stringify(saved[key]) === JSON.stringify(value),
					)
				} catch {
					return false
				}
			}, settings),
		)
		.toBe(true)
}

export async function openAiChat(earthly: EarthlySession): Promise<void> {
	const panel = chatRegion(earthly)
	const composer = chatComposer(earthly)
	if (earthly.isMobile) {
		if (!(await panel.isVisible())) {
			await switchMobileWorkspacePanel(earthly, 'Chat')
		}
	} else {
		if (!(await panel.isVisible())) {
			await earthly.page
				.getByRole('button', {
					name: /^(?:Show Thread|Thread is working; show it)(?: on the right)?$/,
				})
				.click()
		}
	}
	await expect(panel).toBeVisible()
	await expect(composer).toBeEnabled({ timeout: 15_000 })
}

export async function setAiThreadSettingsOpen(earthly: EarthlySession, open = true): Promise<void> {
	const panel = chatRegion(earthly)
	const trigger = panel.getByRole('button', { name: 'Thread settings', exact: true })
	await expect(trigger).toBeVisible()
	if ((await trigger.getAttribute('aria-expanded')) !== String(open)) await trigger.click()
	await expect(trigger).toHaveAttribute('aria-expanded', String(open))
	const model = panel.getByRole('combobox', { name: 'Select chat model', exact: true })
	if (open) await expect(model).toBeVisible()
	else await expect(model).toBeHidden()
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
	if (target === 'new-dataset') await startDataset(earthly)
	await openAiChat(earthly)
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: 'Add Map working copy', exact: true }).click()
	await expect
		.poll(async () => (await threadWorkSnapshot(earthly)).outputs.length)
		.toBeGreaterThan(0)
	const output = (await threadWorkSnapshot(earthly)).outputs
		.filter((item) => item.kind === 'dataset')
		.at(-1)
	if (!output) throw new Error('The selected Map working copy was not added to the Thread.')
	await setThreadWorkingSetOpen(earthly, false)
	return output.title
}

export async function startNewAiChat(earthly: EarthlySession): Promise<NewAiChatResult> {
	const panel = chatRegion(earthly)
	const composer = chatComposer(earthly)
	const previousChatId = (await threadWorkSnapshot(earthly)).id
	await setThreadWorkingSetOpen(earthly)
	await panel.getByRole('button', { name: 'New Thread', exact: true }).click()
	await expect.poll(async () => (await threadWorkSnapshot(earthly)).id).not.toBe(previousChatId)
	await expect(composer).toHaveValue('')
	await expect(panel.locator('summary').filter({ hasText: 'Working on:' })).toContainText(
		'Read-only',
	)
	await setThreadWorkingSetOpen(earthly, false)
	return { previousChatId, newChatId: (await threadWorkSnapshot(earthly)).id }
}

export async function switchAiChat(earthly: EarthlySession, chatId: string): Promise<void> {
	await setThreadWorkingSetOpen(earthly)
	const selector = chatSelector(earthly)
	await expect(selector).toBeEnabled()
	await selector.selectOption(chatId)
	await expect(selector).toHaveValue(chatId)
	await setThreadWorkingSetOpen(earthly, false)
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

export async function dispatchComposedAiChatMessage(
	earthly: EarthlySession,
): Promise<AiChatSendOutcome> {
	const composer = chatComposer(earthly)
	const prompt = await composer.inputValue()
	if (!prompt.trim()) throw new Error('Compose a prompt before dispatching it.')
	// A tool may synchronously open an approval dialog after the send. Radix then
	// hides the underlying Chat region from the accessibility tree even though
	// its submitted user turn remains in the DOM. Keep this post-send assertion
	// anchored to the user-visible copy control without requiring the region to
	// remain accessibility-visible during that modal boundary.
	const userMessages = earthly.page.getByTitle('Copy user message')
	const userMessageCountBefore = await userMessages.count()
	await expect(chatSendButton(earthly)).toBeEnabled()
	await composer.press('Enter')
	await expect.poll(() => userMessages.count()).toBeGreaterThan(userMessageCountBefore)
	await expect(userMessages.last()).toBeVisible()
	await expect(
		earthly.page.locator('section[aria-label="AI Thread"] textarea:visible'),
	).toHaveValue('')
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

export type AiChatApprovalKind = 'edits' | 'reference-publish' | 'story-target'

type TurnCheckpoint =
	| 'waiting'
	| 'edit-gate'
	| 'reference-publish-gate'
	| 'story-target-gate'
	| 'complete'

async function approveStoryTarget(earthly: EarthlySession, timeoutMs: number): Promise<void> {
	const dialog = earthly.page.getByRole('alertdialog')
	const create = dialog.getByRole('button', {
		name: 'New Story and continue',
		exact: true,
	})
	await expect(create).toBeVisible({ timeout: timeoutMs })
	await create.click()
	await expect(dialog).toBeHidden({ timeout: timeoutMs })
}

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
	const storyTarget = earthly.page.getByRole('button', {
		name: 'New Story and continue',
		exact: true,
	})
	const remaining = () => Math.max(1, deadline - Date.now())

	for (;;) {
		const observed: { checkpoint: TurnCheckpoint } = { checkpoint: 'waiting' }
		await expect
			.poll(
				async () => {
					if (await apply.last().isVisible()) observed.checkpoint = 'edit-gate'
					else if (await storyTarget.isVisible()) observed.checkpoint = 'story-target-gate'
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
		if (observed.checkpoint === 'story-target-gate') {
			if (!requiredApprovals.has('story-target')) {
				throw new Error('The turn requested a Story target not allowed by this approval policy.')
			}
			observedApprovals.add('story-target')
			await approveStoryTarget(earthly, remaining())
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
	await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()
	await expect(panel).toBeHidden()
}
