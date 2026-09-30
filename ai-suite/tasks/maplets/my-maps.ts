import { expect, type FrameLocator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openGMapperTask: AiTaskMetadata = {
	id: 'maplets.open-gmapper',
	summary: 'Open GMapper from the Maplets directory without activating a configuration.',
	preconditions: ['Earthly Maplets panel is open'],
	sideEffects: ['Starts the bundled sandbox and opens its sidebar surface'],
	viewports: 'both',
}
export const createGMapperConfigurationTask: AiTaskMetadata = {
	id: 'maplets.create-gmapper-configuration',
	summary: 'Create and preview a named Google My Maps configuration.',
	preconditions: [
		'GMapper is open',
		'The public source is a controlled fixture or authorized source',
	],
	sideEffects: [
		'Fetches public KML in the browser',
		'Saves a local draft',
		'Displays preview geometry',
	],
	viewports: 'both',
}
export const publishGMapperConfigurationTask: AiTaskMetadata = {
	id: 'maplets.publish-gmapper-configuration',
	summary: 'Review and publish a GMapper configuration through the explicit publication step.',
	preconditions: ['A loaded configuration editor is open', 'Signed-in local development persona'],
	sideEffects: [
		'Publishes configuration metadata to isolated local relays',
		'Encrypts private preferences',
	],
	viewports: 'both',
}
export const openGMapperConfigurationTask: AiTaskMetadata = {
	id: 'maplets.open-gmapper-configuration',
	summary: 'Find a GMapper configuration in the current list and open its details.',
	preconditions: [
		'GMapper configuration directory is visible',
		'The configuration is discoverable or saved',
	],
	sideEffects: ['Opens configuration details without fetching geometry'],
	viewports: 'both',
}

export function gmapperFrame(earthly: EarthlySession): FrameLocator {
	return earthly.page.frameLocator('iframe[title="GMapper sandbox"]')
}
export async function openGMapper(earthly: EarthlySession) {
	await earthly.page.getByRole('button', { name: 'Open GMapper', exact: true }).click()
	const frame = gmapperFrame(earthly)
	await expect(
		frame.getByRole('button', { name: 'Create configuration', exact: true }),
	).toBeEnabled()
	await expect(
		frame.getByRole('tab', { name: 'Explore configurations', exact: true }),
	).toBeVisible()
	return frame
}
export async function createGMapperConfiguration(
	earthly: EarthlySession,
	url: string,
	name: string,
) {
	const frame = gmapperFrame(earthly)
	await frame.getByRole('button', { name: 'Create configuration', exact: true }).click()
	await frame.getByLabel('Google My Maps link', { exact: true }).fill(url)
	await frame.getByRole('button', { name: 'Load preview', exact: true }).click()
	await expect(frame.getByLabel('Configuration name', { exact: true })).toBeVisible()
	await frame.getByLabel('Configuration name', { exact: true }).fill(name)
	await expect(frame.getByRole('button', { name: 'Publish…', exact: true })).toBeEnabled()
	return frame
}
export async function publishGMapperConfiguration(earthly: EarthlySession, update = false) {
	const frame = gmapperFrame(earthly)
	await frame
		.getByRole('button', { name: update ? 'Review update' : 'Publish…', exact: true })
		.click()
	await expect(frame.getByText('Publication review', { exact: true })).toBeVisible()
	await expect(
		frame.getByText('Geometry is fetched from Google. It is not included in this publication.', {
			exact: true,
		}),
	).toBeVisible()
	await frame
		.getByRole('button', { name: update ? 'Publish update' : 'Publish configuration', exact: true })
		.click()
	await expect(frame.getByRole('status').first()).toContainText('Configuration published.')
	return frame
}
export async function openGMapperConfiguration(
	earthly: EarthlySession,
	name: string,
	yours = false,
) {
	const frame = gmapperFrame(earthly)
	await frame
		.getByRole('tab', { name: yours ? 'Yours' : 'Explore configurations', exact: true })
		.click()
	await frame.getByLabel('Search configurations', { exact: true }).fill(name)
	const row = frame.getByRole('article', { name, exact: true })
	await row
		.getByRole('button', { name, exact: true })
		.or(row.getByRole('button', { name: `Resume draft: ${name}`, exact: true }))
		.click()
	await expect(
		frame
			.getByRole('heading', { name, exact: true })
			.or(frame.getByLabel('Configuration name', { exact: true })),
	).toBeVisible()
	return frame
}
