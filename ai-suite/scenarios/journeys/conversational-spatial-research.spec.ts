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
} from '../../tasks/chat/conversation'
import {
	expectGeometryFeatureCount,
	publishCurrentGeometryDataset,
} from '../../tasks/create/geometry'
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

test('an analyst turns a chat proposal into a canonical Dataset @experience-audit @journey-conversational-spatial-research', async ({
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

		await sendAiChatMessage(earthly, prompt)
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
		await expect(earthly.page.getByText(/I added two synthetic drinking-water points/)).toBeVisible(
			{ timeout: 15_000 },
		)
		await recorder.observe(
			'proposal-applied',
			'The accepted proposal exists as ordinary editable geometry and the assistant reports completion.',
		)

		const requestRounds = provider.requests()
		expect(requestRounds).toHaveLength(2)
		expect(requestRounds[0]?.toolNames).toContain('write_geojson_to_editor')
		expect(requestRounds[0]?.toolNames).toContain('set_dataset_metadata')
		expect(requestRounds[1]?.messageRoles).toContain('tool')

		await publishCurrentGeometryDataset(earthly)
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
	} finally {
		evidence = await recorder.finish()
	}

	expect(evidence.browserHealth.pageErrors).toEqual([])
})
