/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import NDKCacheAdapterDexie from '@nostr-dev-kit/ndk-cache-dexie'
import { NDKHeadless } from '@nostr-dev-kit/react'
import { AccountsProvider, EventStoreProvider } from 'applesauce-react/providers'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { config } from './config'
// Import for side-effects: instantiates eventStore, pool, accounts, cache, etc.
import { accounts, eventStore } from './lib/nostr'
import { NdkBridgeWatcher } from './lib/nostr/NdkBridgeWatcher'

const elem = document.getElementById('root')!

// Initialize Dexie cache adapter for efficient caching and cache invalidation
const dexieAdapter = new NDKCacheAdapterDexie({
	dbName: 'earthly-cache',
	profileCacheSize: 5000,
	eventCacheSize: 10000,
	eventTagsCacheSize: 20000,
	saveSig: true,
})

// App renders synchronously - config values are baked in at build time
const app = (
	<StrictMode>
		{/*
		 * NDKHeadless is still mounted because legacy code paths (NDKEvent subclasses,
		 * useSubscribe, Blossom) still depend on its NDK instance. The bridge in
		 * NdkBridgeWatcher mirrors the active applesauce account into NDK's
		 * session state, so the session={false} disables NDK's own persistence
		 * to avoid double-writing localStorage. NDKHeadless is removed entirely
		 * in Step 3 once relay I/O is on applesauce.
		 */}
		<NDKHeadless
			ndk={{
				// NDK is the legacy read/write pool used by the few remaining NDK
				// callers (Blossom auth, NIP-60 wallet, GeoSocialActions zaps).
				// Use the broader read set so it can fetch profiles/mailboxes.
				// Outbox safety in dev still relies on our `publish()` helper.
				explicitRelayUrls: config.readRelays,
				cacheAdapter: dexieAdapter,
			}}
			session={false}
		/>
		<NdkBridgeWatcher />
		<EventStoreProvider eventStore={eventStore}>
			<AccountsProvider manager={accounts}>
				<App />
			</AccountsProvider>
		</EventStoreProvider>
	</StrictMode>
)

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.
	const root = (import.meta.hot.data.root ??= createRoot(elem))
	root.render(app)
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(app)
}
