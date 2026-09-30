import { startDataset } from '../tasks/create/dataset'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, openAiChat, sendAiChatMessage } from '../tasks/chat/conversation'
import { setThreadWorkingSetOpen, threadWorkSnapshot } from '../tasks/chat/working-set'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('thinking/tool rounds keep one Map, obey Auto apply, and show progress through reload @regression', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'chat-reliability', {
		holdCompletionResponses: true,
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	await earthly.open({ tour: 'seen' })
	if (earthly.isMobile) await startDataset(earthly)
	await openAiChat(earthly)
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByLabel('Create new maps and stories', { exact: true }).check()
	await setThreadWorkingSetOpen(earthly, false)
	await sendAiChatMessage(earthly, 'Draw one map and improve its geometry and styling.')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const progress = panel.getByRole('status', { name: 'Chat progress' })
	await expect(progress).toHaveText('Waiting for model response')
	provider.releaseCompletionResponses()
	await expect(
		panel.getByText('Finished the same map, including its styling.', { exact: true }),
	).toBeVisible({ timeout: 30_000 })
	await expect(progress).toHaveText('Finished')
	expect(provider.requests()).toHaveLength(7)
	expect(provider.requests().every((r) => r.reasoningIntact && r.toolErrors === 0)).toBe(true)
	expect(
		provider
			.requests()
			.slice(1)
			.every((r) => r.workingTargetRetained),
	).toBe(true)
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(1)
	await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0)
	// Completed diffs stay inside the collapsed action history.
	await expect(panel.getByText('Applied', { exact: true }).first()).not.toBeVisible()
	await panel.getByText('Show details', { exact: true }).click()
	await expect(panel.getByText('~2 restyled', { exact: true })).toBeVisible()
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(progress).toHaveText('Finished')
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(1)
	// The persisted provider reasoning remains valid after reload and a new user turn.
	await sendAiChatMessage(earthly, 'Summarize the map.')
	await expect(progress).toHaveText('Finished')
	expect(provider.requests().at(-1)?.reasoningIntact).toBe(true)
})

test('reasoning-only empty replies leave a visible failure after reload @regression', async ({
	earthly,
}) => {
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'empty-reasoning')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	if (earthly.isMobile) await startDataset(earthly)
	await openAiChat(earthly)
	await sendAiChatMessage(earthly, 'Explain this map.')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel.getByRole('status', { name: 'Chat progress' })).toContainText(
		'Response failed',
	)
	await expect(panel.getByRole('alert')).toContainText('empty response')
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(panel.getByRole('status', { name: 'Chat progress' })).toContainText(
		'Response failed',
	)
	await expect(panel.getByRole('alert')).toContainText('empty response')
})
