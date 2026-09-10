import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	openAiChat,
	sendAiChatMessage,
	startNewAiChat,
} from '../tasks/chat/conversation'
import { setThreadWorkingSetOpen, threadWorkSnapshot } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import {
	DETERMINISTIC_STORY_TARGET_BODY,
	DETERMINISTIC_STORY_TARGET_FINAL_ANSWER,
	DETERMINISTIC_STORY_TARGET_TITLE,
	installDeterministicChatProvider,
} from '../tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

for (const allowCreate of [false, true]) {
	test(`Story creation is ${allowCreate ? 'allowed' : 'blocked'} by the Thread's new-draft permission @regression`, async ({
		earthly,
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'Desktop creation-permission regression')
		await installIsolatedRelays(earthly)
		const provider = await installDeterministicChatProvider(earthly, 'story-target-gate')
		await authorizeJourneyIdentity(earthly, 'owner')
		await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
		await earthly.open()
		await installDeterministicMapStyle(earthly)
		const map = await startDataset(earthly)
		await map.nameInput.fill('Map left unchanged')
		await openAiChat(earthly)
		await startNewAiChat(earthly)
		const working = await setThreadWorkingSetOpen(earthly)
		await working.getByLabel('Allow requested new local Maps and Stories').setChecked(allowCreate)
		await setThreadWorkingSetOpen(earthly, false)
		await sendAiChatMessage(earthly, 'Create a separate article draft.')
		const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
		await expect(
			panel.getByText(
				allowCreate
					? DETERMINISTIC_STORY_TARGET_FINAL_ANSWER
					: 'The model requested a tool in a read-only Thread. No tools were executed.',
				{ exact: true },
			),
		).toBeVisible()
		await expect(earthly.page.getByRole('alertdialog')).toHaveCount(0)
		await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveCount(0)
		expect(provider.requests()).toHaveLength(allowCreate ? 2 : 1)
		const work = await threadWorkSnapshot(earthly)
		if (!allowCreate) {
			expect(work.outputs).toEqual([])
			expect(provider.requests()[0]?.toolNames).not.toContain('write_story_draft')
			return
		}
		expect(work.outputs).toMatchObject([{ title: DETERMINISTIC_STORY_TARGET_TITLE, kind: 'story' }])
		await setThreadWorkingSetOpen(earthly)
		await working
			.getByRole('button', { name: DETERMINISTIC_STORY_TARGET_TITLE, exact: true })
			.click()
		await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(
			DETERMINISTIC_STORY_TARGET_TITLE,
		)
		await expect(
			earthly.page.locator('.ProseMirror[contenteditable="true"]').first(),
		).toContainText(DETERMINISTIC_STORY_TARGET_BODY)
	})
}
