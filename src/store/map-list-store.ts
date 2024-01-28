import { create } from "zustand"

type MapListState = {
  hoveredCollection: string | null
  setHoveredCollection: (collection: string | null) => void
}

export const useMapListStore = create<MapListState>()((set, get, store) => ({
  hoveredCollection: null,
  setHoveredCollection: (collection) =>
    set(() => ({ hoveredCollection: collection })),
}))
