import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"
import { nip19 } from "nostr-tools"
import { create } from "zustand"
import { mapGeometryCollectionFeature } from "~/mapper/geometry-feature"
import {
  CustomFeature,
  type CustomFeatureCollection,
} from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"

export type RecentCollection = {
  naddr: string
  title: string
  identifier: string
  published_at: string
  pubkey: string
  description: string
  headerImage: string
  featureNaddrs: string[]
  features: CustomFeatureCollection
}

export const useRecentCollectionsStore = create<{
  init: () => Promise<void>
  collections: RecentCollection[]
}>()((set, get, store) => ({
  init: async () => {
    const ndkInstance = useNDKStore.getState().ndk
    if (!ndkInstance) {
      throw new Error("NDK not initialized")
    }

    const sub = ndkInstance.subscribe({
      "#y": ["collection"],
      limit: 20,
    })

    sub.on("event", async (rootCollectionEvent: NDKEvent) => {
      const naddr = nip19.naddrEncode({
        pubkey: rootCollectionEvent.pubkey,
        kind: rootCollectionEvent.kind ?? NDKKind.Article,
        identifier: rootCollectionEvent.tagValue("d") ?? "",
      })

      const featureEvents = await ndkInstance.fetchEvents({
        kinds: [4550 as NDKKind],
        authors: [
          ...rootCollectionEvent
            .getMatchingTags("p")
            .map((tag) => tag[1])
            .filter((author): author is string => author !== undefined),
        ],
        "#a": [
          `34550:${rootCollectionEvent.pubkey}:${rootCollectionEvent.tagValue(
            "d",
          )}`,
        ],
      })

      const features = Array.from(featureEvents).map((ev) => {
        if (!ev) return
        const contentEvent = new NDKEvent(undefined, JSON.parse(ev.content))
        return mapGeometryCollectionFeature(contentEvent)
      })

      const featureIdentifiers: string[] = []

      featureEvents.forEach((fe) => {
        featureIdentifiers.push(
          nip19.naddrEncode({
            identifier: fe.tagValue("d") ?? "",
            kind: fe.kind ?? 30333,
            pubkey: fe.pubkey,
          }),
        )
      })

      const validFeatures = features.filter(
        (e) => e !== undefined,
      ) as CustomFeature[]

      const existingCollection = get().collections.find(
        (collection) => collection.naddr === naddr,
      )

      if (existingCollection) {
        set((state) => {
          return {
            collections: state.collections.map((collection) => {
              if (collection.naddr === naddr) {
                return {
                  ...collection,
                  features: {
                    type: "FeatureCollection",
                    features: validFeatures,
                  },
                }
              }
              return collection
            }),
          }
        })
        return
      } else {
        set((state) => {
          return {
            collections: [
              ...state.collections,
              {
                naddr,
                title: rootCollectionEvent.tagValue("title") ?? "",
                identifier: rootCollectionEvent.tagValue("d") ?? "",
                published_at:
                  rootCollectionEvent.tagValue("published_at") ?? "",
                pubkey: rootCollectionEvent.pubkey,
                description: rootCollectionEvent.content,
                headerImage: rootCollectionEvent.tagValue("image") ?? "",
                featureNaddrs: featureIdentifiers,
                features: {
                  type: "FeatureCollection",
                  features: validFeatures,
                },
              },
            ],
          }
        })
        return
      }
    })
    return
  },
  collections: [],
}))
