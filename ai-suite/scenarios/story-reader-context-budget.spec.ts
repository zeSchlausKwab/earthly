import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { NostrEvent } from 'nostr-tools'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Locator } from '@playwright/test'
import { test, expect } from '../fixtures/earthly'
import { installIsolatedRelays } from '../tasks/setup/isolated-relays'

interface Fixture {
	events: NostrEvent[]
	title: string
	path: string
	views: Array<{
		id: string
		camera: { center: [number, number]; zoom: number; bearing: number; pitch: number }
	}>
}

interface ContextRecord {
	canvas: HTMLCanvasElement
	context: WebGLRenderingContext | WebGL2RenderingContext
	lostEvents: number
}

interface BudgetWindow extends Window {
	__readerContextBudget?: ContextRecord[]
}

interface MapElement extends HTMLElement {
	__earthlyMap?: MapLibreMap
}

// Chromium desktop normally permits more live contexts than a mobile WebView.
// This real browser limit reproduces eviction instead of mocking MapLibre failures.
test.use({ launchOptions: { args: ['--max-active-webgl-contexts=8'] } })

async function contextBudget(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const records = (window as BudgetWindow).__readerContextBudget ?? []
		const mainCanvas = document.querySelector('[role="region"][aria-label="Story map"] canvas')
		return {
			live: records.filter((record) => record.canvas.isConnected && !record.context.isContextLost())
				.length,
			mainLost:
				records.find((record) => record.canvas === mainCanvas)?.context.isContextLost() ?? true,
			unexpectedLosses: records.filter(
				(record) => record.canvas.isConnected && record.lostEvents > 0,
			).length,
		}
	})
}

async function assertFigureCamera(view: Locator, expected: Fixture['views'][number]['camera']) {
	const region = view.locator('[data-presentation-ready="true"]')
	await expect(region).toBeVisible({ timeout: 15_000 })
	await expect
		.poll(() =>
			region.evaluate((element, camera) => {
				const map = (element as MapElement).__earthlyMap
				if (!map || map.isMoving()) return false
				const figureCanvas = element.querySelector('canvas')
				const record = (window as BudgetWindow).__readerContextBudget?.find(
					(context) => context.canvas === figureCanvas,
				)
				if (!record || record.context.isContextLost()) return false
				const center = map.getCenter()
				return (
					Math.abs(center.lng - camera.center[0]) < 0.0001 &&
					Math.abs(center.lat - camera.center[1]) < 0.0001 &&
					Math.abs(map.getZoom() - camera.zoom) < 0.0001 &&
					Math.abs(map.getBearing() - camera.bearing) < 0.0001 &&
					Math.abs(map.getPitch() - camera.pitch) < 0.0001
				)
			}, expected),
		)
		.toBe(true)
}

test('long Reader Stories release offscreen figure contexts and restore views while scrolling', async ({
	earthly,
}, testInfo) => {
	test.setTimeout(120_000)
	const fixtureOutput = await promisify(execFile)(
		'bun',
		[resolve('ai-suite/fixtures/story-reader-context-budget.mjs')],
		{ maxBuffer: 2 * 1024 * 1024 },
	)
	const fixture = JSON.parse(fixtureOutput.stdout) as Fixture
	const warnings: string[] = []
	earthly.page.on('console', (message) => {
		if (/Too many active WebGL contexts|CONTEXT_LOST_WEBGL/i.test(message.text()))
			warnings.push(message.text())
	})
	const publications = await installIsolatedRelays(
		earthly,
		new Map(fixture.events.map((event) => [event.id, event])),
	)
	await earthly.page.addInitScript(() => {
		localStorage.setItem('earthly-tour-seen', 'true')
		localStorage.setItem('earthly-discover-welcome-v1', 'seen')
		const records: ContextRecord[] = []
		;(window as BudgetWindow).__readerContextBudget = records
		const original = HTMLCanvasElement.prototype.getContext
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			...args: Parameters<typeof original>
		) {
			const context = original.apply(this, args)
			const type = args[0]
			if (
				(type === 'webgl' || type === 'webgl2') &&
				context &&
				!records.some((record) => record.context === context)
			) {
				const record: ContextRecord = {
					canvas: this,
					context: context as WebGLRenderingContext,
					lostEvents: 0,
				}
				records.push(record)
				this.addEventListener('webglcontextlost', () => {
					record.lostEvents++
				})
			}
			return context
		} as typeof original
	})
	await earthly.page.goto(new URL(fixture.path, earthly.environment.baseURL).href, {
		waitUntil: 'domcontentloaded',
	})
	await expect(
		earthly.page.getByRole('heading', { name: fixture.title, exact: true, level: 1 }),
	).toBeVisible()
	await expect(
		earthly.page.getByRole('region', { name: 'Story map', exact: true }),
	).toHaveAttribute('data-presentation-ready', 'true', { timeout: 20_000 })
	await expect(earthly.page.locator('[data-story-view-id]')).toHaveCount(fixture.views.length)
	const observations: Array<{
		id: string
		direction: string
		live: number
		mainLost: boolean
		unexpectedLosses: number
	}> = []
	try {
		for (const [direction, views] of [
			['forward', fixture.views],
			['backward', [...fixture.views].reverse()],
		] as const) {
			for (const view of views) {
				const block = earthly.page.locator(`[data-story-view-id="${view.id}"]`)
				await block.scrollIntoViewIfNeeded()
				await assertFigureCamera(block, view.camera)
				// The observer's offscreen teardown can follow the visible figure's ready render.
				await expect
					.poll(async () => (await contextBudget(earthly.page)).live)
					.toBeLessThanOrEqual(4)
				const budget = await contextBudget(earthly.page)
				observations.push({ id: view.id, direction, ...budget })
				expect(budget.mainLost, 'the persistent reader map must keep its renderer').toBe(false)
				expect(
					budget.unexpectedLosses,
					'mounted maps must not be evicted by browser context limits',
				).toBe(0)
			}
		}
		expect(warnings).toEqual([])
		expect(publications.size).toBe(0)
	} finally {
		await testInfo.attach('Reader context budget', {
			body: JSON.stringify({ observations, warnings }, null, 2),
			contentType: 'application/json',
		})
	}
})
