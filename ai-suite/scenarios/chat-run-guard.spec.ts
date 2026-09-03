import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, openAiChat, sendAiChatMessage } from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'

test('chat lets the model recover from repeated tool calls without a client-imposed cap', async ({
	earthly,
}) => {
	const provider = await installDeterministicChatProvider(earthly, 'repeated-tool-error')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await openAiChat(earthly)

	await sendAiChatMessage(earthly, 'Research the same missing fixture for me')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(
		panel.getByText(
			'I recovered after three repeated tool errors without Earthly interrupting the run.',
			{ exact: true },
		),
	).toBeVisible({ timeout: 15_000 })
	await expect(panel.getByRole('button', { name: 'Continue', exact: true })).not.toBeVisible()

	const requests = provider.requests()
	expect(requests).toHaveLength(4)
	const advertisedToolNames = requests[0]?.toolNames ?? []
	// The live MCP manifest may add/remove tools. Guard the capabilities this
	// scenario relies on and list stability across retries, not an arbitrary count.
	expect(advertisedToolNames).toEqual(
		expect.arrayContaining([
			'run_code',
			'route_over_network',
			'web_search',
			'add_feature_callouts',
			'write_story_draft',
		]),
	)
	expect(
		requests.every((request) => request.toolNames.join('\n') === advertisedToolNames.join('\n')),
	).toBe(true)
	expect(requests[0]?.hasLoopRecoveryInstruction).toBe(false)
	expect(requests[1]?.hasLoopRecoveryInstruction).toBe(false)
	expect(requests[2]?.hasLoopRecoveryInstruction).toBe(true)
	expect(requests[0]?.systemPromptChars ?? 0).toBeGreaterThan(0)
	expect(requests[0]?.toolSchemaChars ?? 0).toBeGreaterThan(0)

	const usage = panel.getByRole('button', { name: 'Chat usage details', exact: true })
	await usage.click()
	await expect(panel.getByText('Guard stop', { exact: true })).not.toBeVisible()
})
