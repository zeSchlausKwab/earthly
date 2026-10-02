import type { Feature, FeatureCollection } from "geojson";
import { appendRouteCoordinates, routeInOrder, ROUTE_TIMEOUT_MS, ValhallaRequestError, type OrderedRouteResult, type ValhallaLocation, type ValhallaProfile } from "../../src/lib/geo/valhallaRoute";
import { serverConfig } from "../../src/config/env.server";

const DEFAULT_TIMEOUT_MS = 25_000;

function resolveValhallaBaseUrl(baseUrl?: string): string {
  const candidate = baseUrl?.trim() || serverConfig.valhallaUrl?.trim();
  if (!candidate) {
    throw new Error(
      "No Valhalla base URL configured. Set VALHALLA_URL in environment or pass baseUrl.",
    );
  }
  // Accept accidental endpoint URLs and normalize to a base URL.
  return candidate
    .replace(
      /\/(locate|route|isochrone|sources_to_targets|optimized_route|trace_route|trace_attributes|status|height|expansion|tile)\/?$/i,
      "",
    )
    .replace(/\/+$/, "");
}

async function postValhalla<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      let maxLocations: number | undefined;
      try {
        const failure = JSON.parse(text);
        if (failure.error_code === 150 && typeof failure.error === "string") {
          const match = failure.error.match(/Exceeded max locations:\s*(\d+)/i);
          if (match) maxLocations = Number(match[1]);
        }
      } catch { /* An HTML or malformed error never proves a waypoint limit. */ }
      throw new ValhallaRequestError(
        `Valhalla ${path} failed (${response.status}): ${text.slice(0, 200)}`, maxLocations,
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

type ValhallaRouteResponse = {
  trip?: {
    status?: number;
    units?: string;
    summary?: {
      length?: number;
      time?: number;
    };
    legs?: {
      shape?: unknown;
      summary?: {
        length?: number;
        time?: number;
      };
    }[];
  };
};

function asLineCoordinates(value: unknown): [number, number][] {
  if (typeof value === "string") {
    return decodePolyline(value, 6);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const geometry = value as { type?: unknown; coordinates?: unknown };
    if (geometry.type === "LineString") return asLineCoordinates(geometry.coordinates);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== "number" || typeof point[1] !== "number") throw new Error("Valhalla returned an invalid route vertex");
      const lon = point[0];
      const lat = point[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error("Valhalla returned an invalid route vertex");
      return [lon, lat] as [number, number];
    })
    .filter((point): point is [number, number] => Boolean(point));
}

function decodePolyline(
  encoded: string,
  precision = 6,
): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) throw new Error("Valhalla returned a truncated route polyline");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || shift > 30) throw new Error("Valhalla returned an invalid route polyline");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) throw new Error("Valhalla returned a truncated route polyline");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63 || shift > 30) throw new Error("Valhalla returned an invalid route polyline");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

export async function valhallaRoute(params: {
  locations: ValhallaLocation[];
  profile?: ValhallaProfile;
  units?: "kilometers" | "miles";
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<OrderedRouteResult> {
  const profile = params.profile ?? "auto";
  const units = params.units ?? "kilometers";
  const baseUrl = resolveValhallaBaseUrl(params.baseUrl);
  const deadline = AbortSignal.timeout(ROUTE_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  return routeInOrder({
    locations: params.locations,
    profile,
    backendCap: serverConfig.valhallaMaxLocations,
    signal,
    request: async (locations, requestSignal) => {
      const response = await postValhalla<ValhallaRouteResponse>(baseUrl, "/route", {
        locations, costing: profile, units, directions_options: { units },
        shape_format: "geojson", narrative: false,
      }, requestSignal);
      const legs = Array.isArray(response.trip?.legs) ? response.trip.legs : [];
      if (response.trip?.status !== 0 || legs.length !== locations.length - 1)
        throw new Error("Valhalla returned an unsuccessful route or missing waypoint legs");
      const coordinates: [number, number][] = [];
      for (const leg of legs) {
        if (!appendRouteCoordinates(coordinates, asLineCoordinates(leg.shape)))
          throw new Error("Valhalla returned missing or discontinuous leg geometry");
      }
      const summary = response.trip?.summary;
      if (typeof summary?.length !== "number" || typeof summary.time !== "number")
        throw new Error("Valhalla returned no route summary");
      return {
        coordinates,
        lengthKm: summary.length * ((response.trip?.units ?? units) === "miles" ? 1.609344 : 1),
        durationMin: summary.time / 60,
      };
    },
  });
}

type ValhallaIsochroneResponse = {
  features?: unknown[];
  type?: string;
};

export async function valhallaIsochrone(params: {
  location: ValhallaLocation;
  contoursMinutes?: number[];
  profile?: "auto" | "bicycle" | "pedestrian";
  polygons?: boolean;
  baseUrl?: string;
}): Promise<{
  featureCollection: FeatureCollection;
  count: number;
  profile: "auto" | "bicycle" | "pedestrian";
  contoursMinutes: number[];
}> {
  const profile = params.profile ?? "auto";
  const contoursMinutes = params.contoursMinutes?.length
    ? [...new Set(params.contoursMinutes)].sort((a, b) => a - b)
    : [10, 20, 30];
  const baseUrl = resolveValhallaBaseUrl(params.baseUrl);
  const polygons = params.polygons !== false;

  const payload = {
    locations: [params.location],
    costing: profile,
    contours: contoursMinutes.map((time) => ({ time })),
    polygons,
  };

  const response = await postValhalla<ValhallaIsochroneResponse>(
    baseUrl,
    "/isochrone",
    payload,
  );

  const features = Array.isArray(response.features)
    ? (response.features as Feature[])
    : [];

  return {
    featureCollection: {
      type: "FeatureCollection",
      features,
    },
    count: features.length,
    profile,
    contoursMinutes,
  };
}
