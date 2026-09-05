import type { Page } from '@playwright/test'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { parseStoryMarkdown } from '../../src/lib/map-presentation/storyMarkdown'
import { test, expect } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { createStoryDraft } from '../tasks/create/story'
import { openPanel } from '../tasks/navigation/open-panel'
import { installDeterministicMapStyle } from '../tasks/setup/deterministic-map-style'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'
import { testIdentities } from '../test-identities'

const draftKey = `earthly:story:drafts:v1:${testIdentities.owner.publicKey.slice(0, 8)}`

interface PersistedStoryDraft {
	title?: string
	content?: string
	presentation?: unknown
}

async function savedStory(page: Page): Promise<PersistedStoryDraft | null> {
	return page.evaluate((key) => {
		const map = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, PersistedStoryDraft>
		return map['new-story'] ?? null
	}, draftKey)
}

async function mainCamera(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const map = (window as unknown as { __earthlyMap?: { isMoving(): boolean } }).__earthlyMap
				return map ? map.isMoving() : true
			}),
		)
		.toBe(false)
	return page.evaluate(() => {
		const map = (
			window as unknown as {
				__earthlyMap?: { getCenter(): { lng: number; lat: number }; getZoom(): number }
			}
		).__earthlyMap
		if (!map) throw new Error('The main map is not ready')
		const center = map.getCenter()
		return { center: [center.lng, center.lat], zoom: map.getZoom() }
	})
}

function renderedFront(element: Element | null) {
	const map = element
		? (element as HTMLElement & { __earthlyMap?: MapLibreMap }).__earthlyMap
		: (window as unknown as { __earthlyMap?: MapLibreMap }).__earthlyMap
	if (!map) return null
	for (const source of Object.values(map.getStyle().sources)) {
		if (
			source.type !== 'geojson' ||
			typeof source.data !== 'object' ||
			source.data.type !== 'FeatureCollection'
		)
			continue
		const feature = source.data.features.find(
			(entry) =>
				entry.properties?.earthlyPresentationLayerId === 'front' &&
				entry.properties?.earthlyPresentationSourceFeatureId === 'meeting-point',
		)
		if (feature)
			return {
				geometry: feature.geometry,
				source: feature.properties?.earthlyPresentationSource,
				opacity: feature.properties?.earthlyPresentationOpacityMultiplier,
				strokeColor: feature.properties?.strokeColor,
			}
	}
	return null
}

test('manual Story views retain prose, sparse controls and opening layers through save/reload @editor-contract', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	earthly.page.setDefaultTimeout(15_000)
	await authorizeJourneyIdentity(earthly)
	const fixture = await installInMemoryMapFixture(earthly, {
		title: 'Manual Story reference map',
		identifier: 'manual-story-map',
	})
	await installDeterministicMapStyle(earthly)
	const publications: string[] = []
	earthly.page.on('websocket', (socket) =>
		socket.on('framesent', ({ payload }) => {
			try {
				const frame = JSON.parse(
					typeof payload === 'string' ? payload : payload.toString(),
				) as unknown[]
				if (frame[0] === 'EVENT') publications.push(JSON.stringify(frame))
			} catch {
				/* Non-JSON control frames are irrelevant. */
			}
		}),
	)
	const title = 'A manually authored Western Front'
	const leading = 'The line freezes.'
	const trailing = 'The next paragraph must stay.'
	const reference = `nostr:${fixture.path.split('/').at(-1)}`
	await createStoryDraft(earthly, {
		title,
		body: `${leading}\n\nSource: ${reference}\n\n${trailing}`,
	})
	await earthly.page.getByRole('button', { name: 'Start empty', exact: true }).click()
	await earthly.page
		.getByRole('combobox')
		.filter({
			has: earthly.page.getByRole('option', {
				name: 'Add a Map referenced in the body…',
				exact: true,
			}),
		})
		.selectOption(fixture.address)
	await earthly.page.getByRole('button', { name: 'Add layer', exact: true }).click()
	await earthly.page
		.getByRole('textbox', { name: 'Stable presentation layer id', exact: true })
		.fill('front')
	await earthly.page.getByRole('button', { name: 'Hide layer at open', exact: true }).click()

	const editor = earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
	await editor.focus()
	const isMac = await earthly.page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform))
	await earthly.page.keyboard.press(isMac ? 'Meta+ArrowUp' : 'Control+Home')
	for (let index = 0; index < leading.length; index += 1)
		await earthly.page.keyboard.press('ArrowRight')
	await earthly.page
		.getByRole('button', { name: 'Insert Story view from the current map', exact: true })
		.click()
	let block = editor.locator('[data-story-view]').first()
	await block.getByLabel('View title', { exact: true }).fill('The line freezes in 1914')
	await block.getByLabel('Caption', { exact: true }).fill('The first winter on the front.')
	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('both')
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	if (await block.getByRole('button', { name: 'Set camera', exact: true }).isVisible())
		await block.getByRole('button', { name: 'Set camera', exact: true }).click()
	await block.getByLabel('Longitude', { exact: true }).fill('4.4')
	await block.getByLabel('Latitude', { exact: true }).fill('49.6')
	await block.getByLabel('Zoom', { exact: true }).fill('6.2')
	await block.getByLabel('Bearing', { exact: true }).fill('10')
	await block.getByLabel('Pitch', { exact: true }).fill('20')
	const front = block.getByRole('group', { name: 'front', exact: true })
	await front.getByRole('combobox', { name: 'Visibility', exact: true }).selectOption('show')
	await front.getByLabel('Opacity multiplier', { exact: true }).fill('0.35')
	await front.getByRole('button', { name: /^Style overrides/ }).click()
	const strokeColor = front.getByRole('textbox', { name: 'Stroke color', exact: true })
	await strokeColor.fill('#225577')
	await strokeColor.fill('#22')
	await expect(strokeColor).toHaveAttribute('aria-invalid', 'true')
	await expect(strokeColor).toHaveAccessibleDescription(
		'Use a valid stroke color, or clear to inherit.',
	)
	await strokeColor.fill('#225577')
	await front.getByRole('combobox', { name: 'Line dash', exact: true }).selectOption('dashed')
	await front.getByRole('combobox', { name: 'End arrow', exact: true }).selectOption('false')
	const controlsPath = testInfo.outputPath('manual-story-controls.png')
	await earthly.page.screenshot({ path: controlsPath })
	await testInfo.attach('Manual Story view controls', {
		path: controlsPath,
		contentType: 'image/png',
	})

	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('figure')
	const beforePreview = await mainCamera(earthly.page)
	await block.getByRole('button', { name: 'Preview figure', exact: true }).click()
	await expect(earthly.page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
		'data-state',
		'active',
	)
	await expect(
		earthly.page.getByText('The first winter on the front.', { exact: true }),
	).toBeVisible()
	const figure = earthly.page.getByRole('region', { name: 'Story figure map', exact: true })
	await expect(figure).toBeVisible()
	await figure.scrollIntoViewIfNeeded()
	await expect(figure.locator('canvas[aria-label="Map"]')).toBeVisible()
	await expect
		.poll(() => figure.evaluate(renderedFront), { timeout: 15_000 })
		.toEqual({
			geometry: { type: 'Point', coordinates: [13.98, 46.7] },
			source: fixture.address,
			opacity: 0.35,
			strokeColor: '#225577',
		})
	expect(await mainCamera(earthly.page)).toEqual(beforePreview)
	const previewPath = testInfo.outputPath('manual-story-figure-preview.png')
	await earthly.page.screenshot({ path: previewPath })
	await testInfo.attach('Independent Story figure preview', {
		path: previewPath,
		contentType: 'image/png',
	})
	await earthly.page.getByRole('tab', { name: 'Write', exact: true }).click()
	block = earthly.page.locator('.ProseMirror[contenteditable="true"] [data-story-view]').first()
	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('both')
	await block.getByRole('button', { name: 'Apply view', exact: true }).click()
	await expect.poll(async () => (await mainCamera(earthly.page)).zoom).toBeCloseTo(6.2, 1)
	const applied = await mainCamera(earthly.page)
	expect(applied.center[0]).toBeCloseTo(4.4, 2)
	expect(applied.center[1]).toBeCloseTo(49.6, 2)

	// Applying a cue must not freeze subsequent previews at its old snapshot.
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	await block.getByLabel('Longitude', { exact: true }).fill('5.1')
	const updatedFront = block.getByRole('group', { name: 'front', exact: true })
	await updatedFront.getByLabel('Opacity multiplier', { exact: true }).fill('0.55')
	await updatedFront.getByRole('button', { name: /^Style overrides/ }).click()
	await updatedFront.getByRole('textbox', { name: 'Stroke color', exact: true }).fill('#663399')
	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('figure')
	await block.getByRole('button', { name: 'Preview figure', exact: true }).click()
	await expect(figure).toBeVisible()
	await expect
		.poll(() => figure.evaluate(renderedFront))
		.toEqual({
			geometry: { type: 'Point', coordinates: [13.98, 46.7] },
			source: fixture.address,
			opacity: 0.55,
			strokeColor: '#663399',
		})
	await expect
		.poll(() =>
			figure.evaluate(
				(element) =>
					(element as HTMLElement & { __earthlyMap?: MapLibreMap }).__earthlyMap?.getCenter().lng,
			),
		)
		.toBeCloseTo(5.1, 2)
	expect(await mainCamera(earthly.page)).toEqual(applied)
	await earthly.page.getByRole('tab', { name: 'Write', exact: true }).click()
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	await block.getByLabel('Longitude', { exact: true }).fill('4.4')
	await updatedFront.getByLabel('Opacity multiplier', { exact: true }).fill('0.35')
	await updatedFront.getByRole('button', { name: /^Style overrides/ }).click()
	await updatedFront.getByRole('textbox', { name: 'Stroke color', exact: true }).fill('#225577')
	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('both')
	await earthly.page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect
		.poll(async () => (await savedStory(earthly.page))?.content)
		.toContain('The line freezes in 1914')
	const saved = await savedStory(earthly.page)
	if (!saved?.content) throw new Error('Story draft did not persist')
	const occurrence = parseStoryMarkdown(saved.content).views[0]
	expect(occurrence?.result.status).toBe('valid')
	if (occurrence?.result.status !== 'valid') throw new Error('No valid saved view')
	expect(occurrence.result.value).toMatchObject({
		title: 'The line freezes in 1914',
		caption: 'The first winter on the front.',
		display: 'both',
		camera: { center: [4.4, 49.6], zoom: 6.2, bearing: 10, pitch: 20 },
		layers: {
			front: {
				visible: true,
				opacityMultiplier: 0.35,
				style: { strokeColor: '#225577', lineDash: 'dashed', arrowEnd: false },
			},
		},
	})
	expect(saved.presentation).toMatchObject({
		version: 1,
		layers: [{ id: 'front', source: fixture.address, visible: false, opacityMultiplier: 1 }],
	})
	expect(saved.content.indexOf(leading)).toBeLessThan(occurrence.start)
	expect(saved.content.indexOf(reference)).toBeGreaterThan(occurrence.end)
	expect(saved.content).toContain(trailing)

	await earthly.page.reload({ waitUntil: 'domcontentloaded' })
	// A local create has no published address. Reopening New Story resumes its
	// retained new-story slot; it must not clear or replace that saved body.
	if (earthly.isMobile) {
		await earthly.page.getByRole('button', { name: 'Create', exact: true }).click()
		await earthly.page.getByRole('menuitem', { name: 'Story', exact: true }).click()
	} else {
		await openPanel(earthly, 'Stories')
		await earthly.page.getByRole('button', { name: 'New Story', exact: true }).click()
	}
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue(title)
	block = earthly.page.locator('.ProseMirror[contenteditable="true"] [data-story-view]').first()
	await expect(block.getByLabel('View title', { exact: true })).toHaveValue(
		'The line freezes in 1914',
	)
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	await expect(block.getByLabel('Longitude', { exact: true })).toHaveValue('4.4')
	await expect(
		block
			.getByRole('group', { name: 'front', exact: true })
			.getByLabel('Opacity multiplier', { exact: true }),
	).toHaveValue('0.35')
	await block.getByRole('button', { name: 'Move Story view down', exact: true }).click()
	await earthly.page.getByRole('button', { name: 'Save draft', exact: true }).click()
	const moved = await savedStory(earthly.page)
	if (!moved?.content) throw new Error('Moved Story view was not retained')
	expect(moved.content).toContain(reference)
	expect(moved.content).toContain(leading)
	expect(moved.content).toContain(trailing)
	expect(parseStoryMarkdown(moved.content).views[0]?.start).toBeGreaterThan(occurrence.start)
	await block.getByRole('button', { name: 'Move Story view up', exact: true }).click()
	await block.getByRole('button', { name: 'Remove Story view', exact: true }).click()
	await earthly.page.getByRole('button', { name: 'Save draft', exact: true }).click()
	const removed = await savedStory(earthly.page)
	expect(parseStoryMarkdown(removed?.content ?? '').views).toHaveLength(0)
	expect(removed?.content).toContain(leading)
	expect(removed?.content).toContain(reference)
	expect(removed?.content).toContain(trailing)
	expect(removed?.presentation).toEqual(saved.presentation)

	// A discarded draft must not leave its last applied snapshot on the shared map.
	const resumedEditor = earthly.page.locator('.ProseMirror[contenteditable="true"]').first()
	await resumedEditor.focus()
	await earthly.page.keyboard.press(isMac ? 'Meta+ArrowDown' : 'Control+End')
	await earthly.page
		.getByRole('button', { name: 'Insert Story view from the current map', exact: true })
		.click()
	await block.getByRole('combobox', { name: 'Display', exact: true }).selectOption('cue')
	await block.getByRole('button', { name: 'Camera and layers', exact: true }).click()
	await block
		.getByRole('group', { name: 'front', exact: true })
		.getByRole('combobox', { name: 'Visibility', exact: true })
		.selectOption('show')
	await block.getByRole('button', { name: 'Apply view', exact: true }).click()
	await expect
		.poll(() => earthly.page.evaluate(renderedFront, null))
		.toMatchObject({
			geometry: { type: 'Point', coordinates: [13.98, 46.7] },
			source: fixture.address,
		})
	await earthly.page.getByRole('button', { name: 'Discard draft', exact: true }).click()
	await earthly.page
		.getByRole('alertdialog', { name: 'Discard this draft?', exact: true })
		.getByRole('button', { name: 'Discard', exact: true })
		.click()
	await expect(earthly.page.getByLabel('Title', { exact: true })).toHaveValue('')
	await expect.poll(() => earthly.page.evaluate(renderedFront, null)).toBeNull()
	await expect.poll(() => savedStory(earthly.page)).toBeNull()
	expect(publications).toEqual([])
})
