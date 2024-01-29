import { NDKEvent, NDKKind, NostrEvent } from "@nostr-dev-kit/ndk"
import { nip19 } from "nostr-tools"
import { create } from "zustand"
import { vanillaClient } from "~/server/vanilla-client"
import {
  type CustomFeature,
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
        kind: rootCollectionEvent.kind ?? (34550 as NDKKind),
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
        const contentEvent = new NDKEvent(
          undefined,
          JSON.parse(ev.content) as NostrEvent,
        )
        return JSON.parse(contentEvent.content) as CustomFeature
      })

      const featuresWithResolvedReferences = await Promise.all(
        features.map(async (feature) => {
          if (!feature) return
          if (
            (feature.type as "Feature" | "FeatureReference") ===
            "FeatureReference"
          ) {
            const resolvedReference =
              await vanillaClient.curatedItems.getOne.query({
                id: (feature.id as string) ?? "",
              })
            if (!resolvedReference) return
            return {
              type: "Feature",
              geometry: resolvedReference.geometry,
              properties: {
                ...resolvedReference,
                id: resolvedReference.id,
                name: resolvedReference.name,
                noteId: resolvedReference.id,
              },
            }
          } else {
            return feature
          }
        }),
      )

      const featureIdentifiers = Array.from(featureEvents)
        .map((ev) => {
          if (!ev) return
          const contentEvent = new NDKEvent(
            undefined,
            JSON.parse(ev.content) as NostrEvent,
          )
          return nip19.naddrEncode({
            identifier: contentEvent.tagValue("d") ?? "",
            kind: contentEvent.kind ?? (4326 as NDKKind),
            pubkey: contentEvent.pubkey,
          })
        })
        .filter((e): e is `naddr1${string}` => e !== undefined)

      const validFeatures = featuresWithResolvedReferences.filter(
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
