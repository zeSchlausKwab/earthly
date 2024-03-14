import { type NDKEvent, type NDKSubscription } from "@nostr-dev-kit/ndk"
import { nip19 } from "nostr-tools"
import { create } from "zustand"
import { featureEventKind } from "~/config/constants"
import { type CustomFeature } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"

export type RecentFeature = {
  naddr: string
  title: string
  identifier: string
  published_at: string
  pubkey: string
  description: string
  headerImage: string
  features: CustomFeature[]
}

let sub: NDKSubscription

export const useRecentFeaturesStore = create<{
  initRecentFeatures: () => Promise<void>
  recentFeatures: RecentFeature[]
}>()((set) => ({
  initRecentFeatures: async () => {
    const ndkInstance = useNDKStore.getState().ndk
    if (sub) {
      sub.stop()
      set(() => {
        return {
          recentFeatures: [],
        }
      })
    }
    if (!ndkInstance) {
      throw new Error("NDK not initialized")
    }

    sub = ndkInstance.subscribe({
      kinds: [featureEventKind],
      limit: 20,
    })

    sub.on("event", async (event: NDKEvent) => {
      const naddr = nip19.naddrEncode({
        pubkey: event.pubkey,
        kind: event.kind ?? featureEventKind,
        identifier: event.tagValue("d") ?? "",
      })

      const eventFeature = JSON.parse(event.content) as unknown as CustomFeature

      const featureIsPoint = eventFeature.geometry.type === "Point" && eventFeature.geometry.coordinates.length === 2

      if (!featureIsPoint) return

      const eventFeatureProps = eventFeature.properties

      set((state) => {
        return {
          recentFeatures: [
            ...state.recentFeatures,
            {
              naddr,
              title: eventFeatureProps?.name ?? "",
              identifier: event.tagValue("d") ?? "",
              published_at: event.tagValue("published_at") ?? event.created_at?.toString() ?? "",
              pubkey: event.pubkey,
              description: eventFeatureProps?.description ?? "",
              headerImage: event.tagValue("image") ?? "",
              featureNaddrs: [naddr],
              features: [eventFeature],
            },
          ],
        }
      })
    })
    return
  },
  recentFeatures: [],
}))
