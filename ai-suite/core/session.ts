import type { Page } from '@playwright/test'
import type { AiSuiteEnvironment } from './environment'
import { waitForEarthlyReady } from './readiness'

export type TourState = 'new' | 'seen' | 'preserve'
export type DiscoverWelcomeState = 'new' | 'seen' | 'preserve'

export interface OpenEarthlyOptions {
	path?: string
	tour?: TourState
	discover?: DiscoverWelcomeState
}

export class EarthlySession {
	readonly page: Page
	readonly environment: AiSuiteEnvironment
	private initializationRevision = 0

	constructor(page: Page, environment: AiSuiteEnvironment) {
		this.page = page
		this.environment = environment
	}

	get isMobile(): boolean {
		return (this.page.viewportSize()?.width ?? 1440) < 768
	}

	async open(options: OpenEarthlyOptions = {}): Promise<void> {
		const { path = '/', tour = 'seen', discover = 'seen' } = options
		if (tour !== 'preserve' || discover !== 'preserve') {
			const initializationKey = `earthly-ai-suite-open-${this.initializationRevision++}`
			await this.page.addInitScript(
				({ nextTourState, nextDiscoverState, key }) => {
					// addInitScript runs again on reload. Apply each requested opening state
					// once so the test can observe the app's own persistence afterward.
					if (sessionStorage.getItem(key) === 'done') return
					if (nextTourState !== 'preserve') {
						if (nextTourState === 'seen') localStorage.setItem('earthly-tour-seen', 'true')
						else localStorage.removeItem('earthly-tour-seen')
					}
					if (nextDiscoverState !== 'preserve') {
						if (nextDiscoverState === 'seen') {
							localStorage.setItem('earthly-discover-welcome-v1', 'seen')
						} else {
							localStorage.removeItem('earthly-discover-welcome-v1')
						}
					}
					sessionStorage.setItem(key, 'done')
				},
				{ nextTourState: tour, nextDiscoverState: discover, key: initializationKey },
			)
		}

		await this.page.goto(new URL(path, this.environment.baseURL).toString(), {
			waitUntil: 'domcontentloaded',
		})
		await waitForEarthlyReady(this.page)
	}
}
