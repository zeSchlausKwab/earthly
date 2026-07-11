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
	summary: 'Draw a label on the map and publish it as geometry attached to a comment.',
	preconditions: ['Signed-in local development persona', 'An entity comment surface is visible'],
	sideEffects: ['Publishes a comment with GeoJSON to the local development relay'],
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

export async function setCommentAnnotationsVisible(
	earthly: EarthlySession,
	visible: boolean,
): Promise<void> {
	const currentAction = visible ? 'Show annotations' : 'Hide annotations'
	const nextAction = visible ? 'Hide annotations' : 'Show annotations'
	await earthly.page.getByRole('button', { name: currentAction, exact: true }).click()
	await expect(earthly.page.getByRole('button', { name: nextAction, exact: true })).toBeVisible()
}
