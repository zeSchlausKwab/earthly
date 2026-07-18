import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const postCommentTask: AiTaskMetadata = {
	id: 'social.post-comment',
	summary: 'Post a root comment on the currently inspected entity.',
	preconditions: ['Signed-in local development persona', 'An entity comment surface is visible'],
	sideEffects: ['Publishes a comment event to the local development relay'],
	viewports: 'both',
}

export const replyToCommentTask: AiTaskMetadata = {
	id: 'social.reply-to-comment',
	summary: 'Reply to a visible comment in the current entity discussion.',
	preconditions: ['Signed-in local development persona', 'The target comment is visible'],
	sideEffects: ['Publishes a threaded reply event to the local development relay'],
	viewports: 'both',
}

export const postAnnotatedCommentTask: AiTaskMetadata = {
	id: 'social.post-annotated-comment',
	summary: 'Draw one or more map geometries and publish them as attachments to a comment.',
	preconditions: ['Signed-in local development persona', 'An entity comment surface is visible'],
	sideEffects: ['Publishes a comment with GeoJSON to the local development relay'],
	viewports: 'both',
}

export const verifyCommentAnnotationDurabilityTask: AiTaskMetadata = {
	id: 'social.verify-comment-annotation-durability',
	summary:
		'Verify comment geometry is visible by default, can be zoomed/toggled, and returns after reload.',
	preconditions: ['A routed entity contains a comment with attached geometry'],
	sideEffects: ['Toggles annotation visibility and changes the map viewport'],
	viewports: 'both',
}

export const toggleCommentAnnotationsTask: AiTaskMetadata = {
	id: 'social.toggle-comment-annotations',
	summary: 'Hide or show all map annotations attached to comments on the current entity.',
	preconditions: ['An entity discussion contains at least one geometry comment'],
	sideEffects: ['Changes comment annotation layer visibility on the map'],
	viewports: 'both',
}

function visibleRichEditor(earthly: EarthlySession) {
	return earthly.page.locator('.ProseMirror[contenteditable="true"]:visible').first()
}

async function clickMap(earthly: EarthlySession, xRatio: number, yRatio: number): Promise<void> {
	const canvas = earthly.page.locator('.maplibregl-canvas')
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	if (!box) throw new Error('Map canvas has no visible bounding box')
	await canvas.click({ position: { x: box.width * xRatio, y: box.height * yRatio } })
}

async function expectAttachedGeometryCount(earthly: EarthlySession, count: number): Promise<void> {
	await expect(earthly.page.getByText(`${count} geometry attached`, { exact: true })).toBeVisible()
}

export interface CommentOverlaySnapshot {
	sourceIds: string[]
	layerIds: string[]
}

export async function commentOverlaySnapshot(
	earthly: EarthlySession,
): Promise<CommentOverlaySnapshot> {
	return earthly.page.evaluate(() => {
		const map = (
			window as typeof window & {
				__earthlyMap?: {
					getStyle(): { sources?: Record<string, unknown>; layers?: Array<{ id: string }> }
				}
			}
		).__earthlyMap
		const style = map?.getStyle()
		return {
			sourceIds: Object.keys(style?.sources ?? {}).filter((id) => id.startsWith('comment-geo-')),
			layerIds: (style?.layers ?? [])
				.map((layer) => layer.id)
				.filter((id) => id.startsWith('comment-')),
		}
	})
}

export async function postComment(earthly: EarthlySession, text: string): Promise<void> {
	const editor = visibleRichEditor(earthly)
	await expect(editor).toBeVisible()
	await editor.fill(text)
	await earthly.page.getByRole('button', { name: 'Post', exact: true }).click()
	await expect(earthly.page.getByText(text, { exact: true }).first()).toBeVisible()
}

export async function replyToComment(
	earthly: EarthlySession,
	commentText: string,
	replyText: string,
): Promise<void> {
	const comment = earthly.page
		.locator('div.group.rounded-lg.border')
		.filter({ hasText: commentText })
		.first()
	await expect(comment).toBeVisible()
	await comment.getByRole('button', { name: 'Reply', exact: true }).click()
	const form = comment.locator('form')
	await expect(form).toBeVisible()
	await form.locator('.ProseMirror[contenteditable="true"]').fill(replyText)
	await form.getByRole('button', { name: 'Reply', exact: true }).click()
	await expect(earthly.page.getByText(replyText, { exact: true }).first()).toBeVisible()
}

export async function postAnnotatedComment(
	earthly: EarthlySession,
	input: { comment: string; label: string },
): Promise<void> {
	const editor = visibleRichEditor(earthly)
	await expect(editor).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Draw label', exact: true }).first().click()
	await clickMap(earthly, 0.6, 0.44)
	const labelInput = earthly.page.getByPlaceholder('Type label text...')
	await expect(labelInput).toBeVisible()
	await labelInput.fill(input.label)
	await editor.fill(input.comment)
	await expect(earthly.page.getByText('1 geometry attached', { exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Post', exact: true }).click()
	await expect(earthly.page.getByText(input.comment, { exact: true }).first()).toBeVisible()
	await expect(earthly.page.getByText('1 geometry', { exact: true }).first()).toBeVisible()
}

export async function postDeepAnnotatedComment(
	earthly: EarthlySession,
	input: { comment: string; label: string },
): Promise<void> {
	const editor = visibleRichEditor(earthly)
	await expect(editor).toBeVisible()
	await editor.fill(input.comment)

	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickMap(earthly, 0.57, 0.4)
	await expectAttachedGeometryCount(earthly, 1)

	await earthly.page.getByRole('button', { name: 'Draw line', exact: true }).first().click()
	await clickMap(earthly, 0.54, 0.48)
	await clickMap(earthly, 0.59, 0.51)
	await clickMap(earthly, 0.64, 0.47)
	await earthly.page.keyboard.press('Enter')
	await expectAttachedGeometryCount(earthly, 2)

	await earthly.page.getByRole('button', { name: 'Draw polygon', exact: true }).first().click()
	await clickMap(earthly, 0.59, 0.56)
	await clickMap(earthly, 0.65, 0.59)
	await clickMap(earthly, 0.68, 0.53)
	await earthly.page.keyboard.press('Enter')
	await expectAttachedGeometryCount(earthly, 3)

	await earthly.page.getByRole('button', { name: 'Draw label', exact: true }).first().click()
	await clickMap(earthly, 0.64, 0.37)
	const labelInput = earthly.page.getByPlaceholder('Type label text...')
	await expect(labelInput).toBeVisible()
	await labelInput.fill(input.label)
	await expectAttachedGeometryCount(earthly, 4)

	await earthly.page.getByRole('button', { name: 'Post', exact: true }).click()
	const comment = earthly.page
		.locator('div.group.rounded-lg.border')
		.filter({ hasText: input.comment })
		.first()
	await expect(comment).toBeVisible()
	await expect(comment.getByText('4 geometries', { exact: true })).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Hide annotations' })).toBeVisible()
	await expect
		.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length)
		.toBeGreaterThan(0)
}

export async function verifyCommentAnnotationDurability(
	earthly: EarthlySession,
	commentText: string,
): Promise<CommentOverlaySnapshot> {
	const comment = earthly.page
		.locator('div.group.rounded-lg.border')
		.filter({ hasText: commentText })
		.first()
	await expect(comment).toBeVisible({ timeout: 15_000 })
	await expect(earthly.page.getByRole('button', { name: 'Hide annotations' })).toBeVisible()
	await expect
		.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length)
		.toBeGreaterThan(0)

	await comment.getByRole('button', { name: 'Zoom', exact: true }).click()
	await setCommentAnnotationsVisible(earthly, false)
	await expect.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length).toBe(0)
	await setCommentAnnotationsVisible(earthly, true)
	await expect
		.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length)
		.toBeGreaterThan(0)

	const current = new URL(earthly.page.url())
	await earthly.open({ path: `${current.pathname}${current.search}`, tour: 'seen' })
	await expect(earthly.page.getByText(commentText, { exact: true }).first()).toBeVisible({
		timeout: 15_000,
	})
	await expect(earthly.page.getByRole('button', { name: 'Hide annotations' })).toBeVisible()
	await expect
		.poll(async () => (await commentOverlaySnapshot(earthly)).sourceIds.length)
		.toBeGreaterThan(0)
	return commentOverlaySnapshot(earthly)
}

export async function setCommentAnnotationsVisible(
	earthly: EarthlySession,
	visible: boolean,
): Promise<void> {
	const currentAction = visible ? 'Show annotations' : 'Hide annotations'
	const nextAction = visible ? 'Hide annotations' : 'Show annotations'
	await earthly.page.getByRole('button', { name: currentAction, exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: nextAction, exact: true })).toBeVisible()
}
