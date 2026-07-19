import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import { expect, test } from '../../fixtures/earthly'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import {
	approveAiEdit,
	configureChatProvider,
	hideAiChat,
	openAiChat,
	sendAiChatMessage,
	startNewAiChat,
} from '../../tasks/chat/conversation'
import {
	expectGeometryFeatureCount,
	publishCurrentGeometryDataset,
} from '../../tasks/create/geometry'
import { createStoryDraft } from '../../tasks/create/story'
import { editorLifecycleSnapshot } from '../../tasks/editor/lifecycle'
import { openPanel } from '../../tasks/navigation/open-panel'
import { installDeterministicChatProvider } from '../../tasks/setup/deterministic-chat-provider'

const run: ScenarioRunDefinition = {
	id: 'conversational-spatial-research-desktop-baseline',
	personaId: 'spatial-data-analyst',
	journeyId: 'conversational-spatial-research',
	platform: 'desktop-web',
	connectivity: 'Controlled OpenAI-compatible model endpoint and local Earthly services.',
	publishChannel: 'public',
	startingState: [
		'Analyst is pre-authorized on desktop.',
		'No Dataset draft exists and AI edits require explicit confirmation.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'platform-parity'],
}

const prompt =
	'Find public drinking-water points around these trailheads and create 15-minute walking catchments. Keep the result editable and show me any proposed map changes before applying them.'

const unrelatedStory = {
	title: 'Notes for an unrelated coastal-risk review',
	summary: 'A separate research task started after the drinking-water analysis.',
	body: 'Collect source material about port exposure without changing the trailhead Dataset.',
}

test('an analyst turns a chat proposal into a canonical Dataset @experience-audit @ai-journey @journey-conversational-spatial-research', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Spatial research begins on the desktop surface')
	test.setTimeout(120_000)

	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	// Provider setup is fixture state, not part of the analyst's journey. Reloading
	// also proves that the encrypted snapshot can be decrypted by the test signer.
	await earthly.open({ tour: 'preserve' })
	await openAiChat(earthly)

	const recorder = new ExperienceRunRecorder(earthly, testInfo, run)
	let evidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
	try {
		await recorder.observe(
			'chat-ready',
			'The model, provider type, tool policy, safety posture, and empty composer are visible together.',
		)

		const sendOutcome = await sendAiChatMessage(earthly, prompt)
		expect(sendOutcome).toBe('chat-visible')
		await expect(earthly.page.getByText('write_geojson_to_editor', { exact: true })).toBeVisible({
			timeout: 15_000,
		})
		await expectGeometryFeatureCount(earthly, 0)
		await recorder.observe(
			'proposal-awaiting-review',
			'Tool intent and a four-feature diff are visible while the canonical editor is still unchanged.',
		)

		await approveAiEdit(earthly)
		await expectGeometryFeatureCount(earthly, 4)
		await expect(earthly.page.getByText('Geometries (4)', { exact: true })).toBeVisible()
		await earthly.page.getByRole('button', { name: 'Close map stack', exact: true }).click()
		await openPanel(earthly, 'Local drafts')
		await expect(earthly.page.getByText('Geometries (4)', { exact: true })).toBeHidden()
		await earthly.page.evaluate(() => {
			const store = (
				window as typeof window & {
					__earthlyEditorStore?: {
						getState(): { removeMapStackEntry(id: string): void }
					}
				}
			).__earthlyEditorStore
			if (!store) throw new Error('Earthly editor debug store is unavailable')
			store.getState().removeMapStackEntry('draft:active')
		})
		await earthly.page
			.getByRole('button', { name: 'Open Trailhead water catchments in geometry editor' })
			.click()
		await expect(earthly.page.getByText('Geometries (4)', { exact: true })).toBeVisible()
		expect(
			(await editorLifecycleSnapshot(earthly)).mapStack.some(
				(entry) => entry.id === 'draft:active',
			),
		).toBe(true)
		await expect(earthly.page.getByText(/I added two synthetic drinking-water points/)).toBeVisible(
			{ timeout: 15_000 },
		)
		await recorder.observe(
			'proposal-applied',
			'The accepted proposal exposes its four-item geometry list, and the chat target restores that editor after the analyst visits Local drafts.',
		)

		const requestRounds = provider.requests()
		expect(requestRounds).toHaveLength(2)
		expect(requestRounds[0]?.toolNames).toContain('write_geojson_to_editor')
		expect(requestRounds[0]?.toolNames).toContain('set_dataset_metadata')
		expect(requestRounds[1]?.messageRoles).toContain('tool')

		const publishedDatasetUrl = await publishCurrentGeometryDataset(earthly)
		await recorder.observe(
			'dataset-published',
			'The AI-assisted draft publishes through the same Dataset workflow as manual geometry.',
		)

		await hideAiChat(earthly)
		await expect(earthly.page.getByText('Dataset overview')).toBeVisible()
		await recorder.observe(
			'chat-left-result-retained',
			'Closing the assistant preserves the canonical Dataset inspector and map result.',
		)

		await openAiChat(earthly)
		const taskBeforeConversationChange = await editorLifecycleSnapshot(earthly)
		expect(taskBeforeConversationChange.activeWorkspaceChatSessionId).not.toBeNull()
		const chatTransition = await startNewAiChat(earthly)
		expect(chatTransition.newChatId).not.toBe(chatTransition.previousChatId)
		await expect(earthly.page.getByText(prompt, { exact: true })).toBeHidden()
		await expectGeometryFeatureCount(earthly, 4)
		const taskAfterConversationChange = await editorLifecycleSnapshot(earthly)
		expect(taskAfterConversationChange.activeWorkspaceId).toBe(
			taskBeforeConversationChange.activeWorkspaceId,
		)
		expect(taskAfterConversationChange.activeWorkspaceChatSessionId).toBe(
			taskBeforeConversationChange.activeWorkspaceChatSessionId,
		)
		await recorder.observe(
			'new-conversation-same-task',
			'New conversation clears the transcript without retargeting the saved Dataset task or changing its geometry.',
		)

		await hideAiChat(earthly)
		await createStoryDraft(earthly, unrelatedStory)
		await expect(earthly.page.getByLabel('Title')).toHaveValue(unrelatedStory.title)
		await expectGeometryFeatureCount(earthly, 0)
		const parkedState = await editorLifecycleSnapshot(earthly)
		expect(parkedState.activeDraftId).toBeNull()
		expect(parkedState.activeWorkspaceId).toBeNull()
		expect(parkedState.mapStack.some((entry) => entry.id === 'draft:active')).toBe(false)
		expect(parkedState.mapStack.some((entry) => entry.title === 'Trailhead water catchments')).toBe(
			true,
		)
		expect(earthly.page.url()).not.toBe(publishedDatasetUrl)
		await recorder.observe(
			'unrelated-story-task-started',
			'An unrelated Story parks Dataset editing while the published catchments remain available as an ordinary map layer.',
		)
	} finally {
		evidence = await recorder.finish()
	}

	expect(evidence.browserHealth.pageErrors).toEqual([])
})
