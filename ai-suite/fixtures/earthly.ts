import { test as base, expect } from '@playwright/test'
import { resolveEnvironment } from '../core/environment'
import { EarthlySession } from '../core/session'

interface EarthlyFixtures {
	earthly: EarthlySession
}

export const test = base.extend<EarthlyFixtures>({
	earthly: async ({ page }, use) => {
		await use(new EarthlySession(page, resolveEnvironment()))
	},
})

export { expect }
