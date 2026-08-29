# Earthly ContextVM server

Earthly exposes map, geographic research, and web-research tools as an MCP server over Nostr. The browser and Android application use the same type-safe client and discover the server by its Nostr public key.

## Tool families

- **GeoCatalog** — fast, self-hosted semantic/spatial search and geometry retrieval from an immutable, release-pinned geography snapshot, including derived non-stitched transport corridors.
- **Places and OpenStreetMap** — forward/reverse geocoding plus last-resort remote queries for details absent from GeoCatalog.
- **Routing** — Valhalla routes and isochrones.
- **Offline map preparation** — PMTiles extraction and authenticated Blossom upload.
- **Research** — federated web search, protected URL reading, Wikipedia discovery, and provenance-preserving structured Wikipedia extraction.

`web_search` queries Wikipedia, Wikidata, and the VPS-local SearXNG service concurrently. Each response reports provider health. A failed or challenged search engine therefore produces partial coverage instead of discarding useful results from the other sources.

### Structured Wikipedia research

Use `wikipedia_lookup` to find the canonical article, then use `wikipedia_extract` instead of scraping rendered HTML:

1. use `mode: "article"` for a bounded page of the article's readable prose, or `mode: "section"` with a section index/title for focused prose;
2. if `textPagination.status` is `"more"`, continue at `textPagination.nextOffset` and pass its `revisionId` so character offsets remain pinned to one revision; only `"complete"` contains all requested prose;
3. use `mode: "outline"` to inspect section names, table indexes, captions, headers, and sample rows;
4. use `mode: "table"`, the selected `tableIndex`, and bounded `rowOffset`/`rowLimit` values for structured rows. Only `pagination.status: "complete"` contains the full table; `"more"` points to `nextOffset`, while `"final_page"` still omits earlier rows;
5. carry the returned source fields onto every derived map feature: article URL/title, revision ID, section, table, source row, and retrieval time;
6. prefer spatial values already present in structured source fields (coordinates, latitude/longitude, GeoJSON, WKT, or geohashes), and geocode only missing locations;
7. label derived coordinates as `exact`, `approximate`, or `representative` rather than implying more precision than the source provides.

The extractor accepts canonical, raw, and common MediaWiki API article URLs or exact article titles. It uses MediaWiki's parse API and returns revision-pinned prose pages or row-oriented tables with stable source-row numbers. This gives the map authoring boundary enough information to reject incomplete researched datasets before they mutate the editor.

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
- `GEOCATALOG_PATH` — immutable SQLite snapshot; defaults to `./data/geocatalog/current.sqlite`.

Development starts even when no GeoCatalog snapshot is installed, and
`query_geography` returns a typed, non-retryable availability error rather than
silently sending the same request to a remote OSM service. Production performs
a real catalog query before connecting to relays and refuses to become healthy
when the configured snapshot is missing, invalid, or empty. See
[GeoCatalog operations](../docs/operations/geocatalog.md) for snapshot builds,
promotion, and rollback.

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

`ctxcn:verify` fails if regeneration removes these safeguards or either endpoint
loses its identity/version. The MCP server and generated client have independent
implementation versions; their contracts are checked by generated/static schema
tests rather than by falsely requiring those two versions to be equal. Review
generated diffs before committing; do not hand-author generated tool interfaces.

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
