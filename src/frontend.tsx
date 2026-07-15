/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { AccountsProvider, EventStoreProvider } from 'applesauce-react/providers'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { upgradeLegacyHashRoute } from './features/geo-editor/hooks/useRouting'
// Import for side-effects: instantiates eventStore, pool, accounts, cache, etc.
import { accounts, eventStore } from './lib/nostr'
import { startNativeDeepLinks } from './platform/registry'

// Phase 1.2: rewrite a legacy `#/…` hash route to its clean-path equivalent
// before React mounts, so the first parseLocation() the app runs already sees
// the canonical URL (fixes report 7.5 — `/#/datasets` deep-links).
upgradeLegacyHashRoute()
void startNativeDeepLinks()

const elem = document.getElementById('root')!

const app = (
	<StrictMode>
		<EventStoreProvider eventStore={eventStore}>
			<AccountsProvider manager={accounts}>
				<App />
			</AccountsProvider>
		</EventStoreProvider>
	</StrictMode>
)

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.
	import.meta.hot.data.root ??= createRoot(elem)
	import.meta.hot.data.root.render(app)
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(app)
}
