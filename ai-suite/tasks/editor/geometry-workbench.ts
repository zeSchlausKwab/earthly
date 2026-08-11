import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { clickEditorMap, createGeometryDraft, expectGeometryFeatureCount } from '../create/geometry'
import { startDataset } from '../create/dataset'

export const geometryWorkbenchTask: AiTaskMetadata = {
	id: 'editor.geometry-workbench',
	summary: 'Range-select, reorder, and copy geometries through the Dataset geometry workbench.',
	preconditions: ['Desktop Earthly session', 'The map editor has initialized'],
	sideEffects: [
		'Creates and reorders geometries in an unsaved Dataset draft',
		'Writes GeoJSON to the clipboard',
	],
	viewports: 'desktop',
}

export interface GeometryWorkbenchResult {
	selectedAfterRange: number
	orderChanged: boolean
	copyConfirmed: boolean
	visibleTypes: string[]
}

export interface OverlapChooserResult {
	candidateCount: number
	selectedFeatureCount: number
}

async function geometryOrder(earthly: EarthlySession): Promise<string[]> {
	return earthly.page
		.locator('[data-geometry-id]')
		.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-geometry-id') ?? ''))
}

export async function exerciseGeometryWorkbench(
	earthly: EarthlySession,
): Promise<GeometryWorkbenchResult> {
	await createGeometryDraft(earthly, 'Workbench label')

	const geometryRows = earthly.page.locator('[data-geometry-id]')
	await expect(geometryRows).toHaveCount(4)
	const selectionButtons = geometryRows.getByRole('button', { name: /^Select / })
	await expect(selectionButtons).toHaveCount(4)

	await selectionButtons.nth(0).click()
	await selectionButtons.nth(2).click({ modifiers: ['Shift'] })
	const selectedRows = earthly.page.locator('[data-geometry-id][data-selected="true"]')
	await expect(selectedRows).toHaveCount(3)

	const beforeOrder = await geometryOrder(earthly)
	const firstRow = geometryRows.nth(0)
	await firstRow.getByRole('button', { name: /^More actions for / }).click()
	await earthly.page.getByRole('menuitem', { name: 'Move down', exact: true }).click()
	await expect.poll(() => geometryOrder(earthly)).not.toEqual(beforeOrder)
	const afterOrder = await geometryOrder(earthly)

	const firstAfterMove = earthly.page.locator('[data-geometry-id]').nth(0)
	await firstAfterMove.getByRole('button', { name: /^Copy .* as GeoJSON$/ }).click()
	const copyToast = earthly.page.getByText('Geometry GeoJSON copied', { exact: true })
	await expect(copyToast).toBeVisible()

	const visibleTypes = await earthly.page
		.locator('[data-geometry-id]')
		.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-geometry-type') ?? ''))

	return {
		selectedAfterRange: await selectedRows.count(),
		orderChanged: afterOrder.join('|') !== beforeOrder.join('|'),
		copyConfirmed: await copyToast.isVisible(),
		visibleTypes,
	}
}

export async function exerciseOverlappingGeometryChooser(
	earthly: EarthlySession,
): Promise<OverlapChooserResult> {
	await startDataset(earthly)
	await expect
		.poll(
			() =>
				earthly.page.evaluate(() =>
					Boolean(
						(
							window as typeof window & {
								__earthlyUiMap?: { getLayer(id: string): unknown }
							}
						).__earthlyUiMap?.getLayer('geo-editor-point'),
					),
				),
			{ timeout: 30_000 },
		)
		.toBe(true)
	for (const expectedCount of [1, 2]) {
		await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
		await clickEditorMap(earthly, 0.62, 0.42)
		await expectGeometryFeatureCount(earthly, expectedCount)
	}

	await earthly.page.getByRole('button', { name: 'Select mode', exact: true }).click()

	const canvas = earthly.page.locator('.maplibregl-canvas')
	const renderedPoint = await earthly.page.evaluate(() => {
		const editorStore = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): { features: Array<{ geometry?: { type: string; coordinates?: number[] } }> }
				}
			}
		).__earthlyEditorStore
		const map = (
			window as typeof window & {
				__earthlyUiMap?: { project(coordinates: [number, number]): { x: number; y: number } }
			}
		).__earthlyUiMap
		const geometry = editorStore?.getState().features[0]?.geometry
		if (!map || geometry?.type !== 'Point' || !geometry.coordinates) return null
		return map.project([geometry.coordinates[0] ?? 0, geometry.coordinates[1] ?? 0])
	})
	if (!renderedPoint) throw new Error('Unable to project the overlapping point on the map')
	await canvas.click({ position: renderedPoint })

	const chooser = earthly.page.getByRole('menu', { name: 'Choose geometry', exact: true })
	await expect(chooser).toBeVisible()
	const candidates = chooser.getByRole('menuitem')
	await expect(candidates).toHaveCount(2)
	const candidateCount = await candidates.count()
	await candidates.first().click()
	await expect(chooser).toBeHidden()

	const selectedFeatureCount = await earthly.page.evaluate(
		() =>
			(
				window as typeof window & {
					__earthlyEditorStore?: { getState(): { selectedFeatureIds: string[] } }
				}
			).__earthlyEditorStore?.getState().selectedFeatureIds.length ?? 0,
	)
	return { candidateCount, selectedFeatureCount }
}
