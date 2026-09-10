import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, sendAiChatMessage } from '../tasks/chat/conversation'
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
	await expect(
		panel.getByRole('button', { name: 'AI can edit: Map I am viewing', exact: true }),
	).toBeVisible()
	await expect(earthly.page.getByRole('dialog', { name: 'AI editing', exact: true })).toBeHidden()
	const working = await setThreadWorkingSetOpen(earthly)
	await working.getByLabel('Create new maps and stories', { exact: true }).check()
	await setThreadWorkingSetOpen(earthly, false)
	await sendAiChatMessage(earthly, 'Create two separate Maps and a Story that references both.')
	await expect(
		panel.getByText('Created two separate local Maps and a Story. Nothing was published.', {
			exact: true,
		}),
	).toBeVisible({ timeout: 60_000 })
	await earthly.page.screenshot({ path: testInfo.outputPath('compact-chat.png') })
	await setThreadWorkingSetOpen(earthly)
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
	await working.getByRole('button', { name: 'A changing front', exact: true }).click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue('A changing front')
	if (!earthly.isMobile) await expect(panel).toBeVisible()
	await expect(earthly.page.locator('.ProseMirror[contenteditable="true"]').first()).toContainText(
		'earthly-draft:',
	)
	await earthly.page.getByRole('button', { name: 'Edit this Story with AI', exact: true }).click()
	expect((await threadWorkSnapshot(earthly)).id).toBe(originalThread.id)
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect(panel).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).outputs).toHaveLength(4)
	const restored = await setThreadWorkingSetOpen(earthly)
	await restored.getByRole('button', { name: 'Review & publish: A changing front', exact: true }).click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue('A changing front')
	await expect(earthly.page.getByRole('button', { name: 'Publish Story', exact: true })).toBeFocused()
	expect([...publishedEvents.values()].filter(kind => kind === 37515 || kind === 37520)).toHaveLength(0)
	await earthly.page.getByRole('button', { name: 'Publish Story', exact: true }).click()
	const confirmation = earthly.page.getByRole('alertdialog')
	await expect(confirmation).toContainText('Front 1914')
	await confirmation.getByRole('button', { name: 'Publish and continue', exact: true }).click()
	await expect(confirmation).toContainText('Front 1916')
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(confirmation).toBeHidden()
	await expect(
		earthly.page.getByRole('button', { name: 'Publish Story', exact: true }),
	).toBeEnabled()
	await earthly.page.getByRole('button', { name: 'Publish Story', exact: true }).click()
	await expect(confirmation).toContainText('Front 1916')
	await confirmation.getByRole('button', { name: 'Publish and continue', exact: true }).click()
	await expect
		.poll(() => [...publishedEvents.values()].filter((kind) => kind === 37520).length)
		.toBe(1)
	expect([...publishedEvents.values()].filter((kind) => kind === 37515)).toHaveLength(2)
})

test('Story draft shortcuts share the global inventory and discard without resurrection @regression', async ({ earthly }, testInfo) => {
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
	await expect(panel.getByText('Created two separate local Maps and a Story. Nothing was published.', { exact: true })).toBeVisible({ timeout: 60_000 })
	const original = await threadWorkSnapshot(earthly)
	await setThreadWorkingSetOpen(earthly)
	await earthly.page.screenshot({ path: testInfo.outputPath('story-draft-actions.png') })
	await working.getByRole('button', { name: 'All drafts', exact: true }).click()
	const stories = earthly.page.getByRole('region', { name: 'New Story drafts', exact: true })
	await expect(stories.getByRole('button', { name: 'A changing front', exact: true })).toBeVisible()
	await earthly.page.screenshot({ path: testInfo.outputPath('all-drafts.png') })
	if (!earthly.isMobile) await expect(panel).toBeVisible()
	await stories.getByRole('button', { name: 'Preview Story: A changing front', exact: true }).click()
	await expect(earthly.page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute('data-state', 'active')
	await earthly.page.getByRole('button', { name: 'Edit this Story with AI', exact: true }).click()
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: 'Discard draft: A changing front', exact: true }).click()
	await earthly.page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft', exact: true }).click()
	await expect(earthly.page.getByRole('alertdialog')).toBeHidden()
	await expect.poll(() => localStoryDraftTitles(earthly)).not.toContain('A changing front')
	await expect.poll(() => threadWorkSnapshot(earthly)).toMatchObject({ id: original.id, outputs: expect.not.arrayContaining([expect.objectContaining({ title: 'A changing front' })]) })
	if (!earthly.isMobile) await expect(panel).toBeVisible()
	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	await expect.poll(() => localStoryDraftTitles(earthly)).not.toContain('A changing front')
	expect([...publishedEvents.values()].filter(kind => kind === 37515 || kind === 37520)).toHaveLength(0)
})
