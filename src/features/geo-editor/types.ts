import type { FeatureCollection } from "geojson";
import type { GeoBlobReference } from "@/lib/ndk/NDKGeoEvent";

export type CollectionMeta = {
  name: string;
  description: string;
  color: string;
  customProperties: Record<string, string | number | boolean>;
};

export type EditorBlobReference = GeoBlobReference & {
  id: string;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  featureCount?: number;
  geometryTypes?: string[];
  previewCollection?: FeatureCollection;
};

export type GeoSearchResult = {
  placeId: number;
  displayName: string;
  coordinates: { lat: number; lon: number };
  boundingbox: [number, number, number, number] | null;
  [key: string]: any;
};
