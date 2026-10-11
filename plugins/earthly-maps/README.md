# Earthly Maps local plugin

Source package for the public-map pilot. Start the repository's `bun run dev:map-plugin` before connecting the endpoint in `mcp.json`.

The package points to the verified local endpoint `http://127.0.0.1:3337/mcp`. It is not installed or uploaded automatically. A cloud ChatGPT host needs a reachable HTTPS endpoint; replace the endpoint only after hosting it and set the server's matching `EARTHLY_MAP_PUBLIC_URL`.

See [runtime setup and limits](../../src/map-plugin/README.md). This directory contains metadata, workflow instructions, and a connection, not a bundled copy of the Earthly server.
