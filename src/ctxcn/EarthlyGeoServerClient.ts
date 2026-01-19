import { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  NostrClientTransport,
  type NostrTransportOptions,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";

export interface SearchLocationInput {
  /**
   * The location query (e.g., "New York City")
   */
  query: string;
  /**
   * Maximum number of results (default: 10, max: 50)
   */
  limit?: number;
}

export interface SearchLocationOutput {
  result: {
    query: string;
    count: number;
    results: {
      placeId: number;
      displayName: string;
      coordinates: {
        lat: number;
        lon: number;
      };
      /**
       * Bounding box in [west, south, east, north] order
       */
      boundingbox: [number, number, number, number] | null;
      type: string;
      class: string;
      importance?: number;
      address?: {
        [k: string]: string;
      };
      geojson?: unknown;
    }[];
  };
}

export interface ReverseLookupInput {
  /**
   * Latitude coordinate in WGS84
   */
  lat: number;
  /**
   * Longitude coordinate in WGS84
   */
  lon: number;
  /**
   * Level of detail required (0-18, default 18)
   */
  zoom?: number;
}

export interface ReverseLookupOutput {
  result: {
    coordinates: {
      lat: number;
      lon: number;
    };
    zoom: number;
    result: {
      placeId: number;
      displayName: string;
      coordinates: {
        lat: number;
        lon: number;
      };
      /**
       * Bounding box in [west, south, east, north] order
       */
      boundingbox: [number, number, number, number] | null;
      type: string;
      class: string;
      importance?: number;
      address?: {
        [k: string]: string;
      };
      geojson?: unknown;
    } | null;
  };
}

export interface QueryOsmByIdInput {
  /**
   * OSM element type
   */
  osmType: "node" | "way" | "relation";
  /**
   * OSM element ID
   */
  osmId: number;
}

export interface QueryOsmByIdOutput {
  result: {
    feature?: unknown;
    osmType: "node" | "way" | "relation";
    osmId: number;
  };
}

export interface QueryOsmNearbyInput {
  /**
   * Latitude coordinate
   */
  lat: number;
  /**
   * Longitude coordinate
   */
  lon: number;
  /**
   * Search radius in meters (1-5000)
   */
  radius?: number;
  /**
   * OSM tag filters
   */
  filters?: {
    [k: string]: string;
  };
  /**
   * Maximum results to return
   */
  limit?: number;
}

export interface QueryOsmNearbyOutput {
  result: {
    /**
     * Array of GeoJSON Features
     */
    features: unknown[];
    /**
     * Number of features returned
     */
    count: number;
  };
}

export interface QueryOsmBboxInput {
  /**
   * Western longitude
   */
  west: number;
  /**
   * Southern latitude
   */
  south: number;
  /**
   * Eastern longitude
   */
  east: number;
  /**
   * Northern latitude
   */
  north: number;
  /**
   * OSM tag filters
   */
  filters?: {
    [k: string]: string;
  };
  /**
   * Maximum results to return
   */
  limit?: number;
}

export interface QueryOsmBboxOutput {
  result: {
    /**
     * Array of GeoJSON Features
     */
    features: unknown[];
    /**
     * Number of features returned
     */
    count: number;
  };
}

export interface CreateMapExtractInput {
  /**
   * Western longitude of bounding box
   */
  west: number;
  /**
   * Southern latitude of bounding box
   */
  south: number;
  /**
   * Eastern longitude of bounding box
   */
  east: number;
  /**
   * Northern latitude of bounding box
   */
  north: number;
  /**
   * Maximum zoom level (0-16, default 14)
   */
  maxZoom?: number;
  /**
   * Blossom server URL for upload
   */
  blossomServer: string;
}

export interface CreateMapExtractOutput {
  result: {
    /**
     * Unique ID to reference this extraction
     */
    requestId: string;
    /**
     * SHA-256 hash of the extracted PMTiles file
     */
    sha256: string;
    /**
     * Size of the extracted file in bytes
     */
    fileSizeBytes: number;
    /**
     * Area of the bounding box in square kilometers
     */
    areaSqKm: number;
    /**
     * Unsigned Blossom auth event (kind 24242) for client to sign
     */
    unsignedEvent: {
      kind: number;
      created_at: number;
      tags: string[][];
      content: string;
    };
  };
}

export interface CreateMapUploadInput {
  /**
   * Request ID from create_map_extract
   */
  requestId: string;
  /**
   * Signed Blossom auth event from client
   */
  signedEvent: {
    id: string;
    pubkey: string;
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
    sig: string;
  };
}

export interface CreateMapUploadOutput {
  result: {
    /**
     * URL of the uploaded PMTiles file
     */
    blobUrl: string;
    /**
     * SHA-256 hash of the uploaded file
     */
    sha256: string;
  };
}

export type EarthlyGeoServer = {
  SearchLocation: (query: string, limit?: number) => Promise<SearchLocationOutput>;
  ReverseLookup: (lat: number, lon: number, zoom?: number) => Promise<ReverseLookupOutput>;
  QueryOsmById: (osmType: string, osmId: number) => Promise<QueryOsmByIdOutput>;
  QueryOsmNearby: (lat: number, lon: number, radius?: number, filters?: object, limit?: number) => Promise<QueryOsmNearbyOutput>;
  QueryOsmBbox: (west: number, south: number, east: number, north: number, filters?: object, limit?: number) => Promise<QueryOsmBboxOutput>;
  CreateMapExtract: (west: number, south: number, east: number, north: number, maxZoom?: number, blossomServer: string) => Promise<CreateMapExtractOutput>;
  CreateMapUpload: (requestId: string, signedEvent: object) => Promise<CreateMapUploadOutput>;
};

export class EarthlyGeoServerClient implements EarthlyGeoServer {
  static readonly SERVER_PUBKEY = "ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc";
  static readonly DEFAULT_RELAYS = typeof window !== 'undefined' && window.location.hostname === 'localhost' 
    ? ["wss://relay.wavefunc.live", "ws://localhost:3334"]
    : ["wss://relay.wavefunc.live"];
  private client: Client;
  private transport: Transport;

  constructor(
    options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {}
  ) {
    this.client = new Client({
      name: "EarthlyGeoServerClient",
      version: "1.0.0",
    });

    // Private key precedence: constructor options > config file
    const resolvedPrivateKey = options.privateKey ||
      "";

    // Use options.signer if provided, otherwise create from resolved private key
    const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey);
    // Use options.relays if provided, otherwise use class DEFAULT_RELAYS
    const relays = options.relays || EarthlyGeoServerClient.DEFAULT_RELAYS;
    // Use options.relayHandler if provided, otherwise create from relays
    const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays);
    const serverPubkey = options.serverPubkey;
    const { privateKey: _, ...rest } = options;

    this.transport = new NostrClientTransport({
      serverPubkey: serverPubkey || EarthlyGeoServerClient.SERVER_PUBKEY,
      signer,
      relayHandler,
      isStateless: true,
      ...rest,
    });

    // Auto-connect in constructor
    this.client.connect(this.transport).catch((error) => {
      console.error(`Failed to connect to server: ${error}`);
    });
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
  }

  private async call<T = unknown>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const result = await this.client.callTool({
      name,
      arguments: { ...args },
    });
    return result.structuredContent as T;
  }

    /**
   * Search for locations using OpenStreetMap Nominatim API. Returns coordinates, bounding boxes, and geojson outlines.
   * @param {string} query The location query (e.g., "New York City")
   * @param {number} limit [optional] Maximum number of results (default: 10, max: 50)
   * @returns {Promise<SearchLocationOutput>} The result of the search_location operation
   */
  async SearchLocation(
    query: string, limit?: number
  ): Promise<SearchLocationOutput> {
    return this.call("search_location", { query, limit });
  }

    /**
   * Reverse geocode coordinates using OpenStreetMap Nominatim API. Returns address information for a point.
   * @param {number} lat Latitude coordinate in WGS84
   * @param {number} lon Longitude coordinate in WGS84
   * @param {number} zoom [optional] Level of detail required (0-18, default 18)
   * @returns {Promise<ReverseLookupOutput>} The result of the reverse_lookup operation
   */
  async ReverseLookup(
    lat: number, lon: number, zoom?: number
  ): Promise<ReverseLookupOutput> {
    return this.call("reverse_lookup", { lat, lon, zoom });
  }

    /**
   * Query a single OpenStreetMap element by type and ID. Returns full geometry as GeoJSON.
   * @param {string} osmType OSM element type
   * @param {number} osmId OSM element ID
   * @returns {Promise<QueryOsmByIdOutput>} The result of the query_osm_by_id operation
   */
  async QueryOsmById(
    osmType: string, osmId: number
  ): Promise<QueryOsmByIdOutput> {
    return this.call("query_osm_by_id", { osmType, osmId });
  }

    /**
   * Query OpenStreetMap elements near a point. Supports filtering by OSM tags. Returns GeoJSON features.
   * @param {number} lat Latitude coordinate
   * @param {number} lon Longitude coordinate
   * @param {number} radius [optional] Search radius in meters (1-5000)
   * @param {object} filters [optional] OSM tag filters
   * @param {number} limit [optional] Maximum results to return
   * @returns {Promise<QueryOsmNearbyOutput>} The result of the query_osm_nearby operation
   */
  async QueryOsmNearby(
    lat: number, lon: number, radius?: number, filters?: object, limit?: number
  ): Promise<QueryOsmNearbyOutput> {
    return this.call("query_osm_nearby", { lat, lon, radius, filters, limit });
  }

    /**
   * Query OpenStreetMap elements within a bounding box. Supports filtering by OSM tags. Returns GeoJSON features.
   * @param {number} west Western longitude
   * @param {number} south Southern latitude
   * @param {number} east Eastern longitude
   * @param {number} north Northern latitude
   * @param {object} filters [optional] OSM tag filters
   * @param {number} limit [optional] Maximum results to return
   * @returns {Promise<QueryOsmBboxOutput>} The result of the query_osm_bbox operation
   */
  async QueryOsmBbox(
    west: number, south: number, east: number, north: number, filters?: object, limit?: number
  ): Promise<QueryOsmBboxOutput> {
    return this.call("query_osm_bbox", { west, south, east, north, filters, limit });
  }

    /**
   * Extract a PMTiles map excerpt for a bounding box. Returns an unsigned Blossom auth event for the client to sign, then call create_map_upload with the signed event.
   * @param {number} west Western longitude of bounding box
   * @param {number} south Southern latitude of bounding box
   * @param {number} east Eastern longitude of bounding box
   * @param {number} north Northern latitude of bounding box
   * @param {number} maxZoom [optional] Maximum zoom level (0-16, default 14)
   * @param {string} blossomServer Blossom server URL for upload
   * @returns {Promise<CreateMapExtractOutput>} The result of the create_map_extract operation
   */
  async CreateMapExtract(
    west: number, south: number, east: number, north: number, maxZoom?: number, blossomServer: string
  ): Promise<CreateMapExtractOutput> {
    return this.call("create_map_extract", { west, south, east, north, maxZoom, blossomServer });
  }

    /**
   * Upload the extracted PMTiles file to Blossom using a signed auth event. Call create_map_extract first to get the unsigned event.
   * @param {string} requestId Request ID from create_map_extract
   * @param {object} signedEvent Signed Blossom auth event from client
   * @returns {Promise<CreateMapUploadOutput>} The result of the create_map_upload operation
   */
  async CreateMapUpload(
    requestId: string, signedEvent: object
  ): Promise<CreateMapUploadOutput> {
    return this.call("create_map_upload", { requestId, signedEvent });
  }
}
