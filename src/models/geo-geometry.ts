import { z } from "zod"

export const geoGeometrySchema = z.union([
  z.literal("Point"),
  z.literal("MultiPoint"),
  z.literal("LineString"),
  z.literal("MultiLineString"),
  z.literal("Polygon"),
  z.literal("MultiPolygon"),
  z.literal("GeometryCollection"),
])
