import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	configureChatProvider,
	dispatchComposedAiChatMessage,
	openAiChat,
	persistedThreadSnapshot,
	waitForAiChatCompletion,
} from '../tasks/chat/conversation'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft } from '../tasks/create/geometry'
import { editorLifecycleSnapshot } from '../tasks/editor/lifecycle'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { createStoryDraft } from '../tasks/create/story'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

test('relay rejection is not reported as a successful Map publish @regression', async ({
	earthly,
}) => {
	let rejected = 0
	let acceptPublication = false
	let accepted = 0
	// Isolate only this page's local relay. Nothing is forwarded or stored.
	await earthly.page.routeWebSocket(/^ws:\/\/(?:localhost|127\.0\.0\.1):3334\/?$/, (socket) => {
		socket.onMessage((raw) => {
			const message = JSON.parse(String(raw)) as unknown[]
			if (message[0] === 'REQ') socket.send(JSON.stringify(['EOSE', message[1]]))
			if (message[0] === 'EVENT') {
				const event = message[1] as { id: string }
				if (acceptPublication) accepted++
				else rejected++
				socket.send(
					JSON.stringify([
						'OK',
						event.id,
						acceptPublication,
						acceptPublication ? '' : 'blocked: test relay refuses this event',
					]),
				)
			}
		})
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.keyboard.press('Escape')
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Relay rejected draft')
	await addPointToGeometryDraft(earthly)
	const before = await editorLifecycleSnapshot(earthly)
	const publish = earthly.page.getByRole('button', { name: 'Publish', exact: true })
	if (await publish.isVisible()) await publish.click()
	else await earthly.page.getByText('File', { exact: true }).first().click()
	await earthly.page.getByRole('menuitem', { name: 'Publish new Map', exact: true }).click()
	await expect.poll(() => rejected).toBeGreaterThan(0)
	const error = earthly.page.locator('[data-sonner-toast][data-type="error"]')
	await expect(error).toBeVisible()
	await expect(error).toContainText('test relay refuses this event')
	await expect(earthly.page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(before.activeWorkspaceId)
	await expect(draft.nameInput).toHaveValue('Relay rejected draft')
	// A deliberate retry now gets an acknowledgement, without forwarding to a
	// real relay. Success must clear the prior error and leave edit mode normally.
	acceptPublication = true
	if (await publish.isVisible()) await publish.click()
	else await earthly.page.getByText('File', { exact: true }).first().click()
	await earthly.page.getByRole('menuitem', { name: 'Publish new Map', exact: true }).click()
	await expect(earthly.page).toHaveURL(/\/map\//)
	await expect(error).toHaveCount(0)
	await expect(earthly.page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible()
	expect(accepted).toBe(1)
})

test('publish signing failures show an error toast and keep the draft @regression', async ({
	earthly,
}) => {
	await authorizeJourneyIdentity(earthly, 'owner')
	await earthly.page.keyboard.press('Escape')
	const draft = await startDataset(earthly)
	await draft.nameInput.fill('Failed publish retained draft')
	await addPointToGeometryDraft(earthly)
	const before = await editorLifecycleSnapshot(earthly)
	await earthly.page.evaluate(() => {
		const signer = (
			window as unknown as { nostr: { signEvent: (...args: unknown[]) => Promise<unknown> } }
		).nostr
		signer.signEvent = async () => {
			throw new Error('Signing declined by test signer')
		}
	})
	const publish = earthly.page.getByRole('button', { name: 'Publish', exact: true })
	if (await publish.isVisible()) await publish.click()
	else await earthly.page.getByText('File', { exact: true }).first().click()
	await earthly.page.getByRole('menuitem', { name: 'Publish new Map', exact: true }).click()
	const toast = earthly.page.locator('[data-sonner-toast][data-type="error"]')
	await expect(toast).toBeVisible()
	await expect(toast).toContainText(/signing|declined/i)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(before.activeWorkspaceId)
	expect((await editorLifecycleSnapshot(earthly)).featureCount).toBe(1)
})

for (const kind of ['Story', 'Atlas'] as const) {
	test(`${kind} publishing failure shows a toast and retains the editor @regression`, async ({
		earthly,
	}) => {
		await authorizeJourneyIdentity(earthly, 'owner')
		await earthly.page.keyboard.press('Escape')
		if (kind === 'Story') {
			await createStoryDraft(earthly, {
				title: 'Retained failed Story',
				body: 'Keep this narrative when signing fails.',
			})
		} else {
			await openPanel(earthly, 'Atlases')
			await earthly.page.getByRole('button', { name: 'New Atlas', exact: true }).click()
			await earthly.page.getByPlaceholder('Roman ruins in Carinthia').fill('Retained failed Atlas')
		}
		await earthly.page.evaluate(() => {
			const signer = (
				window as unknown as { nostr: { signEvent: (...args: unknown[]) => Promise<unknown> } }
			).nostr
			signer.signEvent = async () => {
				throw new Error('Signing declined by test signer')
			}
		})
		await earthly.page
			.getByRole('button', {
				name: kind === 'Story' ? 'Publish Story' : 'Create Atlas',
				exact: true,
			})
			.first()
			.click()
		await expect(earthly.page.locator('[data-sonner-toast][data-type="error"]')).toContainText(
			'Signing declined by test signer',
		)
		await expect(
			kind === 'Story'
				? earthly.page.getByLabel('Title')
				: earthly.page.getByPlaceholder('Roman ruins in Carinthia'),
		).toHaveValue(`Retained failed ${kind}`)
	})
}

test('the same Thread can move left and right without changing its draft, composer or active run @regression', async ({
	earthly,
}) => {
	test.skip(earthly.isMobile, 'Desktop Thread placement')
	const provider = await installDeterministicChatProvider(earthly, 'target-binding', {
		holdCompletionResponses: true,
	})
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await openAiChat(earthly)
	const thread = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	await thread.locator('textarea').fill('Keep this prompt when moving the Thread')
	const before = await persistedThreadSnapshot(earthly)
	const moveLeft = thread.getByRole('button', { name: 'Move Thread to left panel', exact: true })
	await expect(moveLeft).toBeVisible()
	await moveLeft.click()
	await expect(thread).toBeVisible()
	await expect(
		earthly.page.getByRole('complementary', { name: 'Margin', exact: true }),
	).toBeHidden()
	await expect(earthly.page.locator('section[aria-label="AI Thread"]')).toHaveCount(1)
	const canvas = earthly.page.getByRole('main', { name: 'Map canvas', exact: true })
	await expect
		.poll(async () => (await thread.boundingBox())!.x < (await canvas.boundingBox())!.x)
		.toBe(true)
	await expect(thread.locator('textarea')).toHaveValue('Keep this prompt when moving the Thread')
	expect(await persistedThreadSnapshot(earthly)).toEqual(before)
	await thread.getByRole('button', { name: 'Move Thread to right column', exact: true }).click()
	await expect(
		earthly.page.getByRole('complementary', { name: 'Margin', exact: true }),
	).toBeVisible()
	await expect
		.poll(
			async () =>
				(await thread.boundingBox())!.x >=
				(await canvas.boundingBox())!.x + (await canvas.boundingBox())!.width,
		)
		.toBe(true)
	await expect(thread.locator('textarea')).toHaveValue('Keep this prompt when moving the Thread')
	expect(await persistedThreadSnapshot(earthly)).toEqual(before)
	expect(provider.requests()).toHaveLength(0)
	await dispatchComposedAiChatMessage(earthly)
	await expect.poll(() => provider.requests().length).toBe(1)
	const running = await persistedThreadSnapshot(earthly)
	await moveLeft.click()
	// The toolbar's Move action must move, not close, an already-open left Thread.
	await canvas.getByRole('button', { name: 'Move Thread to the right', exact: true }).click()
	await expect(
		thread.getByRole('button', { name: 'Move Thread to left panel', exact: true }),
	).toBeVisible()
	expect(await persistedThreadSnapshot(earthly)).toEqual(running)
	provider.releaseCompletionResponses()
	await waitForAiChatCompletion(earthly, 0, { timeoutMs: 20_000 })
	await expect(thread.getByTitle('Copy user message')).toHaveCount(1)
	await expect(thread.getByTitle('Copy assistant message')).toHaveCount(1)
	expect(provider.requests()).toHaveLength(1)
	await moveLeft.click()
	await thread.getByRole('button', { name: 'Close Thread', exact: true }).click()
	await expect(
		earthly.page.getByRole('complementary', { name: 'Margin', exact: true }),
	).toBeVisible()
	await openAiChat(earthly)
	expect(await persistedThreadSnapshot(earthly)).toEqual(running)
})

test('publishing controls fit the canvas toolbar with both desktop panels open @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'Desktop canvas width')
	await earthly.page.setViewportSize({ width: 1440, height: 900 })
	await earthly.open({ tour: 'seen' })
	await startDataset(earthly)
	await installDeterministicMapStyle(earthly)
	await earthly.page.getByRole('button', { name: 'Show Thread on the right', exact: true }).click()
	const canvas = earthly.page.getByRole('main', { name: 'Map canvas', exact: true })
	const audience = canvas.getByRole('button', { name: /^Audience/ })
	for (const width of [1440, 1100, 1280, 1920, 1024]) {
		await earthly.page.setViewportSize({ width, height: 900 })
		await expect(audience).toBeVisible()
		await expect
			.poll(() =>
				canvas.locator('[data-tour="toolbar"]').evaluate((bar) => {
					const controls = Array.from(
						bar.querySelectorAll('button:not(:disabled), [role="menuitem"]'),
					).filter((element) => element.getBoundingClientRect().width > 0)
					return controls
						.filter((element) => {
							const bounds = element.getBoundingClientRect()
							return ![0.1, 0.5, 0.9].every((fraction) =>
								element.contains(
									document.elementFromPoint(
										bounds.x + bounds.width * fraction,
										bounds.y + bounds.height / 2,
									),
								),
							)
						})
						.map((element) => element.getAttribute('aria-label') || element.textContent)
				}),
			)
			.toEqual([])
		const bar = await canvas.locator('[data-tour="toolbar"]').boundingBox()
		const navigation = await canvas
			.getByRole('button', { name: 'Zoom in', exact: true })
			.boundingBox()
		expect(navigation!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height)
		if (width === 1440 || width === 1100) {
			await earthly.page.screenshot({
				path: testInfo.outputPath(`toolbar-${width}.png`),
				animations: 'disabled',
			})
		}
	}
})
