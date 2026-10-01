import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import {
	addLineToGeometryDraft,
	expectGeometryFeatureCount,
	geometryDraftSnapshot,
} from '../tasks/create/geometry'
import {
	extrudeSelectedLine,
	openGeometryOperations,
	selectLastLine,
} from '../tasks/editor/geometry-operations'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'

test.beforeEach(async ({ earthly }) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await addLineToGeometryDraft(earthly, [
		[0.45, 0.45],
		[0.55, 0.48],
		[0.65, 0.45],
	])
	await selectLastLine(earthly)
})

test('fat line and fat arrow controls create filled tapered polygons @editor-contract', async ({
	earthly,
}, testInfo) => {
	await extrudeSelectedLine(earthly, {
		shape: 'line',
		width: 500,
		endWidth: 0,
		units: 'Kilometers',
		side: 'Left of line direction',
	})
	await selectLastLine(earthly)
	const result = await extrudeSelectedLine(earthly, {
		shape: 'arrow',
		width: 500,
		endWidth: 200,
		units: 'Kilometers',
		side: 'Right of line direction',
		arrowHeadLength: 600,
		arrowHeadWidth: 400,
	})
	expect(result.geometryTypes).toEqual(['LineString', 'Polygon', 'Polygon'])
	await earthly.page.screenshot({ path: testInfo.outputPath('line-extrusion.png') })
})

test('invalid extrusion stays editable and replacement removes only the source @editor-contract', async ({
	earthly,
}) => {
	await openGeometryOperations(earthly)
	await earthly.page.getByRole('menuitem', { name: 'Line → Fat line', exact: true }).click()
	const dialog = earthly.page.getByRole('dialog', { name: 'Create fat line', exact: true })
	await dialog.getByLabel('Start width', { exact: true }).fill('0')
	await dialog.getByLabel('End width', { exact: true }).fill('0')
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
	await expect(dialog.getByRole('alert')).toHaveText('At least one band width must be positive.')
	await expectGeometryFeatureCount(earthly, 1)
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
	const result = await extrudeSelectedLine(earthly, {
		shape: 'arrow',
		width: 500,
		endWidth: 100,
		units: 'Kilometers',
		resultMode: 'Replace selected feature',
	})
	expect(result.geometryTypes).toEqual(['Polygon'])
	expect((await geometryDraftSnapshot(earthly)).featureCount).toBe(1)
})
