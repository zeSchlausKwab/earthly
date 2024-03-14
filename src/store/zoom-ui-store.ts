import { create } from "zustand"
import { type CustomFeature } from "./edit-collection-store"

type ZoomUIState = {
  collection: CustomFeature[]
  locationFromUser: { lat: number; lng: number } | null
  setCollection: (collection: CustomFeature[]) => void
  setLocationFromUser: () => void
}

export const useZoomUIStore = create<ZoomUIState>()((set) => ({
  collection: [],
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
