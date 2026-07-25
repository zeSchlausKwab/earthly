import { test, expect } from '@playwright/test'

test.describe('product tour route', () => {
	test('presents the product story as a standalone responsive page', async ({ page, baseURL }) => {
		await page.goto(new URL('/tour', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		await expect(page).toHaveTitle(/Tour Earthly/)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Maps become shared places/)
		await expect(page.locator('canvas[aria-label="Map"]')).toHaveCount(0)
		await expect(page.locator('video')).toHaveCount(6)
		await expect(
			page.getByRole('heading', { name: 'Ask the map to do the legwork.' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Let the field propose. Keep the owner in control.' }),
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'A Story can open the map beneath it.' }),
		).toBeVisible()
		await expect(page.getByRole('link', { name: 'Open Earthly' }).first()).toHaveAttribute(
			'href',
			'/',
		)
		await expect(page.getByRole('link', { name: 'Earthly on GitHub' })).toHaveAttribute(
			'href',
			'https://github.com/zeSchlausKwab/earthly',
		)
		await expect(page.getByRole('link', { name: 'Install Earthly from Zapstore' })).toHaveAttribute(
			'href',
			/https:\/\/zapstore\.dev\/apps\/naddr/,
		)
		await expect(
			page.locator(
				'a[href="https://github.com/zeSchlausKwab/earthly/releases/latest/download/earthly-android-arm64-v8a.apk"]',
			),
		).toHaveCount(2)
		await expect(
			page.getByRole('link', { name: 'Download Earthly for macOS from GitHub' }),
		).toHaveAttribute(
			'href',
			'https://github.com/zeSchlausKwab/earthly/releases/latest/download/earthly-macos-aarch64.dmg',
		)
		await expect(
			page.getByRole('heading', { name: 'Take Earthly beyond the browser.' }),
		).toBeVisible()

		const horizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(horizontalOverflow).toBeLessThanOrEqual(1)
	})

	test('places the Porto AI analysis between map creation and participation', async ({
		page,
		baseURL,
	}) => {
		await page.goto(new URL('/tour', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		const create = page.locator('#create')
		const analysis = page.locator('#analyze')
		const participate = page.locator('#participate')

		await expect(analysis).toContainText('20-minute cycling catchment')
		await expect(
			analysis.getByLabel(
				'Earthly AI mapping a Porto apartment search with a bicycle isochrone and nearby amenities',
			),
		).toBeVisible()
		expect(
			await page.evaluate(() => {
				const createNode = document.getElementById('create')
				const analysisNode = document.getElementById('analyze')
				const participateNode = document.getElementById('participate')
				if (!createNode || !analysisNode || !participateNode) return false
				return (
					createNode.contains(analysisNode) &&
					Boolean(
						analysisNode.compareDocumentPosition(participateNode) &
							Node.DOCUMENT_POSITION_FOLLOWING,
					)
				)
			}),
		).toBe(true)
		await expect(create).toBeVisible()
		await expect(participate).toBeVisible()
	})

	test('serves the product films from stable public URLs', async ({ request, baseURL }) => {
		for (const path of [
			'/static/tour/beira-cyclone-draft.mp4',
			'/static/tour/beira-cyclone-draft.webm',
			'/static/tour/beira-cyclone-draft-poster.png',
			'/static/tour/porto-ai-home-search.mp4',
			'/static/tour/porto-ai-home-search.webm',
			'/static/tour/porto-ai-home-search-poster.png',
			'/static/tour/festival-map-editor.mp4',
			'/static/tour/festival-map-editor.webm',
			'/static/tour/visitor-comment-share.mp4',
			'/static/tour/visitor-comment-share.webm',
			'/static/tour/private-group-cross-device.mp4',
			'/static/tour/private-group-cross-device.webm',
			'/static/tour/ai-belt-road-story.mp4',
			'/static/tour/ai-belt-road-story.webm',
			'/static/tour/hormuz-ports-shipping.mp4',
			'/static/tour/hormuz-ports-shipping.webm',
			'/static/tour/mobile-drawing-magnifier.mp4',
			'/static/tour/mobile-drawing-magnifier.webm',
			'/static/tour/mobile-drawing-magnifier-poster.png',
			'/static/tour/collaborative-map-proposal.mp4',
			'/static/tour/collaborative-map-proposal.webm',
			'/static/tour/collaborative-map-proposal-poster.png',
			'/static/tour/story-to-map.mp4',
			'/static/tour/story-to-map.webm',
			'/static/tour/story-to-map-poster.png',
		]) {
			const response = await request.get(new URL(path, baseURL).toString())
			expect(response.ok(), `${path} should be available`).toBe(true)
		}
	})

	test('switches the featured film and its explanation with accessible controls', async ({
		page,
		baseURL,
	}) => {
		await page.goto(new URL('/tour', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		const firstStory = page.getByRole('tab', { name: /Draft the plan/ })
		const portoStory = page.getByRole('tab', { name: /Ask where to live/ })
		const privateStory = page.getByRole('tab', { name: /Work in private/ })
		const aiStory = page.getByRole('tab', { name: /Ask Earthly/ })
		const hormuzStory = page.getByRole('tab', { name: /Trace the routes/ })
		const offlineDrawingStory = page.getByRole('tab', { name: /Draw offline/ })
		const storyPanel = page.getByRole('tabpanel')

		await expect(firstStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Build the response plan by hand.')

		await firstStory.focus()
		await firstStory.press('ArrowRight')
		await expect(portoStory).toBeFocused()
		await expect(portoStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Turn a life question into a spatial answer.')
		await expect(
			storyPanel.getByLabel(
				'Earthly AI mapping a Porto apartment search with a bicycle isochrone and nearby amenities',
			),
		).toBeVisible()
		const horizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(horizontalOverflow).toBeLessThanOrEqual(1)

		await page.getByRole('button', { name: 'Next product film' }).click()
		await expect(privateStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Coordinate privately, across devices.')
		await expect(
			storyPanel.getByLabel(
				'Earthly private group created on desktop, joined from a phone, and answered on desktop',
			),
		).toBeVisible()

		await page.getByRole('button', { name: 'Next product film' }).click()
		await expect(aiStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Ask once. Get a map—and its story.')
		await expect(
			storyPanel.getByLabel(
				'Earthly AI creating a Belt and Road map, showing its actions, and publishing a Story with an inline Dataset reference',
			),
		).toBeVisible()

		await page.getByRole('button', { name: 'Next product film' }).click()
		await expect(hormuzStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Turn a chokepoint into a global network.')
		await expect(
			storyPanel.getByLabel(
				'Earthly AI replacing internal Persian Gulf lanes with outbound shipping corridors through Hormuz to major global ports',
			),
		).toBeVisible()

		await page.getByRole('button', { name: 'Next product film' }).click()
		await expect(offlineDrawingStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Draw precisely—even offline.')
		await expect(
			storyPanel.getByLabel(
				'Earthly mobile hiker drawing a creek-crossing hazard and safe detour offline with the live magnifier in Torres del Paine',
			),
		).toBeVisible()

		await page.getByRole('button', { name: 'Next product film' }).click()
		await expect(firstStory).toHaveAttribute('aria-selected', 'true')
	})

	test('swipes between featured films on a mobile viewport', async ({ page, baseURL }) => {
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(new URL('/tour', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		const firstStory = page.getByRole('tab', { name: /Draft the plan/ })
		const portoStory = page.getByRole('tab', { name: /Ask where to live/ })
		const storyPanel = page.getByRole('tabpanel')
		await expect(firstStory).toHaveAttribute('aria-selected', 'true')

		await storyPanel.dispatchEvent('pointerdown', {
			pointerId: 1,
			pointerType: 'touch',
			isPrimary: true,
			clientX: 330,
			clientY: 420,
			buttons: 1,
		})
		await storyPanel.dispatchEvent('pointerup', {
			pointerId: 1,
			pointerType: 'touch',
			isPrimary: true,
			clientX: 72,
			clientY: 426,
			buttons: 0,
		})

		await expect(portoStory).toHaveAttribute('aria-selected', 'true')
		await expect(storyPanel).toContainText('Turn a life question into a spatial answer.')

		await storyPanel.dispatchEvent('pointerdown', {
			pointerId: 2,
			pointerType: 'touch',
			isPrimary: true,
			clientX: 70,
			clientY: 420,
			buttons: 1,
		})
		await storyPanel.dispatchEvent('pointerup', {
			pointerId: 2,
			pointerType: 'touch',
			isPrimary: true,
			clientX: 326,
			clientY: 423,
			buttons: 0,
		})

		await expect(firstStory).toHaveAttribute('aria-selected', 'true')
	})

	test('opens a linked chapter below the sticky navigation', async ({ page, baseURL }) => {
		await page.goto(new URL('/tour#participate', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		await expect
			.poll(() =>
				page.evaluate(() => {
					const target = document.getElementById('participate')
					const navigation = document.querySelector<HTMLElement>('.tour-nav')
					if (!target || !navigation) return Number.POSITIVE_INFINITY
					return Math.abs(target.getBoundingClientRect().top - navigation.offsetHeight)
				}),
			)
			.toBeLessThan(2)
	})

	test('returns the tour scroll container to the top', async ({ page, baseURL }) => {
		await page.goto(new URL('/tour#participate', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		await expect
			.poll(() => page.locator('.tour-page').evaluate((node) => node.scrollTop))
			.toBeGreaterThan(0)
		await page.getByRole('link', { name: 'Back to top' }).click()
		await expect(page).toHaveURL(/\/tour#tour-top$/)
		await expect.poll(() => page.locator('.tour-page').evaluate((node) => node.scrollTop)).toBe(0)
	})
})
