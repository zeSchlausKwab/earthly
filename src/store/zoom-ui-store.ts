import { create } from "zustand"
import { CustomFeatureCollection } from "./edit-collection-store"

type ZoomUIState = {
  collection: CustomFeatureCollection | null
  locationFromUser: { lat: number; lng: number } | null
  setCollection: (collection: CustomFeatureCollection) => void
  setLocationFromUser: () => void
}

export const useZoomUIStore = create<ZoomUIState>()((set, get, store) => ({
  collection: null,
  locationFromUser: null,
  setCollection: (collection) => set(() => ({ collection })),
  setLocationFromUser: () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords
        set(() => ({ locationFromUser: { lat: latitude, lng: longitude } }))
      })
    }
  },
}))
