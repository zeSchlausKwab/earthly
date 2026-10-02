import { test, expect } from '../fixtures/earthly'
import { startDataset } from '../tasks/create/dataset'
import { selectEditorMode } from '../tasks/editor/lifecycle'
import { addLineToGeometryDraft, expectGeometryFeatureCount } from '../tasks/create/geometry'
import {
	setDesktopAgentAccess,
	setDesktopAgentSafety,
	setDesktopExternalQueries,
	discoverWebMcpTools,
	executeWebMcpTool,
} from '../tasks/chat/webmcp'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

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
	await selectEditorMode(earthly)
})

test('native discovery, full GeoJSON, fat arrows and image callouts work through WebMCP @editor-contract', async ({
	earthly,
}, testInfo) => {
	await expect
		.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
		.toContain('earthly_valhalla_route')
	const tools = await discoverWebMcpTools(earthly)
	expect(tools.some((tool) => tool.name === 'earthly_get_map')).toBe(true)
	expect(
		tools.find((item) => item.name === 'earthly_read_features')?.annotations.readOnlyHint,
	).toBe(true)
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const page = await executeWebMcpTool(earthly, 'earthly_read_features', {
		mapToken: map.mapToken,
		limit: 1,
	})
	const features = (page.geojson as GeoJSON.FeatureCollection).features
	expect(features[0]?.geometry.type).toBe('LineString')
	const featureId = String(features[0]?.id)
	const arrow = await executeWebMcpTool(earthly, 'earthly_extrude_line', {
		mapToken: map.mapToken,
		featureId,
		shape: 'arrow',
		width: 100,
		units: 'kilometers',
	})
	expect(arrow.cancelled).toBe(false)
	await expectGeometryFeatureCount(earthly, 2)
	await earthly.page.route('**/webmcp-test-photo.svg', (route) =>
		route.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="green"/></svg>',
		}),
	)
	const url = new URL('/webmcp-test-photo.svg', earthly.page.url()).href
	const callout = await executeWebMcpTool(earthly, 'earthly_add_feature_callout', {
		mapToken: arrow.mapToken,
		featureId,
		title: 'Desktop flow',
		text: 'Authored through WebMCP',
		media: [{ url, type: 'image', alt: 'Desktop agent image' }],
	})
	expect(callout.ok).not.toBe(false)
	const after = await executeWebMcpTool(earthly, 'earthly_read_features', {
		mapToken: callout.mapToken,
		featureIds: [featureId],
	})
	expect(JSON.stringify(after.geojson)).toContain(url)
	const capture = await executeWebMcpTool(earthly, 'earthly_capture_map_snapshot', {
		mapToken: callout.mapToken,
		scope: 'viewport',
		maxWidth: 512,
		maxHeight: 384,
	})
	expect((capture.image as { dataUrl: string }).dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/)
	await earthly.page.screenshot({ path: testInfo.outputPath('desktop-agent.png') })
	const activityButton = earthly.page.getByRole('button', { name: 'Desktop agent', exact: true })
	await expect(activityButton).toBeVisible()
	const panel = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	if (earthly.isMobile) {
		const entryBounds = await activityButton.boundingBox()
		const selectionBounds = await earthly.page
			.getByRole('region', { name: 'Selection actions', exact: true })
			.boundingBox()
		const drawingBounds = await earthly.page
			.getByRole('navigation', { name: 'Map drawing', exact: true })
			.boundingBox()
		expect(entryBounds).not.toBeNull()
		expect(selectionBounds).not.toBeNull()
		expect(drawingBounds).not.toBeNull()
		expect((entryBounds?.y ?? 0) + (entryBounds?.height ?? 0)).toBeLessThan(selectionBounds?.y ?? 0)
		expect((entryBounds?.y ?? 0) + (entryBounds?.height ?? 0)).toBeLessThan(drawingBounds?.y ?? 0)
	}
	await activityButton.click()
	await expect(panel).toBeVisible()
	await expect(
		panel.getByRole('button', { name: 'Disable agent access', exact: true }),
	).toBeVisible()
	if (earthly.isMobile) {
		const panelBounds = await panel.boundingBox()
		const selectionBounds = await earthly.page
			.getByRole('region', { name: 'Selection actions', exact: true })
			.boundingBox()
		expect((panelBounds?.y ?? 0) + (panelBounds?.height ?? 0)).toBeLessThan(selectionBounds?.y ?? 0)
	}
	await earthly.page.screenshot({ path: testInfo.outputPath('desktop-agent-activity.png') })
	await panel.getByRole('button', { name: 'Close desktop agent activity', exact: true }).click()
	await setDesktopAgentAccess(earthly, false)
	await expect.poll(() => discoverWebMcpTools(earthly)).toEqual([])
})

test('reviews stay visible and cancellation leaves the draft unchanged; Apply has Undo @editor-contract', async ({
	earthly,
}) => {
	await setDesktopAgentAccess(earthly, true)
	await setDesktopAgentSafety(earthly, 'Preview all changes')
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const page = await executeWebMcpTool(earthly, 'earthly_read_features', { mapToken: map.mapToken })
	const featureId = String((page.geojson as GeoJSON.FeatureCollection).features[0]?.id)
	const panel = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	const args = { mapToken: map.mapToken, featureId, width: 100, units: 'kilometers' }
	const cancelled = executeWebMcpTool(earthly, 'earthly_extrude_line', args)
	await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeVisible()
	await expectGeometryFeatureCount(earthly, 1)
	await panel.getByRole('button', { name: 'Cancel operation', exact: true }).click()
	expect((await cancelled).code).toBe('cancelled')
	await expectGeometryFeatureCount(earthly, 1)
	const accepted = executeWebMcpTool(earthly, 'earthly_extrude_line', args)
	await panel.getByRole('button', { name: 'Apply', exact: true }).click()
	expect((await accepted).cancelled).toBe(false)
	await expectGeometryFeatureCount(earthly, 2)
	await panel.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
	await expectGeometryFeatureCount(earthly, 1)
	expect(
		(await executeWebMcpTool(earthly, 'earthly_read_features', { mapToken: 'stale' })).code,
	).toBe('stale_map')
})

test('agent controls camera, framing and basemap; external queries respect the saved preference @editor-contract', async ({
	earthly,
}) => {
	await setDesktopExternalQueries(earthly, false)
	const localTools = await discoverWebMcpTools(earthly)
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const panel = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	await expect(panel).not.toBeVisible()
	const view = await executeWebMcpTool(earthly, 'earthly_set_map_view', {
		mapToken: map.mapToken,
		center: [44, 36],
		zoom: 5,
		bearing: 0,
		pitch: 0,
	})
	expect(view.ok).toBe(true)
	expect((view.camera as { center: number[] }).center[0]).toBeCloseTo(44)
	expect(view.mapToken).toBe(map.mapToken)
	const framed = await executeWebMcpTool(earthly, 'earthly_fit_map_view', {
		mapToken: map.mapToken,
		scope: 'dataset',
		maxZoom: 10,
	})
	expect(framed.ok).toBe(true)
	const basemap = await executeWebMcpTool(earthly, 'earthly_set_basemap_style', {
		mapToken: map.mapToken,
		style: 'positron',
	})
	expect(basemap.ok).toBe(true)
	expect(await earthly.page.evaluate(() => localStorage.getItem('earthly-basemap-style'))).toBe(
		'positron',
	)
	await installDeterministicMapStyle(earthly)
	await expectGeometryFeatureCount(earthly, 1)
	await expect(panel).not.toBeVisible()
	expect(
		(
			await executeWebMcpTool(earthly, 'earthly_get_reference_boundaries', {
				mapToken: map.mapToken,
				level: 'admin1',
				names: ['Erbil'],
			})
		).code,
	).toBe('external_queries_disabled')
	await setDesktopExternalQueries(earthly, true)
	const external = await discoverWebMcpTools(earthly)
	expect(external.length).toBeGreaterThan(localTools.length)
	expect(external.some((tool) => tool.name === 'earthly_valhalla_route')).toBe(true)
	expect(external.some((tool) => /run_code|upload|editor_undo/.test(tool.name))).toBe(false)
	const current = await executeWebMcpTool(earthly, 'earthly_get_map')
	await setDesktopExternalQueries(earthly, false)
	expect((await discoverWebMcpTools(earthly)).map((tool) => tool.name)).toEqual(
		localTools.map((tool) => tool.name),
	)
	expect(
		(
			await executeWebMcpTool(earthly, 'earthly_measure', {
				mapToken: current.mapToken,
				operation: 'bbox',
			})
		).code,
	).toBe('stale_map')
})

test('default desktop access survives reload and explicit opt-outs stay off @editor-contract', async ({
	earthly,
}) => {
	await expect
		.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
		.toContain('earthly_valhalla_route')
	await authorizeJourneyIdentity(earthly, 'owner')
	await expect
		.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
		.toContain('earthly_valhalla_route')
	await earthly.page.reload()
	await expect
		.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
		.toContain('earthly_valhalla_route')
	await setDesktopExternalQueries(earthly, false)
	await earthly.page.reload()
	await expect
		.poll(async () => (await discoverWebMcpTools(earthly)).map((tool) => tool.name))
		.toContain('earthly_get_map')
	expect(
		(await discoverWebMcpTools(earthly)).some((tool) => tool.name === 'earthly_valhalla_route'),
	).toBe(false)
	await setDesktopAgentAccess(earthly, false)
	await earthly.page.reload()
	await setDesktopAgentAccess(earthly, false)
	expect(await discoverWebMcpTools(earthly)).toEqual([])
	await setDesktopAgentAccess(earthly, true)
	expect(
		(await discoverWebMcpTools(earthly)).some((tool) => tool.name === 'earthly_valhalla_route'),
	).toBe(false)
})

test('metadata review shows concrete changes and supports cancellation, Apply and Undo @editor-contract', async ({
	earthly,
}) => {
	await setDesktopAgentAccess(earthly, true)
	await setDesktopAgentSafety(earthly, 'Preview all changes')
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const panel = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	const args = {
		mapToken: map.mapToken,
		name: 'Kurdish-inhabited areas · 1986',
		description: 'Historical source digitization',
		properties: { sourceYear: 1986 },
	}
	const rejected = executeWebMcpTool(earthly, 'earthly_set_dataset_metadata', args)
	await panel.getByRole('button', { name: /Map details changed/ }).click()
	await expect(
		panel.getByText('After: Kurdish-inhabited areas · 1986', { exact: true }),
	).toBeVisible()
	await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
	expect((await rejected).cancelled).toBe(true)
	const accepted = executeWebMcpTool(earthly, 'earthly_set_dataset_metadata', args)
	await panel.getByRole('button', { name: 'Apply', exact: true }).click()
	const result = await accepted
	expect(result.cancelled).toBe(false)
	const renamed = await executeWebMcpTool(earthly, 'earthly_get_map')
	expect((renamed.metadata as { name: string }).name).toBe(args.name)
	await panel.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
	const undone = await executeWebMcpTool(earthly, 'earthly_get_map')
	expect((undone.metadata as { name: string }).name).toBe((map.metadata as { name: string }).name)
	await panel.getByRole('button', { name: 'Close desktop agent activity', exact: true }).click()
	await executeWebMcpTool(earthly, 'earthly_get_map')
	await expect(panel).not.toBeVisible()
})
