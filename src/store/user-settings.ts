import { create } from "zustand"

interface Store {
  mapFollowRecentEvents: boolean
  setMapFollowRecentEvents: (value: boolean) => void
}

export const useUserSettingsStore = create<Store>()((set, get, store) => ({
  mapFollowRecentEvents: true,
  setMapFollowRecentEvents: (value) =>
    set((state) => ({ mapFollowRecentEvents: value })),
}))
