import type { FeatureCollection, LineString } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { NostrEvent } from 'nostr-tools'
import { test, expect } from '../fixtures/earthly'
import type { EarthlySession } from '../core/session'
import { signIn } from '../tasks/auth/sign-in'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { discoverWebMcpTools, executeWebMcpTool, setDesktopAgentSafety } from '../tasks/chat/webmcp'

test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } })

interface Receipt {
	eventId: string
	coordinate: string
	reference: string
	delivery: string
	relays: Array<{ from: string; ok: boolean }>
}

async function readFeatures(earthly: EarthlySession, mapToken?: unknown) {
	const current = mapToken ? { mapToken } : await executeWebMcpTool(earthly, 'earthly_get_map')
	const result = await executeWebMcpTool(earthly, 'earthly_read_features', {
		mapToken: current.mapToken,
	})
	expect(result.ok).toBe(true)
	return (result.geojson as FeatureCollection).features
}

function receiptFor(result: Record<string, unknown>, kind: number): Receipt {
	const receipt = (result.receipts as Receipt[]).find((item) =>
		item.coordinate.startsWith(`${kind}:`),
	)
	if (!receipt)
		throw new Error(`Publication has no kind ${kind} receipt: ${JSON.stringify(result)}`)
	return receipt
}

function publishedEvent(events: Map<string, NostrEvent>, eventId: string): NostrEvent {
	const event = events.get(eventId)
	if (!event) throw new Error(`The isolated relay did not receive signed event ${eventId}`)
	return event
}

function assertDelivered(result: Record<string, unknown>, events: Map<string, NostrEvent>) {
	expect(result, JSON.stringify(result)).toMatchObject({
		ok: true,
		status: 'published',
		sideEffectsApplied: true,
	})
	for (const receipt of result.receipts as Receipt[]) {
		expect(receipt.delivery).toBe('acknowledged')
		expect(receipt.relays.some((relay) => relay.ok)).toBe(true)
		expect(receipt.reference).toMatch(/^nostr:naddr1/)
		const event = publishedEvent(events, receipt.eventId)
		expect(event.sig).toMatch(/^[0-9a-f]{128}$/)
		expect(`${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1]}`).toBe(
			receipt.coordinate,
		)
	}
}

test('native tools author, publish and reopen public Maps, Stories and Atlases with exact revisions @workflow-audit', async ({
	earthly,
}, testInfo) => {
	test.skip(earthly.isMobile, 'The reusable extension sign-in task supports desktop.')
	test.setTimeout(180_000)
	const events = new Map<string, NostrEvent>()
	const publications = await installIsolatedRelays(earthly, events)
	const contentPublications = () =>
		[...publications].filter(([, kind]) => [37515, 37518, 37520].includes(kind))
	await signIn(earthly, 'owner')
	await installDeterministicMapStyle(earthly)
	await setDesktopAgentSafety(earthly, 'Apply with Undo')
	const toolNames = (await discoverWebMcpTools(earthly)).map((tool) => tool.name)
	expect(toolNames).toEqual(
		expect.arrayContaining([
			'earthly_create_map_draft',
			'earthly_open_map_draft',
			'earthly_read_entity',
			'earthly_edit_entity',
			'earthly_update_feature_geometry',
			'earthly_prepare_publication',
			'earthly_publish_publication',
		]),
	)

	// All content below is authored through the browser's discovered native tools.
	const map = await executeWebMcpTool(earthly, 'earthly_create_map_draft', {
		title: 'Native lifecycle Map',
		audience: 'public',
	})
	expect(map).toMatchObject({ ok: true, kind: 'map', workspaceId: expect.any(String) })
	const workspaceId = String(map.workspaceId)
	const localReference = (map.source as { reference: string }).reference
	const added = await executeWebMcpTool(earthly, 'earthly_write_geojson_to_editor', {
		mapToken: (map.map as { mapToken: string }).mapToken,
		geojson: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'route',
					geometry: {
						type: 'LineString',
						coordinates: [
							[4, 50],
							[5, 51],
						],
					},
					properties: {
						name: 'Route with provenance',
						strokeColor: '#3344aa',
						sourceUrl: 'https://example.com/archival-source',
						customProperties: { source: 'Preserve this attribution' },
					},
				},
				{
					type: 'Feature',
					id: 'place',
					geometry: { type: 'Point', coordinates: [4.5, 50.5] },
					properties: { name: 'Untouched place', customProperties: { note: 'Keep me' } },
				},
			],
		},
	})
	expect(added).toMatchObject({ importedCount: 2, cancelled: false })
	const initial = await readFeatures(earthly, added.mapToken)
	const route = initial.find((feature) => feature.properties?.name === 'Route with provenance')
	if (!route?.id) throw new Error('Native import must expose the retained route identity')
	const routeId = String(route.id)
	await earthly.page.route('**/native-lifecycle-photo.svg', (request) =>
		request.fulfill({
			contentType: 'image/svg+xml',
			body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#3344aa"/></svg>',
		}),
	)
	const imageUrl = new URL('/native-lifecycle-photo.svg', earthly.page.url()).href
	const callout = await executeWebMcpTool(earthly, 'earthly_add_feature_callout', {
		mapToken: added.mapToken,
		featureId: routeId,
		title: 'An illustrated route',
		text: 'The geometry can move without losing this image.',
		media: [{ url: imageUrl, type: 'image', alt: 'Native lifecycle illustration' }],
	})
	expect(callout.ok).not.toBe(false)
	const before = await readFeatures(earthly, callout.mapToken)
	const staleMapPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'map', workspaceId },
	})
	expect(staleMapPreview).toMatchObject({ ok: true, mode: 'new', sideEffectsApplied: false })
	expect(contentPublications()).toHaveLength(0)
	const replacement: LineString = {
		type: 'LineString',
		coordinates: [
			[4, 50],
			[5.5, 51],
			[6, 50],
		],
	}
	const patch = await executeWebMcpTool(earthly, 'earthly_update_feature_geometry', {
		mapToken: callout.mapToken,
		featureId: routeId,
		geometry: replacement,
	})
	expect(patch).toMatchObject({ counts: { updated: 1 }, cancelled: false })
	const after = await readFeatures(earthly, patch.mapToken)
	expect(after.find((feature) => String(feature.id) === routeId)?.geometry).toEqual(replacement)
	expect(after.find((feature) => String(feature.id) === routeId)?.properties).toEqual(
		before.find((feature) => String(feature.id) === routeId)?.properties,
	)
	expect(after.filter((feature) => String(feature.id) !== routeId)).toEqual(
		before.filter((feature) => String(feature.id) !== routeId),
	)
	expect(
		await executeWebMcpTool(earthly, 'earthly_publish_publication', {
			previewToken: staleMapPreview.previewToken,
			confirm: true,
		}),
	).toMatchObject({ ok: false, code: 'stale_map', sideEffectsApplied: false })
	expect(contentPublications()).toHaveLength(0)

	const presentation = {
		version: 1,
		initialView: { center: [5, 50.5], zoom: 6 },
		layers: [
			{
				id: 'route-layer',
				source: { kind: 'local-map', workspaceId },
				featureIds: after.map((feature) => String(feature.id)),
				visible: true,
				opacityMultiplier: 1,
				style: { color: '#3344aa', strokeWidth: 4 },
			},
		],
	}
	const view = {
		version: 1,
		type: 'view',
		id: 'route-detail',
		title: 'The revised route',
		caption: 'A named camera and an illustrated source',
		display: 'cue',
		camera: { center: [5.5, 51], zoom: 8 },
		layers: { 'route-layer': { opacityMultiplier: 0.8, style: { strokeWidth: 6 } } },
	}
	const listed = await executeWebMcpTool(earthly, 'earthly_list_local_drafts')
	const story = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		createNew: true,
		creationToken: listed.creationToken,
		title: 'Native lifecycle Story',
		description: 'A Story with a referenced Map, image and named camera.',
		image: imageUrl,
		markdown: `An illustrated native Story.\n\nSource: ${localReference}\n\n![Route illustration](${imageUrl})\n\n\`\`\`earthly-view\n${JSON.stringify(view)}\n\`\`\``,
		presentation,
	})
	expect(story, JSON.stringify(story)).toMatchObject({ ok: true, draftKey: expect.any(String) })
	const preview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'story', draftKey: story.draftKey },
	})
	expect(preview).toMatchObject({
		ok: true,
		mode: 'new',
		publicationChannel: 'public',
		sideEffectsApplied: false,
	})
	expect(preview.dependencies).toEqual([
		expect.objectContaining({
			kind: 'map',
			workspaceId,
			title: 'Native lifecycle Map',
			featureCount: 2,
		}),
	])
	expect(contentPublications()).toHaveLength(0)
	expect(
		await executeWebMcpTool(earthly, 'earthly_publish_publication', {
			previewToken: preview.previewToken,
			confirm: false,
		}),
	).toMatchObject({ ok: false, sideEffectsApplied: false })
	expect(contentPublications()).toHaveLength(0)
	const publishedStory = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: preview.previewToken,
		confirm: true,
	})
	assertDelivered(publishedStory, events)
	expect(contentPublications()).toHaveLength(2)
	const mapReceipt = receiptFor(publishedStory, 37515)
	const storyReceipt = receiptFor(publishedStory, 37520)
	const publishedBody = JSON.parse(publishedEvent(events, storyReceipt.eventId).content) as {
		content: string
		presentation: { layers: Array<{ source: unknown }> }
	}
	expect(publishedBody.content).toContain('earthly-view')
	expect(publishedBody.content).toContain(imageUrl)
	expect(publishedBody.content).not.toContain('earthly-draft:')
	expect(JSON.stringify(publishedBody.presentation)).not.toContain('local-map')
	expect(JSON.stringify(publishedBody.presentation)).toContain(mapReceipt.coordinate)
	expect(
		await executeWebMcpTool(earthly, 'earthly_publish_publication', {
			previewToken: preview.previewToken,
			confirm: true,
		}),
	).toEqual(publishedStory)
	expect(contentPublications()).toHaveLength(2)

	// Positive publication receipts refresh source grants without a public reread.
	const acknowledgedInventory = await executeWebMcpTool(earthly, 'earthly_list_local_drafts')
	const acknowledgedMap = (
		acknowledgedInventory.sources as Array<{
			reference: string
			revisionId?: string
			featureIds?: string[]
		}>
	).find((source) => source.reference === mapReceipt.coordinate)
	expect(acknowledgedMap).toMatchObject({
		revisionId: mapReceipt.eventId,
		featureIds: after.map((feature) => String(feature.id)),
	})
	const featureCitation = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		createNew: true,
		creationToken: acknowledgedInventory.creationToken,
		title: 'An exact newly published feature',
		markdown: `Source: ${mapReceipt.reference}#${encodeURIComponent(routeId)}`,
	})
	expect(featureCitation, JSON.stringify(featureCitation)).toMatchObject({ ok: true })
	expect(contentPublications()).toHaveLength(2)

	const readMap = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: mapReceipt.reference,
	})
	expect(readMap).toMatchObject({ ok: true, revisionId: mapReceipt.eventId, featureCount: 2 })
	const editedMap = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: mapReceipt.coordinate,
		revisionId: readMap.revisionId,
		intent: 'edit',
	})
	expect(editedMap).toMatchObject({ ok: true, kind: 'map', sourceRevisionId: mapReceipt.eventId })
	const editedFeatures = await readFeatures(
		earthly,
		(editedMap.map as { mapToken: string }).mapToken,
	)
	expect(editedFeatures).toEqual(after)
	const forkedMap = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: mapReceipt.coordinate,
		revisionId: readMap.revisionId,
		intent: 'fork',
	})
	expect(forkedMap).toMatchObject({ ok: true, kind: 'map', sourceRevisionId: mapReceipt.eventId })
	expect(forkedMap.workspaceId).not.toBe(editedMap.workspaceId)
	const forkPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'map', workspaceId: forkedMap.workspaceId },
	})
	expect(forkPreview).toMatchObject({ ok: true, mode: 'copy' })
	const publishedFork = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: forkPreview.previewToken,
		confirm: true,
	})
	assertDelivered(publishedFork, events)
	expect(receiptFor(publishedFork, 37515).coordinate).not.toBe(mapReceipt.coordinate)
	const reopened = await executeWebMcpTool(earthly, 'earthly_open_map_draft', {
		workspaceId: editedMap.workspaceId,
	})
	expect(reopened).toMatchObject({ ok: true, workspaceId: editedMap.workspaceId })
	expect(await readFeatures(earthly, (reopened.map as { mapToken: string }).mapToken)).toEqual(
		after,
	)
	const metadataEdit = await executeWebMcpTool(earthly, 'earthly_set_dataset_metadata', {
		mapToken: (reopened.map as { mapToken: string }).mapToken,
		description: 'The owner updated this Map through native tools.',
	})
	expect(metadataEdit.ok).not.toBe(false)
	const ownedMapPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'map', workspaceId: reopened.workspaceId },
	})
	expect(ownedMapPreview).toMatchObject({
		ok: true,
		mode: 'update',
		baseEventId: mapReceipt.eventId,
	})
	const updatedMap = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: ownedMapPreview.previewToken,
		confirm: true,
	})
	assertDelivered(updatedMap, events)
	const updatedMapReceipt = receiptFor(updatedMap, 37515)
	expect(updatedMapReceipt.coordinate).toBe(mapReceipt.coordinate)
	expect(updatedMapReceipt.eventId).not.toBe(mapReceipt.eventId)
	expect(publishedEvent(events, updatedMapReceipt.eventId).created_at).toBeGreaterThan(
		publishedEvent(events, mapReceipt.eventId).created_at,
	)
	expect(
		await executeWebMcpTool(earthly, 'earthly_read_entity', { reference: mapReceipt.coordinate }),
	).toMatchObject({
		ok: true,
		revisionId: updatedMapReceipt.eventId,
		description: 'The owner updated this Map through native tools.',
		featureCount: 2,
	})

	const firstReadStory = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: storyReceipt.coordinate,
	})
	expect(firstReadStory).toMatchObject({
		ok: true,
		revisionId: storyReceipt.eventId,
		title: 'Native lifecycle Story',
	})
	expect(firstReadStory.presentation).toEqual(publishedBody.presentation)
	const editedStory = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: storyReceipt.coordinate,
		revisionId: firstReadStory.revisionId,
		intent: 'edit',
	})
	expect(editedStory).toMatchObject({
		ok: true,
		kind: 'story',
		sourceRevisionId: storyReceipt.eventId,
	})
	const ownedStory = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: editedStory.draftKey,
	})
	expect(
		(
			await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
				draftTarget: editedStory.draftKey,
				draftToken: ownedStory.draftToken,
				description: 'The owner updated this description through native tools.',
			})
		).ok,
	).toBe(true)
	const ownedPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'story', draftKey: editedStory.draftKey },
	})
	expect(ownedPreview).toMatchObject({
		ok: true,
		mode: 'update',
		baseEventId: storyReceipt.eventId,
	})
	const updatedStory = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: ownedPreview.previewToken,
		confirm: true,
	})
	assertDelivered(updatedStory, events)
	const updatedStoryReceipt = receiptFor(updatedStory, 37520)
	expect(updatedStoryReceipt.coordinate).toBe(storyReceipt.coordinate)
	expect(updatedStoryReceipt.eventId).not.toBe(storyReceipt.eventId)
	expect(publishedEvent(events, updatedStoryReceipt.eventId).created_at).toBeGreaterThan(
		publishedEvent(events, storyReceipt.eventId).created_at,
	)
	const readStory = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: storyReceipt.coordinate,
	})
	expect(readStory).toMatchObject({
		ok: true,
		revisionId: updatedStoryReceipt.eventId,
		summary: 'The owner updated this description through native tools.',
	})
	const forkedStory = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: storyReceipt.coordinate,
		revisionId: readStory.revisionId,
		intent: 'fork',
	})
	expect(forkedStory).toMatchObject({
		ok: true,
		kind: 'story',
		sourceRevisionId: updatedStoryReceipt.eventId,
	})
	expect(forkedStory.draftKey).not.toBe(publishedStory.draftTarget)
	const readFork = await executeWebMcpTool(earthly, 'earthly_read_story_draft', {
		draftTarget: forkedStory.draftKey,
	})
	expect((readFork.draft as { title: string }).title).toBe('Native lifecycle Story (my copy)')
	const staleStoryPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'story', draftKey: forkedStory.draftKey },
	})
	const scopedStoryEdit = await executeWebMcpTool(earthly, 'earthly_write_story_draft', {
		draftTarget: forkedStory.draftKey,
		draftToken: readFork.draftToken,
		description: 'A changed copy description invalidates the earlier preview.',
	})
	expect(scopedStoryEdit.ok).toBe(true)
	expect(
		await executeWebMcpTool(earthly, 'earthly_publish_publication', {
			previewToken: staleStoryPreview.previewToken,
			confirm: true,
		}),
	).toMatchObject({ ok: false, code: 'stale_draft', sideEffectsApplied: false })
	expect(contentPublications()).toHaveLength(5)

	const atlas = await executeWebMcpTool(earthly, 'earthly_write_atlas_draft', {
		createNew: true,
		creationToken: (await executeWebMcpTool(earthly, 'earthly_list_local_drafts')).creationToken,
		name: 'Native lifecycle Atlas',
		description: 'The published Map and Story, with their saved presentation.',
		curatedReferences: [mapReceipt.reference, storyReceipt.reference],
		presentation: publishedBody.presentation,
	})
	expect(atlas, JSON.stringify(atlas)).toMatchObject({ ok: true, draftKey: expect.any(String) })
	const atlasPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'atlas', draftKey: atlas.draftKey },
	})
	expect(atlasPreview, JSON.stringify(atlasPreview)).toMatchObject({
		ok: true,
		mode: 'new',
		dependencies: [],
		sideEffectsApplied: false,
	})
	const publishedAtlas = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: atlasPreview.previewToken,
		confirm: true,
	})
	assertDelivered(publishedAtlas, events)
	const atlasReceipt = receiptFor(publishedAtlas, 37518)
	const atlasEvent = publishedEvent(events, atlasReceipt.eventId)
	expect(atlasEvent.tags).toEqual(
		expect.arrayContaining([
			['a', mapReceipt.coordinate],
			['a', storyReceipt.coordinate],
		]),
	)
	expect(contentPublications()).toHaveLength(6)
	const readAtlas = await executeWebMcpTool(earthly, 'earthly_read_entity', {
		reference: atlasReceipt.coordinate,
	})
	expect(readAtlas).toMatchObject({
		ok: true,
		revisionId: atlasReceipt.eventId,
		name: 'Native lifecycle Atlas',
	})
	const editedAtlas = await executeWebMcpTool(earthly, 'earthly_edit_entity', {
		reference: atlasReceipt.coordinate,
		revisionId: readAtlas.revisionId,
		intent: 'edit',
	})
	expect(editedAtlas).toMatchObject({
		ok: true,
		kind: 'atlas',
		sourceRevisionId: atlasReceipt.eventId,
	})
	const ownedAtlas = await executeWebMcpTool(earthly, 'earthly_read_atlas_draft', {
		draftTarget: editedAtlas.draftKey,
	})
	expect(
		(
			await executeWebMcpTool(earthly, 'earthly_write_atlas_draft', {
				draftTarget: editedAtlas.draftKey,
				draftToken: ownedAtlas.draftToken,
				description: 'The owner updated this Atlas through native tools.',
			})
		).ok,
	).toBe(true)
	const ownedAtlasPreview = await executeWebMcpTool(earthly, 'earthly_prepare_publication', {
		target: { kind: 'atlas', draftKey: editedAtlas.draftKey },
	})
	expect(ownedAtlasPreview).toMatchObject({
		ok: true,
		mode: 'update',
		baseEventId: atlasReceipt.eventId,
	})
	const updatedAtlas = await executeWebMcpTool(earthly, 'earthly_publish_publication', {
		previewToken: ownedAtlasPreview.previewToken,
		confirm: true,
	})
	assertDelivered(updatedAtlas, events)
	const updatedAtlasReceipt = receiptFor(updatedAtlas, 37518)
	expect(updatedAtlasReceipt.coordinate).toBe(atlasReceipt.coordinate)
	expect(updatedAtlasReceipt.eventId).not.toBe(atlasReceipt.eventId)
	expect(publishedEvent(events, updatedAtlasReceipt.eventId).created_at).toBeGreaterThan(
		publishedEvent(events, atlasReceipt.eventId).created_at,
	)
	expect(
		await executeWebMcpTool(earthly, 'earthly_read_entity', { reference: atlasReceipt.coordinate }),
	).toMatchObject({
		ok: true,
		revisionId: updatedAtlasReceipt.eventId,
		description: 'The owner updated this Atlas through native tools.',
	})
	expect(contentPublications()).toHaveLength(7)
	await testInfo.attach('native-publication-receipts', {
		body: JSON.stringify(
			{ publishedStory, publishedFork, updatedMap, updatedStory, publishedAtlas, updatedAtlas },
			null,
			2,
		),
		contentType: 'application/json',
	})

	// Load the signed Story through the ordinary public Reader after all native writes.
	await earthly.page.goto(
		new URL(`/read/${storyReceipt.reference.replace(/^nostr:/, '')}`, earthly.environment.baseURL)
			.href,
	)
	await expect(
		earthly.page.getByRole('heading', { name: 'Native lifecycle Story', exact: true, level: 1 }),
	).toBeVisible()
	await expect(
		earthly.page.getByRole('region', { name: 'Story map', exact: true }),
	).toHaveAttribute('data-presentation-ready', 'true', { timeout: 20_000 })
	await expect(earthly.page.locator('[data-story-view-id="route-detail"]')).toContainText(
		'The revised route',
	)
	const illustration = earthly.page
		.getByText('Route illustration', { exact: true })
		.locator('..')
		.locator('img')
	await expect(illustration).toBeVisible()
	await expect(illustration).toHaveAttribute('src', imageUrl)
	await expect
		.poll(() => illustration.evaluate((element) => (element as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0)
	await expect(
		earthly.page.getByRole('navigation', { name: 'Story map presentation', exact: true }),
	).toBeVisible()
	await earthly.page
		.getByRole('list', { name: 'Story timeline', exact: true })
		.getByRole('button', { name: /The revised route/ })
		.click()
	// Read-only display verification: authoring above uses only native tool contracts.
	await expect
		.poll(() =>
			earthly.page.getByRole('region', { name: 'Story map', exact: true }).evaluate((element) => {
				const displayedMap = (element as HTMLElement & { __earthlyMap?: MapLibreMap }).__earthlyMap
				const center = displayedMap?.getCenter()
				return center
					? [center.lng, center.lat, displayedMap?.getZoom()].map((value) =>
							Number(value?.toFixed(4)),
						)
					: null
			}),
		)
		.toEqual([5.5, 51, 8])
})
