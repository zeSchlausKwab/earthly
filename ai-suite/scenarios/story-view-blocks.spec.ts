import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { FeatureCollection } from 'geojson'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Locator } from '@playwright/test'
import type { NostrEvent } from 'nostr-tools'
import type {
	EffectiveStoryViewStateV1,
	MapPresentationV1,
	StoryViewBlockV1,
} from '../../src/lib/map-presentation/types'
import { reduceStoryViewBlocks } from '../../src/lib/map-presentation/views'
import type { EarthlySession } from '../core/session'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'

interface ReaderDebugWindow extends Window {
	__ww1MapMoves?: number
}

interface ReaderMapElement extends HTMLElement {
	__earthlyMap?: MapLibreMap
}

interface Ww1StoryFixture {
	events: NostrEvent[]
	presentation: MapPresentationV1
	views: StoryViewBlockV1[]
	maps: Record<string, { address: string; collection: FeatureCollection }>
	story: { event: NostrEvent; readerPath: string }
}

async function buildWw1StoryFixture(): Promise<Ww1StoryFixture> {
	// Invoke the SAME production-codec builder in Bun without broadening the AI-suite
	// TS graph to the application's pre-existing factory/cast diagnostics.
	const result = await promisify(execFile)('bun', [resolve('scripts/fixtures/ww1-story.ts')], {
		maxBuffer: 2 * 1024 * 1024,
	})
	return JSON.parse(result.stdout) as Ww1StoryFixture
}

async function openFixture(earthly: EarthlySession): Promise<Ww1StoryFixture> {
	await authorizeJourneyIdentity(earthly, 'owner')
	const fixture = await buildWw1StoryFixture()
	await earthly.page.addInitScript((events) => {
		const addWhenReady = () => {
			const store = (
				window as unknown as {
					__earthlyEventStore?: { add(event: (typeof events)[number]): unknown }
				}
			).__earthlyEventStore
			if (store) for (const event of events) store.add(event)
			else requestAnimationFrame(addWhenReady)
		}
		addWhenReady()
	}, fixture.events)
	// The generic workspace opener expects one canvas; a Reader intentionally has several.
	await earthly.page.goto(new URL(fixture.story.readerPath, earthly.environment.baseURL).href, {
		waitUntil: 'domcontentloaded',
	})
	const title = (JSON.parse(fixture.story.event.content) as { title: string }).title
	await expect(
		earthly.page.getByRole('heading', { name: title, exact: true, level: 1 }),
	).toBeVisible()
	await expect(
		earthly.page.getByRole('region', { name: 'Story map', exact: true }),
	).toHaveAttribute('data-presentation-ready', 'true', { timeout: 20_000 })
	await expect
		.poll(() =>
			earthly.page
				.getByRole('region', { name: 'Story map', exact: true })
				.evaluate((element) => Boolean((element as ReaderMapElement).__earthlyMap)),
		)
		.toBe(true)
	return fixture
}

function viewBlock(earthly: EarthlySession, id: string): Locator {
	// Physical Markdown view identity already exists in the production renderer.
	return earthly.page.locator(`[data-story-view-id="${id}"]`)
}

/** A real click on the visible sticky bar: Playwright's pre-scroll moves it by half a page. */
async function clickPresenterControl(earthly: EarthlySession, button: Locator) {
	await expect(button).toBeVisible()
	await expect(button).toBeEnabled()
	const isHitTarget = () =>
		button.evaluate((element) => {
			const bounds = element.getBoundingClientRect()
			return element.contains(
				document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
			)
		})
	// Initial Present may be below the title on a small phone; sticky controls already on
	// screen must not be recentered, which changes the text being followed before the click.
	if (!(await isHitTarget())) await button.scrollIntoViewIfNeeded()
	await expect.poll(isHitTarget).toBe(true)
	const bounds = await button.boundingBox()
	if (!bounds) throw new Error('The visible Story presenter control has no bounds.')
	const x = bounds.x + bounds.width / 2
	const y = bounds.y + bounds.height / 2
	if (earthly.isMobile) await earthly.page.touchscreen.tap(x, y)
	else await earthly.page.mouse.click(x, y)
}

async function assertCuePresented(block: Locator) {
	// One pixel at the bottom edge is not enough: the full cue header must be readable.
	await expect
		.poll(() =>
			block.evaluate((element) => {
				const root = element.closest('.earthly-reader__article')?.getBoundingClientRect()
				const cue = element.querySelector('button')?.getBoundingClientRect()
				return Boolean(
					root && cue && cue.top >= root.top && cue.bottom <= Math.min(root.bottom, innerHeight),
				)
			}),
		)
		.toBe(true)
}

async function camera(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const map = document.querySelector<ReaderMapElement>(
			'[role="region"][aria-label="Story map"]',
		)?.__earthlyMap
		if (!map) throw new Error('The main Reader map is not mounted.')
		const center = map.getCenter()
		return {
			center: [center.lng, center.lat],
			zoom: map.getZoom(),
			bearing: map.getBearing(),
			pitch: map.getPitch(),
			moving: map.isMoving(),
		}
	})
}

async function assertCamera(
	earthly: EarthlySession,
	expected: EffectiveStoryViewStateV1['camera'],
) {
	if (!expected) throw new Error('The WW1 view must define a camera.')
	await expect
		.poll(
			async () => {
				const actual = await camera(earthly)
				return (
					!actual.moving &&
					Math.abs((actual.center[0] ?? 0) - expected.center[0]) < 0.0001 &&
					Math.abs((actual.center[1] ?? 0) - expected.center[1]) < 0.0001 &&
					Math.abs(actual.zoom - expected.zoom) < 0.0001 &&
					Math.abs(actual.bearing - (expected.bearing ?? 0)) < 0.0001 &&
					Math.abs(actual.pitch - (expected.pitch ?? 0)) < 0.0001
				)
			},
			{ timeout: 15_000 },
		)
		.toBe(true)
}

async function renderedLayers(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const map = document.querySelector<ReaderMapElement>(
			'[role="region"][aria-label="Story map"]',
		)?.__earthlyMap
		if (!map) throw new Error('The main Reader map is not mounted.')
		const style = map.getStyle()
		return Object.entries(style.sources).flatMap(([sourceId, source]) => {
			if (
				source.type !== 'geojson' ||
				typeof source.data !== 'object' ||
				source.data.type !== 'FeatureCollection'
			)
				return []
			const data = source.data as FeatureCollection
			const properties = data.features[0]?.properties
			if (!properties?.earthlyPresentationLayerId) return []
			const layers = style.layers.filter((layer) => 'source' in layer && layer.source === sourceId)
			return [
				{
					id: String(properties.earthlyPresentationLayerId),
					source: String(properties.earthlyPresentationSource),
					visible: layers.some((layer) => layer.layout?.visibility !== 'none'),
					features: data.features
						.filter((feature) => !feature.properties?.proxyFeature)
						.map((feature) => ({
							id: String(feature.properties?.earthlyPresentationSourceFeatureId),
							color: feature.properties?.color,
							opacity: feature.properties?.earthlyPresentationOpacityMultiplier,
							strokeWidth: feature.properties?.strokeWidth,
							radius: feature.properties?.radius,
							lineDash: feature.properties?.lineDash,
						})),
				},
			]
		})
	})
}

async function assertLayers(
	earthly: EarthlySession,
	fixture: Ww1StoryFixture,
	expected: EffectiveStoryViewStateV1,
) {
	const expectedVisible = expected.layers
		.filter((layer) => layer.visible)
		.map((layer) => layer.id)
		.sort()
	await expect
		.poll(async () =>
			(await renderedLayers(earthly))
				.filter((layer) => layer.visible)
				.map((layer) => layer.id)
				.sort(),
		)
		.toEqual(expectedVisible)
	for (const layer of expected.layers.filter((entry) => entry.visible)) {
		const source = Object.values(fixture.maps).find((map) => map.address === layer.source)
		if (!source) throw new Error(`Missing fixture source ${layer.source}`)
		const ids = [
			...(layer.featureIds ?? source.collection.features.map((feature) => String(feature.id))),
		].sort()
		await expect
			.poll(async () =>
				(await renderedLayers(earthly))
					.find((entry) => entry.id === layer.id)
					?.features.map((feature) => feature.id)
					.sort(),
			)
			.toEqual(ids)
		const actual = (await renderedLayers(earthly)).find((entry) => entry.id === layer.id)
		expect(actual?.source).toBe(layer.source)
		for (const feature of actual?.features ?? []) {
			expect(feature.opacity).toBe(layer.opacityMultiplier)
			for (const key of ['color', 'strokeWidth', 'radius', 'lineDash'] as const) {
				if (layer.style?.[key] !== undefined) expect(feature[key]).toBe(layer.style[key])
			}
		}
	}
}

/** Place a physical block just above/below the visible reading line through the real scroller. */
async function scrollToReadingLine(block: Locator, crossed = true) {
	await block.evaluate((element, shouldCross) => {
		const scroller = element.closest<HTMLElement>('.earthly-reader__article')
		if (!scroller) throw new Error('Reader article scroll surface is missing.')
		const bounds = scroller.getBoundingClientRect()
		const line = bounds.top + Math.min(bounds.height * 0.2, 120)
		scroller.scrollTo({
			top:
				scroller.scrollTop + element.getBoundingClientRect().top - line + (shouldCross ? 10 : -20),
			behavior: 'instant',
		})
	}, crossed)
	await block
		.page()
		.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				),
		)
}

function watchPublications(earthly: EarthlySession) {
	const published: string[] = []
	earthly.page.on('websocket', (socket) =>
		socket.on('framesent', ({ payload }) => {
			try {
				const frame = JSON.parse(typeof payload === 'string' ? payload : payload.toString())
				if (Array.isArray(frame) && frame[0] === 'EVENT') published.push(String(frame[1]?.id))
			} catch {
				/* Non-Nostr socket frames are not publication attempts. */
			}
		}),
	)
	return published
}

test('WW1 Reader presents four map-driving steps and five physical views with real figures', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const health = monitorBrowserHealth(earthly.page)
	const published = watchPublications(earthly)
	try {
		const fixture = await openFixture(earthly)
		const page = earthly.page
		const timeline = page.getByRole('list', { name: 'Story timeline', exact: true })
		const presenter = page.getByRole('navigation', { name: 'Story map presentation', exact: true })
		await expect(timeline.getByRole('button')).toHaveCount(4)
		await expect(page.locator('[data-story-view-id]')).toHaveCount(5)
		await expect(page.locator('[data-story-view-id] figure')).toHaveCount(3)
		// Below-the-fold figures reserve space without allocating WebGL contexts.
		await expect(viewBlock(earthly, 'ww1-comparison-figure').locator('canvas')).toHaveCount(0)
		await expect(viewBlock(earthly, 'ww1-comparison-figure').getByRole('button')).toHaveCount(0)
		await expect(page.getByRole('complementary', { name: 'Map presentation notices' })).toHaveCount(
			0,
		)
		const reduction = reduceStoryViewBlocks(fixture.presentation, fixture.views)
		const driving = reduction.snapshots.filter((snapshot) => snapshot.view.display !== 'figure')
		await expect(presenter.getByRole('button', { name: 'Present', exact: true })).toBeVisible()
		await clickPresenterControl(
			earthly,
			presenter.getByRole('button', { name: 'Present', exact: true }),
		)
		for (let index = 0; index < driving.length; index++) {
			const snapshot = driving[index]
			if (!snapshot) throw new Error('Missing driving view.')
			if (index)
				await clickPresenterControl(
					earthly,
					presenter.getByRole('button', { name: 'Next', exact: true }),
				)
			await expect(timeline.getByRole('button').nth(index)).toHaveAttribute('aria-current', 'step')
			await expect(presenter).toContainText(`${index + 1} / 4`)
			await assertCuePresented(viewBlock(earthly, snapshot.view.id))
			await assertCamera(earthly, snapshot.state.camera)
			await assertLayers(earthly, fixture, snapshot.state)
			if (snapshot.view.id === 'ww1-spring-1918') {
				// An independent literal assertion catches static-figure changes leaking forward.
				const layers = await renderedLayers(earthly)
				expect(layers.find((layer) => layer.id === 'front-1914')?.visible ?? false).toBe(false)
				expect(layers.find((layer) => layer.id === 'battles-context')?.features[0]).toMatchObject({
					color: '#64748b',
					opacity: 0.1,
					radius: 4,
				})
				await page.screenshot({
					path: testInfo.outputPath(
						`ww1-reader-spring-${earthly.isMobile ? 'mobile' : 'desktop'}.png`,
					),
				})
			}
		}
		await expect(presenter.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
		await clickPresenterControl(
			earthly,
			presenter.getByRole('button', { name: 'Previous map view', exact: true }),
		)
		await expect(timeline.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'step')
		await clickPresenterControl(
			earthly,
			presenter.getByRole('button', { name: 'Previous map view', exact: true }),
		)
		await expect(timeline.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step')
		await assertCamera(earthly, driving[1]?.state.camera)
		await expect(
			presenter.getByRole('button', { name: 'Follow text', exact: true }),
		).toHaveAttribute('aria-pressed', 'false')
		const beforeFigure = await camera(earthly)
		await scrollToReadingLine(viewBlock(earthly, 'ww1-comparison-figure'))
		await expect(viewBlock(earthly, 'ww1-comparison-figure').locator('canvas')).toBeInViewport()
		expect(await camera(earthly)).toEqual(beforeFigure)
		for (const figure of await page.locator('[data-story-view-id] figure').all()) {
			await figure.scrollIntoViewIfNeeded()
			await expect(figure.locator('canvas')).toBeVisible()
		}
		await page.screenshot({
			path: testInfo.outputPath(`ww1-reader-figure-${earthly.isMobile ? 'mobile' : 'desktop'}.png`),
		})
		expect(published).toEqual([])
		expect(health.snapshot().pageErrors).toEqual([])
	} finally {
		await testInfo.attach('WW1 reader browser health', {
			body: JSON.stringify(health.snapshot(), null, 2),
			contentType: 'application/json',
		})
		health.stop()
	}
})

test('WW1 Follow text changes only at driving cue crossings and preserves manual camera within a step', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const fixture = await openFixture(earthly)
	const page = earthly.page
	const presenter = page.getByRole('navigation', { name: 'Story map presentation', exact: true })
	const timeline = page.getByRole('list', { name: 'Story timeline', exact: true })
	const reduction = reduceStoryViewBlocks(fixture.presentation, fixture.views)
	await expect(
		presenter.getByRole('button', { name: 'Pause follow', exact: true }),
	).toHaveAttribute('aria-pressed', 'true')
	await scrollToReadingLine(viewBlock(earthly, 'ww1-1914'))
	await expect(timeline.getByRole('button').nth(0)).toHaveAttribute('aria-current', 'step')
	await assertCamera(earthly, reduction.snapshots[0]?.state.camera)
	await scrollToReadingLine(viewBlock(earthly, 'ww1-1916'), false)
	await expect(timeline.getByRole('button').nth(0)).toHaveAttribute('aria-current', 'step')
	await scrollToReadingLine(viewBlock(earthly, 'ww1-1916'))
	await expect(timeline.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step')
	await assertCamera(earthly, reduction.snapshots[1]?.state.camera)
	await page.evaluate(() => {
		const state = window as ReaderDebugWindow
		state.__ww1MapMoves = 0
		document
			.querySelector<ReaderMapElement>('[role="region"][aria-label="Story map"]')
			?.__earthlyMap?.on('movestart', () => {
				state.__ww1MapMoves = (state.__ww1MapMoves ?? 0) + 1
			})
	})
	const canvas = page.getByRole('region', { name: 'Story map', exact: true }).locator('canvas')
	const box = await canvas.boundingBox()
	if (!box) throw new Error('The Reader map needs a visible drag surface.')
	await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4)
	await page.mouse.down()
	await page.mouse.move(box.x + box.width * 0.35 + 45, box.y + box.height * 0.4 + 20, { steps: 8 })
	await page.mouse.up()
	await expect.poll(async () => (await camera(earthly)).moving).toBe(false)
	const manual = await camera(earthly)
	expect(manual.center).not.toEqual([3.9, 49.7])
	const moves = await page.evaluate(() => (window as ReaderDebugWindow).__ww1MapMoves)
	// Figure crossing and further same-stage scroll events are observable layout events, not timers.
	await scrollToReadingLine(viewBlock(earthly, 'ww1-comparison-figure'), false)
	await scrollToReadingLine(viewBlock(earthly, 'ww1-comparison-figure'))
	await expect(timeline.getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step')
	expect(await camera(earthly)).toEqual(manual)
	expect(await page.evaluate(() => (window as ReaderDebugWindow).__ww1MapMoves)).toBe(moves)
	await scrollToReadingLine(viewBlock(earthly, 'ww1-spring-1918'))
	await expect(timeline.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'step')
	const spring = reduction.snapshots.find((snapshot) => snapshot.view.id === 'ww1-spring-1918')
	await assertCamera(earthly, spring?.state.camera)
	if (!spring) throw new Error('Missing spring cue.')
	await assertLayers(earthly, fixture, spring.state)
	await clickPresenterControl(
		earthly,
		presenter.getByRole('button', { name: 'Pause follow', exact: true }),
	)
	const paused = await camera(earthly)
	await scrollToReadingLine(viewBlock(earthly, 'ww1-armistice'))
	await expect(timeline.getByRole('button').nth(2)).toHaveAttribute('aria-current', 'step')
	expect(await camera(earthly)).toEqual(paused)
	await clickPresenterControl(
		earthly,
		presenter.getByRole('button', { name: 'Follow text', exact: true }),
	)
	await expect(timeline.getByRole('button').nth(3)).toHaveAttribute('aria-current', 'step')
	await assertCamera(earthly, reduction.snapshots.at(-1)?.state.camera)
	await page.screenshot({
		path: testInfo.outputPath(`ww1-follow-text-${earthly.isMobile ? 'mobile' : 'desktop'}.png`),
	})
})
