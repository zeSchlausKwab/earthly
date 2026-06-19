---
title: CVM caching layer for Overpass/OSM geometry + a maintained boundary library
status: backlog
created: 2026-06-19
source: Phase 4 UAT conversation-dump analysis (great-circle arc run: 15 rounds, 17 tool calls)
priority: medium (think-through-later)
---

# CVM caching layer for Overpass/OSM geometry

## Idea

Add a caching layer on the **CVM** (ContextVM geo server — the remote MCP server behind
`search_location`, `get_osm_relation_geometry`, `query_osm_by_id`, etc.) that stores
Overpass / OSM query results so repeated requests don't hit the third-party Overpass API.

Beyond a passive cache, **pre-capture the most frequent requests** — city points and
country / admin boundaries — into a maintained local library shipped/served by the CVM.
Country boundaries especially will be requested constantly; we shouldn't make a live
3rd-party call (and pull multi-thousand-token geometry) every time.

## Why (evidence)

The Phase 4 UAT conversation-dump analysis (drawing a Lisbon→Athens great-circle arc)
showed a 15-round, 17-tool-call detour. Two of the rounds were a **7,029-token
`get_osm_relation_geometry` boundary blob** fetched only because `search_location`
returned a *relation without coordinates* for Lisbon and the *wrong* Athens (Georgia, USA).
A cache + curated boundary/city library would:
- avoid the live Overpass round-trip and its large payload,
- let `search_location` resolve well-known places (capitals, countries) instantly and
  correctly from the maintained set,
- reduce context bloat (cached/curated results can be trimmed to what's needed),
- improve latency and reliability (no dependency on Overpass availability/rate limits).

## Open questions (for the later think-through)

- Where does the cache live — CVM process memory, a local store, or a published/served
  blob (Blossom)? Eviction / TTL / invalidation policy for OSM data that changes.
- What's the seed set for the "library" — ISO countries + admin-1 + a capitals/major-cities
  gazetteer? Source + license (OSM/Natural Earth)?
- Geometry resolution / simplification tiers (full boundary vs. simplified vs. centroid)
  so callers can ask for the cheapest representation that answers the question.
- How this interacts with the client-side `search_location` disambiguation fix (return
  usable lat/lon + prefer the prominent match) — client mitigation now, server library later.
- Does this belong in the mapnolia binary or a separate CVM geo service?

## Relation to other work

- The client-side geocoder-quality mitigation (return coords / disambiguate) and prompt
  steering ("use known coords for well-known places; don't fetch OSM geometry unless asked")
  are the near-term hedges; this maintained-library cache is the durable fix.
- Not scheduled into a phase yet — captured here to think through later.
