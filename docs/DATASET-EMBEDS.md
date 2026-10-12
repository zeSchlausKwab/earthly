# Dataset embeds

Open a published public Map, then **Share → Embed on a website**. The panel shows
the selected dataset, checks compatibility, and offers a live iframe preview and
copyable HTML. Configure light/dark theme, height (200–2000 px), title, legend,
map controls, scroll zoom, and fit-to-dataset or the current camera. Scroll zoom
is off by default. The preview is capped at 360 px high; copied HTML uses the
chosen height.

The public dataset inspector's Share button opens the same popover, including
on mobile where the inspector sheet covers the map toolbar.

Embedding does not publish, sign, or upload geometry. It references the existing
Nostr address; display settings are URL parameters. The viewer loads the latest
published version on each page load. Unsaved edits are excluded; the iframe does
not continuously subscribe to updates.

Only a loaded, signed public dataset matching the focused address is eligible.
Private workspace projections, field-session datasets, unpublished drafts, and
non-dataset views do not expose the Embed tab. Local validation rejects external
blob references, unsupported geometry, more than 300 features, and data over
48 KiB. Before enabling copy/preview, a credential-free GET to the viewer's
`/api/maps/:naddr` verifies that its configured relays can supply a supported
published version. Failure offers a retry or recommends sharing the Earthly link.
Changing the selected event or closing the panel cancels pending checks.

`PUBLIC_MAP_URL` is a frontend build setting, defaulting to
`https://maps.earthly.city`. It must be an HTTP(S) origin without credentials,
query, or fragment. Tauri permits that production origin in its frame policy;
native builds using another viewer must also update `frame-src`.

For local testing, start the existing development relay on port 3334 without
resetting someone else's instance, then start the viewer and app in separate
terminals:

```sh
EARTHLY_MAP_PORT=3357 EARTHLY_MAP_PUBLIC_URL=http://127.0.0.1:3357 EARTHLY_MAP_RELAYS=ws://127.0.0.1:3334 bun run dev:map-plugin
PORT=3300 PUBLIC_MAP_URL=http://127.0.0.1:3357 RELAY_URL=ws://localhost:3334 EXTRA_READ_RELAYS= bun src/index.ts
AI_SUITE_BASE_URL=http://localhost:3300 AI_SUITE_EMBED_URL=http://127.0.0.1:3357 bunx playwright test -c ai-suite/playwright.config.ts dataset-embed.spec.ts --workers=1
```

These scenarios publish disposable fixtures only to the loopback relay, exercise
desktop/mobile sharing, configured preview and clipboard output, a separate
iframe host, service failure/retry, and local incompatibility rejection. They
require explicit `AI_SUITE_EMBED_URL` opt-in and verify the viewer's relays are
loopback before publishing.
