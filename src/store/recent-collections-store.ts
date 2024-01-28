import { create } from "zustand";
import { useNDKStore } from "~/store/ndk-store";
import { type NDKEvent, NDKKind } from "@nostr-dev-kit/ndk";
import { nip19 } from "nostr-tools";
import { type CustomFeatureCollection } from "~/store/edit-collection-store";
import { mapGeometryCollectionFeature } from "~/mapper/geometry-feature";
import { decodeNaddr } from "~/utils/naddr";

export type RecentCollection = {
  naddr: string;
  title: string;
  identifier: string;
  published_at: string;
  pubkey: string;
  description: string;
  featureNaddrs: string[];
  features: CustomFeatureCollection;
};

export const useRecentCollectionsStore = create<{
  init: () => void;
  collections: RecentCollection[];
}>()((set, get, store) => ({
  init: async () => {
    const ndkInstance = useNDKStore.getState().ndk;
    if (!ndkInstance) {
      throw new Error("NDK not initialized");
    }

    const sub = ndkInstance.subscribe({
      "#y": ["collection"],
      limit: 20,
    });

    sub.on("event", async (event: NDKEvent) => {
      const naddr = nip19.naddrEncode({
        pubkey: event.pubkey,
        kind: event.kind ?? NDKKind.Article,
        identifier: event.tagValue("d") ?? "",
      });

      const featureIdentifiers = event.getMatchingTags("f") as [
        string,
        string,
      ][];

      const featureEvents = featureIdentifiers.map(async ([, naddr]) => {
        const featureNaddrData = decodeNaddr(naddr);

        const ev = await ndkInstance.fetchEvent({
          kinds: [featureNaddrData.kind],
          authors: [featureNaddrData.pubkey],
          "#d": [featureNaddrData.identifier],
        });

        return ev;
      });

      const featureEventsResolved = await Promise.all(featureEvents);

      const features = featureEventsResolved.map((ev) => {
        if (!ev) return;
        return mapGeometryCollectionFeature(ev);
      });

      const existingCollection = get().collections.find(
        (collection) => collection.naddr === naddr,
      );

      if (existingCollection) {
        set((state) => {
          return {
            collections: state.collections.map((collection) => {
              if (collection.naddr === naddr) {
                return {
                  ...collection,
                  features: {
                    type: "FeatureCollection",
                    features: features,
                  },
                };
              }
              return collection;
            }),
          };
        });
        return;
      } else {
        set((state) => {
          return {
            collections: [
              ...state.collections,
              {
                naddr,
                title: event.tagValue("title") ?? "",
                identifier: event.tagValue("d") ?? "",
                published_at: event.tagValue("published_at") ?? "",
                pubkey: event.pubkey,
                description: event.content,
                featureNaddrs: featureIdentifiers.map((e) => e[1]),
                features: {
                  type: "FeatureCollection",
                  features: features,
                },
              },
            ],
          };
        });
        return;
      }
    });
    return;
  },
  collections: [],
}));
