import { test, expect } from '@playwright/test'

test.describe('product tour route', () => {
	test('presents the product story as a standalone responsive page', async ({ page, baseURL }) => {
		await page.goto(new URL('/tour', baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})

		await expect(page).toHaveTitle(/Tour Earthly/)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Maps become shared places/)
		await expect(page.locator('canvas[aria-label="Map"]')).toHaveCount(0)
		await expect(page.locator('video')).toHaveCount(3)
		await expect(page.getByRole('link', { name: 'Open Earthly' }).first()).toHaveAttribute(
			'href',
			'/',
		)

		const horizontalOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(horizontalOverflow).toBeLessThanOrEqual(1)
	})

	test('serves both product films from stable public URLs', async ({ request, baseURL }) => {
		for (const path of [
			'/static/tour/festival-map-editor.mp4',
			'/static/tour/festival-map-editor.webm',
			'/static/tour/visitor-comment-share.mp4',
			'/static/tour/visitor-comment-share.webm',
		]) {
			const response = await request.get(new URL(path, baseURL).toString())
			expect(response.ok(), `${path} should be available`).toBe(true)
		}
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
})
