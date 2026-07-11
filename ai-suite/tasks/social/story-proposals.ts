import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const proposeStoryEditTask: AiTaskMetadata = {
	id: 'social.propose-story-edit',
	summary: 'Open a Story as another persona and publish a proposed narrative edit.',
	preconditions: ['Signed-in non-owner persona', 'Published Story URL on the local relay'],
	sideEffects: ['Publishes a Story edit proposal to the local development relay'],
	viewports: 'desktop',
}

export const acceptStoryEditTask: AiTaskMetadata = {
	id: 'social.accept-story-edit',
	summary: 'Review and accept an open Story edit proposal as the Story owner.',
	preconditions: ['Signed-in Story owner', 'Story reader view with an open proposal'],
	sideEffects: ['Publishes an updated Story and accepted proposal status to the local relay'],
	viewports: 'desktop',
}

export const rejectStoryEditTask: AiTaskMetadata = {
	id: 'social.reject-story-edit',
	summary: 'Review and reject an open Story edit proposal as the Story owner.',
	preconditions: ['Signed-in Story owner', 'Story reader view with an open proposal'],
	sideEffects: ['Publishes a rejected proposal status to the local development relay'],
	viewports: 'desktop',
}

export async function proposeStoryEdit(
	earthly: EarthlySession,
	storyUrl: string,
	proposedBody: string,
): Promise<void> {
	await draftStoryProposal(earthly, storyUrl, proposedBody)
	const dialog = earthly.page.getByRole('dialog', { name: 'Propose an edit' })
	await dialog.getByRole('button', { name: 'Propose an edit', exact: true }).click()
	await expect(dialog).toBeHidden()
	await expect(
		earthly.page.getByText('Edit proposed — the author will see it for review.'),
	).toBeVisible()
}

export async function draftStoryProposal(
	earthly: EarthlySession,
	storyUrl: string,
	proposedBody: string,
): Promise<void> {
	const url = new URL(storyUrl)
	await earthly.open({ path: `${url.pathname}${url.search}`, tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Propose an edit', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Propose an edit' })
	await expect(dialog).toBeVisible()
	const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
	await editor.click()
	await earthly.page.keyboard.press('ControlOrMeta+A')
	await earthly.page.keyboard.type(proposedBody)
}

async function openProposalReview(earthly: EarthlySession): Promise<void> {
	await expect(earthly.page.getByText(/1 proposed edit to review/)).toBeVisible({ timeout: 15_000 })
	await earthly.page.getByText('Review edit', { exact: true }).click()
	await expect(earthly.page.getByText('Proposed', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText('Current', { exact: true })).toBeVisible()
}

export async function acceptStoryEdit(
	earthly: EarthlySession,
	proposedBody: string,
): Promise<void> {
	await openProposalReview(earthly)
	await earthly.page.getByRole('button', { name: 'Accept edit', exact: true }).click()
	await expect(earthly.page.getByText('Edit applied — your story is updated.')).toBeVisible()
	await expect(earthly.page.getByText(proposedBody, { exact: true }).first()).toBeVisible()
}

export async function rejectStoryEdit(earthly: EarthlySession): Promise<void> {
	await openProposalReview(earthly)
	await earthly.page.getByRole('button', { name: 'Reject', exact: true }).click()
	await expect(
		earthly.page.getByText('Proposed edit rejected — your story stays as-is.'),
	).toBeVisible()
}
