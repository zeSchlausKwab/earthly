import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { startDataset } from '../create/dataset'
import {
	addPolygonToGeometryDraft,
	clickEditorMap,
	expectGeometryFeatureCount,
	geometryDraftSnapshot,
} from '../create/geometry'

export const geometryOperationsTask: AiTaskMetadata = {
	id: 'editor.geometry-operations',
	summary: 'Apply numeric, drag, and cutter-based geometry operations through the editor menus.',
	preconditions: ['Desktop Earthly session', 'The map editor has initialized'],
	sideEffects: ['Creates an unsaved Dataset draft with derived line geometry'],
	viewports: 'desktop',
}

export const extrudeLineTask: AiTaskMetadata = {
	id: 'editor.extrude-line',
	summary:
		'Extrude the selected line into a filled fat line or fat arrow through the width dialog.',
	preconditions: ['Earthly is open', 'Exactly one line is selected in an unsaved Dataset draft'],
	sideEffects: ['Creates a derived polygon, optionally replacing its source line'],
	viewports: 'both',
}

export interface ExtrudeLineOptions {
	shape: 'line' | 'arrow'
	width: number
	endWidth: number
	units?: 'Meters' | 'Kilometers' | 'Miles'
	side?: 'Centered on line' | 'Left of line direction' | 'Right of line direction'
	resultMode?: 'Create derived copy' | 'Replace selected feature'
	arrowHeadLength?: number
	arrowHeadWidth?: number
}

export async function extrudeSelectedLine(earthly: EarthlySession, options: ExtrudeLineOptions) {
	const before = (await geometryDraftSnapshot(earthly)).featureCount
	await openGeometryOperations(earthly)
	await earthly.page
		.getByRole('menuitem', { name: `Line → Fat ${options.shape}`, exact: true })
		.click()
	const dialog = earthly.page.getByRole('dialog', {
		name: `Create fat ${options.shape}`,
		exact: true,
	})
	await expect(dialog).toBeVisible()
	await dialog.getByLabel('Start width', { exact: true }).fill(String(options.width))
	await dialog.getByLabel('End width', { exact: true }).fill(String(options.endWidth))
	for (const [label, value] of [
		['Units', options.units],
		['Extrusion side', options.side],
		['Result', options.resultMode],
	]) {
		if (!value) continue
		await dialog.getByLabel(label!, { exact: true }).click()
		await earthly.page.getByRole('option', { name: value, exact: true }).click()
	}
	if (options.arrowHeadLength !== undefined)
		await dialog
			.getByLabel('Arrowhead length', { exact: true })
			.fill(String(options.arrowHeadLength))
	if (options.arrowHeadWidth !== undefined)
		await dialog.getByLabel('Arrowhead width', { exact: true }).fill(String(options.arrowHeadWidth))
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
	await expect(dialog).toBeHidden()
	await expectGeometryFeatureCount(
		earthly,
		before + (options.resultMode === 'Replace selected feature' ? 0 : 1),
	)
	return geometryDraftSnapshot(earthly)
}

export async function selectLastLine(earthly: EarthlySession): Promise<void> {
	await earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						editor?: {
							getAllFeatures(): Array<{ id: string; geometry: { type: string } }>
							selectFeature(id: string): void
						}
					}
				}
			}
		).__earthlyEditorStore
		const editor = store?.getState().editor
		const feature = [...(editor?.getAllFeatures() ?? [])]
			.reverse()
			.find((candidate) => ['LineString', 'MultiLineString'].includes(candidate.geometry.type))
		if (!editor || !feature) throw new Error('No line feature is available to select')
		editor.selectFeature(feature.id)
	})
}

async function selectLastPolygon(earthly: EarthlySession): Promise<void> {
	await earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						editor?: {
							getAllFeatures(): Array<{ id: string; geometry: { type: string } }>
							selectFeature(id: string): void
						}
					}
				}
			}
		).__earthlyEditorStore
		const editor = store?.getState().editor
		const feature = [...(editor?.getAllFeatures() ?? [])]
			.reverse()
			.find((candidate) => ['Polygon', 'MultiPolygon'].includes(candidate.geometry.type))
		if (!editor || !feature) throw new Error('No polygon feature is available to select')
		editor.selectFeature(feature.id)
	})
}

export async function openGeometryOperations(earthly: EarthlySession): Promise<void> {
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'More tools', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Geometry operations', exact: true }).click()
		return
	}
	const button = earthly.page.getByRole('button', { name: 'Geometry operations', exact: true })
	if (await button.isVisible()) {
		await button.click()
		return
	}
	await earthly.page.getByRole('menuitem', { name: 'Edit', exact: true }).click()
	await earthly.page
		.getByRole('menuitem', { name: 'Geometry operations', exact: true })
		.press('ArrowRight')
}

async function openParallelLineChoices(earthly: EarthlySession): Promise<void> {
	await openGeometryOperations(earthly)
	await earthly.page
		.getByRole('menuitem', { name: 'Offset / Corridor', exact: true })
		.press('ArrowRight')
	await earthly.page
		.getByRole('menuitem', { name: 'Line → Parallel line', exact: true })
		.press('ArrowRight')
}

async function selectedLineScreenPoint(earthly: EarthlySession): Promise<{ x: number; y: number }> {
	return earthly.page.evaluate(() => {
		const root = window as typeof window & {
			__earthlyMap?: {
				project(position: [number, number]): { x: number; y: number }
			}
			__earthlyEditorStore?: {
				getState(): {
					editor?: {
						getSelectedFeatures(): Array<{
							geometry: { type: string; coordinates: unknown }
						}>
					}
				}
			}
		}
		const selected = root.__earthlyEditorStore?.getState().editor?.getSelectedFeatures()[0]
		if (!selected || selected.geometry.type !== 'LineString' || !root.__earthlyMap) {
			throw new Error('A selected LineString and loaded map are required')
		}
		const coordinates = selected.geometry.coordinates as [number, number][]
		const first = coordinates[0]
		const last = coordinates.at(-1)
		if (!first || !last) throw new Error('The selected line has no coordinates')
		return root.__earthlyMap.project([(first[0] + last[0]) / 2, (first[1] + last[1]) / 2])
	})
}

export interface GeometryOperationsResult {
	featureCount: number
	geometryTypes: string[]
	numericDialogVisible: boolean
	dragGuidanceVisible: boolean
	splitGuidanceVisible: boolean
}

export async function exerciseGeometryOperations(
	earthly: EarthlySession,
): Promise<GeometryOperationsResult> {
	await startDataset(earthly)
	await earthly.page.getByRole('button', { name: 'Draw line', exact: true }).first().click()
	await clickEditorMap(earthly, 0.45, 0.5)
	await clickEditorMap(earthly, 0.65, 0.5)
	await earthly.page.keyboard.press('Enter')
	await expectGeometryFeatureCount(earthly, 1)
	await selectLastLine(earthly)

	await openParallelLineChoices(earthly)
	await earthly.page.getByRole('menuitem', { name: 'Enter distance…', exact: true }).press('Enter')
	const dialog = earthly.page.getByRole('dialog', { name: 'Create parallel line' })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByText('Perpendicular distance', { exact: true })).toBeVisible()
	const numericDialogVisible = true
	await dialog.getByLabel('Perpendicular distance').fill('25')
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 2)

	await openParallelLineChoices(earthly)
	await earthly.page.getByRole('menuitem', { name: 'Drag on map', exact: true }).press('Enter')
	await expect(earthly.page.getByText('Geometry operation · Drag', { exact: true })).toBeVisible()
	const dragGuidanceVisible = true
	const canvas = earthly.page.locator('.maplibregl-canvas')
	const box = await canvas.boundingBox()
	if (!box) throw new Error('Map canvas has no visible bounding box')
	await earthly.page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)
	await earthly.page.mouse.down()
	await earthly.page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.38, {
		steps: 8,
	})
	await earthly.page.mouse.up()
	await expectGeometryFeatureCount(earthly, 3)
	await expect(earthly.page.getByText('Geometry operation · Drag', { exact: true })).toBeHidden()

	await selectLastLine(earthly)
	const splitPoint = await selectedLineScreenPoint(earthly)
	await openGeometryOperations(earthly)
	await earthly.page.getByRole('menuitem', { name: 'Cut / Split', exact: true }).press('ArrowRight')
	await earthly.page.getByRole('menuitem', { name: /Line at placed point/ }).press('Enter')
	await expect(earthly.page.getByText('Geometry operation · Draw', { exact: true })).toBeVisible()
	const splitGuidanceVisible = true
	await earthly.page.mouse.click(box.x + splitPoint.x, box.y + splitPoint.y)
	await expectGeometryFeatureCount(earthly, 4)

	return {
		...(await geometryDraftSnapshot(earthly)),
		numericDialogVisible,
		dragGuidanceVisible,
		splitGuidanceVisible,
	}
}

export async function exercisePolygonSplit(
	earthly: EarthlySession,
): Promise<GeometryOperationsResult> {
	await startDataset(earthly)
	await addPolygonToGeometryDraft(earthly, [
		[0.48, 0.38],
		[0.68, 0.38],
		[0.68, 0.64],
		[0.48, 0.64],
	])
	await selectLastPolygon(earthly)

	await openGeometryOperations(earthly)
	await earthly.page.getByRole('menuitem', { name: 'Cut / Split', exact: true }).press('ArrowRight')
	await earthly.page.getByRole('menuitem', { name: /Polygon by drawn line/ }).press('Enter')
	await expect(earthly.page.getByText('Geometry operation · Draw', { exact: true })).toBeVisible()

	// Both clicks are deliberately just inside the polygon. The cutter is valid
	// only if endpoint snapping reaches the visible top and bottom boundaries.
	await clickEditorMap(earthly, 0.58, 0.385)
	await clickEditorMap(earthly, 0.58, 0.635)
	const snappingProbe = await earthly.page.evaluate(() => {
		const editor = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						editor?: {
							getSelectedFeatures(): Array<{
								id: string
								geometry: { type: string; coordinates: unknown }
							}>
							getGeometryOperation(): unknown
							drawLineMode?: { getCoordinates(): number[][] }
						}
					}
				}
			}
		).__earthlyEditorStore?.getState().editor
		const selected = editor?.getSelectedFeatures()[0]
		const cutter = editor?.drawLineMode?.getCoordinates()
		if (selected?.geometry.type !== 'Polygon' || !cutter || cutter.length !== 2) {
			return { endpointsSnapped: false, selected, cutter }
		}
		const ring = (selected.geometry.coordinates as number[][][])[0] ?? []
		const latitudes = ring
			.map((position) => position[1])
			.filter((latitude): latitude is number => typeof latitude === 'number')
		if (latitudes.length === 0) return { endpointsSnapped: false, selected, cutter }
		const north = Math.max(...latitudes)
		const south = Math.min(...latitudes)
		return {
			endpointsSnapped:
				Math.abs(Number(cutter[0]?.[1]) - north) < 1e-7 &&
				Math.abs(Number(cutter[1]?.[1]) - south) < 1e-7,
			selected,
			cutter,
		}
	})
	expect(snappingProbe.endpointsSnapped).toBe(true)
	await earthly.page.keyboard.press('Enter')
	await expectGeometryFeatureCount(earthly, 2)

	return {
		...(await geometryDraftSnapshot(earthly)),
		numericDialogVisible: false,
		dragGuidanceVisible: false,
		splitGuidanceVisible: true,
	}
}
