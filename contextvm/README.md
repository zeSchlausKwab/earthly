# ContextVM Geo Server

A Nostr-based MCP server focused on geocoding and reverse geocoding via OpenStreetMap Nominatim.

## Tools

- **search_location** — Forward geocode queries (places, addresses, landmarks) and return coordinates, bounding boxes, and GeoJSON outlines.
- **reverse_lookup** — Reverse geocode WGS84 coordinates to addresses and place metadata.

## Running

The server announces itself to the relay when started.

```bash
# Start the geo server
bun run contextvm/server.ts
```

Environment variables:

- `SERVER_KEY` (or alias `SERVER_KEY`): Nostr private key for the server (hex format)
- `RELAY_URL`: Relay URL (default: ws://localhost:3334)

## Client Usage

```typescript
import { Client } from "@modelcontextprotocol/sdk/client";
import { NostrClientTransport } from "@contextvm/sdk";

const client = new Client({ name: "earthly-geo-client", version: "1.0.0" });
await client.connect(new NostrClientTransport({ relays: ["ws://localhost:3334"] }));

const forward = await client.callTool({
  name: "search_location",
  arguments: { query: "Paris, France", limit: 5 },
});

const reverse = await client.callTool({
  name: "reverse_lookup",
  arguments: { lat: 48.8584, lon: 2.2945 },
});
```

## Modular Design

- `tools/nominatim.ts` — Nominatim API integration
- `geo-schemas.ts` — Zod schemas for the geocoding MCP tools
- `server.ts` — MCP server wiring and Nostr transport

## References

- [ContextVM Documentation](https://docs.contextvm.org/ts-sdk/tutorials/client-server-communication/)
- [Nominatim](https://nominatim.org/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
