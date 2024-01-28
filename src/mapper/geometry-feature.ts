import { type NDKEvent } from "@nostr-dev-kit/ndk"
import {
  type NostrGeometryFeature,
  persistedGeometryFeatureSchema,
  type RuntimeGeometryFeature,
} from "~/models/geometry-feature"
import { type GeoJsonGeometryTypes } from "geojson"

export const runtimeGeometryFeatureToNostr = (
  runtimeFeature: RuntimeGeometryFeature,
) => {
  return persistedGeometryFeatureSchema.parse({
    kind: runtimeFeature.kind,
    pubkey: runtimeFeature.pubkey,
    content: runtimeFeature.content,
    created_at: runtimeFeature.created_at,
    tags: [
      [
        "a",
        `34550:${runtimeFeature.communityEventAuthorPubkey}:${runtimeFeature.motherEventIdentifier}`,
        "wss://relay.earthly.land",
      ],
      ["d", runtimeFeature.d],
      ["published_at", runtimeFeature.published_at.toString()],
      ["name", runtimeFeature.name],
      ["color", runtimeFeature.color],
      ["type", runtimeFeature.type],
      ["coordinates", JSON.stringify(runtimeFeature.coordinates)],
      // ["g", runtimeFeature.geohash],
      ["y", "feature"],
    ],
  } as NostrGeometryFeature)
}

export const getProperties = (event: NDKEvent) => {
  return {
    id: event?.tagValue("d") ?? "",
    description: event?.content,
    color: event?.tagValue("color") ?? "#000000",
    name: event?.tagValue("name") ?? "",
  }
}

function getCoordinates(event: NDKEvent) {
  return JSON.parse(event?.tagValue("coordinates") ?? "[]") as number[][]
}

export const mapGeometryCollectionFeature = (event: NDKEvent) => {
  const geometryType = event?.tagValue("type") as GeoJsonGeometryTypes

  return {
    Point: {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    MultiPoint: {
      type: "Feature",
      geometry: {
        type: "MultiPoint",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    LineString: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    MultiLineString: {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    Polygon: {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    MultiPolygon: {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: getCoordinates(event),
      },
      properties: getProperties(event),
    },
    GeometryCollection: {
      type: "Feature",
      geometry: {
        type: "GeometryCollection",
        geometries: getCoordinates(event),
      },
      properties: getProperties(event),
    },
  }[geometryType]
}

export const nostrGeometryFeatureToRuntime = (
  nostrFeature: NostrGeometryFeature,
) => {
  const event = nostrFeature as unknown as NDKEvent
  return {
    kind: nostrFeature.kind,
    pubkey: nostrFeature.pubkey,
    content: nostrFeature.content,
    created_at: nostrFeature.created_at,
    d: event.tagValue("d") ?? "",
    published_at: new Date(event.tagValue("published_at") ?? "").getDate(),
    name: event.tagValue("name") ?? "",
    color: event.tagValue("color") ?? "",
    type: event.tagValue("type") ?? "",
    coordinates: JSON.parse(event?.tagValue("coordinates") ?? "[]"),
  } as RuntimeGeometryFeature
}
