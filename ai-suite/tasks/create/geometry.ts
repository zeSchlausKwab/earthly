import { expect, type Locator } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { startDataset } from './dataset'

export const createGeometryDraftTask: AiTaskMetadata = {
	id: 'create.geometry-draft',
	summary: 'Create point, line, polygon, and label geometries in a new Dataset draft.',
	preconditions: ['Earthly is open', 'The map editor has finished initializing'],
	sideEffects: ['Creates an unsaved local Dataset workspace with four geometries'],
	viewports: 'both',
}

export const publishGeometryDatasetTask: AiTaskMetadata = {
	id: 'create.publish-geometry-dataset',
	summary: 'Create geometry, name the Dataset, and publish it to the local development relay.',
	preconditions: ['Signed-in local development persona', 'The map editor has initialized'],
	sideEffects: ['Publishes a disposable Dataset event to the local development relay'],
	viewports: 'desktop',
}

export interface GeometryDraftResult {
	featureCount: number
	geometryTypes: string[]
	annotationText: string | null
	annotationEditorAutoOpened: boolean
}

export async function geometryDraftSnapshot(earthly: EarthlySession): Promise<GeometryDraftResult> {
	return earthly.page.evaluate(() => {
		const store = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						features: Array<{
							geometry?: { type?: string } | null
							properties?: Record<string, unknown>
						}>
					}
				}
			}
		).__earthlyEditorStore
		const features = store?.getState().features ?? []
		return {
			featureCount: features.length,
			geometryTypes: features.map((feature) => feature.geometry?.type ?? 'none'),
			annotationText:
				(features.find((feature) => feature.properties?.featureType === 'annotation')?.properties
					?.text as string | undefined) ?? null,
			annotationEditorAutoOpened: false,
		}
	})
}

export async function expectGeometryFeatureCount(
	earthly: EarthlySession,
	count: number,
): Promise<void> {
	await expect.poll(async () => (await geometryDraftSnapshot(earthly)).featureCount).toBe(count)
}

export async function clickEditorMap(
	earthly: EarthlySession,
	xRatio: number,
	yRatio: number,
): Promise<void> {
	const canvas = earthly.page.locator('.maplibregl-canvas')
	await expect(canvas).toBeVisible()
	const box = await canvas.boundingBox()
	if (!box) throw new Error('Map canvas has no visible bounding box')
	let y = box.height * yRatio
	if (earthly.isMobile) {
		const sheet = earthly.page.getByTestId('mobile-sheet')
		if (await sheet.isVisible()) {
			const sheetBox = await sheet.boundingBox()
			if (sheetBox) {
				const exposedMapHeight = Math.max(96, sheetBox.y - box.y)
				y = Math.min(y, exposedMapHeight / 2)
			}
		}
	}
	await canvas.click({ position: { x: box.width * xRatio, y } })
}

export async function addPointToGeometryDraft(
	earthly: EarthlySession,
	xRatio = 0.62,
	yRatio = 0.42,
): Promise<number> {
	const before = (await geometryDraftSnapshot(earthly)).featureCount
	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, xRatio, yRatio)
	await expectGeometryFeatureCount(earthly, before + 1)
	return before + 1
}

export async function addPolygonToGeometryDraft(
	earthly: EarthlySession,
	points: ReadonlyArray<readonly [xRatio: number, yRatio: number]>,
): Promise<number> {
	if (points.length < 3) throw new Error('A polygon draft requires at least three points')
	const before = (await geometryDraftSnapshot(earthly)).featureCount
	await earthly.page.getByRole('button', { name: 'Draw polygon', exact: true }).first().click()
	for (const [xRatio, yRatio] of points) await clickEditorMap(earthly, xRatio, yRatio)
	await earthly.page.keyboard.press('Enter')
	await expectGeometryFeatureCount(earthly, before + 1)
	return before + 1
}

export async function addLabelToGeometryDraft(
	earthly: EarthlySession,
	text: string,
	xRatio: number,
	yRatio: number,
): Promise<Locator> {
	const before = (await geometryDraftSnapshot(earthly)).featureCount
	await earthly.page.getByRole('button', { name: 'Draw label', exact: true }).first().click()
	await clickEditorMap(earthly, xRatio, yRatio)
	await expectGeometryFeatureCount(earthly, before + 1)
	const labelInput = earthly.page.getByPlaceholder('Type label text...').last()
	await expect(labelInput).toBeVisible()
	await labelInput.fill(text)
	await expect(labelInput).toHaveValue(text)
	return labelInput
}

export async function publishCurrentGeometryDataset(earthly: EarthlySession): Promise<string> {
	let publishButton = earthly.page.getByRole('button', { name: 'Publish', exact: true })
	if (!(await publishButton.isVisible())) {
		await earthly.page.getByText('File', { exact: true }).first().click()
		publishButton = earthly.page.getByRole('menuitem', {
			name: 'Publish new dataset',
			exact: true,
		})
	}
	await expect(publishButton).toBeEnabled()
	await publishButton.click()
	await expect
		.poll(() => new URL(earthly.page.url()).pathname, { timeout: 15_000 })
		.toMatch(/^\/datasets\/geoevent\//)
	return earthly.page.url()
}

export async function createGeometryDraft(
	earthly: EarthlySession,
	annotationText = 'AI suite map label',
): Promise<GeometryDraftResult> {
	await startDataset(earthly)

	await earthly.page.getByRole('button', { name: 'Draw point', exact: true }).first().click()
	await clickEditorMap(earthly, 0.62, 0.42)
	await expectGeometryFeatureCount(earthly, 1)

	await earthly.page.getByRole('button', { name: 'Draw line', exact: true }).first().click()
	await clickEditorMap(earthly, 0.56, 0.48)
	await clickEditorMap(earthly, 0.62, 0.5)
	await clickEditorMap(earthly, 0.68, 0.47)
	await earthly.page.keyboard.press('Enter')
	await expectGeometryFeatureCount(earthly, 2)

	await earthly.page.getByRole('button', { name: 'Draw polygon', exact: true }).first().click()
	await clickEditorMap(earthly, 0.56, 0.56)
	await clickEditorMap(earthly, 0.63, 0.6)
	await clickEditorMap(earthly, 0.69, 0.55)
	await earthly.page.keyboard.press('Enter')
	await expectGeometryFeatureCount(earthly, 3)

	await earthly.page.getByRole('button', { name: 'Draw label', exact: true }).first().click()
	await clickEditorMap(earthly, 0.64, 0.38)
	await expectGeometryFeatureCount(earthly, 4)
	// Placing a label now expands its row and focuses the text field
	// immediately (workflow audit P2) — same behavior as the comment composer.
	const annotationInput = earthly.page.getByPlaceholder('Type label text...').first()
	await expect(annotationInput).toBeVisible()
	await expect(annotationInput).toBeFocused()
	const annotationEditorAutoOpened = true
	await annotationInput.fill(annotationText)
	await expect
		.poll(async () => (await geometryDraftSnapshot(earthly)).annotationText)
		.toBe(annotationText)

	return { ...(await geometryDraftSnapshot(earthly)), annotationEditorAutoOpened }
}

export async function createAndPublishGeometryDataset(
	earthly: EarthlySession,
	name: string,
): Promise<GeometryDraftResult & { url: string }> {
	const result = await createGeometryDraft(earthly)
	await earthly.page.getByPlaceholder('Name').first().fill(name)
	const url = await publishCurrentGeometryDataset(earthly)
	return { ...result, url }
}
