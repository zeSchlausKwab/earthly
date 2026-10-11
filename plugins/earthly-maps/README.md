# Earthly Maps plugin

Source package for the public-map pilot. The MCP connection points to the hosted
endpoint `https://maps.earthly.city/mcp` with no authentication. It exposes map
preview, public Nostr publishing, reading, geocoding, and configurable iframes.

The package is not installed or uploaded automatically. For a personal ChatGPT
connection, add that URL under Plugins → Add → Add custom MCP server, choose
**No authentication**, then create/install the plugin.

For local development, run `bun run dev:map-plugin` and use
`http://127.0.0.1:3337/mcp` in your local client's configuration. Never point
mutating AI Suite scenarios at the production endpoint or relay.

See [runtime setup and limits](../../src/map-plugin/README.md) and
[PM2/Caddy deployment](../../ops/vps/map-plugin/README.md). This directory contains
metadata, workflow instructions, and a connection, not a bundled Earthly server.
