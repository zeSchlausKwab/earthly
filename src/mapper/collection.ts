import { type NDKEvent } from "@nostr-dev-kit/ndk"
import {
  type NostrCollection,
  persistedCollectionSchema,
  type RuntimeCollection,
  runtimeCollectionSchema,
} from "~/models/collection"

export const runtimeCollectionToNostr = (runtimeCollection: RuntimeCollection) => {
  return persistedCollectionSchema.parse({
    kind: runtimeCollection.kind,
    pubkey: runtimeCollection.pubkey,
    content: runtimeCollection.content,
    created_at: runtimeCollection.created_at,
    tags: [
      ["d", runtimeCollection.identifier],
      ["title", runtimeCollection.title],
      ["description", runtimeCollection.description],
      ["image", runtimeCollection.image],
      ["published_at", runtimeCollection.published_at.toString()],
      // ["g", runtimeCollection.geohash],
      ["y", "collection"],
      ["relay", runtimeCollection.authorRelay, "author"],
      ["relay", runtimeCollection.requestsRelay, "requests"],
      ["relay", runtimeCollection.approvalsRelay, "approvals"],
      ...runtimeCollection.moderatorPubKeys.map((pubkey) => ["p", pubkey, "moderator"]),
    ],
  } as NostrCollection)
}

export const nostrCollectionToRuntime = (nostrCollection: NostrCollection) => {
  const event = nostrCollection as unknown as NDKEvent
  const relayTags = event.getMatchingTags("relay")
  const authorRelay = relayTags.find((tag) => tag[2] === "author")?.[1] ?? ""
  const requestsRelay = relayTags.find((tag) => tag[2] === "requests")?.[1] ?? ""
  const approvalsRelay = relayTags.find((tag) => tag[2] === "approvals")?.[1] ?? ""

  return runtimeCollectionSchema.parse({
    kind: nostrCollection.kind,
    pubkey: nostrCollection.pubkey,
    content: nostrCollection.content,
    created_at: nostrCollection.created_at,
    identifier: event.tagValue("d") ?? "",
    title: event.tagValue("title") ?? "",
    description: event.tagValue("description") ?? "",
    image: event.tagValue("image") ?? "",
    published_at: new Date(event.tagValue("published_at") ?? "").getDate(),
    authorRelay: authorRelay,
    requestsRelay: requestsRelay,
    approvalsRelay: approvalsRelay,
    moderatorPubKeys: event.getMatchingTags("p").map((pubkey) => pubkey[1]),
  } as RuntimeCollection)
}
