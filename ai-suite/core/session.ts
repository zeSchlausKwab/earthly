import type { Page } from '@playwright/test'
import type { AiSuiteEnvironment } from './environment'
import { waitForEarthlyReady } from './readiness'

export type TourState = 'new' | 'seen' | 'preserve'

export interface OpenEarthlyOptions {
	path?: string
	tour?: TourState
}

export class EarthlySession {
	readonly page: Page
	readonly environment: AiSuiteEnvironment

	constructor(page: Page, environment: AiSuiteEnvironment) {
		this.page = page
		this.environment = environment
	}

	get isMobile(): boolean {
		return (this.page.viewportSize()?.width ?? 1440) < 768
	}

	async open(options: OpenEarthlyOptions = {}): Promise<void> {
		const { path = '/', tour = 'seen' } = options
		if (tour !== 'preserve') {
			await this.page.addInitScript((nextTourState: Exclude<TourState, 'preserve'>) => {
				if (nextTourState === 'seen') localStorage.setItem('earthly-tour-seen', 'true')
				else localStorage.removeItem('earthly-tour-seen')
			}, tour)
		}

		await this.page.goto(new URL(path, this.environment.baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})
		await waitForEarthlyReady(this.page)
	}
}
