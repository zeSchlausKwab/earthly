import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	openAiChat,
	composeAiChatMessage,
	moveAiChat,
	selectAiChatTarget,
} from '../tasks/chat/conversation'
import { threadWorkSnapshot, setThreadWorkingSetOpen } from '../tasks/chat/working-set'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft } from '../tasks/create/geometry'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

test('Ask can move right and back without losing the conversation or composer @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'Desktop panel placement')
	test.setTimeout(120_000)
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ path: '/ask' })
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel).toBeVisible()
	await composeAiChatMessage(earthly, 'Keep this unsent message while moving chat.')
	const before = await threadWorkSnapshot(earthly)
	await earthly.page.screenshot({ path: testInfo.outputPath('chat-left.png') })
	await moveAiChat(earthly, 'right')
	expect((await panel.boundingBox())!.x).toBeGreaterThan(earthly.page.viewportSize()!.width / 2)
	await expect(panel.locator('textarea')).toHaveValue('Keep this unsent message while moving chat.')
	await earthly.page.screenshot({ path: testInfo.outputPath('chat-right.png') })
	await moveAiChat(earthly, 'left')
	expect((await panel.boundingBox())!.x).toBeLessThan(100)
	await expect(panel.locator('textarea')).toHaveValue('Keep this unsent message while moving chat.')
	expect(await threadWorkSnapshot(earthly)).toEqual(before)
	await panel.getByRole('button', { name: 'Close Thread', exact: true }).click()
	await expect(panel).toBeHidden()
	await openPanel(earthly, 'Local drafts')
	await expect(panel).toBeHidden()
	await earthly.page.getByRole('button', { name: 'Ask', exact: true }).click()
	await expect(panel).toBeVisible()
	await expect(panel.locator('textarea')).toHaveValue('Keep this unsent message while moving chat.')
	// A desktop placement preference must not make the mobile Browse sheet inert.
	await earthly.page.setViewportSize({ width: 390, height: 844 })
	await earthly.page.getByRole('button', { name: 'Browse', exact: true }).click()
	await earthly.page.getByRole('tab', { name: /^Stories(?:\s|$)/ }).click()
	await expect.poll(() => new URL(earthly.page.url()).pathname).toBe('/browse/stories')
})

test('global Drafts leaves the right chat and its composer open @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop simultaneous panels')
	test.setTimeout(120_000)
	await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open()
	await startDataset(earthly)
	await openAiChat(earthly)
	await composeAiChatMessage(earthly, 'Keep this draft while browsing drafts.')
	const before = await threadWorkSnapshot(earthly)
	await openPanel(earthly, 'Local drafts')
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel).toBeVisible()
	await expect(panel.locator('textarea')).toHaveValue('Keep this draft while browsing drafts.')
	expect(await threadWorkSnapshot(earthly)).toEqual(before)
})

test('publishing a Map keeps the conversation open and marks its publication @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'Desktop simultaneous editor and chat')
	test.setTimeout(240_000)
	const published = await installIsolatedRelays(earthly)
	const provider = await installDeterministicChatProvider(earthly, 'target-binding')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open()
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Publication stays in this chat')
	await addPointToGeometryDraft(earthly)
	await openAiChat(earthly)
	await selectAiChatTarget(earthly, 'current-dataset')
	await composeAiChatMessage(earthly, 'What should we improve next?')
	const before = await threadWorkSnapshot(earthly)
	const working = await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Unpublished', { exact: true })).toBeVisible()
	await working
		.getByRole('button', { name: 'Review & publish: Publication stays in this chat', exact: true })
		.click()
	await earthly.page.getByRole('menuitem', { name: 'Publish new Map', exact: true }).click()
	await expect.poll(() => [...published.values()].filter((kind) => kind === 37515).length).toBe(1)
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await expect(panel).toBeVisible()
	await expect(panel.locator('textarea')).toHaveValue('What should we improve next?')
	expect((await threadWorkSnapshot(earthly)).id).toBe(before.id)
	await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Published', { exact: true })).toBeVisible()
	await working
		.getByRole('button', { name: 'View published: Publication stays in this chat', exact: true })
		.click()
	await expect(panel).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).id).toBe(before.id)
	await setThreadWorkingSetOpen(earthly)
	await working.getByRole('button', { name: 'Publication stays in this chat', exact: true }).click()
	await draft.nameInput.fill('Publication with local changes')
	await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Unpublished changes', { exact: true })).toBeVisible()
	await setThreadWorkingSetOpen(earthly, false)
	await openPanel(earthly, 'Local drafts')
	await expect(earthly.page.getByRole('region', { name: 'Local drafts', exact: true }).getByText('Unpublished changes', { exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: /saved alternatives/ })).toHaveCount(0)
	await earthly.page.screenshot({ path: testInfo.outputPath('draft-changes.png') })
	await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Unpublished changes', { exact: true })).toBeVisible()
	await working
		.getByRole('button', { name: 'Publish changes: Publication with local changes', exact: true })
		.click()
	await expect.poll(() => [...published.values()].filter((kind) => kind === 37515).length).toBe(2)
	await expect(
		earthly.page.getByRole('menuitem', { name: 'Update existing', exact: true }),
	).toHaveCount(0)
	await expect(panel).toBeVisible()
	await expect(earthly.page).toHaveURL(/\/drafts(?:\?|$)/)
	await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Published', { exact: true })).toBeVisible()
	await expect(working.getByText('Unpublished changes', { exact: true })).toHaveCount(0)
	await working.getByRole('button', { name: 'Publication with local changes', exact: true }).click()
	await draft.nameInput.fill('Further changes after publication')
	await openPanel(earthly, 'Local drafts')
	await expect(earthly.page.getByRole('region', { name: 'Local drafts', exact: true }).getByText('Unpublished changes', { exact: true })).toBeVisible()
	// The global inventory uses the same one-click action as the AI editing menu.
	const inventory = earthly.page.getByRole('region', { name: 'Local drafts', exact: true })
	await inventory
		.getByRole('button', {
			name: 'Publish changes: Further changes after publication',
			exact: true,
		})
		.click()
	await expect.poll(() => [...published.values()].filter((kind) => kind === 37515).length).toBe(3)
	await expect(inventory.getByText('Published', { exact: true })).toBeVisible()
	await expect(panel).toBeVisible()
	await expect(panel.locator('textarea')).toHaveValue('What should we improve next?')
	await expect(earthly.page).toHaveURL(/\/drafts(?:\?|$)/)
	await inventory
		.getByRole('button', { name: /^Further changes after publication\b/ })
		.click()
	await draft.nameInput.fill('Changes kept after reload')
	await openPanel(earthly, 'Local drafts')
	// The isolated relay does not replay events: this also verifies that the
	// persisted baseline works offline, without a source event or active editor.
	await earthly.page.reload()
	await expect(panel).toBeVisible()
	await expect(earthly.page.getByRole('region', { name: 'Local drafts', exact: true }).getByText('Unpublished changes', { exact: true })).toBeVisible()
	await setThreadWorkingSetOpen(earthly)
	await expect(working.getByText('Unpublished changes', { exact: true })).toBeVisible()
	expect((await threadWorkSnapshot(earthly)).id).toBe(before.id)
})

test('drafts are flat, with saved alternatives only on demand @regression', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(180_000)
	await installIsolatedRelays(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.open()
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('One Map, one row')
	await openPanel(earthly, 'Local drafts')
	const inventory = earthly.page.getByRole('region', { name: 'Local drafts', exact: true })
	await expect(inventory.getByText('One Map, one row', { exact: true })).toHaveCount(1)
	await expect(earthly.page.getByRole('button', { name: /saved alternatives/ })).toHaveCount(0)
	await expect(
		earthly.page.getByRole('button', { name: 'Review & publish: One Map, one row', exact: true }),
	).toBeVisible()
	await earthly.page.screenshot({ path: testInfo.outputPath('flat-drafts.png') })
	await earthly.page
		.getByRole('button', { name: 'More actions for One Map, one row', exact: true })
		.click()
	await earthly.page.getByRole('menuitem', { name: 'Rename Map', exact: true }).click()
	await inventory.getByRole('textbox', { name: 'Map name', exact: true }).fill('Renamed Map')
	await inventory.getByRole('button', { name: 'Save name', exact: true }).click()
	await expect(inventory.getByText('Renamed Map', { exact: true })).toHaveCount(1)
	await earthly.page
		.getByRole('button', { name: 'More actions for Renamed Map', exact: true })
		.click()
	await earthly.page
		.getByRole('menuitem', { name: 'Save an alternative draft', exact: true })
		.click()
	await openPanel(earthly, 'Local drafts')
	await expect(earthly.page.getByRole('button', { name: /saved alternatives/ })).toBeVisible()
})
