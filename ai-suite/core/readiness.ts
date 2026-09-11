import { expect, type Page } from '@playwright/test'

export async function waitForEarthlyReady(page: Page): Promise<void> {
	await expect(page).toHaveTitle(/Earthly/)
	// Reader routes can also contain near-viewport figure maps.
	await expect(page.locator('canvas[aria-label="Map"]').first()).toBeVisible()
}
