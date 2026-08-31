import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	completeAiChatTurn,
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
	sendAiChatMessage,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import {
	DETERMINISTIC_STORY_TARGET_BODY,
	DETERMINISTIC_STORY_TARGET_FINAL_ANSWER,
	DETERMINISTIC_STORY_TARGET_TITLE,
	installDeterministicChatProvider,
} from '../tasks/setup/deterministic-chat-provider'

async function readNewStoryDraft(earthly: Parameters<typeof openAiChat>[0]) {
	return earthly.page.evaluate(() => {
		for (const [key, value] of Object.entries(localStorage)) {
			if (!key.startsWith('earthly:story:drafts:v1:')) continue
			try {
				const drafts = JSON.parse(value) as Record<string, unknown>
				if (drafts['new-story']) return drafts['new-story']
			} catch {
				// A malformed unrelated scope must not masquerade as a saved Story draft.
			}
		}
		return null
	})
}

test('AI Story writing pauses for an explicit Story edit target and then resumes @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The desktop editor rail exposes this gate clearly',
	)
	test.setTimeout(120_000)

	const provider = await installDeterministicChatProvider(earthly, 'story-target-gate')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	await earthly.open({ tour: 'preserve' })

	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill('Dataset target for an article request')
	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')

	const panel = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
	const assistantMessageCountBefore = await panel.getByTitle('Copy assistant message').count()
	await sendAiChatMessage(earthly, 'Write an article explaining this map.')

	const dialog = earthly.page.getByRole('alertdialog')
	await expect(dialog).toBeVisible()
	await expect(
		dialog.getByRole('button', { name: 'New Story and continue', exact: true }),
	).toBeVisible()
	await expect(
		earthly.page.locator('select[aria-label="Select conversation"] option:checked'),
	).toContainText('Awaiting approval')
	await expect.poll(() => readNewStoryDraft(earthly)).toBeNull()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveCount(0)

	await completeAiChatTurn(earthly, assistantMessageCountBefore, {
		approvals: ['story-target'],
	})

	await expect
		.poll(() => readNewStoryDraft(earthly))
		.toMatchObject({
			title: DETERMINISTIC_STORY_TARGET_TITLE,
			content: DETERMINISTIC_STORY_TARGET_BODY,
		})
	await expect(
		panel.getByText(DETERMINISTIC_STORY_TARGET_FINAL_ANSWER, { exact: true }),
	).toBeVisible()
	expect(provider.requests()).toHaveLength(2)

	// The explicit approval retained a populated Story edit state. Reveal it via
	// the ordinary sidebar control and verify the same local draft is author-visible.
	await earthly.page.getByRole('button', { name: 'Story', exact: true }).click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(
		DETERMINISTIC_STORY_TARGET_TITLE,
	)
	await expect(earthly.page.locator('.ProseMirror[contenteditable="true"]').first()).toContainText(
		DETERMINISTIC_STORY_TARGET_BODY,
	)
})
