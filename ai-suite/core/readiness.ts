import { expect, type Page } from '@playwright/test'

export async function waitForEarthlyReady(page: Page): Promise<void> {
	await expect(page).toHaveTitle(/Earthly/)
	await expect(page.locator('canvas[aria-label="Map"]')).toBeVisible()
}
