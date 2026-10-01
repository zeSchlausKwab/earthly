import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import { test, expect } from '../fixtures/earthly'
import type { EarthlySession } from '../core/session'
import { startDataset } from '../tasks/create/dataset'
import { addPointToGeometryDraft, expectGeometryFeatureCount } from '../tasks/create/geometry'
import { editorLifecycleSnapshot, selectEditorMode } from '../tasks/editor/lifecycle'
import { openPanel } from '../tasks/navigation/open-panel'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { discoverWebMcpTools, executeWebMcpTool, setDesktopAgentSafety } from '../tasks/chat/webmcp'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

test.beforeEach(async ({ earthly }) => {
	await installIsolatedRelays(earthly)
	await earthly.open({ tour: 'seen' })
	await installDeterministicMapStyle(earthly)
	const map = await startDataset(earthly)
	await map.nameInput.fill('WebMCP local source')
	await addPointToGeometryDraft(earthly)
	await selectEditorMode(earthly)
	await setDesktopAgentSafety(earthly, 'Apply with Undo')
})

interface ListedSource {
	kind: 'map' | 'story'
	reference: string
	title: string
	featureIds?: string[]
}
interface ListedDraft {
	kind: 'story' | 'atlas'
	draftKey: string
	title: string
}

async function localDrafts(earthly: EarthlySession) {
	const result = await executeWebMcpTool(earthly, 'earthly_list_local_drafts')
	return {
		...result,
		creationToken: String(result.creationToken),
		sources: result.sources as ListedSource[],
		drafts: result.drafts as ListedDraft[],
	}
}

async function sourceStory(earthly: EarthlySession, title = 'Native Story with views') {
	const listed = await localDrafts(earthly)
	const source = listed.sources.find(
		(entry) => entry.kind === 'map' && entry.reference.startsWith('earthly-draft:'),
	)
	if (!source?.featureIds?.length)
		throw new Error('The native source list must contain the retained Map and its point')
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const read = await executeWebMcpTool(earthly, 'earthly_read_features', {
		mapToken: map.mapToken,
		featureIds: source.featureIds,
	})
	const point = (read.geojson as FeatureCollection<Point>).features[0]
	if (!point) throw new Error('The local Map point is unavailable')
	const center = point.geometry.coordinates.slice(0, 2)
	const workspaceId = decodeURIComponent(source.reference.slice('earthly-draft:'.length))
	const presentation = {
		version: 1,
		initialView: { center, zoom: 5 },
		layers: [
			{
				id: 'places',
				source: { kind: 'local-map', workspaceId },
				featureIds: source.featureIds,
				visible: true,
				opacityMultiplier: 1,
				style: { color: '#166534', radius: 8 },
			},
		],
	}
	const view = {
		version: 1,
		type: 'view',
		id: 'detail',
		title: 'A closer local view',
		caption: 'An unpublished Map rendered in the Story',
		display: 'both',
		camera: { center, zoom: 7 },
		layers: { places: { style: { color: '#f97316', radius: 12 }, opacityMultiplier: 0.7 } },
	}
	const markdown = `An editable native Story.\n\nSource: ${source.reference}\n\n\`\`\`earthly-view\n${JSON.stringify(view)}\n\`\`\``
	const result = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		createNew: true,
		creationToken: listed.creationToken,
		title,
		description: 'Local source, opening camera and a named view',
		markdown,
		presentation,
	})
	expect(result.ok).toBe(true)
	return { result, source, presentation, markdown, view }
}

test('local Atlas subsets replace baseline geometry and restore the saved Map when closed @editor-contract', async ({
	earthly,
}) => {
	const map = await executeWebMcpTool(earthly, 'earthly_get_map')
	const written = await executeWebMcpTool(earthly, 'earthly_write_geojson_to_editor', {
		mapToken: map.mapToken,
		geojson: {
			type: 'Feature',
			id: 'unselected-point',
			geometry: { type: 'Point', coordinates: [16, 48] },
			properties: { name: 'Unselected place' },
		},
	})
	expect(written.cancelled).toBe(false)
	expect(written.importedCount).toBe(1)
	await expectGeometryFeatureCount(earthly, 2)
	const authored = await sourceStory(earthly)
	const selectedId = authored.source.featureIds![0]!
	const presentation = {
		...authored.presentation,
		layers: authored.presentation.layers.map((layer) => ({
			...layer,
			featureIds: [selectedId],
			opacityMultiplier: 0.25,
		})),
	}
	const atlas = await executeWebMcpTool(earthly, 'earthly_write_atlas_draft', {
		createNew: true,
		creationToken: (await localDrafts(earthly)).creationToken,
		name: 'Selected places only',
		curatedReferences: [authored.source.reference],
		presentation,
	})
	expect(atlas.ok).toBe(true)
	const before = await editorLifecycleSnapshot(earthly)
	const baselineIds = () =>
		earthly.page.evaluate(async () => {
			const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
			const source = map?.getSource('geo-editor') as GeoJSONSource | undefined
			const data = await source?.getData()
			return data?.type === 'FeatureCollection'
				? data.features
						.filter((feature) => feature.properties?.meta === 'feature')
						.map((feature) => String(feature.id))
						.sort()
				: []
		})
	await expect.poll(baselineIds).toEqual([...authored.source.featureIds!].sort())
	const closeActivity = earthly.page.getByRole('button', {
		name: 'Close desktop agent activity',
		exact: true,
	})
	if (await closeActivity.isVisible()) await closeActivity.click()
	await openPanel(earthly, 'Local drafts')
	await earthly.page
		.getByRole('region', { name: 'New Atlas drafts', exact: true })
		.getByRole('button', { name: 'Selected places only', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Name', { exact: true })).toHaveValue('Selected places only')
	await expect.poll(baselineIds).toEqual([])
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
				return map
					? Object.values(map.getStyle().sources).flatMap((source) =>
							source.type === 'geojson' &&
							typeof source.data === 'object' &&
							source.data.type === 'FeatureCollection'
								? source.data.features
										.filter(
											(feature) => feature.properties?.earthlyPresentationLayerId === 'places',
										)
										.map((feature) => ({
											id: feature.properties?.earthlyPresentationSourceFeatureId,
											opacity: feature.properties?.earthlyPresentationOpacityMultiplier,
										}))
								: [],
						)
					: []
			}),
		)
		.toEqual([{ id: selectedId, opacity: 0.25 }])
	const during = await editorLifecycleSnapshot(earthly)
	expect(during.mapStack).toEqual(before.mapStack)
	await expectGeometryFeatureCount(earthly, 2)
	await openPanel(earthly, 'Local drafts')
	if (!earthly.isMobile)
		await earthly.page.getByRole('button', { name: 'Back to Local drafts', exact: true }).click()
	await earthly.page
		.getByRole('region', { name: 'Local drafts', exact: true })
		.getByRole('button', { name: /^WebMCP local source\s/ })
		.click()
	await expect.poll(baselineIds).toEqual([...authored.source.featureIds!].sort())
	await expectGeometryFeatureCount(earthly, 2)
	expect((await editorLifecycleSnapshot(earthly)).activeWorkspaceId).toBe(before.activeWorkspaceId)
})

for (const kind of ['story', 'atlas'] as const) {
	test(`mounted ${kind} fields flush human input and refresh after native edits and Undo @editor-contract`, async ({
		earthly,
	}) => {
		const authored = await sourceStory(earthly, 'Visible native Story')
		const title = kind === 'story' ? 'Visible native Story' : 'Visible native Atlas'
		const created =
			kind === 'story'
				? authored.result
				: await executeWebMcpTool(earthly, 'earthly_write_atlas_draft', {
						createNew: true,
						creationToken: (await localDrafts(earthly)).creationToken,
						name: title,
						description: 'Original Atlas description',
						curatedReferences: [authored.source.reference],
						presentation: authored.presentation,
					})
		expect(created.ok).toBe(true)
		await openPanel(earthly, 'Local drafts')
		await earthly.page
			.getByRole('region', {
				name: kind === 'story' ? 'New Story drafts' : 'New Atlas drafts',
				exact: true,
			})
			.getByRole('button', { name: title, exact: true })
			.click()
		const titleField = earthly.page.getByLabel(kind === 'story' ? 'Title' : 'Name', { exact: true })
		await expect(titleField).toHaveValue(title)
		await titleField.fill('Pending human title')
		const descriptionField =
			kind === 'story'
				? earthly.page.getByLabel('Summary', { exact: true })
				: earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
		await descriptionField.fill('Pending human description')
		const read = await executeWebMcpTool(earthly, `earthly_read_${kind}_draft`, {
			draftTarget: created.draftKey,
		})
		expect(read.ok).toBe(true)
		expect(read.draft).toMatchObject({
			[kind === 'story' ? 'title' : 'name']: 'Pending human title',
			description: 'Pending human description',
		})
		const changed = await executeWebMcpTool(earthly, `earthly_write_${kind}_draft`, {
			draftTarget: created.draftKey,
			draftToken: read.draftToken,
			[kind === 'story' ? 'title' : 'name']: 'Visible native revision',
			description: 'Visible native description',
		})
		expect(changed.ok).toBe(true)
		await expect(titleField).toHaveValue('Visible native revision')
		if (kind === 'story') await expect(descriptionField).toHaveValue('Visible native description')
		else await expect(descriptionField).toHaveText('Visible native description')
		await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
		const review = earthly.page
			.getByRole('complementary', { name: 'Desktop agent activity', exact: true })
			.getByLabel(kind === 'story' ? 'Story draft changes' : 'Atlas draft changes', { exact: true })
			.filter({ hasText: 'Visible native revision · applied' })
			.last()
		await review.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
		await expect(titleField).toHaveValue('Pending human title')
		if (kind === 'story') await expect(descriptionField).toHaveValue('Pending human description')
		else await expect(descriptionField).toHaveText('Pending human description')
		const undone = await executeWebMcpTool(earthly, `earthly_read_${kind}_draft`, {
			draftTarget: created.draftKey,
		})
		expect(undone.draft).toMatchObject({
			[kind === 'story' ? 'title' : 'name']: 'Pending human title',
			description: 'Pending human description',
		})
	})
}

test('Undo of a mounted new Story closes the removed slot without recreating it @editor-contract', async ({
	earthly,
}) => {
	const authored = await sourceStory(earthly, 'A removable native Story')
	await openPanel(earthly, 'Local drafts')
	await earthly.page
		.getByRole('region', { name: 'New Story drafts', exact: true })
		.getByRole('button', { name: 'A removable native Story', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(
		'A removable native Story',
	)
	await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
	await earthly.page
		.getByRole('complementary', { name: 'Desktop agent activity', exact: true })
		.getByLabel('Story draft changes', { exact: true })
		.filter({ hasText: 'A removable native Story · applied' })
		.getByRole('button', { name: 'Undo desktop agent edit', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveCount(0)
	expect(
		(await localDrafts(earthly)).drafts.some(
			(draft) => draft.draftKey === authored.result.draftKey,
		),
	).toBe(false)
	await earthly.page
		.getByRole('complementary', { name: 'Desktop agent activity', exact: true })
		.getByRole('button', { name: 'Close desktop agent activity', exact: true })
		.click()
	await openPanel(earthly, 'Local drafts')
	await expect(
		earthly.page.getByRole('region', { name: 'New Story drafts', exact: true }),
	).toHaveCount(0)
	expect(
		(await localDrafts(earthly)).drafts.some(
			(draft) => draft.draftKey === authored.result.draftKey,
		),
	).toBe(false)
})

test('native Story and Atlas drafts preserve local references, names, descriptions and cameras @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(90_000)
	const tools = await discoverWebMcpTools(earthly)
	expect(tools).toHaveLength(37)
	for (const name of [
		'earthly_list_local_drafts',
		'earthly_read_story_draft',
		'earthly_write_story_draft',
		'earthly_read_atlas_draft',
		'earthly_write_atlas_draft',
	])
		expect(tools.some((tool) => tool.name === name)).toBe(true)
	const writeSchema = tools.find((tool) => tool.name === 'earthly_write_story_draft')?.inputSchema
	const schema = typeof writeSchema === 'string' ? JSON.parse(writeSchema) : writeSchema
	expect(
		schema.properties.presentation.properties.layers.items.properties.source.anyOf,
	).toContainEqual(expect.objectContaining({ type: 'object' }))

	const authored = await sourceStory(earthly)
	const listed = await localDrafts(earthly)
	const second = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		createNew: true,
		creationToken: listed.creationToken,
		title: 'A distinct second Story',
		markdown: 'Independent narrative',
	})
	expect(second.ok).toBe(true)
	expect(second.draftKey).not.toBe(authored.result.draftKey)
	const atlas = await executeWebMcpTool(earthly, 'earthly_write_atlas_draft', {
		createNew: true,
		creationToken: listed.creationToken,
		name: 'Native Atlas overview',
		description: 'An overview that curates the local Map and Story',
		curatedReferences: [authored.source.reference, authored.result.reference],
		presentation: authored.presentation,
	})
	expect(atlas.ok).toBe(true)
	expect(atlas.draftKey).not.toBe(authored.result.draftKey)
	const storyRead = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: authored.result.draftKey,
	})
	expect(storyRead.draft).toMatchObject({
		title: 'Native Story with views',
		description: 'Local source, opening camera and a named view',
		markdown: authored.markdown,
		presentation: authored.presentation,
		mapAuthoring: { viewBlockCount: 1, openingLayerIds: ['places'] },
	})
	const atlasRead = await executeWebMcpTool(earthly, 'earthly_read_atlas_draft', {
		draftTarget: atlas.draftKey,
	})
	expect(atlasRead.draft).toMatchObject({
		name: 'Native Atlas overview',
		description: 'An overview that curates the local Map and Story',
		curatedReferences: [authored.source.reference, authored.result.reference],
		presentation: authored.presentation,
	})
	await expectGeometryFeatureCount(earthly, 1)

	await openPanel(earthly, 'Local drafts')
	await earthly.page
		.getByRole('region', { name: 'New Story drafts', exact: true })
		.getByRole('button', { name: 'Native Story with views', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(
		'Native Story with views',
	)
	await earthly.page.getByRole('tab', { name: 'Preview', exact: true }).click()
	const figure = earthly.page.getByRole('region', { name: 'Story figure map', exact: true })
	await expect(figure).toBeVisible()
	await expect
		.poll(() =>
			figure.evaluate((element) => {
				const map = (element as HTMLElement & { __earthlyMap?: MapLibreMap }).__earthlyMap
				if (!map) return []
				return Object.values(map.getStyle().sources).flatMap((source) =>
					source.type === 'geojson' &&
					typeof source.data === 'object' &&
					source.data.type === 'FeatureCollection'
						? source.data.features.flatMap((feature) =>
								feature.properties?.earthlyPresentationLayerId
									? [
											{
												id: feature.properties.earthlyPresentationSourceFeatureId,
												source: feature.properties.earthlyPresentationSource,
												color: feature.properties.color,
											},
										]
									: [],
							)
						: [],
				)
			}),
		)
		.toEqual(
			authored.source.featureIds!.map((id) => ({
				id,
				source: authored.source.reference,
				color: '#f97316',
			})),
		)
	await earthly.page.getByRole('button', { name: /A closer local view/ }).click()
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				(window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap?.getZoom(),
			),
		)
		.toBeCloseTo(7, 1)
	await earthly.page.screenshot({ path: testInfo.outputPath('native-local-story-figure.png') })
	await openPanel(earthly, 'Local drafts')
	if (!earthly.isMobile)
		await earthly.page.getByRole('button', { name: 'Back to Local drafts', exact: true }).click()
	await earthly.page
		.getByRole('region', { name: 'New Atlas drafts', exact: true })
		.getByRole('button', { name: 'Native Atlas overview', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Name', { exact: true })).toHaveValue(
		'Native Atlas overview',
	)
	const curated = earthly.page.getByRole('region', { name: 'Curated references', exact: true })
	await expect(curated.getByText('WebMCP local source', { exact: true })).toBeVisible()
	await expect(curated.getByText('Native Story with views', { exact: true })).toBeVisible()
	await expect(
		earthly.page.getByText('Layer “places” must reference', { exact: false }),
	).toHaveCount(0)
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
				if (!map) return []
				return Object.values(map.getStyle().sources).flatMap((source) =>
					source.type === 'geojson' &&
					typeof source.data === 'object' &&
					source.data.type === 'FeatureCollection'
						? source.data.features
								.filter((feature) => feature.properties?.earthlyPresentationLayerId === 'places')
								.map((feature) => ({
									id: feature.properties?.earthlyPresentationSourceFeatureId,
									source: feature.properties?.earthlyPresentationSource,
									color: feature.properties?.color,
								}))
						: [],
				)
			}),
		)
		.toEqual(
			authored.source.featureIds!.map((id) => ({
				id,
				source: authored.source.reference,
				color: '#166534',
			})),
		)
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				(window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap?.getZoom(),
			),
		)
		.toBeCloseTo(5, 1)
	await earthly.page.screenshot({ path: testInfo.outputPath('native-local-atlas-preview.png') })
	await earthly.page.getByRole('button', { name: 'Set from current view', exact: true }).click()
	const capturedAtlas = await executeWebMcpTool(earthly, 'earthly_read_atlas_draft', {
		draftTarget: atlas.draftKey,
	})
	expect(capturedAtlas.draft).toMatchObject({
		presentation: {
			layers: [
				{ source: authored.presentation.layers[0]!.source, featureIds: authored.source.featureIds },
			],
		},
	})
})

test('native document tokens reject stale writes and preserve no-op snapshots @editor-contract', async ({
	earthly,
}) => {
	const authored = await sourceStory(earthly, 'Token-bound Story')
	const read = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: authored.result.draftKey,
	})
	const unchanged = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		draftTarget: authored.result.draftKey,
		draftToken: read.draftToken,
		title: 'Token-bound Story',
	})
	expect(unchanged.status).toBe('unchanged')
	expect(unchanged.draft).toEqual(read.draft)
	const changed = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		draftTarget: authored.result.draftKey,
		draftToken: unchanged.draftToken,
		description: 'A later description',
	})
	expect(changed.ok).toBe(true)
	const stale = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		draftTarget: authored.result.draftKey,
		draftToken: read.draftToken,
		title: 'Stale replacement',
	})
	expect(stale.code).toBe('stale_draft')
	const after = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: authored.result.draftKey,
	})
	expect(after.draft).toMatchObject({
		title: 'Token-bound Story',
		description: 'A later description',
		markdown: authored.markdown,
	})
})

test('document review cancels, applies and prevents Undo from replacing subsequent edits @editor-contract', async ({
	earthly,
}) => {
	await setDesktopAgentSafety(earthly, 'Preview all changes')
	const listed = await localDrafts(earthly)
	const panel = earthly.page.getByRole('complementary', {
		name: 'Desktop agent activity',
		exact: true,
	})
	const input = {
		createNew: true,
		creationToken: listed.creationToken,
		title: 'Reviewed native Story',
		description: 'Concrete draft review',
		markdown: 'Reviewed narrative',
	}
	const cancelled = executeWebMcpTool(earthly, 'earthly_write_story_draft', input)
	await expect(panel.getByRole('button', { name: 'Apply changes', exact: true })).toBeVisible()
	await panel.getByText('Review document changes', { exact: true }).click()
	await expect(panel.getByText('"Concrete draft review"', { exact: false }).first()).toBeVisible()
	expect((await executeWebMcpTool(earthly, 'earthly_list_local_drafts')).code).toBe('editor_busy')
	expect(
		await earthly.page.evaluate(() =>
			JSON.parse(localStorage.getItem('earthly:story:drafts:v1:guest') ?? '{}'),
		),
	).toEqual({})
	await panel.getByRole('button', { name: 'Cancel', exact: true }).click()
	expect((await cancelled).status).toBe('cancelled')
	expect((await localDrafts(earthly)).drafts).toEqual([])
	const accepted = executeWebMcpTool(earthly, 'earthly_write_story_draft', input)
	await panel.getByRole('button', { name: 'Apply changes', exact: true }).click()
	const created = await accepted
	expect(created.ok).toBe(true)
	await panel.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
	expect((await localDrafts(earthly)).drafts).toEqual([])

	const repeated = executeWebMcpTool(earthly, 'earthly_write_story_draft', input)
	await panel.getByRole('button', { name: 'Apply changes', exact: true }).click()
	const retained = await repeated
	const creationReview = panel
		.getByLabel('Story draft changes', { exact: true })
		.filter({ hasText: 'Reviewed native Story · applied' })
		.last()
	await setDesktopAgentSafety(earthly, 'Apply with Undo')
	const later = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		draftTarget: retained.draftKey,
		draftToken: retained.draftToken,
		title: 'Later human-safe content',
	})
	expect(later.ok).toBe(true)
	await earthly.page.getByRole('button', { name: 'Desktop agent', exact: true }).click()
	await creationReview.getByRole('button', { name: 'Undo desktop agent edit', exact: true }).click()
	await expect(
		earthly.page.getByText(
			'This draft changed since the AI edit. Open it to review; Undo did not overwrite it.',
			{ exact: true },
		),
	).toBeVisible()
	const retainedAfterUndo = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: retained.draftKey,
	})
	expect(retainedAfterUndo.draft).toMatchObject({ title: 'Later human-safe content' })
})
