import { create } from "zustand";
import { type Feature, type FeatureCollection, type Geometry } from "geojson";
import { useNDKStore } from "~/store/ndk-store";
import { mapGeometryCollectionFeature } from "~/mapper/geometry-feature";
import { decodeNaddr } from "~/utils/naddr";

interface FeatureProperties {
  id: string;
  name: string;
  description: string;
  color: string;
}

export type CustomFeature = Feature<Geometry, FeatureProperties>;
export type CustomFeatureCollection = FeatureCollection<
  Geometry,
  FeatureProperties
>;

export const useEditingCollectionStore = create<{
  naddr: string | undefined;
  geometryCollection: CustomFeatureCollection;
  reset: () => void;
  setGeometry: (geometry: CustomFeatureCollection) => void;
  addFeature: (feature: CustomFeature) => void;
  setGeometryFromNostr: (eventId: string) => void;
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
    });
  },
  setGeometry: (geometry) => {
    set({ geometryCollection: geometry });
  },
  addFeature: (feature) => {
    set((state) => ({
      geometryCollection: {
        ...state.geometryCollection,
        features: [...state.geometryCollection.features, feature],
      },
    }));
  },
  setGeometryFromNostr: async (naddr: string) => {
    const ndkInstance = useNDKStore.getState().ndk;
    if (!ndkInstance) {
      throw new Error("NDK not initialized");
    }

    const collectionNaddrData = decodeNaddr(naddr);

    const collectionEvent = await ndkInstance.fetchEvent({
      kinds: [collectionNaddrData.kind],
      authors: [collectionNaddrData.pubkey],
      "#d": [collectionNaddrData.identifier],
    });

    if (!collectionEvent) {
      throw new Error("Event not found");
    }

    const geometryCollection = await Promise.all(
      collectionEvent?.getMatchingTags("f").map(async (e) => {
        const naddrData = decodeNaddr(e[1] ?? "");

        const geoEvent = await ndkInstance.fetchEvent({
          authors: [naddrData.pubkey],
          "#d": [naddrData.identifier],
        });

        if (!geoEvent) return;

        return mapGeometryCollectionFeature(geoEvent);
      }),
    );

    set({
      naddr: naddr,
      geometryCollection: {
        type: "FeatureCollection",
        features: geometryCollection,
      },
    });
  },
}));
