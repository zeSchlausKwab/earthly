import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	composeAiChatMessage,
	configureChatProvider,
	sendAiChatMessage,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import {
	localMapOutputCounts,
	localStoryDraftTitles,
	setThreadWorkingSetOpen,
	threadWorkSnapshot,
} from '../tasks/chat/working-set'

test('a work Thread creates independent Maps and a Story without publishing or retargeting the editor @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const publishedEvents = await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'working-set')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	await earthly.open()
	await installDeterministicMapStyle(earthly)
	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill('Map I am viewing')
	const viewedMap = (await editorLifecycleSnapshot(earthly)).activeWorkspaceId
	await earthly.page.getByRole('button', { name: 'Edit this Map with AI', exact: true }).click()
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel).toBeVisible()
	await expect(panel.getByRole('button', { name: 'AI can edit 1', exact: true })).toBeVisible()
	await expect(
		panel.getByRole('button', { name: 'AI can edit 1', exact: true }),
	).not.toHaveAttribute('data-ai-attention', 'true')
	await expect(earthly.page.getByRole('region', { name: 'AI can edit', exact: true })).toBeHidden()
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByLabel('Create new maps and stories', { exact: true }).check()
	await setThreadWorkingSetOpen(earthly, false)
	await sendAiChatMessage(earthly, 'Create two separate Maps and a Story that references both.')
	await expect(
		panel.getByText('Created two separate local Maps and a Story. Nothing was published.', {
			exact: true,
		}),
	).toBeVisible({ timeout: 60_000 })
	const editButton = panel.getByRole('button', { name: 'AI can edit 4', exact: true })
	await expect(editButton).toHaveAttribute('data-ai-attention', 'true')
	await expect(editButton).toHaveAttribute('aria-description', 'New AI changes are ready to view.')
	await expect
		.poll(async () => {
			const state = await editorLifecycleSnapshot(earthly)
			return state.mapStack
				.filter((entry) => entry.entityType === 'ai-result')
				.map((entry) => ({ title: entry.title, visible: entry.visible }))
		})
		.toEqual([{ title: 'Front 1914', visible: true }])
	// The first output reaches the real styled map source, with chat and the
	// user's original editing workspace retained.
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (
					window as typeof window & {
						__earthlyUiMap?: {
							getStyle(): {
								sources: Record<
									string,
									{ data?: { features?: Array<{ properties?: { localWorkspaceId?: string } }> } }
								>
							}
						}
					}
				).__earthlyUiMap
				return (
					map
						?.getStyle()
						.sources['geo-editor-remote-datasets']?.data?.features?.filter(
							(feature) => feature.properties?.localWorkspaceId,
						).length ?? 0
				)
			}),
		)
		.toBe(1)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(viewedMap)
	await earthly.page.screenshot({ path: testInfo.outputPath('compact-chat.png') })
	await setThreadWorkingSetOpen(earthly)
	await setThreadWorkingSetOpen(earthly, false)
	await expect(editButton).not.toHaveAttribute('data-ai-attention', 'true')
	await setThreadWorkingSetOpen(earthly)
	await expect(
		working.getByRole('button', { name: 'View on map: Front 1914', exact: true }),
	).toHaveAttribute('data-ai-attention', 'true')
	await expect(
		working.getByRole('button', { name: 'Preview Story: A changing front', exact: true }),
	).toHaveAttribute('data-ai-attention', 'true')
	await expect(working.getByRole('button', { name: 'Front 1914', exact: true })).toBeVisible()
	await expect(working.getByRole('button', { name: 'Front 1916', exact: true })).toBeVisible()
	await expect(working.getByRole('button', { name: 'A changing front', exact: true })).toBeVisible()
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(viewedMap)
	expect(provider.requests()).toHaveLength(3)
	expect([...publishedEvents.values()].filter((kind) => kind === 37515 || kind === 37520)).toEqual(
		[],
	)
	await expect
		.poll(() => localMapOutputCounts(earthly))
		.toEqual(
			expect.arrayContaining([
				{ title: 'Map I am viewing', features: 0 },
				{ title: 'Front 1914', features: 1 },
				{ title: 'Front 1916', features: 1 },
			]),
		)
	const originalThread = await threadWorkSnapshot(earthly)
	await earthly.page.screenshot({ path: testInfo.outputPath('working-set.png') })
	await working
		.getByRole('button', { name: 'Preview Story: A changing front', exact: true })
		.click()
	await expect(earthly.page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
		'data-state',
		'active',
	)
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue('A changing front')
	if (!earthly.isMobile) await expect(panel).toBeVisible()
	await expect(earthly.page.getByRole('tabpanel', { name: 'Preview', exact: true })).toContainText(
		'earthly-draft:',
	)
	await earthly.page.getByRole('button', { name: 'Edit this Story with AI', exact: true }).click()
	expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
	await setThreadWorkingSetOpen(earthly)
	await expect(
		working.getByRole('button', { name: 'Preview Story: A changing front', exact: true }),
	).not.toHaveAttribute('data-ai-attention', 'true')
	await expect(
		working.getByRole('button', { name: 'View on map: Front 1914', exact: true }),
	).toHaveAttribute('data-ai-attention', 'true')
	await setThreadWorkingSetOpen(earthly, false)
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(panel).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(4)
	await composeAiChatMessage(earthly, 'Keep these unpublished follow-up notes.')
	await setThreadWorkingSetOpen(earthly)
	const beforePublishUrl = earthly.page.url()
	await working
		.getByRole('button', { name: 'Publish Story: A changing front', exact: true })
		.click()
	const confirmation = earthly.page.getByRole('alertdialog')
	await expect(confirmation).toContainText('Front 1914')
	await expect(confirmation).toContainText('Front 1916')
	await confirmation.getByRole('button', { name: 'Keep drafts', exact: true }).click()
	await expect(confirmation).toBeHidden()
	expect(
		[...publishedEvents.values()].filter((kind) => kind === 37515 || kind === 37520),
	).toHaveLength(0)
	await working
		.getByRole('button', { name: 'Publish Story: A changing front', exact: true })
		.click()
	await confirmation.getByRole('button', { name: 'Publish Story and 2 maps', exact: true }).click()
	await expect(confirmation).toBeHidden()
	await expect
		.poll(() => [...publishedEvents.values()].filter((kind) => kind === 37520).length)
		.toBe(1)
	expect([...publishedEvents.values()].filter((kind) => kind === 37515)).toHaveLength(2)
	expect(earthly.page.url()).toBe(beforePublishUrl)
	await expect(panel).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
	await expect(working.getByText('Published', { exact: true })).toHaveCount(3)
	await earthly.page.screenshot({ path: testInfo.outputPath('published-work.png') })
	await setThreadWorkingSetOpen(earthly, false)
	await expect(panel.locator('textarea')).toHaveValue('Keep these unpublished follow-up notes.')
	if (!earthly.isMobile) {
		await setThreadWorkingSetOpen(earthly)
		await working.getByRole('button', { name: 'A changing front', exact: true }).click()
		await earthly.page.getByLabel('Title', { exact: true }).fill('A changing front — updated')
		await setThreadWorkingSetOpen(earthly)
		await expect(working.getByText('Unpublished changes', { exact: true })).toBeVisible()
		const beforeUpdateUrl = earthly.page.url()
		await working
			.getByRole('button', { name: 'Publish changes: A changing front — updated', exact: true })
			.click()
		await expect
			.poll(() => [...publishedEvents.values()].filter((kind) => kind === 37520).length)
			.toBe(2)
		expect([...publishedEvents.values()].filter((kind) => kind === 37515)).toHaveLength(2)
		await expect(working.getByText('Unpublished changes', { exact: true })).toHaveCount(0)
		await expect(panel).toBeVisible()
		expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
		expect(earthly.page.url()).toBe(beforeUpdateUrl)
		await setThreadWorkingSetOpen(earthly, false)
		await expect(panel.locator('textarea')).toHaveValue('Keep these unpublished follow-up notes.')
	}
})

test('Story draft shortcuts share the global inventory and discard without resurrection @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const publishedEvents = await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'working-set')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, { ...provider.settings, safetyLevel: 3 })
	await earthly.open()
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Edit this Map with AI', exact: true }).click()
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByLabel('Create new maps and stories', { exact: true }).check()
	await setThreadWorkingSetOpen(earthly, false)
	await sendAiChatMessage(earthly, 'Create two separate Maps and a Story that references both.')
	await expect(
		panel.getByText('Created two separate local Maps and a Story. Nothing was published.', {
			exact: true,
		}),
	).toBeVisible({ timeout: 60_000 })
	const original = await threadWorkSnapshot(earthly)
	await setThreadWorkingSetOpen(earthly)
	await earthly.page.screenshot({ path: testInfo.outputPath('story-draft-actions.png') })
	if (
		await earthly.page
			.getByRole('button', { name: 'Back to Local drafts', exact: true })
			.isVisible()
	)
		await earthly.page.getByRole('button', { name: 'Back to Local drafts', exact: true }).click()
	await working.getByRole('button', { name: 'All drafts', exact: true }).click()
	const stories = earthly.page.getByRole('region', { name: 'New Story drafts', exact: true })
	await expect(stories.getByRole('button', { name: 'A changing front', exact: true })).toBeVisible()
	await earthly.page.screenshot({ path: testInfo.outputPath('all-drafts.png') })
	if (!earthly.isMobile) await expect(panel).toBeVisible()
	await stories
		.getByRole('button', { name: 'Preview Story: A changing front', exact: true })
		.click()
	await expect(earthly.page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
		'data-state',
		'active',
	)
	await earthly.page.getByRole('button', { name: 'Edit this Story with AI', exact: true }).click()
	await composeAiChatMessage(earthly, 'Keep the remaining Maps for later.')
	await setThreadWorkingSetOpen(earthly)
	const discard = working.getByRole('button', {
		name: 'Discard draft: A changing front',
		exact: true,
	})
	await discard.click()
	const confirmation = earthly.page.getByRole('alertdialog')
	await expect(confirmation).toContainText('Discard “A changing front”?')
	await expect(confirmation).toContainText('its AI editing access from all conversations')
	await confirmation.getByRole('button', { name: 'Keep draft', exact: true }).click()
	await expect(confirmation).toBeHidden()
	await expect.poll(() => localStoryDraftTitles(earthly)).toContain('A changing front')
	await discard.click()
	await confirmation.getByRole('button', { name: 'Discard draft', exact: true }).click()
	await expect(confirmation).toBeHidden()
	await expect.poll(() => localStoryDraftTitles(earthly)).not.toContain('A changing front')
	await expect
		.poll(() => threadWorkSnapshot(earthly))
		.toMatchObject({
			id: original.id,
			outputs: expect.not.arrayContaining([expect.objectContaining({ title: 'A changing front' })]),
		})
	await expect(panel).toBeVisible()
	await setThreadWorkingSetOpen(earthly, false)
	await expect(panel.locator('textarea')).toHaveValue('Keep the remaining Maps for later.')
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect.poll(() => localStoryDraftTitles(earthly)).not.toContain('A changing front')
	expect(
		[...publishedEvents.values()].filter((kind) => kind === 37515 || kind === 37520),
	).toHaveLength(0)
})
