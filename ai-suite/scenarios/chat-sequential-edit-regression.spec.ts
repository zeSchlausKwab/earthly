import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	openAiChat,
	selectAiChatTarget,
	sendAiChatMessage,
	waitForAiChatCompletion,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot, openDatasetEditor } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import {
	DETERMINISTIC_SEQUENTIAL_DATASET_DESCRIPTION,
	DETERMINISTIC_SEQUENTIAL_DATASET_NAME,
	installDeterministicChatProvider,
} from '../tasks/setup/deterministic-chat-provider'

test('sequential AI metadata and geometry edits do not conflict with their own editor echo @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The reported self-conflict was on desktop')
	test.setTimeout(120_000)

	const provider = await installDeterministicChatProvider(earthly, 'metadata-then-geometry')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	await earthly.open({ tour: 'preserve' })
	await startDataset(earthly)

	// Keep the real metadata editor mounted. Applying the first tool result used
	// to make TipTap echo the new description back into the draft and bump its
	// timestamp, which the following geometry tool mistook for a user edit.
	const descriptionEditor = earthly.page
		.getByRole('textbox')
		.filter({
			has: earthly.page.locator('[data-placeholder="Description (optional)"]'),
		})
		.first()
	await expect(descriptionEditor).toBeVisible()

	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')
	const panel = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
	await expect(
		panel.getByRole('switch', { name: 'Just accept AI edits without confirmation', exact: true }),
	).toBeChecked()

	const assistantMessagesBefore = await panel.getByTitle('Copy assistant message').count()
	await sendAiChatMessage(
		earthly,
		'First set a non-empty Dataset description, then add the deterministic map geometry.',
	)
	// There are deliberately no user actions between the two tool calls.
	await waitForAiChatCompletion(earthly, assistantMessagesBefore)

	await expect(
		panel.getByText(/The bound Dataset changed while this AI tool was working\./),
	).toHaveCount(0)
	await expect(panel.getByText('Not applied', { exact: true })).toHaveCount(0)
	await expect(panel.getByText(/^Tool error:/)).toHaveCount(0)
	await expectGeometryFeatureCount(earthly, 4)
	await expect(earthly.page.getByPlaceholder('Name').first()).toHaveValue(
		DETERMINISTIC_SEQUENTIAL_DATASET_NAME,
	)
	await expect(
		earthly.page
			.getByRole('textbox')
			.filter({ hasText: DETERMINISTIC_SEQUENTIAL_DATASET_DESCRIPTION })
			.first(),
	).toBeVisible()

	// The status and the canonical editor agree: the four-feature card is only
	// labelled Applied because the same four features are present in the draft.
	const showDetails = panel.getByText('Show details', { exact: true })
	if (await showDetails.isVisible()) await showDetails.click()
	const geometrySummary = panel.getByText('+4 added · ~0 changed · −0 deleted', { exact: true })
	await expect(geometrySummary).toBeVisible()
	const geometryDisclosure = geometrySummary.locator('..').locator('..').locator('..')
	await expect(geometryDisclosure.getByText('Applied', { exact: true })).toBeVisible()
	await expect(geometryDisclosure.getByText('Not applied', { exact: true })).toHaveCount(0)

	const firstSnapshot = await editorLifecycleSnapshot(earthly)
	expect(firstSnapshot.activeDraftId).not.toBeNull()
	expect(provider.requests()).toHaveLength(3)

	// Reopen the saved local draft after a full app navigation to prove the
	// geometry was durably persisted, not merely left on the visible surface.
	const current = new URL(earthly.page.url())
	await earthly.open({
		path: `${current.pathname}${current.search}`,
		tour: 'preserve',
		discover: 'preserve',
	})
	await openPanel(earthly, 'Local drafts')
	const drafts = earthly.page.getByRole('region', { name: 'Local drafts' })
	const expandDrafts = drafts.getByRole('button', { name: 'Expand saved drafts' }).first()
	if (await expandDrafts.isVisible()) await expandDrafts.click()
	const savedDraft = drafts
		.getByRole('button')
		.filter({ hasText: DETERMINISTIC_SEQUENTIAL_DATASET_NAME })
		.first()
	await expect(savedDraft).toBeVisible()
	await savedDraft.click()
	await expect
		.poll(async () => (await editorLifecycleSnapshot(earthly)).activeDraftId)
		.toBe(firstSnapshot.activeDraftId)
	await expectGeometryFeatureCount(earthly, 4)
	const reopenedNameInput = await openDatasetEditor(earthly)
	await expect(reopenedNameInput).toHaveValue(DETERMINISTIC_SEQUENTIAL_DATASET_NAME)
	await expect(
		earthly.page
			.getByRole('textbox')
			.filter({ hasText: DETERMINISTIC_SEQUENTIAL_DATASET_DESCRIPTION })
			.first(),
	).toBeVisible()
})
