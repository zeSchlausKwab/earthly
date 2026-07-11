import type { ConsoleMessage, Page, Request, Response } from '@playwright/test'
import type { AiTaskMetadata } from '../../core/task'

export const monitorBrowserHealthTask: AiTaskMetadata = {
	id: 'diagnostics.monitor-browser-health',
	summary:
		'Record browser console errors, uncaught exceptions, failed requests, and error responses.',
	preconditions: ['Attach before opening Earthly when startup health matters'],
	sideEffects: ['Adds temporary read-only listeners to the Playwright page'],
	viewports: 'both',
}

export interface BrowserHealthSnapshot {
	consoleErrors: string[]
	pageErrors: string[]
	failedRequests: Array<{ method: string; url: string; failure: string }>
	errorResponses: Array<{ status: number; method: string; url: string }>
}

export interface BrowserHealthMonitor {
	snapshot(): BrowserHealthSnapshot
	stop(): void
}

export function monitorBrowserHealth(page: Page): BrowserHealthMonitor {
	const state: BrowserHealthSnapshot = {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		errorResponses: [],
	}

	const onConsole = (message: ConsoleMessage) => {
		if (message.type() === 'error') state.consoleErrors.push(message.text())
	}
	const onPageError = (error: Error) => state.pageErrors.push(error.stack ?? error.message)
	const onRequestFailed = (request: Request) => {
		state.failedRequests.push({
			method: request.method(),
			url: request.url(),
			failure: request.failure()?.errorText ?? 'Unknown request failure',
		})
	}
	const onResponse = (response: Response) => {
		if (response.status() < 400) return
		state.errorResponses.push({
			status: response.status(),
			method: response.request().method(),
			url: response.url(),
		})
	}

	page.on('console', onConsole)
	page.on('pageerror', onPageError)
	page.on('requestfailed', onRequestFailed)
	page.on('response', onResponse)

	return {
		snapshot: () => structuredClone(state),
		stop: () => {
			page.off('console', onConsole)
			page.off('pageerror', onPageError)
			page.off('requestfailed', onRequestFailed)
			page.off('response', onResponse)
		},
	}
}
