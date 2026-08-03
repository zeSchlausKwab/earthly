import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { clickEditorMap } from '../create/geometry'

export const addMapCalloutTask: AiTaskMetadata = {
	id: 'editor.add-map-callout',
	summary: 'Author a contextual callout on a selected geometry or a new point anchor.',
	preconditions: ['An active Dataset draft'],
	sideEffects: [
		'Adds authored callout content and placement to the selected feature, or creates a point anchor',
	],
	viewports: 'both',
}

export interface MapCalloutSnapshot {
	featureId: string
	calloutId: string
	text: string
	offset: [number, number]
}

async function currentMapCallout(earthly: EarthlySession): Promise<MapCalloutSnapshot | null> {
	return earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						features: Array<{
							id: string
							properties?: Record<string, unknown>
						}>
					}
				}
			}
		).__earthlyEditorStore
		for (const feature of store?.getState().features ?? []) {
			const callouts = feature.properties?.['earthly:callouts']
			if (!Array.isArray(callouts) || !callouts[0] || typeof callouts[0] !== 'object') continue
			const callout = callouts[0] as {
				id?: unknown
				text?: unknown
				placement?: { offset?: unknown }
			}
			if (typeof callout.id !== 'string' || typeof callout.text !== 'string') continue
			const rawOffset = callout.placement?.offset
			const offset: [number, number] =
				Array.isArray(rawOffset) &&
				typeof rawOffset[0] === 'number' &&
				typeof rawOffset[1] === 'number'
					? [rawOffset[0], rawOffset[1]]
					: [0, 0]
			return { featureId: feature.id, calloutId: callout.id, text: callout.text, offset }
		}
		return null
	})
}

export async function addMapCallout(
	earthly: EarthlySession,
	text: string,
): Promise<MapCalloutSnapshot> {
	const toolbarAction = earthly.page.getByRole('button', { name: 'Add map callout', exact: true })
	await expect(toolbarAction).toBeVisible()
	await toolbarAction.click()
	const composer = earthly.page.getByTestId('map-callout-composer')
	const anchorAction = earthly.page.getByRole('button', {
		name: 'Cancel callout anchor',
		exact: true,
	})
	await expect(composer.or(anchorAction)).toBeVisible()
	if (await anchorAction.isVisible()) {
		await clickEditorMap(earthly, 0.62, 0.42)
	}
	await expect(composer).toBeVisible()
	const editor = composer.locator('[contenteditable="true"]').first()
	await expect(editor).toBeVisible()
	await editor.fill(text)
	await composer.getByRole('button', { name: 'Add to map' }).click()
	await expect(composer).toBeHidden()

	const callout = earthly.page.locator('[data-callout-state="full"]').filter({ hasText: text })
	await expect(callout).toBeVisible()
	await expect.poll(() => currentMapCallout(earthly)).toMatchObject({ text })
	const snapshot = await currentMapCallout(earthly)
	if (!snapshot) throw new Error('The callout was visible but missing from the active draft')
	return snapshot
}

export async function editFirstMapCalloutText(
	earthly: EarthlySession,
	text: string,
): Promise<MapCalloutSnapshot> {
	const existing = await currentMapCallout(earthly)
	if (!existing) throw new Error('No map callout is available to edit')
	const card = earthly.page
		.locator('[data-callout-state="full"]')
		.filter({ hasText: existing.text })
		.first()
	await expect(card).toBeVisible()
	const editor = card.locator('[contenteditable="true"]').first()
	await expect(editor).toBeVisible()
	await editor.fill(text)
	await expect.poll(async () => (await currentMapCallout(earthly))?.text).toBe(text)
	const snapshot = await currentMapCallout(earthly)
	if (!snapshot) throw new Error('The edited callout disappeared from the active draft')
	return snapshot
}

export async function dragSelectedMapCallout(
	earthly: EarthlySession,
	delta: { x: number; y: number },
): Promise<MapCalloutSnapshot> {
	const handle = earthly.page.getByTitle('Drag to position this callout')
	await expect(handle).toBeVisible()
	const box = await handle.boundingBox()
	if (!box) throw new Error('The callout drag handle has no bounding box')
	await earthly.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
	await earthly.page.mouse.down()
	await earthly.page.mouse.move(box.x + box.width / 2 + delta.x, box.y + box.height / 2 + delta.y, {
		steps: 4,
	})
	await earthly.page.mouse.up()
	await expect.poll(async () => (await currentMapCallout(earthly))?.offset).not.toEqual([0, 0])
	const snapshot = await currentMapCallout(earthly)
	if (!snapshot) throw new Error('The dragged callout was missing from the active draft')
	return snapshot
}

export type MapCalloutDisplayMode = 'full' | 'compact' | 'collapsed'

const calloutDisplayActionLabels: Record<MapCalloutDisplayMode, string> = {
	full: 'Callout size: full. Switch to compact',
	compact: 'Callout size: compact. Switch to pins',
	collapsed: 'Callout size: pins. Switch to full',
}

export async function cycleMapCalloutDisplayMode(
	earthly: EarthlySession,
	currentMode: MapCalloutDisplayMode,
	nextMode: MapCalloutDisplayMode,
): Promise<void> {
	const action = earthly.page.getByRole('button', {
		name: calloutDisplayActionLabels[currentMode],
		exact: true,
	})
	await expect(action).toBeVisible()
	await action.click()
	await expect(
		earthly.page.getByRole('button', {
			name: calloutDisplayActionLabels[nextMode],
			exact: true,
		}),
	).toBeVisible()
	await expect(earthly.page.locator(`[data-callout-state="${nextMode}"]`)).toBeVisible()
}
