import { NDKEvent, type NDKKind, type NDKSubscription, type NostrEvent } from "@nostr-dev-kit/ndk"
import { nip19 } from "nostr-tools"
import { create } from "zustand"
import { approvalEventKind, featureEventKind, moderatedCommunityEventKind } from "~/config/constants"
import { vanillaClient } from "~/server/vanilla-client"
import { type CustomFeature, type FeatureReference } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"

export type RecentCollection = {
  naddr: `naddr${string}`
  title: string
  identifier: string
  published_at: string
  pubkey: string
  description: string
  headerImage: string
  featureNaddrs: string[]
  features: CustomFeature[]
}

let sub: NDKSubscription

export const useRecentCollectionsStore = create<{
  initRecentCollections: () => Promise<void>
  recentCollections: RecentCollection[]
}>()((set, get, store) => ({
  initRecentCollections: async () => {
    const ndkInstance = useNDKStore.getState().ndk
    if (sub) {
      sub.stop()
      set(() => {
        return {
          recentCollections: [],
        }
      })
    }
    if (!ndkInstance) {
      throw new Error("NDK not initialized")
    }

    sub = ndkInstance.subscribe({
      kinds: [moderatedCommunityEventKind],
      limit: 20,
    })

    sub.on("event", async (rootCollectionEvent: NDKEvent) => {
      const naddr = nip19.naddrEncode({
        pubkey: rootCollectionEvent.pubkey,
        kind: rootCollectionEvent.kind ?? moderatedCommunityEventKind,
        identifier: rootCollectionEvent.tagValue("d") ?? "",
      })

      console.log("rootCollectionEvent", rootCollectionEvent.kind)

      const featureEvents =
        rootCollectionEvent.kind === moderatedCommunityEventKind
          ? await ndkInstance.fetchEvents({
              kinds: [approvalEventKind],
              authors: [
                ...rootCollectionEvent
                  .getMatchingTags("p")
                  .map((tag) => tag[1])
                  .filter((author): author is string => author !== undefined),
              ],
              "#a": [`${featureEventKind}:${rootCollectionEvent.pubkey}:${rootCollectionEvent.tagValue("d")}`],
            })
          : await ndkInstance.fetchEvents({
              kinds: [featureEventKind],
              authors: [rootCollectionEvent.pubkey],
              "#a": [`${featureEventKind}:${rootCollectionEvent.pubkey}:${rootCollectionEvent.tagValue("d")}`],
            })

      const features = Array.from(featureEvents).map((ev) => {
        if (!ev) return
        const contentEvent = new NDKEvent(undefined, JSON.parse(ev.content) as NostrEvent)
        return JSON.parse(contentEvent.content) as CustomFeature
      })

      const featuresWithResolvedReferences = await Promise.all(
        features.map(async (feature) => {
          if (!feature) return
          if ((feature.type as "Feature" | "FeatureReference") === "FeatureReference") {
            const featureReference = feature as unknown as FeatureReference<Record<string, string>>
            const split = featureReference.category.split(":")
            const resolvedReference = await vanillaClient.curatedItems.getOneByName.query({
              category: `${split[0]}`,
              name: `${split[1]}`,
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
          const contentEvent = new NDKEvent(undefined, JSON.parse(ev.content) as NostrEvent)
          return nip19.naddrEncode({
            identifier: contentEvent.tagValue("d") ?? "",
            kind: contentEvent.kind ?? (4326 as NDKKind),
            pubkey: contentEvent.pubkey,
          })
        })
        .filter((e): e is `naddr1${string}` => e !== undefined)

      const validFeatures = featuresWithResolvedReferences.filter((e) => e !== undefined) as CustomFeature[]

      const existingCollection = get().recentCollections.find((collection) => collection.naddr === naddr)

      // console.log("validFeatures", validFeatures)

      if (existingCollection) {
        set((state) => {
          return {
            recentCollections: state.recentCollections.map((collection) => {
              if (collection.naddr === naddr) {
                return {
                  ...collection,
                  features: validFeatures,
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
            recentCollections: [
              ...state.recentCollections,
              {
                naddr,
                title: rootCollectionEvent.tagValue("title") ?? "",
                identifier: rootCollectionEvent.tagValue("d") ?? "",
                published_at: rootCollectionEvent.tagValue("published_at") ?? "",
                pubkey: rootCollectionEvent.pubkey,
                description: rootCollectionEvent.content,
                headerImage: rootCollectionEvent.tagValue("image") ?? "",
                featureNaddrs: featureIdentifiers,
                features: validFeatures,
              },
            ],
          }
        })
        return
      }
    })
    return
  },
  recentCollections: [],
}))
