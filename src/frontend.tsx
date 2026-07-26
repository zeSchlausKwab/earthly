/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const elem = document.getElementById('root')
if (!elem) throw new Error('Earthly root element was not found')

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
	void startNativeDeepLinks()
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
	if (import.meta.hot) {
		// With hot module reloading, `import.meta.hot.data` is persisted.
		import.meta.hot.data.root ??= createRoot(elem)
		import.meta.hot.data.root.render(application)
		return
	}

	createRoot(elem).render(application)
}

void renderApplication()
