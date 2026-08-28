import {
  NostrServerTransport,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serverConfig } from "../src/config/env.server";
import {
  reverseLookupInputSchema,
  reverseLookupOutputSchema,
  queryGeographyInputSchema,
  queryGeographyOutputSchema,
  searchLocationInputSchema,
  searchLocationOutputSchema,
  queryByIdInputSchema,
  queryByIdOutputSchema,
  queryNearbyInputSchema,
  queryBboxInputSchema,
  queryFeaturesOutputSchema,
  resolveOsmEntityInputSchema,
  resolveOsmEntityOutputSchema,
  getOsmRelationGeometryInputSchema,
  getOsmRelationGeometryOutputSchema,
  getCountryBoundaryInputSchema,
  getCountryBoundaryOutputSchema,
  valhallaRouteInputSchema,
  valhallaRouteOutputSchema,
  valhallaIsochroneInputSchema,
  valhallaIsochroneOutputSchema,
  createMapExtractInputSchema,
  createMapExtractOutputSchema,
  createMapUploadInputSchema,
  createMapUploadOutputSchema,
} from "./geo-schemas.ts";
import {
  GeoCatalogError,
  formatGeoCatalogReadiness,
  openSqliteGeoCatalog,
  preflightGeoCatalog,
} from "./geocatalog/index.ts";
import {
  webSearchInputSchema,
  webSearchOutputSchema,
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
  wikipediaLookupInputSchema,
  wikipediaLookupOutputSchema,
  wikipediaExtractInputSchema,
  wikipediaExtractOutputSchema,
} from "./web-schemas.ts";
import {
  NominatimRequestError,
  reverseLookup,
  searchLocation,
} from "./tools/nominatim.ts";
import {
  queryById,
  queryNearby,
  queryBbox,
  findAdministrativeBoundaryRelation,
  queryRelationGeometry,
} from "./tools/overpass.ts";
import {
  extractPmtiles,
  getPendingExtraction,
  removePendingExtraction,
  calculateBBoxAreaSqKm,
} from "./tools/pmtiles.ts";
import {
  checkBlossomServer,
  uploadToBlossomWithAuth,
} from "./tools/blossom.ts";
import { webSearch } from "./tools/web-search.ts";
import { fetchUrl } from "./tools/fetch-url.ts";
import { wikipediaLookup } from "./tools/wikipedia.ts";
import { wikipediaExtract } from "./tools/wikipedia-extract.ts";
import { valhallaIsochrone, valhallaRoute } from "./tools/valhalla.ts";
import { researchToolLimiter } from "./research-tool-limiter.ts";

// Configuration from validated environment
const SERVER_PRIVATE_KEY =
  serverConfig.serverKey ||
  "0000000000000000000000000000000000000000000000000000000000000001"; // Dev fallback
// Stage isolation (docs/RELAY_STAGES.md): the dev geo server binds ONLY to the
// local relay — even if RELAY_URL points elsewhere — so dev MCP traffic never
// reaches public relays. Prod serves on the configured relay + the public
// ContextVM relays.
const RELAYS = serverConfig.isProduction
  ? [
      ...new Set([
        serverConfig.relayUrl || "wss://relay.earthly.city",
        "wss://relay2.contextvm.org",
        "wss://relay.earthly.city",
      ]),
    ]
  : ["ws://localhost:3334"];

const geoCatalog = openSqliteGeoCatalog({ path: serverConfig.geoCatalogPath });

function requestClientPubkey(extra: { _meta?: unknown }): string {
  const metadata = extra._meta as Record<string, unknown> | undefined;
  return typeof metadata?.clientPubkey === "string"
    ? metadata.clientPubkey
    : "unknown-client";
}

function roundCoordinate(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function isCoordinateTuple(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function sameCoordinateTuple(a: unknown, b: unknown): boolean {
  if (!isCoordinateTuple(a) || !isCoordinateTuple(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function simplifyCoordinateNode(
  node: unknown,
  precision: number,
  maxPointsPerPath: number,
): unknown {
  if (!Array.isArray(node)) return node;
  if (node.length === 0) return node;

  // Base coordinate tuple: [lon, lat, ...]
  if (typeof node[0] === "number") {
    return (node as unknown[]).map((value) =>
      typeof value === "number" ? roundCoordinate(value, precision) : value,
    );
  }

  // Path level: [[lon,lat], ...]
  if (isCoordinateTuple(node[0])) {
    const path = node as unknown[];
    const rounded = path.map((point) =>
      simplifyCoordinateNode(point, precision, maxPointsPerPath),
    );
    if (rounded.length <= maxPointsPerPath) return rounded;

    const isClosed =
      rounded.length > 2 &&
      sameCoordinateTuple(rounded[0], rounded[rounded.length - 1]);
    const minTarget = isClosed ? 4 : 2;
    const target = Math.max(minTarget, maxPointsPerPath);
    const maxIndex = rounded.length - 1;

    const keepIndexes = new Set<number>([0, maxIndex]);
    const interiorSlots = Math.max(0, target - 2);
    for (let i = 1; i <= interiorSlots; i += 1) {
      const index = Math.round((i * maxIndex) / (interiorSlots + 1));
      keepIndexes.add(index);
    }

    const sampled = [...keepIndexes]
      .sort((a, b) => a - b)
      .map((index) => rounded[index]);

    if (
      isClosed &&
      sampled.length > 0 &&
      !sameCoordinateTuple(sampled[0], sampled[sampled.length - 1])
    ) {
      sampled.push(sampled[0]);
    }

    return sampled;
  }

  return node.map((child) =>
    simplifyCoordinateNode(child, precision, maxPointsPerPath),
  );
}

function simplifyFeatureGeometry(
  feature: unknown,
  precision: number,
  maxPointsPerPath: number,
): unknown {
  if (!feature || typeof feature !== "object") return feature;
  const rawFeature = feature as Record<string, unknown>;
  const rawGeometry =
    rawFeature.geometry && typeof rawFeature.geometry === "object"
      ? (rawFeature.geometry as Record<string, unknown>)
      : null;
  if (!rawGeometry || !("coordinates" in rawGeometry)) {
    return rawFeature;
  }

  return {
    ...rawFeature,
    geometry: {
      ...rawGeometry,
      coordinates: simplifyCoordinateNode(
        rawGeometry.coordinates,
        precision,
        maxPointsPerPath,
      ),
    },
  };
}

function structuredToolFailure(error: unknown): Record<string, unknown> {
  if (error instanceof GeoCatalogError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      suggestedAction:
        error.code === "snapshot_unavailable" || error.code === "snapshot_invalid"
          ? "Ask the Earthly operator to install a valid GeoCatalog snapshot; do not retry this request unchanged or fall back silently."
          : "Correct the geography query before retrying.",
      sideEffectsApplied: false,
    };
  }
  if (error instanceof NominatimRequestError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      suggestedAction: error.retryable
        ? "Retry after the indicated delay or reuse already-returned candidates."
        : "Correct the request instead of retrying it unchanged.",
      sideEffectsApplied: false,
    };
  }
  return {
    ok: false,
    code: "tool_handler_error",
    message: error instanceof Error ? error.message : "Tool execution failed",
    retryable: false,
    sideEffectsApplied: false,
  };
}

async function main() {
  const geoCatalogReadiness = await preflightGeoCatalog({
    catalog: geoCatalog,
    required: serverConfig.isProduction,
  });
  if (geoCatalogReadiness) {
    console.log(
      `🗂️ GeoCatalog ready: ${formatGeoCatalogReadiness(geoCatalogReadiness)}`,
    );
  }
  console.log("🗺️ Starting ContextVM Geo Server...\n");

  // 1. Setup Signer and Relay Pool
  const signer = new PrivateKeySigner(SERVER_PRIVATE_KEY);
  const relayPool = new ApplesauceRelayPool(RELAYS);
  const serverPubkey = await signer.getPublicKey();

  console.log(`📡 Server Public Key: ${serverPubkey}`);
  console.log(`🔌 Connecting to relays: ${RELAYS.join(", ")}...\n`);

  // 2. Create and Configure the MCP Server
  const mcpServer = new McpServer({
    name: "earthly-geo-server",
    version: "0.3.0",
  });

  // 9. Register Tool: Search Locations (Nominatim)
  mcpServer.registerTool(
    "search_location",
    {
      title: "Search Locations (Nominatim)",
      description:
        "Remote Nominatim fallback for geocoding or name detail absent from query_geography and bundled world layers. Use query_geography first and do not call this merely to verify a catalog match. Returns coordinates, bounding boxes, and GeoJSON outlines.",
      inputSchema: searchLocationInputSchema,
      outputSchema: searchLocationOutputSchema,
    },
    async ({ query, limit }) => {
      try {
        console.log(`🗺️ Searching locations: ${query}`);
        const result = await searchLocation(query, limit);

        const output = { result };
        return {
          content: [],
          structuredContent: output,
        };
      } catch (error: any) {
        console.error(`❌ Location search failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: structuredToolFailure(error) },
          isError: true,
        };
      }
    },
  );

  // 10. Register Tool: Reverse Geocoding (Nominatim)
  mcpServer.registerTool(
    "reverse_lookup",
    {
      title: "Reverse Geocode (Nominatim)",
      description:
        "Remote Nominatim fallback for address detail at a coordinate. Use only when the local catalog and bundled world layers cannot answer the request. Returns address information for a point.",
      inputSchema: reverseLookupInputSchema,
      outputSchema: reverseLookupOutputSchema,
    },
    async ({ lat, lon, zoom }) => {
      try {
        console.log(
          `🗺️ Reverse geocoding: lat=${lat}, lon=${lon}, zoom=${zoom ?? 18}`,
        );
        const result = await reverseLookup(lat, lon, zoom);

        const output = { result };
        return {
          content: [],
          structuredContent: output,
        };
      } catch (error: any) {
        console.error(`❌ Reverse lookup failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: structuredToolFailure(error) },
          isError: true,
        };
      }
    },
  );

  // Register Tool: Query the local immutable geography catalog
  mcpServer.registerTool(
    "query_geography",
    {
      title: "Query Earthly GeoCatalog",
      description:
        "Query Earthly's fast, self-hosted geography snapshot for administrative areas, localities, places, roads, rail, waterways, and infrastructure. Use this before remote OpenStreetMap tools. Filters combine with AND semantics. Discover human-readable searches without geometry, then resolve chosen stable ids with geometry for mapping.",
      inputSchema: queryGeographyInputSchema,
      outputSchema: queryGeographyOutputSchema,
    },
    async ({
      text,
      ids,
      kinds,
      categories,
      adminLevels,
      countryCode,
      bbox,
      near,
      radiusMeters,
      limit,
      includeGeometry,
    }) => {
      try {
        console.log(
          `🗂️ Querying GeoCatalog: ${text || ids?.join(",") || kinds?.join(",") || "browse"}`,
        );
        const result = await geoCatalog.query({
          ...(text ? { text } : {}),
          ...(ids ? { ids } : {}),
          ...(kinds ? { kinds } : {}),
          ...(categories ? { categories } : {}),
          ...(adminLevels ? { adminLevels } : {}),
          ...(countryCode ? { countryCode } : {}),
          ...(bbox
            ? { bbox: [bbox.west, bbox.south, bbox.east, bbox.north] }
            : {}),
          ...(near ? { near } : {}),
          ...(radiusMeters !== undefined ? { radiusMeters } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(includeGeometry !== undefined ? { includeGeometry } : {}),
        });
        console.log(
          `📦 GeoCatalog returned ${result.metadata.query.returned} result(s) from ${result.metadata.snapshot.id}`,
        );
        return { content: [], structuredContent: { result } };
      } catch (error: unknown) {
        const failure = structuredToolFailure(error);
        const message =
          typeof failure.message === "string"
            ? failure.message
            : "GeoCatalog query failed";
        const suggestedAction =
          typeof failure.suggestedAction === "string"
            ? ` ${failure.suggestedAction}`
            : "";
        console.error(`❌ GeoCatalog query failed: ${message}`);
        return {
          content: [
            {
              type: "text",
              text: `${String(failure.code)}: ${message}.${suggestedAction}`,
            },
          ],
          // Do not send structuredContent for errors: MCP validates it against
          // the success-only output schema after tools/list has been cached.
          isError: true,
        };
      }
    },
  );

  // 11. Register Tool: Query OSM by ID (Overpass)
  mcpServer.registerTool(
    "query_osm_by_id",
    {
      title: "Query OSM Element by ID (Overpass)",
      description:
        "Fetch one exact OpenStreetMap element by type and ID. Use directly for an exact user-supplied OSM id; otherwise use only as a last resort after query_geography and bundled world layers lack the required detail. Returns full geometry as GeoJSON.",
      inputSchema: queryByIdInputSchema,
      outputSchema: queryByIdOutputSchema,
    },
    async ({ osmType, osmId }) => {
      try {
        console.log(`🗺️ Querying OSM ${osmType}/${osmId}`);
        const result = await queryById(osmType, osmId);

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM query by ID failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 12. Register Tool: Query OSM Nearby (Overpass)
  mcpServer.registerTool(
    "query_osm_nearby",
    {
      title: "Query OSM Elements Nearby (Overpass)",
      description:
        "Remote Overpass last resort for local detail absent from query_geography and bundled world layers. Queries OpenStreetMap elements near a point with optional tag filters and returns GeoJSON features.",
      inputSchema: queryNearbyInputSchema,
      outputSchema: queryFeaturesOutputSchema,
    },
    async ({
      lat,
      lon,
      radius,
      filters,
      filterSets,
      limit,
      includeRelations,
    }) => {
      try {
        console.log(`🗺️ Querying OSM nearby: ${lat},${lon} radius=${radius}m`);
        const result = await queryNearby(
          lat,
          lon,
          radius,
          filters,
          filterSets,
          limit,
          Boolean(includeRelations),
        );

        // Log response size for debugging
        const responseStr = JSON.stringify({ result });
        console.log(
          `📦 Response size: ${responseStr.length} bytes (${result.count} features)`,
        );

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM nearby query failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 13. Register Tool: Query OSM Bbox (Overpass)
  mcpServer.registerTool(
    "query_osm_bbox",
    {
      title: "Query OSM Elements in Bounding Box (Overpass)",
      description:
        "Remote Overpass last resort for local detail absent from query_geography and bundled world layers. Queries OpenStreetMap elements within a bounding box with optional tag filters and returns GeoJSON features.",
      inputSchema: queryBboxInputSchema,
      outputSchema: queryFeaturesOutputSchema,
    },
    async ({
      west,
      south,
      east,
      north,
      filters,
      filterSets,
      limit,
      includeRelations,
    }) => {
      try {
        console.log(
          `🗺️ Querying OSM bbox: [${west},${south},${east},${north}]`,
        );
        const result = await queryBbox(
          west,
          south,
          east,
          north,
          filters,
          filterSets,
          limit,
          Boolean(includeRelations),
        );

        // Log response size for debugging
        const responseStr = JSON.stringify({ result });
        console.log(
          `📦 Response size: ${responseStr.length} bytes (${result.count} features)`,
        );

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM bbox query failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 14. Register Tool: Resolve OSM Entity
  mcpServer.registerTool(
    "resolve_osm_entity",
    {
      title: "Resolve OSM Entity",
      description:
        "Remote Nominatim last resort for resolving a name to concrete OSM ids before an OSM import. Use query_geography first for boundaries and places; do not call this merely to verify a catalog match.",
      inputSchema: resolveOsmEntityInputSchema,
      outputSchema: resolveOsmEntityOutputSchema,
    },
    async ({ query, limit, preferredOsmType, adminLevel, countryCode }) => {
      try {
        const requestedLimit = Math.max(1, Math.min(limit ?? 5, 10));
        const normalizedCountryCode = countryCode?.trim().toLowerCase();
        const normalizedQuery = query.trim();
        const boundaryMode =
          preferredOsmType === "relation" || typeof adminLevel === "number";
        const queryVariants = Array.from(
          new Set(
            [
              normalizedQuery,
              normalizedCountryCode
                ? `${normalizedQuery}, ${normalizedCountryCode.toUpperCase()}`
                : null,
              normalizedCountryCode === "de"
                ? `${normalizedQuery}, Germany`
                : null,
              normalizedCountryCode === "de" ? `Land ${normalizedQuery}` : null,
              boundaryMode
                ? `${normalizedQuery} administrative boundary`
                : null,
            ].filter((value): value is string => Boolean(value?.trim())),
          ),
        );
        const searchLimit = Math.min(50, Math.max(requestedLimit * 6, 20));
        // Nominatim is a shared public service: try constrained variants in
        // order and stop once one returns candidates. The client also
        // coalesces/caches/rate-limits calls, but avoiding the fan-out here is
        // the biggest protection against one entity resolution becoming five
        // simultaneous searches.
        const searchResponses = [];
        for (const queryVariant of queryVariants) {
          const response = await searchLocation(queryVariant, searchLimit, {
            countryCode: normalizedCountryCode,
          });
          searchResponses.push(response);
          const hasStrictCandidate = response.results.some((candidate) => {
            const typeOk = preferredOsmType
              ? candidate.osmType === preferredOsmType
              : true;
            const candidateCountry =
              candidate.address?.country_code?.toLowerCase() ?? null;
            const countryOk = normalizedCountryCode
              ? candidateCountry !== null &&
                candidateCountry === normalizedCountryCode
              : true;
            const rawAdminLevel = Number(candidate.extratags?.admin_level);
            const adminOk =
              typeof adminLevel !== "number" ||
              rawAdminLevel === adminLevel ||
              (candidate.class === "boundary" &&
                candidate.type === "administrative" &&
                candidate.osmType === "relation");
            return typeOk && countryOk && adminOk;
          });
          if (hasStrictCandidate) break;
        }
        const mergedResults = searchResponses.flatMap(
          (response) => response.results,
        );
        const dedupedResults = Array.from(
          new Map(
            mergedResults.map((candidate) => {
              const key =
                candidate.osmType && candidate.osmId
                  ? `${candidate.osmType}:${candidate.osmId}`
                  : `place:${candidate.placeId}`;
              return [key, candidate] as const;
            }),
          ).values(),
        );
        const queryNeedle = normalizedQuery.toLowerCase();

        const classifyAdminMatch = (
          candidate: (typeof dedupedResults)[number],
        ): "exact" | "boundary" | "none" => {
          if (typeof adminLevel !== "number") return "exact";
          const raw = candidate.extratags?.admin_level;
          if (raw) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed) && parsed === adminLevel) {
              return "exact";
            }
          }
          if (
            candidate.class === "boundary" &&
            candidate.type === "administrative" &&
            candidate.osmType === "relation"
          ) {
            return "boundary";
          }
          return "none";
        };

        const evaluated = dedupedResults.map((candidate) => {
          const candidateCountry =
            candidate.address?.country_code?.toLowerCase() ?? null;
          const countryMatches = normalizedCountryCode
            ? candidateCountry
              ? candidateCountry === normalizedCountryCode
              : null
            : true;
          const typeMatches = preferredOsmType
            ? candidate.osmType === preferredOsmType
            : true;
          const adminMatch = classifyAdminMatch(candidate);
          const nameMatches = candidate.displayName
            .toLowerCase()
            .includes(queryNeedle);

          let score = 0;
          if (preferredOsmType) {
            score += typeMatches ? 120 : -80;
          }
          if (normalizedCountryCode) {
            if (countryMatches === true) score += 80;
            else if (countryMatches === false) score -= 140;
            else score -= 20;
          }
          if (typeof adminLevel === "number") {
            if (adminMatch === "exact") score += 160;
            else if (adminMatch === "boundary") score += 50;
            else score -= 160;
          }
          if (
            candidate.class === "boundary" &&
            candidate.type === "administrative"
          ) {
            score += 60;
          }
          if (candidate.osmType === "relation") score += 25;
          if (nameMatches) score += 30;
          if (typeof candidate.importance === "number") {
            score += candidate.importance * 15;
          }

          return {
            candidate,
            score,
            typeMatches,
            countryMatches,
            adminMatch,
          };
        });

        const strictMatches = evaluated.filter((item) => {
          const typeOk = preferredOsmType ? item.typeMatches : true;
          const countryOk = normalizedCountryCode
            ? item.countryMatches !== false
            : true;
          const adminOk =
            typeof adminLevel === "number" ? item.adminMatch !== "none" : true;
          return typeOk && countryOk && adminOk;
        });

        let selected = (strictMatches.length > 0 ? strictMatches : evaluated)
          .sort((a, b) => b.score - a.score)
          .slice(0, requestedLimit);

        const collectCoordinatePairs = (
          input: unknown,
          pairs: [number, number][],
        ): void => {
          if (!Array.isArray(input) || input.length === 0) return;
          if (
            input.length >= 2 &&
            typeof input[0] === "number" &&
            typeof input[1] === "number" &&
            Number.isFinite(input[0]) &&
            Number.isFinite(input[1])
          ) {
            pairs.push([input[0], input[1]]);
            return;
          }
          for (const child of input) {
            collectCoordinatePairs(child, pairs);
          }
        };

        const computeFeatureBbox = (
          feature: any,
        ): [number, number, number, number] | null => {
          const geometry = feature?.geometry;
          if (!geometry || !geometry.coordinates) return null;
          const pairs: [number, number][] = [];
          collectCoordinatePairs(geometry.coordinates, pairs);
          if (pairs.length === 0) return null;
          let west = Number.POSITIVE_INFINITY;
          let south = Number.POSITIVE_INFINITY;
          let east = Number.NEGATIVE_INFINITY;
          let north = Number.NEGATIVE_INFINITY;
          for (const [lon, lat] of pairs) {
            if (lon < west) west = lon;
            if (lon > east) east = lon;
            if (lat < south) south = lat;
            if (lat > north) north = lat;
          }
          if (![west, south, east, north].every(Number.isFinite)) return null;
          return [west, south, east, north];
        };

        if (selected.length === 0 && boundaryMode) {
          try {
            const relationLookup = await findAdministrativeBoundaryRelation({
              countryCode: countryCode?.trim().toUpperCase(),
              name: normalizedQuery,
              adminLevel,
            });
            const relationGeometry = await queryRelationGeometry(
              relationLookup.relationId,
            );
            const fallbackBbox = computeFeatureBbox(relationGeometry.feature);
            const fallbackLon = fallbackBbox
              ? (fallbackBbox[0] + fallbackBbox[2]) / 2
              : 0;
            const fallbackLat = fallbackBbox
              ? (fallbackBbox[1] + fallbackBbox[3]) / 2
              : 0;
            const tags = relationLookup.relation.tags ?? {};
            const displayName = tags.name
              ? `${tags.name} (relation ${relationLookup.relationId})`
              : `relation/${relationLookup.relationId}`;

            selected = [
              {
                candidate: {
                  placeId: relationLookup.relationId,
                  displayName,
                  osmType: "relation",
                  osmId: relationLookup.relationId,
                  class: "boundary",
                  type: tags.type ?? "administrative",
                  importance: 1,
                  coordinates: { lat: fallbackLat, lon: fallbackLon },
                  boundingbox: fallbackBbox,
                  extratags: tags,
                },
                score: 1000,
                typeMatches: true,
                countryMatches: true,
                adminMatch: "exact" as const,
              },
            ];
          } catch (fallbackError: any) {
            console.warn(
              `resolve_osm_entity fallback relation lookup failed: ${fallbackError?.message ?? "unknown error"}`,
            );
          }
        }

        const candidates = selected.map((item) => ({
          placeId: item.candidate.placeId,
          displayName: item.candidate.displayName,
          osmType: item.candidate.osmType,
          osmId: item.candidate.osmId,
          class: item.candidate.class,
          type: item.candidate.type,
          importance: item.candidate.importance,
          coordinates: item.candidate.coordinates,
          boundingbox: item.candidate.boundingbox,
          extratags: item.candidate.extratags,
        }));

        return {
          content: [],
          structuredContent: {
            result: {
              query,
              count: candidates.length,
              candidates,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ resolve_osm_entity failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 15. Register Tool: Get OSM Relation Geometry
  mcpServer.registerTool(
    "get_osm_relation_geometry",
    {
      title: "Get OSM Relation Geometry",
      description:
        "Remote OSM geometry fetch for one exact relation id. Use directly only for a user-supplied OSM relation id; otherwise use as a last resort after query_geography lacks the required boundary detail. Assembles the relation into clean GeoJSON.",
      inputSchema: getOsmRelationGeometryInputSchema,
      outputSchema: getOsmRelationGeometryOutputSchema,
    },
    async ({ relationId, coordinatePrecision, maxPointsPerRing }) => {
      try {
        const base = await queryRelationGeometry(relationId);
        let feature = base.feature;
        if (
          feature &&
          typeof coordinatePrecision === "number" &&
          typeof maxPointsPerRing === "number"
        ) {
          feature = simplifyFeatureGeometry(
            feature,
            coordinatePrecision,
            maxPointsPerRing,
          ) as typeof feature;
        }

        return {
          content: [],
          structuredContent: {
            result: {
              relationId,
              feature: feature ?? null,
              tags: base.tags,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ get_osm_relation_geometry failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 16. Register Tool: Get Country Boundary
  mcpServer.registerTool(
    "get_country_boundary",
    {
      title: "Get Country Boundary",
      description:
        "Compatibility fallback for a country administrative boundary absent from query_geography and bundled world layers. Resolves and fetches a remote OSM relation (admin_level=2 by default); do not use it to verify a catalog match.",
      inputSchema: getCountryBoundaryInputSchema,
      outputSchema: getCountryBoundaryOutputSchema,
    },
    async ({
      countryCode,
      name,
      adminLevel,
      coordinatePrecision,
      maxPointsPerRing,
    }) => {
      try {
        if (!countryCode && !name) {
          throw new Error("countryCode or name is required.");
        }

        let relationLookup: Awaited<
          ReturnType<typeof findAdministrativeBoundaryRelation>
        > | null = null;
        let queryLabel = "";

        if (countryCode) {
          try {
            relationLookup = await findAdministrativeBoundaryRelation({
              countryCode,
              adminLevel,
            });
            queryLabel = `countryCode=${countryCode.toUpperCase()}`;
          } catch (error) {
            if (!name) throw error;
          }
        }

        if (!relationLookup && name) {
          relationLookup = await findAdministrativeBoundaryRelation({
            name,
            adminLevel,
          });
          queryLabel = `name=${name}`;
        }

        if (!relationLookup) {
          throw new Error("Country boundary relation not found.");
        }

        const relationGeometry = await queryRelationGeometry(
          relationLookup.relationId,
        );

        let feature = relationGeometry.feature;
        if (
          feature &&
          typeof coordinatePrecision === "number" &&
          typeof maxPointsPerRing === "number"
        ) {
          feature = simplifyFeatureGeometry(
            feature,
            coordinatePrecision,
            maxPointsPerRing,
          ) as typeof feature;
        }

        return {
          content: [],
          structuredContent: {
            result: {
              query: queryLabel,
              relationId: relationLookup.relationId,
              candidateCount: relationLookup.candidates.length,
              feature: feature ?? null,
              tags: relationGeometry.tags,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ get_country_boundary failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 17. Register Tool: Valhalla Route
  mcpServer.registerTool(
    "valhalla_route",
    {
      title: "Valhalla Route",
      description:
        "Compute a route between waypoints using Valhalla and return GeoJSON line geometry.",
      inputSchema: valhallaRouteInputSchema,
      outputSchema: valhallaRouteOutputSchema,
    },
    async ({ locations, profile, units, baseUrl }) => {
      try {
        const result = await valhallaRoute({
          locations,
          profile,
          units,
          baseUrl,
        });
        return {
          content: [],
          structuredContent: {
            result: {
              feature: result.feature,
              summary: result.summary,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ valhalla_route failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 18. Register Tool: Valhalla Isochrone
  mcpServer.registerTool(
    "valhalla_isochrone",
    {
      title: "Valhalla Isochrone",
      description:
        "Compute isochrone contours around a location using Valhalla.",
      inputSchema: valhallaIsochroneInputSchema,
      outputSchema: valhallaIsochroneOutputSchema,
    },
    async ({ location, contoursMinutes, profile, polygons, baseUrl }) => {
      try {
        const result = await valhallaIsochrone({
          location,
          contoursMinutes,
          profile,
          polygons,
          baseUrl,
        });
        return {
          content: [],
          structuredContent: {
            result: {
              featureCollection: result.featureCollection,
              count: result.featureCollection.features?.length ?? 0,
              profile: result.profile,
              contoursMinutes: result.contoursMinutes,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ valhalla_isochrone failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 19. Register Tool: Create Map Extract (PMTiles)
  mcpServer.registerTool(
    "create_map_extract",
    {
      title: "Extract PMTiles Map Excerpt",
      description:
        "Extract a PMTiles map excerpt for a bounding box. Returns an unsigned Blossom auth event for the client to sign, then call create_map_upload with the signed event.",
      inputSchema: createMapExtractInputSchema,
      outputSchema: createMapExtractOutputSchema,
    },
    async ({ west, south, east, north, maxZoom, blossomServer }) => {
      try {
        console.log(
          `🗺️ Create map extract: bbox=[${west},${south},${east},${north}] maxZoom=${maxZoom ?? 16}`,
        );

        // Check Blossom server reachability first (without auth for now)
        try {
          const testUrl = new URL(blossomServer);
          const healthCheck = await fetch(testUrl.toString(), {
            method: "HEAD",
          }).catch(() => null);
          if (!healthCheck) {
            throw new Error(`Cannot reach Blossom server at ${blossomServer}`);
          }
        } catch (err: any) {
          throw new Error(
            `Invalid or unreachable Blossom server: ${err.message}`,
          );
        }

        const extractResult = await extractPmtiles(
          { west, south, east, north },
          maxZoom ?? 16,
          blossomServer,
        );

        const areaSqKm = calculateBBoxAreaSqKm({ west, south, east, north });

        return {
          content: [],
          structuredContent: {
            result: {
              ...extractResult,
              areaSqKm,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ Create map extract failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 15. Register Tool: Create Map Upload (Blossom)
  mcpServer.registerTool(
    "create_map_upload",
    {
      title: "Upload PMTiles to Blossom",
      description:
        "Upload the extracted PMTiles file to Blossom using a signed auth event. Call create_map_extract first to get the unsigned event.",
      inputSchema: createMapUploadInputSchema,
      outputSchema: createMapUploadOutputSchema,
    },
    async ({ requestId, signedEvent }) => {
      try {
        console.log(`📤 Create map upload: requestId=${requestId}`);

        const pending = getPendingExtraction(requestId);
        if (!pending) {
          throw new Error(
            `No pending extraction found for requestId: ${requestId}. It may have expired (10 min TTL).`,
          );
        }

        // Verify signed event matches expected hash
        const hashTag = signedEvent.tags.find((t) => t[0] === "x");
        if (!hashTag || hashTag[1] !== pending.sha256) {
          throw new Error(
            `Signed event hash mismatch. Expected: ${pending.sha256}, Got: ${hashTag?.[1] ?? "none"}`,
          );
        }

        // Upload to Blossom
        const uploadResult = await uploadToBlossomWithAuth(
          pending.blossomServer,
          pending.filePath,
          signedEvent,
        );

        // Cleanup
        await removePendingExtraction(requestId);

        return {
          content: [],
          structuredContent: {
            result: uploadResult,
          },
        };
      } catch (error: any) {
        console.error(`❌ Create map upload failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 16. Register Tool: Federated Web Search
  mcpServer.registerTool(
    "web_search",
    {
      title: "Federated Web Search",
      description:
        "Search Wikipedia, Wikidata, and Earthly's private SearXNG instance in parallel. Returns partial results with provider health when one source is unavailable.",
      inputSchema: webSearchInputSchema,
      outputSchema: webSearchOutputSchema,
    },
    async ({ query, limit, categories, language }, extra) => {
      try {
        console.log(`🔍 Web search: ${query}`);
        const result = await researchToolLimiter.run(
          requestClientPubkey(extra),
          () => webSearch(query, limit, categories, language),
        );
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Web search failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 17. Register Tool: Fetch URL (Readability)
  mcpServer.registerTool(
    "fetch_url",
    {
      title: "Fetch URL (Readability)",
      description:
        "Fetch a URL and extract readable text content using Mozilla Readability. Returns title, description, and cleaned article text.",
      inputSchema: fetchUrlInputSchema,
      outputSchema: fetchUrlOutputSchema,
    },
    async ({ url, maxLength }, extra) => {
      try {
        console.log(`🌐 Fetching URL: ${url}`);
        const result = await researchToolLimiter.run(
          requestClientPubkey(extra),
          () => fetchUrl(url, maxLength),
        );
        console.log(
          `📦 Fetched: ${result.title || url} (${result.textLength} chars)`,
        );
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Fetch URL failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 18. Register Tool: Wikipedia Lookup
  mcpServer.registerTool(
    "wikipedia_lookup",
    {
      title: "Wikipedia Lookup",
      description:
        "Search Wikipedia full text, look up an exact title, or find nearby articles by geographic coordinates. Returns article summaries and coordinates.",
      inputSchema: wikipediaLookupInputSchema,
      outputSchema: wikipediaLookupOutputSchema,
    },
    async ({ query, title, lat, lon, radius, limit, language }, extra) => {
      try {
        const mode = query
          ? `search: ${query}`
          : title
            ? `title: ${title}`
            : `geo: ${lat},${lon}`;
        console.log(`📚 Wikipedia lookup: ${mode}`);
        const result = await researchToolLimiter.run(
          requestClientPubkey(extra),
          () => wikipediaLookup({
            query,
            title,
            lat,
            lon,
            radius,
            limit,
            language,
          }),
        );
        console.log(`📦 Found ${result.count} articles`);
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Wikipedia lookup failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 19. Register Tool: Structured Wikipedia Extraction
  mcpServer.registerTool(
    "wikipedia_extract",
    {
      title: "Structured Wikipedia Extraction",
      description:
        "Inspect a Wikipedia article's sections and tables, then retrieve a bounded page of structured table rows. Table results include pagination.status: complete means the response contains the full table, more points to pagination.nextOffset, and final_page still omits earlier rows. Every response includes article, revision, section, table, and row provenance suitable for researched map datasets.",
      inputSchema: wikipediaExtractInputSchema,
      outputSchema: wikipediaExtractOutputSchema,
    },
    async ({ url, title, language, mode, tableIndex, rowOffset, rowLimit }, extra) => {
      try {
        console.log(`📑 Wikipedia extraction: ${url || title}`);
        const result = await researchToolLimiter.run(
          requestClientPubkey(extra),
          () => wikipediaExtract({ url, title, language, mode, tableIndex, rowOffset, rowLimit }),
        );
        console.log(`📦 Extracted ${result.tables.length} table outlines`);
        return { content: [], structuredContent: { result } };
      } catch (error: any) {
        console.error(`❌ Wikipedia extraction failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 20. Configure the Nostr Server Transport
  const serverTransport = new NostrServerTransport({
    signer,
    relayHandler: relayPool,
    isAnnouncedServer: true,
    injectClientPubkey: true,
    maxSessions: 1_000,
    // CEP-22 fragments large MCP responses after handlers return complete data.
    // Keep this explicit even though the SDK currently enables it by default.
    oversizedTransfer: { enabled: true },
    serverInfo: {
      name: "Earthly Geo Server",
      website: "https://earthly.city",
      about:
        "Fast self-hosted geography catalog, geocoding, OSM fallback queries, Valhalla routing, web search, URL fetching, and provenance-aware Wikipedia extraction.",
      picture: "https://openmaptiles.org/img/home-banner-map.png",
    },
  });

  // 6. Connect the server
  console.log("🔗 Connecting MCP server to Nostr transport...");
  await mcpServer.connect(serverTransport);

  console.log("✅ Server is running and listening for requests on Nostr");
  console.log("📋 Available tools:");
  console.log("   - query_geography");
  console.log("   - search_location");
  console.log("   - reverse_lookup");
  console.log("   - query_osm_by_id");
  console.log("   - query_osm_nearby");
  console.log("   - query_osm_bbox");
  console.log("   - resolve_osm_entity");
  console.log("   - get_osm_relation_geometry");
  console.log("   - get_country_boundary");
  console.log("   - valhalla_route");
  console.log("   - valhalla_isochrone");
  console.log("   - create_map_extract");
  console.log("   - create_map_upload");
  console.log("   - web_search");
  console.log("   - fetch_url");
  console.log("   - wikipedia_lookup");
  console.log("   - wikipedia_extract");
  console.log(`\n🔑 Client should use server pubkey: ${serverPubkey}`);
  console.log("💡 Press Ctrl+C to exit.\n");

  // Log when requests are received
  console.log("👂 Listening for tool requests...\n");
}

// Start the server
main().catch((error) => {
  console.error("❌ Failed to start metadata server:", error);
  process.exit(1);
});
