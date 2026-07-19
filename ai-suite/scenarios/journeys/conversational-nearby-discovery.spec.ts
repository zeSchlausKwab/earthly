import type { ScenarioRunDefinition } from '../../experience-lab/model'
import { ExperienceRunRecorder } from '../../experience-lab/run-recorder'
import { expect, test } from '../../fixtures/earthly'
import { authorizeJourneyIdentity } from '../../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	hideAiChat,
	openAiChat,
	sendAiChatMessage,
} from '../../tasks/chat/conversation'
import { expectGeometryFeatureCount } from '../../tasks/create/geometry'
import { cancelSightingPlacement, startSightingPlacement } from '../../tasks/create/sighting'
import { installDeterministicChatProvider } from '../../tasks/setup/deterministic-chat-provider'
import {
	attemptDeniedDeviceLocation,
	grantAndTrackDeviceLocation,
	installDeterministicGeolocation,
	stopDeviceLocationTracking,
} from '../../tasks/setup/deterministic-geolocation'

const run: ScenarioRunDefinition = {
	id: 'conversational-nearby-discovery-mobile-web-baseline',
	personaId: 'curious-map-explorer',
	journeyId: 'conversational-nearby-discovery',
	platform: 'mobile-web',
	connectivity: 'Controlled OpenAI-compatible model endpoint and local Earthly services.',
	publishChannel: 'not-applicable',
	startingState: [
		'Explorer is pre-authorized on mobile web so provider setup is not part of the journey.',
		'Device location begins denied and can be granted through a deterministic browser fixture.',
		'No authoring workspace or private destination is active.',
	],
	reviewLensIds: ['product-complexity', 'privacy-destination', 'accessibility', 'platform-parity'],
}

const firstPrompt = 'I have 45 minutes. Find a quiet park and coffee nearby, without a car.'

test('a nearby explorer recovers location, reaches the current blocker, and returns to the map @experience-audit @ai-journey @journey-conversational-nearby-discovery', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile', 'Nearby discovery evaluates the mobile surface')
	test.setTimeout(120_000)

	await installDeterministicGeolocation(earthly, {
		latitude: 48.2082,
		longitude: 16.3738,
	})
	const provider = await installDeterministicChatProvider(earthly, 'nearby-discovery')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'preserve' })

	const recorder = new ExperienceRunRecorder(earthly, testInfo, run)
	let evidence: Awaited<ReturnType<ExperienceRunRecorder['finish']>> | undefined
	try {
		const entry = await recorder.observe(
			'entry',
			'The explorer starts from the mobile map with a public, unattached destination.',
		)
		expect(entry.currentDestination).toContain('Public')

		await attemptDeniedDeviceLocation(earthly)
		await recorder.observe(
			'location-denied',
			'Denial changes only the locate icon for three seconds; no explanation or manual-place recovery is presented.',
		)

		await grantAndTrackDeviceLocation(earthly)
		await recorder.observe(
			'location-recovered',
			'Granting on a second attempt centers the map and changes the control to Stop tracking location.',
		)
		await stopDeviceLocationTracking(earthly)

		await openAiChat(earthly)
		await recorder.observe(
			'chat-ready',
			'AI chat replaces the mobile navigation menu; the map is no longer simultaneously visible.',
		)

		const firstSendOutcome = await sendAiChatMessage(earthly, firstPrompt)
		expect(firstSendOutcome).toBe('chat-replaced-by-editor')
		await expectGeometryFeatureCount(earthly, 0)
		await recorder.observe(
			'first-prompt-displaced',
			'Sending a first read-only question creates an empty Dataset workspace and replaces chat with the editor while the message continues in the background.',
		)
		const stopEditing = earthly.page.getByRole('button', { name: 'Stop editing', exact: true })
		if (await stopEditing.isVisible()) {
			await stopEditing.click()
			await openAiChat(earthly)
		}
		await expectGeometryFeatureCount(earthly, 0)
		const firstRequestStarted = provider.requests().length > 0
		if (firstRequestStarted) {
			await expect(
				earthly.page.getByText(/Two synthetic candidates are Riverside Park/),
			).toBeVisible({ timeout: 15_000 })
		}
		await recorder.observe(
			'chat-recovered',
			firstRequestStarted
				? 'Stopping the unintended edit returns to chat and reveals a prose-only answer; the low-patience journey still abandons before refinement.'
				: 'Stopping the unintended edit returns to an empty chat because the displaced first message never reached the model.',
		)

		const requestRounds = provider.requests()
		expect([0, 2]).toContain(requestRounds.length)
		if (requestRounds.length === 2) {
			expect(requestRounds[0]?.toolNames).toContain('get_editor_state')
			expect(requestRounds[1]?.messageRoles).toContain('tool')
		}

		await hideAiChat(earthly)
		await expect(earthly.page.getByText('Garden Court Park', { exact: false })).toBeHidden()
		await expectGeometryFeatureCount(earthly, 0)
		await earthly.page.getByRole('button', { name: 'Map stack', exact: true }).click()
		await expect(earthly.page.getByText('Map Stack', { exact: true })).toBeVisible()
		await recorder.observe(
			'chat-closed',
			'Closing chat retains the located viewport but leaves no inspectable recommendation or route in Map Stack.',
		)
		await earthly.page.getByRole('button', { name: 'Close Map', exact: true }).click()

		await startSightingPlacement(earthly)
		await recorder.observe(
			'unrelated-public-task-started',
			'The explorer can immediately begin a public Sighting and is not trapped in AI chat.',
		)
		await cancelSightingPlacement(earthly)
	} finally {
		evidence = await recorder.finish()
	}

	expect(evidence.browserHealth.pageErrors).toEqual([])
})
