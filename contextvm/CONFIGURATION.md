# Configuration Guide

## Server Configuration

The ContextVM geo server needs a Nostr keypair to communicate via the relay.

### Development Keys (for testing only)

**Server:**

- Private Key: `0000000000000000000000000000000000000000000000000000000000000001`
- Public Key: `79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`

**Client:**

- Private Key: `0000000000000000000000000000000000000000000000000000000000000002`
- Public Key: `c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5`

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server configuration (contextvm/server.ts)
SERVER_KEY=0000000000000000000000000000000000000000000000000000000000000001
# Optional alias still supported by the server:
# SERVER_KEY=...

# Client configuration (frontend or other services)
SERVER_PUBKEY=79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
CLIENT_KEY=0000000000000000000000000000000000000000000000000000000000000002

# Relay URL (shared)
RELAY_URL=ws://localhost:3334
```

### Generating Production Keys

For production, generate secure random keys:

```bash
# Generate server private key
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then derive the public key using nostr-tools or a similar library.

## Tool Usage

Once connected, call the MCP tools provided by the geo server:

```typescript
// Search for places
await client.callTool({
  name: "search_location",
  arguments: { query: "Paris, France", limit: 5 },
});

// Reverse geocode coordinates
await client.callTool({
  name: "reverse_lookup",
  arguments: { lat: 48.8584, lon: 2.2945 },
});
```
