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
