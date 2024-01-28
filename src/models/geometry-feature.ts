import { z } from "zod"
import { type NDKKind } from "@nostr-dev-kit/ndk"
import { geoGeometrySchema } from "~/models/geo-geometry"

export const persistedGeometryFeatureSchema = z.object({
  kind: z.literal(30333 as NDKKind),
  pubkey: z.string().min(1),
  content: z.string(),
  created_at: z
    .number()
    .int()
    .default(Math.floor(Date.now() / 1000)),
  tags: z.tuple([
    z.tuple([z.literal("d"), z.string().uuid()]),
    z.tuple([z.literal("published_at"), z.string()]),
    z.tuple([z.literal("name"), z.string()]),
    z.tuple([z.literal("color"), z.string()]),
    z.tuple([z.literal("type"), geoGeometrySchema]),
    z.tuple([z.literal("coordinates"), z.string()]),
    // z.tuple([z.literal("g"), z.string()]),
    z.tuple([z.literal("y"), z.string()]),
  ]),
})
export type NostrGeometryFeature = z.infer<
  typeof persistedGeometryFeatureSchema
>

export const runtimeGeometryFeatureSchema = z.object({
  kind: z.literal(30333 as NDKKind),
  pubkey: z.string().min(1),
  content: z.string(),
  created_at: z
    .number()
    .int()
    .default(Math.floor(Date.now() / 1000)),
  d: z.string().uuid(),
  published_at: z.number(),
  name: z.string(),
  color: z.string(),
  type: geoGeometrySchema,
  coordinates: z.array(z.number()),
  // geohash: z.string(),
})

export type RuntimeGeometryFeature = z.infer<
  typeof runtimeGeometryFeatureSchema
>
