import { expect, type Locator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import type { Feature } from 'geojson'
import type { MapCallout } from '../../../src/lib/geo/callouts'

export const addMapCalloutTask: AiTaskMetadata = {
	id: 'editor.add-map-callout',
	summary: 'Add a map callout to the selected geometry through the visible composer.',
	preconditions: ['One geometry is selected in a local Dataset draft'],
	sideEffects: ['Adds authored callout content to the local draft'],
	viewports: 'both',
}

export const attachCalloutImageTask: AiTaskMetadata = {
	id: 'editor.attach-callout-image',
	summary: 'Attach an image URL to an editable map callout.',
	preconditions: ['The target callout is open in the local draft editor'],
	sideEffects: ['Stores an image attachment on the callout'],
	viewports: 'both',
}

export const setCalloutDisplayModeTask: AiTaskMetadata = {
	id: 'editor.callout-display-mode',
	summary: 'Cycle callouts between full cards, compact cards, and pins using map controls.',
	preconditions: ['At least one callout is visible on the map'],
	sideEffects: ['Changes the local map callout presentation'],
	viewports: 'both',
}

export function mapCalloutCard(earthly: EarthlySession, title?: string): Locator {
	return earthly.page.getByRole('article', {
		name: title ? `Map callout: ${title}` : 'Map callout',
		exact: true,
	})
}

export async function draftCalloutSnapshot(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): { editor?: { getAllFeatures(): Feature[] } }
				}
			}
		).__earthlyEditorStore
		return (store?.getState().editor?.getAllFeatures() ?? []).flatMap((feature) => {
			const callouts = feature.properties?.['earthly:callouts'] as MapCallout[] | undefined
			return (callouts ?? []).map((callout) => ({ ...callout, featureId: String(feature.id) }))
		})
	})
}

export async function addMapCallout(
	earthly: EarthlySession,
	text: string,
	title?: string,
): Promise<Locator> {
	const before = (await draftCalloutSnapshot(earthly)).length
	const add = earthly.page.getByRole('button', { name: 'Add map callout', exact: true })
	if (await add.isVisible()) await add.click()
	else {
		await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Add map callout', exact: true }).click()
	}
	const composer = earthly.page.getByTestId('map-callout-composer')
	await expect(composer).toBeVisible()
	await composer.getByRole('textbox').fill(text)
	await composer.getByRole('button', { name: 'Add to map', exact: true }).click()
	await expect.poll(async () => (await draftCalloutSnapshot(earthly)).length).toBe(before + 1)
	if (title) await mapCalloutCard(earthly).getByPlaceholder('Optional title').fill(title)
	const card = mapCalloutCard(earthly, title)
	await expect(card).toBeVisible()
	return card
}

export async function attachCalloutImage(
	earthly: EarthlySession,
	url: string,
	title?: string,
): Promise<void> {
	const card = mapCalloutCard(earthly, title)
	await card.getByLabel('Callout image URL').fill(url)
	await card.getByRole('button', { name: 'Add image', exact: true }).click()
	await expect
		.poll(async () =>
			(await draftCalloutSnapshot(earthly)).some(
				(callout) =>
					(!title || callout.title === title) && callout.media?.some((media) => media.url === url),
			),
		)
		.toBe(true)
}

export async function setCalloutDisplayMode(
	earthly: EarthlySession,
	mode: 'full' | 'compact' | 'pins',
): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const button = earthly.page.getByRole('button', { name: /^Callout size:/ })
		const menu = !(await button.isVisible())
		if (menu) await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
		const control = menu ? earthly.page.getByRole('menuitem', { name: /^Callout size:/ }) : button
		await expect(control).toBeVisible()
		const label = await control.getAttribute('aria-label')
		if (label?.startsWith(`Callout size: ${mode}.`)) {
			if (menu) await earthly.page.keyboard.press('Escape')
			return
		}
		await control.click()
	}
	throw new Error(`Could not switch callouts to ${mode}`)
}
