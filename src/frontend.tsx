/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NDKCacheAdapterDexie from "@nostr-dev-kit/ndk-cache-dexie";
import { NDKHeadless, NDKSessionLocalStorage } from "@nostr-dev-kit/react";
import { App } from "./App";
import { config } from "./config";

const elem = document.getElementById("root")!;

// Initialize Dexie cache adapter for efficient caching and cache invalidation
const dexieAdapter = new NDKCacheAdapterDexie({
  dbName: "earthly-cache",
  profileCacheSize: 5000,
  eventCacheSize: 10000,
  eventTagsCacheSize: 20000,
  saveSig: true,
});

// App renders synchronously - config values are baked in at build time
const app = (
  <StrictMode>
    <NDKHeadless
      ndk={{
        explicitRelayUrls: [config.relayUrl],
        cacheAdapter: dexieAdapter,
      }}
      session={{
        storage: new NDKSessionLocalStorage(),
        opts: { follows: true, profile: true },
      }}
    />
    <App />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}
