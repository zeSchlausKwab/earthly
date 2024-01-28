import { type NDKEvent } from "@nostr-dev-kit/ndk"
import {
  type NostrGeometryFeature,
  type PersistedFeatureEventContent,
  persistedGeometryFeatureSchema,
  type RuntimeGeometryFeature,
} from "~/models/geometry-feature"

export const runtimeGeometryFeatureToNostr = (
  runtimeFeature: RuntimeGeometryFeature,
) => {
  return persistedGeometryFeatureSchema.parse({
    kind: runtimeFeature.kind,
    pubkey: runtimeFeature.pubkey,
    content: JSON.stringify({
      type: "Feature",
      geometry: {
        type: runtimeFeature.type,
        coordinates: runtimeFeature.coordinates,
      },
      properties: {
        id: runtimeFeature.d,
        name: runtimeFeature.name,
        description: runtimeFeature.description,
        color: runtimeFeature.color,
      },
    } as PersistedFeatureEventContent),
    created_at: runtimeFeature.created_at,
    tags: [
      [
        "a",
        `34550:${runtimeFeature.communityEventAuthorPubkey}:${runtimeFeature.motherEventIdentifier}`,
        "wss://relay.earthly.land",
      ],
      ["d", runtimeFeature.d],
      ["published_at", runtimeFeature.published_at.toString()],
      ["y", "feature"],
    ],
  } as NostrGeometryFeature)
}

export const nostrGeometryFeatureToRuntime = (
  nostrFeature: NostrGeometryFeature,
) => {
  const event = nostrFeature as unknown as NDKEvent
  const content = event?.content as unknown as PersistedFeatureEventContent
  return {
    kind: nostrFeature.kind,
    pubkey: nostrFeature.pubkey,
    description: event.tagValue("description"),
    created_at: nostrFeature.created_at,
    d: event.tagValue("d") ?? "",
    published_at: new Date(event.tagValue("published_at") ?? "").getDate(),
    name: event.tagValue("name") ?? "",
    color: event.tagValue("color") ?? "",
    type: event.tagValue("type") ?? "",
    coordinates: content.geometry.coordinates,
    communityEventAuthorPubkey: event.tagValue("a")?.split(":")[1] ?? "",
    content: nostrFeature.content,
    motherEventIdentifier: event.tagValue("a")?.split(":")[2] ?? "",
  } as RuntimeGeometryFeature
}
