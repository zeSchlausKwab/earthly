import { test as base, expect } from '@playwright/test'
import { resolveEnvironment } from '../core/environment'
import { EarthlySession } from '../core/session'

interface EarthlyFixtures {
	earthly: EarthlySession
	newEarthlySession: () => Promise<EarthlySession>
}

export const test = base.extend<EarthlyFixtures>({
	earthly: async ({ page }, use) => {
		await use(new EarthlySession(page, resolveEnvironment()))
	},
	newEarthlySession: async ({ browser, page }, use) => {
		const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = []
		await use(async () => {
			const context = await browser.newContext({
				viewport: page.viewportSize() ?? { width: 1440, height: 900 },
			})
			contexts.push(context)
			return new EarthlySession(await context.newPage(), resolveEnvironment())
		})
		await Promise.all(contexts.map((context) => context.close()))
	},
})

export { expect }
