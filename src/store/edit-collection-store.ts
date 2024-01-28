import { create } from "zustand"
import { type Feature, type FeatureCollection, type Geometry } from "geojson"
import { useNDKStore } from "~/store/ndk-store"
import { mapGeometryCollectionFeature } from "~/mapper/geometry-feature"
import { decodeNaddr } from "~/utils/naddr"
import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"

export interface FeatureProperties {
  id: string
  name: string
  description: string
  color: string
  approved: boolean
}

export type CustomFeature = Feature<Geometry, FeatureProperties>
export type CustomFeatureCollection = FeatureCollection<
  Geometry,
  FeatureProperties
>

export const useEditingCollectionStore = create<{
  naddr: string | undefined
  geometryCollection: CustomFeatureCollection
  reset: () => void
  setGeometry: (geometry: CustomFeatureCollection) => void
  addFeature: (feature: CustomFeature) => void
  setGeometryFromNostr: (
    eventId: string,
    withUnapproved?: boolean,
  ) => Promise<void>
}>()((set, get, store) => ({
  naddr: undefined,
  geometryCollection: {
    type: "FeatureCollection",
    features: [],
  },
  reset: () => {
    set({
      naddr: undefined,
      geometryCollection: {
        type: "FeatureCollection",
        features: [],
      },
    })
  },
  setGeometry: (geometry) => {
    set({ geometryCollection: geometry })
  },
  addFeature: (feature) => {
    set((state) => ({
      geometryCollection: {
        ...state.geometryCollection,
        features: [...state.geometryCollection.features, feature],
      },
    }))
  },
  setGeometryFromNostr: async (naddr: string, withUnapproved = false) => {
    const ndkInstance = useNDKStore.getState().ndk
    if (!ndkInstance) {
      throw new Error("NDK not initialized")
    }

    const collectionNaddrData = decodeNaddr(naddr)

    const collectionEvent = await ndkInstance.fetchEvent({
      kinds: [collectionNaddrData.kind],
      // authors: [collectionNaddrData.pubkey],
      "#d": [collectionNaddrData.identifier],
    })

    console.log(collectionEvent)

    if (!collectionEvent) {
      throw new Error("Event not found")
    }

    const validGeometryCollection = []

    if (withUnapproved) {
      const geometryCollection = await ndkInstance.fetchEvents({
        kinds: [30333 as NDKKind],
        "#a": [
          `34550:${collectionEvent.pubkey}:${collectionEvent.tagValue("d")}`,
        ],
      })

      geometryCollection.forEach((ev) => {
        if (!ev) return
        validGeometryCollection.push(mapGeometryCollectionFeature(ev))
      })
    } else {
      const geometryCollection = await ndkInstance.fetchEvents({
        kinds: [4550 as NDKKind],
        "#a": [
          `34550:${collectionEvent.pubkey}:${collectionEvent.tagValue("d")}`,
        ],
      })

      geometryCollection.forEach((ev) => {
        if (!ev) return
        const contentEvent = new NDKEvent(undefined, JSON.parse(ev.content))
        validGeometryCollection.push(mapGeometryCollectionFeature(contentEvent))
      })
    }

    set({
      naddr: naddr,
      geometryCollection: {
        type: "FeatureCollection",
        features: validGeometryCollection as CustomFeature[],
      },
    })
  },
}))
