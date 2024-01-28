import { create } from "zustand"
import { type NDKEvent } from "@nostr-dev-kit/ndk"

interface NostrKeyState {
  recentEvents: NDKEvent[]
  setRecentEvents: (
    updateFunction: (prevEvents: NDKEvent[]) => NDKEvent[],
  ) => void
}

export const useEventStore = create<NostrKeyState>()((set, get, store) => ({
  recentEvents: [],
  setRecentEvents: (updateFunction) =>
    set((state) => ({ recentEvents: updateFunction(state.recentEvents) })),
}))
