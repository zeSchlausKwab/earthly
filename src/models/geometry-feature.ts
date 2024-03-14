import { z } from "zod"
import { type NDKKind } from "@nostr-dev-kit/ndk"
import { geoGeometrySchema } from "~/models/geo-geometry"

export const persistedFeatureEventContentSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.string(),
    coordinates: z.array(z.number()),
  }),
  properties: z.object({
    id: z.string(),
    color: z.string(),
    name: z.string(),
    description: z.string(),
  }),
})

export type PersistedFeatureEventContent = z.infer<typeof persistedFeatureEventContentSchema>

export const persistedGeometryFeatureSchema = z.object({
  kind: z.literal(4326 as NDKKind),
  pubkey: z.string().min(1),
  content: z.string(persistedFeatureEventContentSchema),
  created_at: z
    .number()
    .int()
    .default(Math.floor(Date.now() / 1000)),
  tags: z.tuple([
    z.tuple([z.literal("a"), z.string(), z.string()]),
    z.tuple([z.literal("d"), z.string().uuid()]),
    z.tuple([z.literal("published_at"), z.string()]),
    z.tuple([z.literal("y"), z.string()]),
  ]),
})
export type NostrGeometryFeature = z.infer<typeof persistedGeometryFeatureSchema>

export const runtimeGeometryFeatureSchema = z.object({
  kind: z.literal(4326 as NDKKind),
  pubkey: z.string().min(1),
  communityEventAuthorPubkey: z.string().min(1),
  motherEventIdentifier: z.string().min(1),
  description: z.string(),
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
})

export type RuntimeGeometryFeature = z.infer<typeof runtimeGeometryFeatureSchema>
