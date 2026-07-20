import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { clickEditorMap } from './geometry'

export const createSightingTask: AiTaskMetadata = {
	id: 'create.sighting',
	summary: 'Place, describe, and publish a public Sighting through the responsive create journey.',
	preconditions: ['Earthly is open', 'A local test identity is authorized', 'The map is ready'],
	sideEffects: ['Publishes a disposable Sighting event to the local development relay'],
	viewports: 'both',
}

export interface SightingInput {
	title: string
	description: string
}

export async function startSightingPlacement(earthly: EarthlySession): Promise<void> {
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Sighting', exact: true }).click()
	} else {
		await earthly.page.getByRole('button', { name: 'Sightings', exact: true }).click()
		await earthly.page.getByRole('button', { name: 'New Sighting', exact: true }).click()
	}
	await expect(earthly.page.getByText('Click the map to drop your sighting')).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Cancel placement' })).toBeVisible()
}

export async function cancelSightingPlacement(earthly: EarthlySession): Promise<void> {
	await earthly.page.getByRole('button', { name: 'Cancel placement' }).click()
	await expect(earthly.page.getByText('Click the map to drop your sighting')).toBeHidden()
	await expect(earthly.page.locator('.maplibregl-canvas')).toBeVisible()
}

export async function placeSighting(earthly: EarthlySession): Promise<void> {
	await clickEditorMap(earthly, 0.58, 0.36)
	await expect(
		earthly.page.getByRole('heading', { name: 'New Sighting', exact: true }),
	).toBeVisible()
}

export async function publishSighting(
	earthly: EarthlySession,
	input: SightingInput,
): Promise<void> {
	await earthly.page.getByLabel('Title', { exact: true }).fill(input.title)
	await earthly.page.getByLabel('Description', { exact: true }).fill(input.description)
	await expect(earthly.page.getByRole('button', { name: 'Add a photo' })).toBeVisible()
	const publish = earthly.page.getByRole('button', { name: 'Publish Sighting', exact: true })
	await expect(publish).toBeEnabled()
	await publish.click()
	await expect(
		earthly.page.getByRole('heading', { name: input.title, exact: true }).first(),
	).toBeVisible({
		timeout: 15_000,
	})
	await expect.poll(() => new URL(earthly.page.url()).pathname).toMatch(/^\/sightings(?:\/|$)/)
}

export async function createAndPublishSighting(
	earthly: EarthlySession,
	input: SightingInput,
): Promise<void> {
	await startSightingPlacement(earthly)
	await placeSighting(earthly)
	await publishSighting(earthly, input)
}
