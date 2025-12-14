import { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  NostrClientTransport,
  type NostrTransportOptions,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";
import { config } from "../config";

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

export type EarthlyGeoServer = {
  SearchLocation: (
    query: string,
    limit?: number
  ) => Promise<SearchLocationOutput>;
  ReverseLookup: (
    lat: number,
    lon: number,
    zoom?: number
  ) => Promise<ReverseLookupOutput>;
};

export class EarthlyGeoServerClient implements EarthlyGeoServer {
  /** Server pubkey from config (or override via constructor) */
  static get SERVER_PUBKEY(): string {
    return config.serverPubkey;
  }

  static getDefaultRelays(): string[] {
    return [config.relayUrl];
  }
  private client: Client;
  private transport: Transport;

  constructor(
    options: Partial<NostrTransportOptions> & {
      privateKey?: string;
      relays?: string[];
    } = {}
  ) {
    this.client = new Client({
      name: "EarthlyGeoServerClient",
      version: "1.0.0",
    });

    // Private key precedence: constructor options > config
    const resolvedPrivateKey = options.privateKey || config.clientKey;

    const {
      privateKey: _,
      relays = EarthlyGeoServerClient.getDefaultRelays(),
      signer = new PrivateKeySigner(resolvedPrivateKey),
      relayHandler = new ApplesauceRelayPool(relays),
      serverPubkey,
      ...rest
    } = options;

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
    query: string,
    limit?: number
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
    lat: number,
    lon: number,
    zoom?: number
  ): Promise<ReverseLookupOutput> {
    return this.call("reverse_lookup", { lat, lon, zoom });
  }
}

/**
 * Default singleton instance of EarthlyGeoServerClient.
 * This instance uses the default configuration and can be used directly
 * without creating a new instance.
 *
 * @example
 * import { earthlyGeoServer } from './EarthlyGeoServerClient';
 * const result = await earthlyGeoServer.SomeMethod();
 */
export const earthlyGeoServer = new EarthlyGeoServerClient();
