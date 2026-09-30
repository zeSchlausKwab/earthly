import { openChatView } from '../tasks/chat/navigation'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, moveAiChat, composeAiChatMessage } from '../tasks/chat/conversation'
import { setThreadWorkingSetOpen, threadWorkSnapshot } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'

test('entity drag and touch search share explicit read-only and editable roles @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const publications = await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open()
	await installInMemoryMapFixture(earthly, { title: 'Foreign survey source', author: 'mara' })
	const dataset = await startDataset(earthly)
	await dataset.nameInput.fill('Keep editing this Map')
	await earthly.page.getByRole('button', { name: 'Edit this Map with AI', exact: true }).click()
	const chat = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	if (!earthly.isMobile) await moveAiChat(earthly, 'right')
	await composeAiChatMessage(earthly, 'Do not lose this message.')
	const original = await threadWorkSnapshot(earthly)
	const editor = await editorLifecycleSnapshot(earthly)
	const working = await setThreadWorkingSetOpen(earthly)
	await openChatView(earthly, 'sources')
	const refs = chat.getByRole('region', { name: 'Read-only sources', exact: true })
	if (earthly.isMobile) {
		await refs.getByPlaceholder('Search maps, stories, atlases…').fill('Foreign survey')
		await earthly.page
			.getByRole('dialog')
			.last()
			.getByRole('button', { name: /^Foreign survey source/ })
			.last()
			.click()
	} else {
		await openPanel(earthly, 'Maps')
		await setThreadWorkingSetOpen(earthly, false)
		const handle = earthly.page.getByRole('button', {
			name: 'Drag or add Foreign survey source to chat',
			exact: true,
		})
		await expect(handle).toBeVisible()
		const box = (await handle.boundingBox())!
		await earthly.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await earthly.page.mouse.down()
		await earthly.page.mouse.move(box.x + 25, box.y + 25, { steps: 8 })
		const sources = (await chat.getByRole('button', { name: /^Sources / }).boundingBox())!
		await earthly.page.mouse.move(sources.x + sources.width / 2, sources.y + sources.height / 2, {
			steps: 10,
		})
		await expect(refs).toBeVisible()
		const dropHeading = refs.getByRole('heading')
		await dropHeading.scrollIntoViewIfNeeded()
		const destination = (await dropHeading.boundingBox())!
		await earthly.page.mouse.move(destination.x + destination.width / 2, destination.y + 12, {
			steps: 12,
		})
		await earthly.page.mouse.up()
	}
	await expect
		.poll(() => threadWorkSnapshot(earthly))
		.toMatchObject({ id: original.id, referenceCount: 1, outputs: original.outputs })
	await expect(refs.getByText('Foreign survey source', { exact: true })).toBeVisible()
	await refs
		.getByRole('button', { name: 'Actions for source Foreign survey source', exact: true })
		.click()
	await earthly.page.getByRole('menuitem', { name: 'Let AI edit', exact: true }).click()
	await expect
		.poll(async () => (await threadWorkSnapshot(earthly)).outputs.length)
		.toBe(original.outputs.length + 1)
	await expect(working.getByText('Proposal draft', { exact: true })).toBeVisible()
	await expect.poll(async () => (await threadWorkSnapshot(earthly)).referenceCount).toBe(0)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(editor.activeWorkspaceId)
	await expect(chat.locator('textarea')).toHaveValue('Do not lose this message.')
	await working
		.getByRole('button', { name: 'Drag or add Foreign survey source to chat', exact: true })
		.click()
	await earthly.page
		.getByRole('button', { name: 'Add as read-only reference', exact: true })
		.click()
	await openChatView(earthly, 'sources')
	await expect
		.poll(() => threadWorkSnapshot(earthly))
		.toMatchObject({ id: original.id, outputs: original.outputs, referenceCount: 1 })
	await expect(refs.getByText('Foreign survey source', { exact: true })).toBeVisible()
	await openChatView(earthly, 'chat')
	await expect(chat.locator('textarea')).toHaveValue('Do not lose this message.')
	expect(
		[...publications.values()].filter((kind) => kind === 37515 || kind === 37520),
	).toHaveLength(0)
	await earthly.page.screenshot({ path: testInfo.outputPath('chat-context.png') })
})
