import { type NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"
import {
  type NostrCollection,
  persistedCollectionSchema,
  type RuntimeCollection,
  runtimeCollectionSchema,
} from "~/models/collection"
import { nip19 } from "nostr-tools"

export const mapFeatureEventsToIdentifiers = (
  newFeatureEvents: NDKEvent[],
): Array<["f", string]> => {
  return newFeatureEvents.map((event) => {
    const naddr = nip19.naddrEncode({
      pubkey: event.pubkey,
      kind: event.kind ?? NDKKind.Article,
      identifier: event.tagValue("d") ?? "",
    })

    return ["f", naddr]
  })
}

export const runtimeCollectionToNostr = (
  runtimeCollection: RuntimeCollection,
) => {
  return persistedCollectionSchema.parse({
    kind: runtimeCollection.kind,
    pubkey: runtimeCollection.pubkey,
    content: runtimeCollection.content,
    created_at: runtimeCollection.created_at,
    tags: [
      ["d", runtimeCollection.d],
      ["title", runtimeCollection.title],
      ["image", runtimeCollection.image],
      ["published_at", runtimeCollection.published_at.toString()],
      // ["g", runtimeCollection.geohash],
      ["y", "collection"],
      ...runtimeCollection.features,
    ],
  } as NostrCollection)
}

export const nostrCollectionToRuntime = (nostrCollection: NostrCollection) => {
  const event = nostrCollection as unknown as NDKEvent
  return runtimeCollectionSchema.parse({
    kind: nostrCollection.kind,
    pubkey: nostrCollection.pubkey,
    content: nostrCollection.content,
    created_at: nostrCollection.created_at,
    d: event.tagValue("d") ?? "",
    title: event.tagValue("title") ?? "",
    image: event.tagValue("image") ?? "",
    published_at: new Date(event.tagValue("published_at") ?? "").getDate(),
    features: [event.getMatchingTags("f")],
  } as RuntimeCollection)
}
