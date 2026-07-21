# Earthly ContextVM server

Earthly exposes map, geographic research, and web-research tools as an MCP server over Nostr. The browser and Android application use the same type-safe client and discover the server by its Nostr public key.

## Tool families

- **Places and OpenStreetMap** — forward/reverse geocoding, nearby and bounding-box queries, relation geometry, and country boundaries.
- **Routing** — Valhalla routes and isochrones.
- **Offline map preparation** — PMTiles extraction and authenticated Blossom upload.
- **Research** — federated web search, protected URL reading, Wikipedia discovery, and provenance-preserving structured Wikipedia extraction.

`web_search` queries Wikipedia, Wikidata, and the VPS-local SearXNG service concurrently. Each response reports provider health. A failed or challenged search engine therefore produces partial coverage instead of discarding useful results from the other sources.

### Structured Wikipedia research

Use `wikipedia_lookup` to find the canonical article, then use `wikipedia_extract` instead of scraping rendered HTML:

1. call `wikipedia_extract` with `mode: "outline"` to inspect section names, table indexes, captions, headers, and sample rows;
2. call it again with `mode: "table"`, the selected `tableIndex`, and bounded `rowOffset`/`rowLimit` values;
3. follow the explicit pagination contract: only `pagination.status: "complete"` means the response contains the full table; `"more"` points to `nextOffset`, while `"final_page"` still omits earlier rows;
4. carry the returned source fields onto every derived map feature: article URL/title, revision ID, section, table, source row, and retrieval time;
5. prefer spatial values already present in structured source fields (coordinates, latitude/longitude, GeoJSON, WKT, or geohashes), and geocode only missing locations;
6. label derived coordinates as `exact`, `approximate`, or `representative` rather than implying more precision than the source provides.

The extractor accepts only canonical Wikipedia article URLs or article titles. It uses MediaWiki's parse API and returns row-oriented data with stable source-row numbers. This gives the map authoring boundary enough information to reject incomplete researched datasets before they mutate the editor.

## Local development

Start the private local search container, the relay, and then the ContextVM server:

```bash
bun run searxng:dev
bun run relay
bun --env-file=.env contextvm/server.ts
```

`bun run searxng:stop` stops the optional search container when research work is finished. Without
it, `web_search` still returns Wikipedia/Wikidata coverage and reports SearXNG as unavailable.

Development is deliberately restricted to `ws://localhost:3334`. Production announces on the configured public relay set. Relevant server-only environment values are:

- `SERVER_KEY` and `SERVER_PUBKEY` — the ContextVM Nostr identity.
- `RELAY_URL` — the primary relay.
- `SEARXNG_URL` — `http://127.0.0.1:8888` in production.
- `VALHALLA_URL` — routing backend.

See [Private SearXNG operations](../docs/operations/searxng.md) for VPS setup and maintenance.

## Generated client workflow

[`ctxcn`](https://github.com/ContextVM/ctxcn) generates `src/ctxcn/EarthlyGeoServerClient.ts` from the live MCP `tools/list` contract. Start the local relay and server, then run:

```bash
bun run ctxcn:update
bun run ctxcn:verify
```

The generated type and method surface is authoritative. Earthly deliberately customizes the generated runtime block because the generic generator cannot infer application policy:

- a fresh process-local Nostr client identity;
- stage-aware relay routing;
- CEP-22 oversized response support;
- awaiting transport connection before the first call;
- MCP error unwrapping and live `listTools`/generic-call support.

`ctxcn:verify` fails if regeneration removes these safeguards or if client and server versions diverge. Review generated diffs before committing; do not hand-author tool input/output interfaces.

## Verification

```bash
bun test contextvm/tools
bun run ctxcn:verify
bun run deploy --check
```

## References

- [ContextVM TypeScript SDK](https://docs.contextvm.org/ts-sdk/tutorials/client-server-communication/)
- [ctxcn generated clients](https://github.com/ContextVM/ctxcn)
- [Model Context Protocol](https://modelcontextprotocol.io/)
