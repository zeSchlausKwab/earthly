import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { discoverWebMcpTools, executeWebMcpTool, setDesktopAgentSafety } from '../tasks/chat/webmcp'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

const rectangle = (name: string, west: number, east: number): GeoJSON.Feature => ({
	type: 'Feature',
	properties: {
		name,
		fillColor: '#d946ef',
		importSource: 'polygon-fixture',
		'earthly:callouts': [{ id: 'note', text: 'Keep my note' }],
	},
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[west, 0],
				[east, 0],
				[east, 10],
				[west, 10],
				[west, 0],
			],
		],
	},
})

test.beforeEach(async ({ earthly }) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	await startDataset(earthly)
	await setDesktopAgentSafety(earthly, 'Apply with Undo')
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const imported = await executeWebMcpTool(earthly, 'earthly_write_geojson_to_editor', {
		mapToken: map.mapToken,
		geojson: {
			type: 'FeatureCollection',
			features: [
				rectangle('source', 0, 10),
				rectangle('west-mask', -1, 3),
				rectangle('east-mask', 7, 11),
				rectangle('far-away', 30, 40),
			],
		},
	})
	expect(imported.ok).not.toBe(false)
	await expectGeometryFeatureCount(earthly, 4)
})

async function snapshot(earthly: Parameters<typeof executeWebMcpTool>[0]) {
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const page = await executeWebMcpTool(earthly, 'earthly_read_features', { mapToken: map.mapToken })
	return { mapToken: map.mapToken, features: (page.geojson as GeoJSON.FeatureCollection).features }
}

test('native polygon clipping retains inputs and properties, returns a fresh result and supports Undo @editor-contract', async ({
	earthly,
}) => {
	expect((await discoverWebMcpTools(earthly)).map((tool) => tool.name)).toContain(
		'earthly_polygon_boolean',
	)
	const before = await snapshot(earthly)
	const id = (name: string) =>
		String(before.features.find((feature) => feature.properties?.name === name)?.id)
	const clipped = await executeWebMcpTool(earthly, 'earthly_polygon_boolean', {
		mapToken: before.mapToken,
		sourceFeatureId: id('source'),
		maskFeatureIds: [id('west-mask'), id('east-mask')],
		operation: 'intersection',
		resultMode: 'append',
	})
	expect(clipped).toMatchObject({
		cancelled: false,
		emptyResult: false,
		counts: { created: 1, updated: 0 },
	})
	await expectGeometryFeatureCount(earthly, 5)
	const after = await snapshot(earthly)
	expect(
		after.features.filter((feature) => before.features.some((prior) => prior.id === feature.id)),
	).toEqual(before.features)
	const output = after.features.find(
		(feature) => feature.id === (clipped.resultFeatureIds as string[])[0],
	)
	expect(output?.geometry.type).toBe('MultiPolygon')
	expect(output?.properties).toMatchObject({
		name: 'source',
		fillColor: '#d946ef',
		importSource: before.features.find((feature) => feature.id === id('source'))?.properties
			?.importSource,
		'earthly:callouts': [{ id: 'note', text: 'Keep my note' }],
	})
	const activity = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	if (!(await activity.isVisible()))
		await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
	await activity
		.getByRole('button', { name: 'Undo desktop agent edit', exact: true })
		.last()
		.click()
	await expectGeometryFeatureCount(earthly, 4)
	expect((await snapshot(earthly)).features).toEqual(before.features)
})

test('native polygon replacement has one review, cancels cleanly, and empty output never deletes the source @editor-contract', async ({
	earthly,
}) => {
	await setDesktopAgentSafety(earthly, 'Preview all changes')
	const before = await snapshot(earthly)
	const id = (name: string) =>
		String(before.features.find((feature) => feature.properties?.name === name)?.id)
	const input = {
		mapToken: before.mapToken,
		sourceFeatureId: id('source'),
		maskFeatureIds: [id('west-mask')],
		operation: 'intersection',
		resultMode: 'replace-source',
	}
	const pending = executeWebMcpTool(earthly, 'earthly_polygon_boolean', input)
	const activity = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	await expect(activity.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(1)
	await activity.getByRole('button', { name: 'Cancel operation', exact: true }).click()
	expect((await pending).code).toBe('cancelled')
	expect((await snapshot(earthly)).features).toEqual(before.features)
	const accepted = executeWebMcpTool(earthly, 'earthly_polygon_boolean', input)
	await activity.getByRole('button', { name: 'Apply', exact: true }).click()
	expect(await accepted).toMatchObject({
		cancelled: false,
		resultFeatureIds: [id('source')],
		counts: { created: 0, updated: 1 },
	})
	const after = await snapshot(earthly)
	const source = after.features.find((feature) => feature.id === id('source'))
	expect(source?.geometry).toEqual(rectangle('source', 0, 3).geometry)
	expect(source?.properties).toEqual(
		before.features.find((feature) => feature.id === id('source'))?.properties,
	)
	expect(after.features.filter((feature) => feature.id !== id('source'))).toEqual(
		before.features.filter((feature) => feature.id !== id('source')),
	)
	const empty = await executeWebMcpTool(earthly, 'earthly_polygon_boolean', {
		...input,
		mapToken: after.mapToken,
		maskFeatureIds: [id('far-away')],
	})
	expect(empty).toMatchObject({
		emptyResult: true,
		unchanged: true,
		counts: { created: 0, updated: 0 },
	})
	expect((await snapshot(earthly)).features).toEqual(after.features)
	await expect(activity.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0)
})
