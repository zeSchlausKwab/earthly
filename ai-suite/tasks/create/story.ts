import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export interface StoryDraftInput {
	title: string
	summary?: string
	body: string
}

export const createStoryDraftTask: AiTaskMetadata = {
	id: 'create.story-draft',
	summary: 'Open the Story editor, fill its content, and save a local draft.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Stores an unpublished Story draft in browser storage'],
	viewports: 'both',
}

export const publishStoryTask: AiTaskMetadata = {
	id: 'create.publish-story',
	summary: 'Create and publish a Story (Nostr long-form Article) through the visible editor.',
	preconditions: ['Signed-in local development persona', 'Earthly is open'],
	sideEffects: ['Publishes a Story event to the local development relay'],
	viewports: 'both',
}

export const insertStoryReferenceTask: AiTaskMetadata = {
	id: 'create.insert-story-reference',
	summary:
		'Insert a Dataset, feature, OSM element, or map-picked coordinate through the Story editor.',
	preconditions: [
		'Open Story editor',
		'Referenced entity is loaded or published to the local relay',
	],
	sideEffects: ['Adds an inline spatial reference to the current Story draft'],
	viewports: 'desktop',
}

export async function openStoryReferencePicker(earthly: EarthlySession): Promise<void> {
	const editor = earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
	await expect(editor).toBeVisible()
	await editor.focus()
	const isMac = await earthly.page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
	await earthly.page.keyboard.press(isMac ? 'Meta+ArrowDown' : 'Control+End')
	await editor.pressSequentially('$')
	await expect(earthly.page.getByRole('listbox', { name: 'Spatial references' })).toBeVisible()
}

export async function pickStoryCoordinateFromOpenPicker(earthly: EarthlySession): Promise<string> {
	const editor = earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
	await earthly.page.getByRole('button', { name: 'Pick a coordinate on the map' }).click()
	await expect(
		earthly.page.getByText('Click the map to insert this coordinate into the article.'),
	).toBeVisible({ timeout: 15_000 })

	const pickerSurface = earthly.page.getByRole('button', { name: 'Choose coordinate on map' })
	await expect(pickerSurface).toBeVisible()
	await expect(pickerSurface).toHaveCSS('cursor', 'crosshair')
	const mapBounds = await pickerSurface.boundingBox()
	if (!mapBounds) throw new Error('Map is not available for coordinate picking')
	// The map stack occupies the upper-left of the canvas. Pick an unobstructed
	// point on the right so this exercises the same visible click a user makes.
	await earthly.page.mouse.click(
		mapBounds.x + mapBounds.width * 0.72,
		mapBounds.y + mapBounds.height * 0.55,
	)
	await expect(
		earthly.page.getByText('Click the map to insert this coordinate into the article.'),
	).toBeHidden()

	const mention = editor.locator('[title^="geo:"]').last()
	await expect(mention).toBeVisible()
	const reference = await mention.getAttribute('title')
	if (!reference?.startsWith('geo:')) throw new Error('Coordinate picker did not insert a geo URI')
	return reference
}

export async function insertStoryCoordinateReference(earthly: EarthlySession): Promise<string> {
	await openStoryReferencePicker(earthly)
	return pickStoryCoordinateFromOpenPicker(earthly)
}

export async function createStoryDraft(
	earthly: EarthlySession,
	input: StoryDraftInput,
): Promise<void> {
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Story', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Stories', exact: true }).click()
		await earthly.page.getByRole('button', { name: 'New Story' }).click()
	}

	await expect(earthly.page.getByText('New Story').first()).toBeVisible()
	await earthly.page.getByLabel('Title').fill(input.title)
	if (input.summary) await earthly.page.getByLabel('Summary').fill(input.summary)
	await earthly.page.locator('.ProseMirror[contenteditable="true"]').fill(input.body)
	await earthly.page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(earthly.page.getByLabel('Title')).toHaveValue(input.title)
}

export async function publishOpenStory(earthly: EarthlySession): Promise<void> {
	const publishButton = earthly.page.getByRole('button', { name: 'Publish Story', exact: true })
	await expect(publishButton).toBeEnabled()
	await publishButton.click()
	await expect(earthly.page.getByText('New Story').first()).toBeHidden()
}

export async function insertStoryReference(
	earthly: EarthlySession,
	input: { query: string; expectedName: string },
): Promise<void> {
	const editor = earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
	await expect(editor).toBeVisible()
	await editor.focus()
	const isMac = await earthly.page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
	await earthly.page.keyboard.press(isMac ? 'Meta+ArrowDown' : 'Control+End')
	await editor.pressSequentially(`$${input.query}`, { delay: 15 })
	const escapedName = input.expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const option = earthly.page
		.getByRole('button', { name: new RegExp(`^${escapedName}(?:\\s|$)`) })
		.last()
	await expect(option).toBeVisible({ timeout: 10_000 })
	await option.click()
	await expect(editor.getByText(input.expectedName, { exact: true })).toBeVisible()
}

export async function createAndPublishStory(
	earthly: EarthlySession,
	input: StoryDraftInput,
): Promise<{ url: string }> {
	await createStoryDraft(earthly, input)
	await publishOpenStory(earthly)
	// Publish now lands directly on the published Story's canonical reader
	// route (workflow audit P1) — no catalog round-trip needed.
	await expect
		.poll(() => new URL(earthly.page.url()).pathname, { timeout: 15_000 })
		.toMatch(/^\/stories\/story\//)
	await expect(earthly.page.getByText(input.title, { exact: true }).first()).toBeVisible()
	await expect(earthly.page.getByText(input.body, { exact: true }).first()).toBeVisible()
	return { url: earthly.page.url() }
}
