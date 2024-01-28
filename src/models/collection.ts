import { z } from "zod"
import { NDKKind } from "@nostr-dev-kit/ndk"

export const editCollectionFormSchema = z.object({
  storyTitle: z.string().min(3, {
    message: "The story has to have a title.",
  }),
  storyDescription: z.string().min(3, {
    message: "Give a short description of your story.",
  }),
})
export type EditingCollectionFormSchema = z.infer<
  typeof editCollectionFormSchema
>

export const updateCollectionFormSchema = z.object({
  naddr: z.string().min(1),
  storyTitle: z.string().min(3, {
    message: "The story has to have a title.",
  }),
  storyDescription: z.string().min(3, {
    message: "Give a short description of your story.",
  }),
})
export type UpdateCollectionFormSchema = z.infer<
  typeof updateCollectionFormSchema
>

export const persistedCollectionSchema = z.object({
  kind: z.literal(34550 as NDKKind),
  pubkey: z.string().min(1),
  content: z.string(),
  created_at: z
    .number()
    .int()
    .default(Math.floor(Date.now() / 1000)),
  tags: z
    .tuple([
      z.tuple([z.literal("d"), z.string().uuid()]),
      z.tuple([z.literal("title"), z.string()]),
      z.tuple([z.literal("description"), z.string()]),
      z.tuple([z.literal("image"), z.string()]),
      z.tuple([z.literal("published_at"), z.string()]),
      // z.tuple([z.literal("g"), z.string()]),
      z.tuple([z.literal("y"), z.literal("collection")]),
      z.tuple([z.literal("relay"), z.string(), z.literal("author")]),
      z.tuple([z.literal("relay"), z.string(), z.literal("requests")]),
      z.tuple([z.literal("relay"), z.string(), z.literal("approvals")]),
    ])
    .rest(z.tuple([z.literal("p"), z.string(), z.literal("moderator")])),
})
export type NostrCollection = z.infer<typeof persistedCollectionSchema>

export const runtimeCollectionSchema = z.object({
  kind: z.literal(34550 as NDKKind),
  pubkey: z.string().min(1),
  content: z.string(),
  created_at: z
    .number()
    .int()
    .default(Math.floor(Date.now() / 1000)),
  identifier: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  image: z.string(),
  published_at: z.number(),
  authorRelay: z.string(),
  requestsRelay: z.string(),
  approvalsRelay: z.string(),
  moderatorPubKeys: z.array(z.string()),
  // features: z.array(z.unknown()),
  // geohash: z.string(),
})

export type RuntimeCollection = z.infer<typeof runtimeCollectionSchema>
