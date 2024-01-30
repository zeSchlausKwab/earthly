import { NDKEvent, type NDKKind, type NostrEvent } from "@nostr-dev-kit/ndk"
import { CuratedFeature } from "@prisma/client"
import type { GeometryCollection } from "geojson"
import { type Feature, type FeatureCollection, type Geometry } from "geojson"
import { create } from "zustand"
import { vanillaClient } from "~/server/vanilla-client"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"

export type FeatureProperties = {
  id: string
  noteId?: string
  name: string
  description: string
  color: string
  approved?: boolean
  isLink?: boolean
}

export type FeatureReference<P> = {
  type: "FeatureReference"
  category: `${string}:${string}`
  id: string
  properties: P
}
export type NostrableGeometry = Exclude<Geometry, GeometryCollection>
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
  addCuratedFeature: (curatedFeature: CuratedFeature) => void
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
  addCuratedFeature: (feature) => {
    const innerFeature = feature.geometry as FeatureReference<
      Record<string, string>
    >
    const beFeature = {
      type: "Feature",
      geometry: innerFeature as unknown as Geometry,
      properties: {
        id: feature.id,
        color:
          "#" +
          Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, "0"),

        name: feature.name,
        description: feature.isoA3,
        isLink: true,
      },
    } as CustomFeature

    console.log(beFeature)

    set((state) => ({
      geometryCollection: {
        ...state.geometryCollection,
        features: [...state.geometryCollection.features, beFeature],
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

    if (!collectionEvent) {
      throw new Error("Event not found")
    }

    const validGeometryCollection: CustomFeature[] = []

    if (withUnapproved) {
      const geometryCollection = await ndkInstance.fetchEvents({
        kinds: [4326 as NDKKind],
        "#a": [
          `34550:${collectionEvent.pubkey}:${collectionEvent.tagValue("d")}`,
        ],
      })

      geometryCollection.forEach((ev) => {
        if (!ev) return
        validGeometryCollection.push({
          ...(JSON.parse(ev.content) as CustomFeature),
          properties: {
            ...JSON.parse(ev.content).properties,
            noteId: ev.id,
          },
        })
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
        const contentEvent = new NDKEvent(
          undefined,
          JSON.parse(ev.content) as NostrEvent,
        )

        validGeometryCollection.push({
          ...(JSON.parse(contentEvent.content) as CustomFeature),
          properties: {
            ...JSON.parse(contentEvent.content).properties,
            noteId: contentEvent.id,
          },
        })
      })
    }

    const featuresWithResolvedReferences = await Promise.all(
      validGeometryCollection.map(async (feature) => {
        if (!feature) return
        if (
          (feature.type as "Feature" | "FeatureReference") ===
          "FeatureReference"
        ) {
          const featureReference = feature as unknown as FeatureReference<
            Record<string, string>
          >
          const split = featureReference.category.split(":")
          const resolvedReference =
            await vanillaClient.curatedItems.getOneByName.query({
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
          } as unknown as CustomFeature
        } else {
          return feature
        }
      }),
    )

    set({
      naddr: naddr,
      geometryCollection: {
        type: "FeatureCollection",
        features: featuresWithResolvedReferences.filter(
          (e) => e !== undefined,
        ) as CustomFeature[],
      },
    })
  },
}))
