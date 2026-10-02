import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
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

type StorySurface = 'Reader' | 'workspace'

// Chromium desktop normally permits more live contexts than a mobile WebView.
// This real browser limit reproduces eviction instead of mocking MapLibre failures.
test.use({ launchOptions: { args: ['--max-active-webgl-contexts=8'] } })

async function contextBudget(page: import('@playwright/test').Page, surface: StorySurface) {
	return page.evaluate((currentSurface) => {
		const records = (window as BudgetWindow).__readerContextBudget ?? []
		const mainCanvas =
			currentSurface === 'Reader'
				? document.querySelector('[role="region"][aria-label="Story map"] canvas')
				: Array.from(document.querySelectorAll('canvas')).find(
						(canvas) => !canvas.closest('[data-story-view-id]'),
					)
		return {
			live: records.filter((record) => record.canvas.isConnected && !record.context.isContextLost())
				.length,
			mainLost:
				records.find((record) => record.canvas === mainCanvas)?.context.isContextLost() ?? true,
			unexpectedLosses: records.filter(
				(record) => record.canvas.isConnected && record.lostEvents > 0,
			).length,
		}
	}, surface)
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

for (const surface of ['Reader', 'workspace'] as const) {
	test(`long ${surface} Stories release offscreen figure contexts and restore views while scrolling`, async ({
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
		const path = surface === 'Reader' ? fixture.path : fixture.path.replace('/read/', '/story/')
		await earthly.page.goto(new URL(path, earthly.environment.baseURL).href, {
			waitUntil: 'domcontentloaded',
		})
		await expect(
			earthly.page.getByRole('heading', {
				name: fixture.title,
				exact: true,
				level: surface === 'Reader' ? 1 : 2,
			}),
		).toBeVisible()
		if (surface === 'Reader') {
			await expect(
				earthly.page.getByRole('region', { name: 'Story map', exact: true }),
			).toHaveAttribute('data-presentation-ready', 'true', { timeout: 20_000 })
		} else {
			await expect(
				earthly.page.locator('canvas[aria-label="Map"]:not([data-story-view-id] canvas)').first(),
			).toBeVisible()
		}
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
						.poll(async () => (await contextBudget(earthly.page, surface)).live)
						.toBeLessThanOrEqual(4)
					const budget = await contextBudget(earthly.page, surface)
					observations.push({ id: view.id, direction, ...budget })
					expect(budget.mainLost, `the persistent ${surface} map must keep its renderer`).toBe(
						false,
					)
					expect(
						budget.unexpectedLosses,
						'mounted maps must not be evicted by browser context limits',
					).toBe(0)
				}
			}
			expect(warnings).toEqual([])
			expect(publications.size).toBe(0)
			await earthly.page.screenshot({ path: testInfo.outputPath(`${surface}-context-budget.png`) })
		} finally {
			const reportPath = testInfo.outputPath('context-budget.json')
			await writeFile(
				reportPath,
				JSON.stringify(
					{ observations, warnings, final: await contextBudget(earthly.page, surface) },
					null,
					2,
				),
			)
			await testInfo.attach(`${surface} context budget`, {
				path: reportPath,
				contentType: 'application/json',
			})
		}
	})
}
