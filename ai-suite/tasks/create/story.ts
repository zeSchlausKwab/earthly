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
