import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openMyMapsViewerTask: AiTaskMetadata = {
	id: 'maplets.open-my-maps-viewer',
	summary: 'Start the browser-only My Maps Viewer from the Maplets catalog.',
	preconditions: ['Earthly Maplets panel is open'],
	sideEffects: ['Adds the bundled viewer to the map stack'],
	viewports: 'both',
}
export const addMyMapsSourceTask: AiTaskMetadata = {
	id: 'maplets.add-my-maps-source',
	summary: 'Display a public My Maps source through the viewer’s URL control.',
	preconditions: [
		'My Maps Viewer is open',
		'The source is a controlled fixture or an explicitly requested public map',
	],
	sideEffects: ['Fetches public KML in the browser', 'Displays source geometry on the map'],
	viewports: 'both',
}
export async function openMyMapsViewer(earthly: EarthlySession) {
	await earthly.page.getByRole('button', { name: 'Add My Maps Viewer to map', exact: true }).click()
	const frame = earthly.page.frameLocator('iframe[title="My Maps Viewer sandbox"]')
	await expect(frame.getByRole('button', { name: 'Add source', exact: true })).toBeEnabled()
	return frame
}
export async function addMyMapsSource(earthly: EarthlySession, url: string, name: string) {
	const frame = earthly.page.frameLocator('iframe[title="My Maps Viewer sandbox"]')
	await frame.getByLabel('Google My Maps link', { exact: true }).fill(url)
	await frame.getByRole('button', { name: 'Add source', exact: true }).click()
	await expect(frame.getByRole('article', { name, exact: true }).getByRole('status')).toContainText(
		'Last fetched',
	)
	return frame
}
