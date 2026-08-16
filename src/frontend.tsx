/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode, type ReactNode } from 'react'
import { createRoot, type RootOptions } from 'react-dom/client'
import './index.css'

interface EarthlyBootCoordinator {
	reloadOnce(): boolean
	clearReloadGuard(): void
	showFailure(title: string, detail: string): void
}

declare global {
	interface Window {
		__earthlyBoot?: EarthlyBootCoordinator
	}
}

function getRootElement(): HTMLElement {
	const root = document.getElementById('root')
	if (!root) throw new Error('Earthly root element was not found')
	return root
}

const elem = getRootElement()
const bootTemplate = elem.querySelector<HTMLElement>('[data-earthly-boot]')?.cloneNode(true) as
	| HTMLElement
	| undefined

const BOOT_IMPORT_RETRY_KEY = 'earthly-boot-import-retry-v1'

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function isRetryableImportFailure(error: unknown): boolean {
	const message = describeError(error).toLowerCase()
	return [
		'failed to fetch dynamically imported module',
		'error loading dynamically imported module',
		'importing a module script failed',
		'load failed',
	].some((fragment) => message.includes(fragment))
}

function retryImportOnce(error: unknown): boolean {
	if (!isRetryableImportFailure(error)) return false
	if (window.__earthlyBoot) return window.__earthlyBoot.reloadOnce()

	try {
		if (window.sessionStorage.getItem(BOOT_IMPORT_RETRY_KEY) === '1') return false
		window.sessionStorage.setItem(BOOT_IMPORT_RETRY_KEY, '1')
		window.location.reload()
		return true
	} catch {
		return false
	}
}

function clearImportRetryGuard() {
	if (window.__earthlyBoot) {
		window.__earthlyBoot.clearReloadGuard()
		return
	}

	try {
		window.sessionStorage.removeItem(BOOT_IMPORT_RETRY_KEY)
	} catch {
		// Storage can be unavailable in hardened browser contexts.
	}
}

function showBootFailure(error: unknown, errorInfo?: { componentStack?: string }) {
	console.error('Earthly failed to start', error, errorInfo)
	const title = 'Earthly could not finish loading'
	const detail = 'The app hit a startup problem. Your local work is safe.'
	if (window.__earthlyBoot) {
		window.__earthlyBoot.showFailure(title, detail)
		return
	}

	let boot = elem.querySelector<HTMLElement>('[data-earthly-boot]')
	if (!boot && bootTemplate) {
		boot = bootTemplate.cloneNode(true) as HTMLElement
		elem.replaceChildren(boot)
	}
	if (!boot) return

	boot.dataset.state = 'error'
	const titleElement = boot.querySelector<HTMLElement>('[data-earthly-boot-title]')
	const detailElement = boot.querySelector<HTMLElement>('[data-earthly-boot-detail]')
	const retry = boot.querySelector<HTMLButtonElement>('[data-earthly-boot-retry]')
	if (titleElement) titleElement.textContent = title
	if (detailElement) detailElement.textContent = detail
	if (retry) {
		retry.hidden = false
		retry.onclick = () => window.location.reload()
		retry.focus()
	}
}

function reportRecoverableRootError(error: unknown, errorInfo: { componentStack?: string }) {
	// React recovered, so keep its live tree intact. The watchdog still exposes a
	// retry if the initial commit subsequently stalls instead of becoming usable.
	console.error('Earthly recovered from a React rendering error', error, errorInfo)
}

const rootOptions: RootOptions = {
	onUncaughtError: showBootFailure,
	onRecoverableError: reportRecoverableRootError,
}

function isTourPathname(pathname: string) {
	return pathname.replace(/\/+$/, '') === '/tour'
}

async function createApplication(): Promise<ReactNode> {
	if (isTourPathname(window.location.pathname)) {
		const { TourPage } = await import('./pages/tour/TourPage')
		return (
			<StrictMode>
				<TourPage />
			</StrictMode>
		)
	}

	const [
		{ AccountsProvider, EventStoreProvider },
		{ App },
		{ upgradeLegacyHashRoute },
		{ accounts, eventStore, initializeAccountPersistence, startPublishOutbox },
		{ startNativeDeepLinks },
	] = await Promise.all([
		import('applesauce-react/providers'),
		import('./App'),
		import('./features/geo-editor/hooks/useRouting'),
		import('./lib/nostr'),
		import('./platform/registry'),
	])

	// Rewrite legacy `#/…` routes before the editor mounts so its first location
	// parse sees the canonical clean path.
	upgradeLegacyHashRoute()
	await initializeAccountPersistence()
	await startNativeDeepLinks()
	void startPublishOutbox()

	return (
		<StrictMode>
			<EventStoreProvider eventStore={eventStore}>
				<AccountsProvider manager={accounts}>
					<App />
				</AccountsProvider>
			</EventStoreProvider>
		</StrictMode>
	)
}

async function renderApplication() {
	const application = await createApplication()
	clearImportRetryGuard()
	if (import.meta.hot) {
		// With hot module reloading, `import.meta.hot.data` is persisted.
		import.meta.hot.data.root ??= createRoot(elem, rootOptions)
		import.meta.hot.data.root.render(application)
		return
	}

	createRoot(elem, rootOptions).render(application)
}

void renderApplication().catch((error: unknown) => {
	if (!retryImportOnce(error)) showBootFailure(error)
})
