import { loadLiveAiSettings } from '../../core/chat-provider-settings'
import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import { expect, test } from '../../fixtures/earthly'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import { configureChatProvider, openAiChat, sendAiChatMessage } from '../../tasks/chat/conversation'

const liveSettings = loadLiveAiSettings()

// A browser trace can retain request headers and DOM input values. This file is
// the live-only lane, so it deliberately gives up those artifacts to keep an
// API key out of failure output.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

const run: ScenarioRunDefinition = {
	id: 'conversational-spatial-research-live-provider-smoke',
	personaId: 'spatial-data-analyst',
	journeyId: 'conversational-spatial-research',
	platform: 'desktop-web',
	connectivity: 'Explicitly opted-in external OpenAI-compatible provider.',
	publishChannel: 'not-applicable',
	startingState: [
		'Analyst is pre-authorized in an ephemeral browser context.',
		'Live credentials were loaded from an ignored local file and imported with confirm-all safety.',
	],
	reviewLensIds: ['privacy-destination', 'product-complexity'],
}

test.describe('opt-in live AI experience', () => {
	test('a real provider completes a read-only Earthly turn @live-ai @experience-audit', async ({
		earthly,
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'The live smoke starts on desktop')
		test.skip(!liveSettings, 'Set EARTHLY_LIVE_AI_SETTINGS_FILE to opt into paid live AI')
		test.setTimeout(180_000)
		if (!liveSettings) return

		await authorizeJourneyIdentity(earthly, 'owner')
		await configureChatProvider(earthly, { ...liveSettings, safetyLevel: 1 })
		await earthly.open({ tour: 'preserve' })
		await openAiChat(earthly)

		const recorder = new ExperienceRunRecorder(earthly, testInfo, run)
		let evidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
		try {
			await recorder.observe(
				'live-chat-ready',
				'The external provider is configured in an ephemeral context; no credential field is visible.',
			)
			const assistantMessages = earthly.page.getByTitle('Copy assistant message')
			const before = await assistantMessages.count()
			await sendAiChatMessage(
				earthly,
				'Use get_editor_state only. Do not change the map, publish, or call remote data tools. Briefly tell me the current feature count and whether an authoring destination is active.',
			)
			await expect
				.poll(() => assistantMessages.count(), { timeout: 150_000 })
				.toBeGreaterThan(before)
			await expect(earthly.page.getByPlaceholder('Type a message...')).toBeEnabled()
			await recorder.observe(
				'live-read-only-answer',
				'A variable real-model answer completed; this proves connectivity and interaction, not answer correctness.',
			)
		} finally {
			evidence = await recorder.finish()
		}

		expect(evidence.browserHealth.pageErrors).toEqual([])
	})
})
