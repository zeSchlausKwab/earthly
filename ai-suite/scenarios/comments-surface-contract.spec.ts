import type { Locator } from '@playwright/test'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	mobileWorkspaceSheet,
	setMobileWorkspaceTransparency,
} from '../tasks/navigation/mobile-workspace'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { commentOverlaySnapshot, setCommentAnnotationsVisible } from '../tasks/social/comments'

async function paintedAncestors(locator: Locator, boundary: 'form' | 'card') {
	return locator.evaluate((element, stopAt) => {
		const surfaces: Array<{ tag: string; classes: string; background: string }> = []
		let current: Element | null = element
		while (current) {
			surfaces.push({
				tag: current.tagName,
				classes: current.className,
				background: getComputedStyle(current).backgroundColor,
			})
			if (
				(stopAt === 'form' && current.tagName === 'FORM') ||
				(stopAt === 'card' && current.hasAttribute('data-translucent'))
			)
				break
			current = current.parentElement
		}
		return surfaces
	}, boundary)
}

function isTransparent(background: string): boolean {
	return background === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(background)
}

async function setSheetSnap(sheet: Locator, snap: 'full' | 'half') {
	const slider = sheet.getByRole('slider', { name: 'Resize panel', exact: true })
	await slider.press('End')
	if (snap === 'half') await slider.press('ArrowDown')
	const targetHeight = Number(await slider.getAttribute('aria-valuenow'))
	// The sheet animates height; scroll the composer only after its viewport settles.
	await expect
		.poll(async () => Math.round((await sheet.boundingBox())?.height ?? 0))
		.toBe(targetHeight)
}

test('mobile Comments keep the long discussion and composer inside half and full sheets @regression', async ({
	earthly,
}, testInfo) => {
	test.skip(!earthly.isMobile, 'Phone Comments containment contract')
	await authorizeJourneyIdentity(earthly, 'owner')
	const fixture = await installInMemoryMapFixture(earthly, {
		title: 'Field discussion',
		identifier: 'comments-surface-layout',
		commentCount: 12,
	})
	await earthly.open({ path: `${fixture.path}?tab=comments`, tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	const inspect = sheet.getByRole('region', { name: 'Map inspection', exact: true })
	const threads = inspect.getByRole('region', { name: 'Comment threads', exact: true })
	const form = inspect.getByRole('form', { name: 'Comment composer', exact: true })
	const footer = form.locator('..')
	const post = form.getByRole('button', { name: 'Post', exact: true })
	await expect(inspect.getByText('12 comments', { exact: true })).toBeVisible()
	await expect(inspect.getByRole('heading', { name: fixture.title, exact: true })).toHaveCount(1)
	await expect(
		inspect.locator('header').getByRole('button', { name: 'Like', exact: true }),
	).toHaveCount(1)
	await expect(inspect.getByRole('button', { name: 'Like', exact: true })).toHaveCount(13)
	await expect(inspect.getByRole('heading', { name: 'Comments', exact: true })).toHaveCount(0)
	const viewport = earthly.page.viewportSize()
	if (!viewport) throw new Error('Phone viewport unavailable')
	for (const width of [390, 320]) {
		await earthly.page.setViewportSize({ ...viewport, width })
		for (const snap of ['full', 'half'] as const) {
			await setSheetSnap(sheet, snap)
			await setMobileWorkspaceTransparency(earthly, true)
			await expect(form).toHaveAttribute('data-translucent', 'true')
			await post.scrollIntoViewIfNeeded()
			const screenshot = testInfo.outputPath(`comments-${width}-${snap}.png`)
			await earthly.page.screenshot({ path: screenshot, animations: 'disabled' })
			await testInfo.attach(`Comments ${width}px ${snap}`, {
				path: screenshot,
				contentType: 'image/png',
			})
			const boxes = {
				sheet: await sheet.boundingBox(),
				threads: await threads.boundingBox(),
				form: await form.boundingBox(),
				footer: await footer.boundingBox(),
				footerScroll: await footer.evaluate((element) => ({
					client: element.clientHeight,
					scroll: element.scrollHeight,
					top: element.scrollTop,
				})),
				post: await post.boundingBox(),
				list: await threads.evaluate((element) => ({
					client: element.clientHeight,
					scroll: element.scrollHeight,
				})),
			}
			await testInfo.attach(`Comments ${width}px ${snap} bounds`, {
				body: JSON.stringify(boxes, null, 2),
				contentType: 'application/json',
			})
			expect
				.soft(boxes.threads?.height, `${width}px ${snap}: discussion retains a usable scroll area`)
				.toBeGreaterThan(40)
			expect.soft(boxes.list.scroll).toBeGreaterThan(boxes.list.client)
			await expect
				.soft(post, `${width}px ${snap}: Post stays reachable in the sheet`)
				.toBeInViewport({ ratio: 1 })
			expect
				.soft(
					(boxes.post?.y ?? 0) + (boxes.post?.height ?? 0),
					`${width}px ${snap}: footer remains above dock`,
				)
				.toBeLessThanOrEqual((boxes.sheet?.y ?? 0) + (boxes.sheet?.height ?? 0))
			expect
				.soft(
					(boxes.footer?.y ?? 0) + (boxes.footer?.height ?? 0),
					`${width}px ${snap}: footer wrapper remains contained`,
				)
				.toBeLessThanOrEqual((boxes.sheet?.y ?? 0) + (boxes.sheet?.height ?? 0))
			await expect
				.soft(
					inspect.getByRole('heading', { name: fixture.title, exact: true }),
					`${width}px ${snap}: footer scrolling does not displace object header`,
				)
				.toBeInViewport({ ratio: 1 })
			const editorPaint = await paintedAncestors(form.locator('.ProseMirror'), 'form')
			expect(
				editorPaint.filter((surface) => !isTransparent(surface.background)),
				`${width}px ${snap}: actual editor/form glass`,
			).toEqual([])
			expect(await footer.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
				'rgba(0, 0, 0, 0)',
			)
		}
	}
	await setSheetSnap(sheet, 'full')
	const newestText = fixture.commentTexts.at(-1)
	if (!newestText) throw new Error('Expected a long comment fixture')
	const cardText = threads.getByText(newestText, { exact: true })
	await cardText.scrollIntoViewIfNeeded()
	expect(
		(await paintedAncestors(cardText, 'card')).every((surface) =>
			isTransparent(surface.background),
		),
	).toBe(true)
	await setMobileWorkspaceTransparency(earthly, false)
	await expect(form).toHaveAttribute('data-translucent', 'false')
	expect(
		(await paintedAncestors(form.locator('.ProseMirror'), 'form')).some(
			(surface) => !isTransparent(surface.background),
		),
	).toBe(true)
	expect(
		(await paintedAncestors(cardText, 'card')).some(
			(surface) => !isTransparent(surface.background),
		),
	).toBe(true)
	for (const width of [320, 390]) {
		await earthly.page.setViewportSize({ ...viewport, width })
		for (const snap of ['full', 'half'] as const) {
			await setSheetSnap(sheet, snap)
			await post.scrollIntoViewIfNeeded()
			await expect(post).toBeInViewport({ ratio: 1 })
			const screenshot = testInfo.outputPath(`comments-${width}-${snap}-opaque.png`)
			await earthly.page.screenshot({ path: screenshot, animations: 'disabled' })
			await testInfo.attach(`Comments ${width}px ${snap} opaque`, {
				path: screenshot,
				contentType: 'image/png',
			})
		}
	}
})

test('Comments preserve count, reaction sorting, replies and attached-place controls without publishing @regression', async ({
	earthly,
}, testInfo) => {
	await authorizeJourneyIdentity(earthly, 'owner')
	const fixture = await installInMemoryMapFixture(earthly, {
		title: 'Discussion controls',
		identifier: 'comments-surface-actions',
		commentCount: 12,
		includeDiscussionFeatures: true,
	})
	const outgoingEvents: string[] = []
	earthly.page.on('websocket', (socket) =>
		socket.on('framesent', (frame) => {
			if (String(frame.payload).startsWith('["EVENT",')) outgoingEvents.push(String(frame.payload))
		}),
	)
	await earthly.open({ path: `${fixture.path}?tab=comments`, tour: 'seen' })
	if (earthly.isMobile) await setSheetSnap(mobileWorkspaceSheet(earthly), 'full')
	const inspect = earthly.page.getByRole('region', { name: 'Map inspection', exact: true })
	const threads = inspect.getByRole('region', { name: 'Comment threads', exact: true })
	const form = inspect.getByRole('form', { name: 'Comment composer', exact: true })
	const annotationCheckpoints: unknown[] = []
	const captureAnnotations = async (step: string) => {
		annotationCheckpoints.push({
			step,
			map: await earthly.page.evaluate(() => {
				const map = (
					window as unknown as {
						__earthlyMap?: {
							isStyleLoaded(): boolean
							isMoving(): boolean
							areTilesLoaded(): boolean
							getStyle(): { sources: Record<string, unknown>; layers: Array<{ id: string }> }
						}
					}
				).__earthlyMap
				return map
					? {
							styleLoaded: map.isStyleLoaded(),
							moving: map.isMoving(),
							tilesLoaded: map.areTilesLoaded(),
							sources: Object.keys(map.getStyle().sources),
							layers: map
								.getStyle()
								.layers.map((layer) => layer.id)
								.filter((id) => id.startsWith('comment-')),
						}
					: null
			}),
			controls: await inspect
				.getByRole('button', { name: /^(Hide|Show) (annotations|comment geometry)$/ })
				.evaluateAll((buttons) =>
					buttons.map((button) => ({
						name: button.getAttribute('aria-label') ?? button.textContent,
						pressed: button.getAttribute('aria-pressed'),
					})),
				),
		})
	}
	const oldestText = fixture.commentTexts[0]
	const newestText = fixture.commentTexts.at(-1)
	if (!oldestText || !newestText || !fixture.replyText)
		throw new Error('Expected discussion fixture')
	await expect(inspect.getByText('13 comments', { exact: true })).toBeVisible()
	await expect(threads.getByText(/^Fixture comment/).first()).toHaveText(newestText)
	const sort = inspect.getByRole('combobox', { name: 'Sort comments', exact: true })
	await sort.selectOption('most-liked')
	await expect(threads.getByText(/^Fixture comment/).first()).toHaveText(oldestText)
	const card = threads
		.getByText(oldestText, { exact: true })
		.locator('xpath=ancestor::*[@data-translucent][1]')
	await card.getByText('1 geometry', { exact: true }).scrollIntoViewIfNeeded()
	await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(1)
	await card.getByRole('button', { name: 'Hide comment geometry', exact: true }).click()
	await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(0)
	await card.getByRole('button', { name: 'Show comment geometry', exact: true }).click()
	await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(1)
	await card.getByRole('button', { name: 'Zoom', exact: true }).click()
	await captureAnnotations('after zoom')
	await setCommentAnnotationsVisible(earthly, false)
	await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(0)
	await captureAnnotations('hidden globally')
	await setCommentAnnotationsVisible(earthly, true)
	await captureAnnotations('requested show globally')
	try {
		await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(1)
	} finally {
		await captureAnnotations('after source restoration wait')
		await testInfo.attach('Annotation layer restoration', {
			body: JSON.stringify(annotationCheckpoints, null, 2),
			contentType: 'application/json',
		})
	}
	await expect(threads.getByText(fixture.replyText, { exact: true })).toBeVisible()
	await card.getByRole('button', { name: 'Collapse replies', exact: true }).click()
	await expect(threads.getByText(fixture.replyText, { exact: true })).toBeHidden()
	await card.getByRole('button', { name: 'Expand replies', exact: true }).click()
	await expect(threads.getByText(fixture.replyText, { exact: true })).toBeVisible()
	await card.getByRole('button', { name: 'Reply', exact: true }).click()
	const reply = card.getByRole('form', { name: 'Reply composer', exact: true })
	await expect(reply).toBeVisible()
	await expect(form).toBeHidden()
	await reply.locator('.ProseMirror').fill('An unsent local reply')
	await expect(reply.getByRole('button', { name: 'Reply', exact: true })).toBeEnabled()
	await reply.getByRole('button', { name: 'Cancel', exact: true }).click()
	await expect(reply).toBeHidden()
	await expect(form).toBeVisible()
	await sort.selectOption('newest')
	await expect(threads.getByText(/^Fixture comment/).first()).toHaveText(newestText)
	for (const [label, expectedMode] of [
		['Drop a pin', 'draw_point'],
		['Draw a line', 'draw_linestring'],
		['Draw an area', 'draw_polygon'],
		['Add a label', 'draw_annotation'],
	] as const) {
		await form.getByRole('button', { name: 'Attach a place', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: label, exact: true }).click()
		await expect
			.poll(() =>
				earthly.page.evaluate(
					() =>
						(
							window as unknown as { __earthlyEditorStore?: { getState(): { mode: string } } }
						).__earthlyEditorStore?.getState().mode,
				),
			)
			.toBe(expectedMode)
		await expect(
			form.getByRole('button', { name: 'Select comment geometry', exact: true }),
		).toBeEnabled()
		await form.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeHidden()
	}
	expect(outgoingEvents).toEqual([])
})
