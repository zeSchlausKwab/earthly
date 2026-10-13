# Public maps production verification

Verified on 2026-10-11 from ChatGPT in Brave and an independent browser/client.

## Deployment

- Endpoint: `https://maps.earthly.city/mcp`, no authentication for the guest pilot.
- Persistence: `wss://relay.earthly.city`, signed kind-37515 Nostr events.
- PM2: `earthly-maps`, one Bun process behind Caddy, loopback port 3337.
- Verified active release: `20261011T120014Z-b5892be25806`.
- The user installed the Caddy route with the repository installer; HTTPS health and MCP discovery passed. The main Earthly services were not restarted.
- A personal Earthly Maps plugin was created and connected in ChatGPT. This is not a public directory listing or submission.

## Live scenario

All coordinates below were supplied as fictional demonstration data, not geocoded or used for navigation:

| Feature | Geometry | Coordinates (longitude, latitude) |
| --- | --- | --- |
| Demo stop | Point | `[16.4,48.21]` |
| Illustrative route | LineString | `[[16.4,48.21],[16.41,48.215],[16.42,48.21]]` |
| Demo zone | Polygon | `[[[16.405,48.205],[16.415,48.205],[16.415,48.21],[16.405,48.21],[16.405,48.205]]]` |

Observed results:

1. `preview_map` displayed the interactive map, real OpenFreeMap basemap, three features, controls, and attribution in ChatGPT.
2. ChatGPT's **Enforce CSP for custom apps** setting was enabled. The map loaded after reloading with enforcement active.
3. Selecting the route in the feature list displayed its details and reported “Selection added to the conversation.”
4. A follow-up prompt changed the route to purple and the zone to orange while preserving the draft ID, all feature IDs, and exact coordinates; the draft advanced from revision 1 to 2.
5. An explicit public-publishing request, followed by ChatGPT's one-time approval, published the revised fictional map and returned its public link.
6. `get_map_embed` returned a responsive iframe, height 500, dark theme, scroll zoom disabled. It rendered the published features from a separate localhost origin without ChatGPT authentication.
7. A fresh MCP client called `read_map`; a separate relay read verified the Nostr signature, title, feature IDs, colors, and coordinates. Public results did not contain the draft editing capability.

Published event ID:

`adea3727605e3e577540b7df2c5a41078a354a83d25b332d13820c3771efaa57`

[Open the fictional demo map](https://maps.earthly.city/maps/naddr1qvzqqqyj3vpzp0939vqc67vjy040mday0k86npx2yqdjlqa3x84ruwl5yvyf32fqqyv8wumn8ghj7un9d3shjtn9v9e8g6rv0yhxx6t50yqp2ve5gfx8vmz0vfx9wst6ffp5s6jh0fshv6g75zhd6)

## Issues found and fixed

- **ChatGPT tool-schema validation:** tuple-style array `items` and geometry `oneOf` were rejected during connection. Input schemas now advertise numeric arrays and `anyOf`, while runtime validation retains coordinate bounds and tuple semantics. Commit `4eba55d7`.
- **MCP reconnects between turns:** per-connection draft storage broke follow-up edits. A bounded process-local store now retains drafts through reconnects, guarded by an unguessable `draftId` bearer capability and unchanged expiry. Commit `b5892be2`. Public maps and embeds contain no such capability.

## Automated checks and limits

- Map service: 11 tests, 226 assertions, passing after the reconnect fix.
- Viewer/worker build and configuration check passed.
- Deployment support: 9 tests passed in the deployment implementation; prior loopback desktop/mobile map E2E scenarios also passed.
- Production mutation was performed only through the authorized ChatGPT UI with the fictional dataset. AI Suite mutation scenarios remain restricted to loopback services and relays.

Geocoding, host fullscreen behavior, mobile ChatGPT, and public directory submission were not part of this live verification. Guest drafts/signing keys expire within two hours and are lost on restart; published events remain readable while the relay retains them. The unauthenticated pilot has bounded resources but no account-based quotas or durable editing recovery.
