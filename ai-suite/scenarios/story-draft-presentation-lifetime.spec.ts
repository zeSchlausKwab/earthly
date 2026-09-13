import { hexToBytes } from '@noble/hashes/utils.js'
import type { Page } from '@playwright/test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { finalizeEvent, nip19 } from 'nostr-tools'
import type { MapPresentationV1 } from '../../src/lib/map-presentation/types'
import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { createStoryDraft } from '../tasks/create/story'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { testIdentities } from '../test-identities'

const storyTitle = 'Retained Story with a local view'
const draftKey = `earthly:story:drafts:v1:${testIdentities.owner.publicKey.slice(0, 8)}`

async function savedStory(page: Page) {
	return page.evaluate((key) => {
		const drafts = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<
			string,
			{ title?: string; content?: string; presentation?: unknown; updatedAt?: number }
		>
		const draft = drafts['new-story']
		if (!draft) return null
		// Resuming an editor may flush its retained draft again. Compare authored
		// state, including its view, rather than the save operation's timestamp.
		const { updatedAt: _updatedAt, ...snapshot } = draft
		return snapshot
	}, draftKey)
}

async function presentationState(page: Page) {
	return page.evaluate(() => {
		const map = (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
		if (!map) return null
		const layers = Object.values(map.getStyle().sources).flatMap((source) => {
			if (
				source.type !== 'geojson' ||
				typeof source.data !== 'object' ||
				source.data.type !== 'FeatureCollection'
			)
				return []
			return source.data.features.flatMap((feature) =>
				feature.properties?.earthlyPresentationLayerId
					? [
							{
								id: feature.properties.earthlyPresentationLayerId,
								source: feature.properties.earthlyPresentationSource,
								featureId: feature.properties.earthlyPresentationSourceFeatureId,
								opacity: feature.properties.earthlyPresentationOpacityMultiplier,
								color: feature.properties.color,
							},
						]
					: [],
			)
		})
		const center = map.getCenter()
		return {
			layers,
			center: [center.lng, center.lat] as const,
			zoom: map.getZoom(),
			moving: map.isMoving(),
		}
	})
}

test('retained Story preview yields to the Atlas until explicitly resumed @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(90_000)
	const page = earthly.page
	page.setDefaultTimeout(15_000)
	const pageErrors: string[] = []
	const publications: string[] = []
	page.on('pageerror', (error) => pageErrors.push(error.message))
	page.on('websocket', (socket) =>
		socket.on('framesent', ({ payload }) => {
			try {
				const frame = JSON.parse(
					typeof payload === 'string' ? payload : payload.toString(),
				) as unknown[]
				if (frame[0] === 'EVENT') publications.push(JSON.stringify(frame))
			} catch {
				/* Ignore non-JSON WebSocket control frames. */
			}
		}),
	)
	await authorizeJourneyIdentity(earthly)
	const map = await installInMemoryMapFixture(earthly, {
		title: 'Presentation lifetime source',
		identifier: 'ai-suite-story-lifetime-source',
	})
	const identifier = 'ai-suite-story-lifetime-atlas'
	const atlasPresentation: MapPresentationV1 = {
		version: 1,
		initialView: { center: [13.98, 46.7], zoom: 7.3 },
		layers: [
			{
				id: 'atlas-kept',
				source: map.address as `37515:${string}:${string}`,
				featureIds: ['meeting-point'],
				visible: true,
				opacityMultiplier: 0.6,
				style: { color: '#166534', radius: 9 },
			},
		],
	}
	const atlas = finalizeEvent(
		{
			kind: 37518,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier],
				['a', map.address],
			],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				name: 'Atlas keeps its own presentation',
				description: 'Page-local presentation lifetime fixture.',
				descriptionFormat: 'markdown',
				governance: 'closed',
				presentation: atlasPresentation,
			}),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)
	// Only this scenario needs an Atlas with an authored presentation. Like the
	// shared Map fixture, it enters the real EventStore but never a relay.
	await page.addInitScript((event) => {
		const insert = () => {
			const store = (
				window as unknown as {
					__earthlyEventStore?: { add(value: typeof event): unknown }
				}
			).__earthlyEventStore
			if (store) store.add(event)
			else requestAnimationFrame(insert)
		}
		insert()
	}, atlas)
	const naddr = nip19.naddrEncode({ kind: atlas.kind, pubkey: atlas.pubkey, identifier })
	await earthly.open({ path: `/browse/maps?in=${naddr}` })
	await installDeterministicMapStyle(earthly)
	const atlasLayer = {
		id: 'atlas-kept',
		source: map.address,
		featureId: 'meeting-point',
		opacity: 0.6,
		color: '#166534',
	}
	await expect.poll(async () => (await presentationState(page))?.layers).toEqual([atlasLayer])
	await expect.poll(async () => (await presentationState(page))?.moving).toBe(false)
	await expect.poll(async () => (await presentationState(page))?.zoom).toBeCloseTo(7.3, 1)

	await createStoryDraft(earthly, {
		title: storyTitle,
		body: `Keep this unpublished prose.\n\nSource: nostr:${map.path.split('/').at(-1)}`,
	})
	await page.getByRole('button', { name: 'Start empty', exact: true }).click()
	await page
		.getByRole('combobox')
		.filter({
			has: page.getByRole('option', { name: 'Add a Map referenced in the body…', exact: true }),
		})
		.selectOption(map.address)
	await page.getByRole('button', { name: 'Add layer', exact: true }).click()
	await page
		.getByRole('textbox', { name: 'Stable presentation layer id', exact: true })
		.fill('story-kept')
	// Insert into the opening prose, never into a retained selection within the
	// Nostr address: splitting that address legitimately revokes its layer grant.
	const editor = page.locator('.ProseMirror[contenteditable="true"]').first()
	await editor.focus()
	const isMac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
	await page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home')
	for (let index = 0; index < 'Keep this unpublished prose.'.length; index += 1)
		await page.keyboard.press('ArrowRight')
	await page
		.getByRole('button', { name: 'Insert Story view from the current map', exact: true })
		.click()
	const block = page.locator('.ProseMirror[contenteditable="true"] [data-story-view]').first()
	await block.getByLabel('View title', { exact: true }).fill('Explicit Story camera')
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	if (await block.getByRole('button', { name: 'Set camera', exact: true }).isVisible())
		await block.getByRole('button', { name: 'Set camera', exact: true }).click()
	await block.getByLabel('Longitude', { exact: true }).fill('4.4')
	await block.getByLabel('Latitude', { exact: true }).fill('49.6')
	await block.getByLabel('Zoom', { exact: true }).fill('6.2')
	await block.getByRole('button', { name: 'Apply view', exact: true }).click()
	await expect.poll(async () => (await presentationState(page))?.zoom).toBeCloseTo(6.2, 1)
	await expect
		.poll(async () => (await presentationState(page))?.layers.map((layer) => layer.id))
		.toEqual(['story-kept'])
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect
		.poll(async () => (await savedStory(page))?.content)
		.toContain('Explicit Story camera')
	const saved = await savedStory(page)
	await expect.poll(async () => (await presentationState(page))?.moving).toBe(false)
	const appliedCamera = await presentationState(page)

	// Leaving the visible editor retains its local state, but must revoke its
	// presentation ownership: the Atlas lens remains the foreground carrier.
	await openPanel(earthly, 'Shelf')
	// The desktop retains the foreground editor while switching its underlying
	// work destination. Its explicit Back control returns to the actual Shelf.
	if (!earthly.isMobile)
		await page.getByRole('button', { name: 'Back to Shelf', exact: true }).click()
	await expect(page.getByLabel('Title', { exact: true })).toBeHidden()
	expect(new URL(page.url()).searchParams.get('in')).toBe(naddr)
	await expect.poll(async () => (await presentationState(page))?.layers).toEqual([atlasLayer])
	await expect.poll(async () => (await presentationState(page))?.moving).toBe(false)
	// The same Atlas opening is a once-only camera intent. Restoring its layers
	// must not repeatedly reframe an already-active lens.
	const restoredAtlas = await presentationState(page)
	if (!restoredAtlas || !appliedCamera) throw new Error('The main presentation map is unavailable')
	expect(restoredAtlas.zoom).toBeCloseTo(appliedCamera.zoom, 8)
	expect(restoredAtlas.center[0]).toBeCloseTo(appliedCamera.center[0], 8)
	expect(restoredAtlas.center[1]).toBeCloseTo(appliedCamera.center[1], 8)
	expect(await savedStory(page)).toEqual(saved)
	const atlasPath = testInfo.outputPath(`retained-story-atlas-${testInfo.project.name}.png`)
	await page.screenshot({ path: atlasPath })
	await testInfo.attach('Atlas retains its presentation with Story saved', {
		path: atlasPath,
		contentType: 'image/png',
	})

	if (earthly.isMobile) {
		// Shelf has no saved-work selector. The mobile contract ends at the
		// retained-draft boundary; desktop exercises the explicit return below.
		expect(publications).toEqual([])
		expect(pageErrors).toEqual([])
		return
	}
	await page
		.getByRole('navigation', { name: 'Return to retained work', exact: true })
		.getByRole('button', { name: 'Story edit', exact: true })
		.click()
	await expect(page.getByLabel('Title', { exact: true })).toHaveValue(storyTitle)
	await expect(block.getByLabel('View title', { exact: true })).toHaveValue('Explicit Story camera')
	await block.getByRole('button', { name: 'Apply view', exact: true }).click()
	await expect
		.poll(async () => (await presentationState(page))?.layers.map((layer) => layer.id))
		.toEqual(['story-kept'])
	await expect.poll(async () => (await presentationState(page))?.moving).toBe(false)
	await expect.poll(async () => (await presentationState(page))?.zoom).toBeCloseTo(6.2, 1)
	const resumedPath = testInfo.outputPath(`resumed-story-${testInfo.project.name}.png`)
	await page.screenshot({ path: resumedPath })
	await testInfo.attach('Explicitly resumed Story preview', {
		path: resumedPath,
		contentType: 'image/png',
	})
	await openPanel(earthly, 'Shelf')
	if (!earthly.isMobile)
		await page.getByRole('button', { name: 'Back to Shelf', exact: true }).click()
	await expect(page.getByLabel('Title', { exact: true })).toBeHidden()
	await expect.poll(async () => (await presentationState(page))?.layers).toEqual([atlasLayer])
	expect(await savedStory(page)).toEqual(saved)
	expect(publications).toEqual([])
	expect(pageErrors).toEqual([])
})
