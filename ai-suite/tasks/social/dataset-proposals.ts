import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { addPointToGeometryDraft, geometryDraftSnapshot } from '../create/geometry'
import { placeMobilePrecisionPoint } from '../editor/mobile-precision-drawing'

export const reviewDatasetProposalTask: AiTaskMetadata = {
	id: 'social.review-dataset-proposal',
	summary: 'Open a Dataset proposal, preview its map change, and expose owner decisions.',
	preconditions: ['Signed-in Dataset owner', 'Dataset overview with an open proposal'],
	sideEffects: ['Toggles the proposal geometry preview on the map'],
	viewports: 'desktop',
}

export const decideDatasetProposalTask: AiTaskMetadata = {
	id: 'social.decide-dataset-proposal',
	summary: 'Request changes, reject, or accept a Dataset proposal as its owner.',
	preconditions: ['Signed-in Dataset owner', 'Expanded open proposal'],
	sideEffects: ['Publishes a proposal status and, when accepted, an updated Dataset'],
	viewports: 'desktop',
}

export const proposeDatasetEditTask: AiTaskMetadata = {
	id: 'social.propose-dataset-edit',
	summary: 'Load another author’s Dataset and send an edit proposal through the visible composer.',
	preconditions: ['Signed-in non-owner persona', 'Published Dataset URL'],
	sideEffects: ['Publishes a disposable Dataset proposal to the local development relay'],
	viewports: 'desktop',
}

export const proposeDatasetGeometryEditTask: AiTaskMetadata = {
	id: 'social.propose-dataset-geometry-edit',
	summary:
		'Load another author’s Dataset, add real geometry, and send the changed copy as an edit proposal.',
	preconditions: ['Signed-in non-owner persona', 'Published Dataset URL'],
	sideEffects: ['Publishes a geometry-changing Dataset proposal to the local development relay'],
	viewports: 'both',
}

export interface DatasetGeometryProposalResult {
	beforeFeatureCount: number
	proposedFeatureCount: number
}

async function submitCurrentDatasetProposal(
	earthly: EarthlySession,
	description: string,
): Promise<void> {
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'More tools', exact: true }).first().tap()
		await earthly.page.getByRole('menuitem', { name: /Propose edit to owner/ }).tap()
	} else {
		await earthly.page.getByText('File', { exact: true }).first().click()
		await earthly.page.getByRole('menuitem', { name: /Propose edit to owner/ }).click()
	}
	const dialog = earthly.page.getByRole('dialog', { name: 'Propose edit to owner' })
	await expect(dialog).toBeVisible()
	await dialog.locator('.ProseMirror[contenteditable="true"]').fill(description)
	await dialog.getByRole('button', { name: 'Send proposal', exact: true }).click()
	await expect(earthly.page.getByText('Edit proposal sent to the dataset owner.')).toBeVisible({
		timeout: 15_000,
	})
}

async function waitForEditorReady(earthly: EarthlySession): Promise<void> {
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean(
					(
						window as typeof window & {
							__earthlyEditorStore?: { getState(): { editor: unknown } }
						}
					).__earthlyEditorStore?.getState().editor,
				),
			),
		)
		.toBe(true)
}

export async function proposeDatasetEdit(
	earthly: EarthlySession,
	datasetUrl: string,
	description: string,
): Promise<void> {
	const url = new URL(datasetUrl)
	await earthly.open({ path: `${url.pathname}${url.search}`, tour: 'seen' })
	await waitForEditorReady(earthly)
	await earthly.page.getByRole('button', { name: 'Load copy', exact: true }).click()
	await expect(earthly.page.getByPlaceholder('Name').first()).toBeVisible({ timeout: 15_000 })
	await submitCurrentDatasetProposal(earthly, description)
}

export async function proposeDatasetGeometryEdit(
	earthly: EarthlySession,
	datasetUrl: string,
	description: string,
): Promise<DatasetGeometryProposalResult> {
	const url = new URL(datasetUrl)
	await earthly.open({ path: `${url.pathname}${url.search}`, tour: 'seen' })
	await waitForEditorReady(earthly)
	await earthly.page.getByRole('button', { name: 'Load copy', exact: true }).click()
	await expect(earthly.page.getByPlaceholder('Name').first()).toBeVisible({ timeout: 15_000 })
	await expect
		.poll(async () => (await geometryDraftSnapshot(earthly)).featureCount)
		.toBeGreaterThan(0)
	const beforeFeatureCount = (await geometryDraftSnapshot(earthly)).featureCount
	const proposedFeatureCount = earthly.isMobile
		? (await placeMobilePrecisionPoint(earthly, 0.72, 0.42)).featureCount
		: await addPointToGeometryDraft(earthly, 0.72, 0.42)
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Select / pan', exact: true }).first().tap()
	}
	await submitCurrentDatasetProposal(earthly, description)
	return { beforeFeatureCount, proposedFeatureCount }
}

async function openProposalsPanel(earthly: EarthlySession): Promise<void> {
	await earthly.page.getByRole('tab', { name: 'Proposals', exact: true }).click()
	await expect(earthly.page.getByText('Edit Proposals', { exact: true })).toBeVisible()
}

export async function openDatasetProposal(
	earthly: EarthlySession,
	description: string,
): Promise<void> {
	await openProposalsPanel(earthly)
	await expect(earthly.page.getByText(/\d+ open/)).toBeVisible({ timeout: 15_000 })
	const openCard = earthly.page.getByRole('button').filter({ hasText: 'Open' }).last()
	await expect(openCard).toBeVisible()
	await openCard.click()
	await expect(earthly.page.getByText(description, { exact: true })).toBeVisible()
}

export async function previewDatasetProposal(earthly: EarthlySession): Promise<void> {
	const preview = earthly.page.getByRole('button', { name: 'Preview proposal change' })
	await preview.click()
	await expect(earthly.page.getByRole('button', { name: 'Hide proposal preview' })).toHaveAttribute(
		'aria-pressed',
		'true',
	)
}

export async function requestDatasetProposalChanges(
	earthly: EarthlySession,
	reason: string,
): Promise<void> {
	await earthly.page.getByRole('button', { name: 'Request changes', exact: true }).click()
	const form = earthly.page.locator('form').filter({ hasText: 'Post' }).last()
	await form.locator('.ProseMirror[contenteditable="true"]').fill(reason)
	await form.getByRole('button', { name: 'Post', exact: true }).click()
	await expect(earthly.page.getByText('Change request sent')).toBeVisible()
	await expect(earthly.page.getByText('Needs changes', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText(reason, { exact: true })).toBeVisible()
}

export async function rejectDatasetProposal(earthly: EarthlySession): Promise<void> {
	await earthly.page.getByRole('button', { name: 'Reject proposal', exact: true }).click()
	await expect(earthly.page.getByText('Proposal rejected')).toBeVisible()
	await expect(earthly.page.getByText('Rejected', { exact: true })).toBeVisible()
}

export async function acceptDatasetProposal(earthly: EarthlySession): Promise<void> {
	await earthly.page.getByRole('button', { name: 'Accept proposal', exact: true }).click()
	await expect(earthly.page.getByText('Proposal accepted')).toBeVisible({ timeout: 15_000 })
	await expect(earthly.page.getByText('Accepted', { exact: true })).toBeVisible()
}
