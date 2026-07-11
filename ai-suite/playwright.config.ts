import { defineConfig, devices } from '@playwright/test'
import { resolveEnvironment } from './core/environment'

const environment = resolveEnvironment()

export default defineConfig({
	testDir: './scenarios',
	outputDir: './artifacts/test-results',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	timeout: 60_000,
	workers: 2,
	reporter: [['list'], ['html', { outputFolder: './artifacts/html-report', open: 'never' }]],
	use: {
		baseURL: environment.baseURL,
		headless: environment.headless,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
		},
		{
			name: 'mobile',
			use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
		},
	],
})
