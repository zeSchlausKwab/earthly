import { create } from "zustand"
import { CustomFeatureCollection } from "./edit-collection-store"

type ZoomUIState = {
  collection: CustomFeatureCollection | null
  setCollection: (collection: CustomFeatureCollection) => void
}

export const useZoomUIStore = create<ZoomUIState>()((set, get, store) => ({
  collection: null,
  setCollection: (collection) => set(() => ({ collection })),
}))
