import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { NostrEvent } from 'nostr-tools'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { mobileWorkspaceSheet } from '../tasks/navigation/mobile-workspace'
import { testIdentities } from '../test-identities'

interface StoryFixture {
	events: NostrEvent[]
	views: Array<{ title: string }>
	story: { event: NostrEvent; naddr: string; readerPath: string }
}

for (const identity of ['mara', 'owner'] as const) {
	const proposing = identity !== 'owner'
	test(`${proposing ? 'contributor' : 'owner'} Story pencil opens the normal editor and retains local view edits @editor-contract`, async ({
		earthly,
	}, testInfo) => {
		test.setTimeout(90_000)
		const page = earthly.page
		page.setDefaultTimeout(15_000)
		const errors: string[] = []
		const publications: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		page.on('websocket', (socket) =>
			socket.on('framesent', ({ payload }) => {
				try {
					const frame = JSON.parse(
						typeof payload === 'string' ? payload : payload.toString(),
					) as unknown[]
					if (frame[0] === 'EVENT') publications.push(JSON.stringify(frame))
				} catch {
					/* Non-JSON WebSocket control frames are irrelevant. */
				}
			}),
		)
		await authorizeJourneyIdentity(earthly, identity)
		// Reuse the signed production-codec fixture, without importing the broad
		// application factory graph into the browser suite's TypeScript project.
		const built = await promisify(execFile)('bun', [resolve('scripts/fixtures/ww1-story.ts')], {
			maxBuffer: 2 * 1024 * 1024,
		})
		const fixture = JSON.parse(built.stdout) as StoryFixture
		expect(fixture.story.event.pubkey).toBe(testIdentities.owner.publicKey)
		const original = JSON.parse(fixture.story.event.content) as { title: string; content: string }
		await page.addInitScript((events) => {
			const insertWhenReady = () => {
				const store = (
					window as unknown as {
						__earthlyEventStore?: { add(event: (typeof events)[number]): unknown }
					}
				).__earthlyEventStore
				if (store) for (const event of events) store.add(event)
				else requestAnimationFrame(insertWhenReady)
			}
			insertWhenReady()
		}, fixture.events)
		await page.goto(new URL(fixture.story.readerPath, earthly.environment.baseURL).href, {
			waitUntil: 'domcontentloaded',
		})
		await expect(
			page.getByRole('heading', { name: original.title, exact: true, level: 1 }),
		).toBeVisible()
		const editLabel = proposing ? 'Propose a Story edit' : 'Edit Story'
		await page.getByRole('button', { name: editLabel, exact: true }).click()
		const editPath = `/story/${fixture.story.naddr}/edit`
		await expect.poll(() => new URL(page.url()).pathname).toBe(editPath)
		await expect(page.getByRole('heading', { name: editLabel, exact: true })).toBeVisible()
		await expect(page.getByRole('dialog', { name: 'Propose an edit', exact: true })).toBeHidden()
		// Include hidden DOM: a second desktop editor on phones would introduce
		// competing autosave and AI-prefill writers for the same local draft.
		const mountedEditors = page.locator('.ProseMirror[contenteditable="true"]')
		await expect(mountedEditors).toHaveCount(1)
		const surface = earthly.isMobile
			? mobileWorkspaceSheet(earthly)
			: page.getByRole('complementary', { name: 'Margin', exact: true })
		const title = surface.getByPlaceholder('Roman ruins in Carinthia', { exact: true })
		await expect(title).toHaveValue(original.title)
		if (proposing) {
			await expect(surface.locator('.ProseMirror[contenteditable="true"]').first()).toBeVisible()
			await expect(surface.getByRole('textbox', { name: 'Cover image URL', exact: true })).toBeHidden()
			await surface.getByText('Cover and opening view · read-only', { exact: true }).click()
			await expect(title).toHaveAttribute('readonly', '')
			await expect(
				surface.getByPlaceholder('A one-line summary readers see on the story card.', {
					exact: true,
				}),
			).toHaveAttribute('readonly', '')
			await expect(
				surface.getByRole('textbox', { name: 'Cover image URL', exact: true }),
			).toHaveAttribute('readonly', '')
			await expect(surface.getByRole('button', { name: 'Blossom', exact: true })).toBeDisabled()
			const opening = surface.getByRole('group', { name: 'Opening view settings', exact: true })
			await expect(opening).toHaveAttribute('disabled', '')
			await expect(
				opening.getByRole('button', { name: 'Capture camera', exact: true }),
			).toBeDisabled()
			await expect(
				opening.getByRole('textbox', { name: 'Stable presentation layer id', exact: true }).first(),
			).toBeDisabled()
			await surface.getByText('Cover and opening view · read-only', { exact: true }).click()
		} else await expect(title).toBeEditable()
		const editor = surface.locator('.ProseMirror[contenteditable="true"]').first()
		await expect(editor).toBeVisible()
		await expect(editor.locator('[data-story-view]')).toHaveCount(fixture.views.length)
		const firstViewTitle = editor.getByLabel('View title', { exact: true }).first()
		await expect(firstViewTitle).toHaveValue(fixture.views[0]?.title ?? '')
		const localViewTitle = `${proposing ? 'Proposed' : 'Owner'} view kept locally`
		await firstViewTitle.fill(localViewTitle)
		// Modify prose without replacing the structured view blocks or their refs.
		await editor.focus()
		const isMac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
		await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home')
		const localProse = `${proposing ? 'Contributor' : 'Owner'} local note, not published.`
		await page.keyboard.insertText(localProse)
		await page.keyboard.press('Enter')
		await page.getByRole('button', { name: 'Save draft', exact: true }).click()
		await expect(editor).toContainText(localProse)
		await expect(firstViewTitle).toHaveValue(localViewTitle)
		await expect(
			page
				.getByRole('button', { name: proposing ? 'Send proposal' : 'Save changes', exact: true })
				.last(),
		).toBeEnabled()
		const capture = testInfo.outputPath(
			`story-${identity}-standard-editor-${testInfo.project.name}.png`,
		)
		await page.screenshot({ path: capture })
		await testInfo.attach(`${identity} uses standard Story editor`, {
			path: capture,
			contentType: 'image/png',
		})

		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect.poll(() => new URL(page.url()).pathname).toBe(editPath)
		await expect(page.getByRole('heading', { name: editLabel, exact: true })).toBeVisible()
		await expect(mountedEditors).toHaveCount(1)
		await expect(editor).toContainText(localProse)
		await expect(editor.locator('[data-story-view]')).toHaveCount(fixture.views.length)
		await expect(firstViewTitle).toHaveValue(localViewTitle)
		await expect(page.getByRole('dialog', { name: 'Propose an edit', exact: true })).toBeHidden()
		if (identity === 'owner' && testInfo.project.name === 'desktop') {
			const desktopViewport = page.viewportSize()
			if (!desktopViewport) throw new Error('The browser viewport is unavailable')
			for (const viewport of [{ width: 390, height: 844 }, desktopViewport]) {
				await page.setViewportSize(viewport)
				await expect(mountedEditors).toHaveCount(1)
				await expect(mountedEditors).toBeVisible()
				await expect(mountedEditors).toContainText(localProse)
				await expect(mountedEditors.locator('[data-story-view]')).toHaveCount(fixture.views.length)
				await expect(mountedEditors.getByLabel('View title', { exact: true }).first()).toHaveValue(
					localViewTitle,
				)
				await expect(
					page.getByPlaceholder('Roman ruins in Carinthia', { exact: true }),
				).toHaveValue(original.title)
			}
		}
		expect(publications).toEqual([])
		expect(errors).toEqual([])
	})
}
