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
}) => {
	test.skip(earthly.isMobile, 'Desktop simultaneous editor and chat')
	test.setTimeout(120_000)
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
})
