import { expect, type Locator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const startDatasetTask: AiTaskMetadata = {
	id: 'create.start-dataset',
	summary: 'Start a new local Dataset draft through the visible creation UI.',
	preconditions: ['Earthly is open', 'First-run tour is not blocking the UI'],
	sideEffects: ['Creates an unsaved local workspace and draft'],
	viewports: 'both',
}

export interface DatasetDraftResult {
	pathname: string
	nameInput: Locator
}

export async function startDataset(earthly: EarthlySession): Promise<DatasetDraftResult> {
	// startNewDataset silently no-ops until the GeoEditor instance exists (it
	// is created on the map's style-load). Wait for it so the create click
	// can't race map initialization on a slow tile fetch.
	await expect
		.poll(
			() =>
				earthly.page.evaluate(() =>
					Boolean(
						(
							window as { __earthlyEditorStore?: { getState(): { editor: unknown } } }
						).__earthlyEditorStore?.getState().editor,
					),
				),
			{ timeout: 30_000 },
		)
		.toBe(true)

	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Dataset', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Datasets', exact: true }).click()
		await earthly.page.getByRole('button', { name: 'New dataset' }).click()
	}

	const nameInput = earthly.page.getByPlaceholder('Name').first()
	await expect(nameInput).toBeVisible()
	await expect(earthly.page.getByText('Untitled draft').first()).toBeVisible()
	return { pathname: new URL(earthly.page.url()).pathname, nameInput }
}
