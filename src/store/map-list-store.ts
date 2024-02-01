import { create } from "zustand"

type MapListState = {
  focusedCollection: string | undefined
  setFocusedCollection: (collectionId: string) => void
  pinnedCollections: string[]
  addPinnedCollection: (collectionId: string) => void
  removePinnedCollection: (collectionId: string) => void
}

export const useMapListStore = create<MapListState>()((set, get, store) => ({
  focusedCollection: undefined,
  setFocusedCollection: (collectionId: string) =>
    set(() => ({ focusedCollection: collectionId })),
  pinnedCollections: [],
  addPinnedCollection: (collectionId: string) =>
    set((state) => ({
      pinnedCollections: [...state.pinnedCollections, collectionId],
    })),
  removePinnedCollection: (collectionId: string) =>
    set((state) => ({
      pinnedCollections: state.pinnedCollections.filter(
        (id) => id !== collectionId,
      ),
    })),
}))
