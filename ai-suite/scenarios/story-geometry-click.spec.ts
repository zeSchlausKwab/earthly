import { hexToBytes } from '@noble/hashes/utils.js'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { finalizeEvent, nip19, type NostrEvent } from 'nostr-tools'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { mobileWorkspaceSheet } from '../tasks/navigation/mobile-workspace'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import { testIdentities } from '../test-identities'

async function exposeMobileMap(earthly: EarthlySession) {
	if (!earthly.isMobile) return
	const resize = mobileWorkspaceSheet(earthly).getByRole('slider', {
		name: 'Resize panel',
		exact: true,
	})
	await resize.press('Home')
	const minimum = await resize.getAttribute('aria-valuemin')
	if (minimum === null) throw new Error('The mobile sheet must expose its minimum height.')
	await expect(resize).toHaveAttribute('aria-valuenow', minimum)
}

async function openStoryFixture(earthly: EarthlySession, authored: boolean) {
	const events = new Map<string, NostrEvent>()
	const publications = await installIsolatedRelays(earthly, events)
	await earthly.open()
	const map = await installInMemoryMapFixture(earthly, {
		title: 'Story geometry inspection source',
		identifier: 'story-geometry-inspection-source',
	})
	const identifier = `story-geometry-click-${authored ? 'authored' : 'reference'}`
	const title = `Story with ${authored ? 'authored layers' : 'an ordinary Map reference'}`
	const story = finalizeEvent(
		{
			kind: 37520,
			created_at: Math.floor(Date.now() / 1000) - 5,
			tags: [
				['d', identifier],
				['a', map.address],
			],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				title,
				content: `Keep the Story map while inspecting its geometry.\n\nSource: nostr:${map.path.split('/').at(-1)}`,
				...(authored
					? {
							presentation: {
								version: 1,
								initialView: { center: [13.98, 46.7], zoom: 9.3 },
								layers: [
									{
										id: 'story-inspection-layer',
										source: map.address,
										featureIds: ['meeting-point'],
										visible: true,
										opacityMultiplier: 0.7,
										style: { color: '#7c3aed', radius: 14 },
									},
								],
							},
						}
					: {}),
			}),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	events.set(story.id, story)
	const path = `/story/${nip19.naddrEncode({ kind: story.kind, pubkey: story.pubkey, identifier })}`
	await earthly.open({ path })
	await installDeterministicMapStyle(earthly)
	await expect(earthly.page.getByRole('heading', { name: title, exact: true })).toBeVisible()
	await exposeMobileMap(earthly)
	return { map, path, publications }
}

async function mapSnapshot(earthly: EarthlySession, source: string) {
	return earthly.page.evaluate((reference) => {
		const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
		if (!map) throw new Error('The workspace map is unavailable.')
		const layers = Object.entries(map.getStyle().sources).flatMap(([sourceId, data]) => {
			if (
				data.type !== 'geojson' ||
				typeof data.data !== 'object' ||
				data.data.type !== 'FeatureCollection'
			)
				return []
			return data.data.features.flatMap((feature) => {
				const props = feature.properties
				if (props?.earthlyPresentationSource !== reference || props.proxyFeature) return []
				return [
					{
						sourceId,
						id: feature.id,
						geometry: feature.geometry,
						carrier: props.earthlyPresentationCarrierId,
						layer: props.earthlyPresentationLayerId,
						source: props.earthlyPresentationSource,
						featureId: props.earthlyPresentationSourceFeatureId,
						color: props.color,
						radius: props.radius,
						opacity: props.earthlyPresentationOpacityMultiplier,
					},
				]
			})
		})
		const projected = map.project([13.98, 46.7])
		const canvas = map.getCanvas()
		const bounds = canvas.getBoundingClientRect()
		const point = { x: bounds.x + projected.x, y: bounds.y + projected.y }
		const hits = map
			.queryRenderedFeatures(projected)
			.filter(
				(feature) =>
					feature.properties?.earthlyPresentationSource === reference &&
					feature.properties?.earthlyPresentationSourceFeatureId === 'meeting-point' &&
					!feature.properties?.proxyFeature,
			)
			.map((feature) => feature.layer.id)
		return {
			layers,
			hits,
			camera: {
				center: map.getCenter().toArray(),
				zoom: map.getZoom(),
				bearing: map.getBearing(),
				pitch: map.getPitch(),
			},
			moving: map.isMoving(),
			point,
			canvasReceivesClick: document.elementFromPoint(point.x, point.y) === canvas,
		}
	}, source)
}

async function clickGeometry(earthly: EarthlySession, source: string) {
	// Opening the source inspector raises the phone sheet. Expose the canvas
	// through its normal resize control before tapping the geometry again.
	await exposeMobileMap(earthly)
	await expect.poll(async () => (await mapSnapshot(earthly, source)).moving).toBe(false)
	await expect.poll(async () => (await mapSnapshot(earthly, source)).hits.length).toBeGreaterThan(0)
	await expect.poll(async () => (await mapSnapshot(earthly, source)).canvasReceivesClick).toBe(true)
	const { point } = await mapSnapshot(earthly, source)
	if (earthly.isMobile) await earthly.page.touchscreen.tap(point.x, point.y)
	else await earthly.page.mouse.click(point.x, point.y)
	// Source cleanup and restoration happen after the inspector's React commit.
	// Observe actual rendered frames before asserting that the overlay survived.
	await earthly.page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
}

for (const authored of [true, false]) {
	test(`Story ${authored ? 'authored presentation' : 'ordinary Map reference'} survives repeated canvas geometry inspection @editor-contract`, async ({
		earthly,
	}, testInfo) => {
		const fixture = await openStoryFixture(earthly, authored)
		const pageErrors: string[] = []
		earthly.page.on('pageerror', (error) => pageErrors.push(error.message))
		await expect
			.poll(async () => (await mapSnapshot(earthly, fixture.map.address)).layers.length)
			.toBe(1)
		await expect
			.poll(async () => (await mapSnapshot(earthly, fixture.map.address)).moving)
			.toBe(false)
		const before = await mapSnapshot(earthly, fixture.map.address)
		expect(before.layers[0]).toMatchObject({
			source: fixture.map.address,
			featureId: 'meeting-point',
			...(authored
				? { layer: 'story-inspection-layer', color: '#7c3aed', radius: 14, opacity: 0.7 }
				: {}),
		})
		const observations = []
		for (let click = 0; click < 2; click += 1) {
			await clickGeometry(earthly, fixture.map.address)
			await expect(
				earthly.page.getByRole('dialog', { name: 'Meeting point details', exact: true }),
			).toBeVisible()
			// Inspecting the geometry may replace the Margin's single subject with
			// its source Map; the routed Story continues to own the canvas layers.
			await expect(
				earthly.page.getByRole('heading', { name: fixture.map.title, exact: true }),
			).toHaveCount(1)
			expect(new URL(earthly.page.url()).pathname).toBe(fixture.path)
			await expect
				.poll(async () => (await mapSnapshot(earthly, fixture.map.address)).layers)
				.toEqual(before.layers)
			await expect
				.poll(async () => (await mapSnapshot(earthly, fixture.map.address)).hits.length)
				.toBeGreaterThan(0)
			const after = await mapSnapshot(earthly, fixture.map.address)
			expect(after.camera.center[0]).toBeCloseTo(before.camera.center[0] ?? 0, 8)
			expect(after.camera.center[1]).toBeCloseTo(before.camera.center[1] ?? 0, 8)
			expect(after.camera.zoom).toBeCloseTo(before.camera.zoom, 8)
			expect(after.camera.bearing).toBeCloseTo(before.camera.bearing, 8)
			expect(after.camera.pitch).toBeCloseTo(before.camera.pitch, 8)
			observations.push(after)
		}
		expect(fixture.publications.size).toBe(0)
		expect(pageErrors).toEqual([])
		await testInfo.attach('story-geometry-inspection.json', {
			body: JSON.stringify({ authored, before, observations }, null, 2),
			contentType: 'application/json',
		})
	})
}
