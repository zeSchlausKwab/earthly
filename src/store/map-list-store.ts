import { type NDKKind } from "@nostr-dev-kit/ndk"
import { create } from "zustand"
import { communityEventKind, featureEventKind, moderatedCommunityEventKind } from "~/config/constants"
import { decodeNaddr } from "~/utils/naddr"
import { useNDKStore } from "./ndk-store"

export type EditModes = "feature" | "collection" | "mod_collection" | "none"
export type ExistingEditModes = Exclude<EditModes, "none">

type MapListState = {
  focusedCollection: string | undefined
  setFocusedCollection: (collectionId: string) => void
  pinnedCollections: string[]
  addPinnedCollection: (collectionId: string) => void
  removePinnedCollection: (collectionId: string) => void
  // setDisplayItems: (items: ExistingEditModes[]) => void
  editOrFocus: {
    naddr: `naddr${string}` | undefined
    mode: EditModes
    amOwner: boolean
  }
  setFocusOnFeature: (naddr: `naddr${string}`) => void
  setEditForNew: (editMode: ExistingEditModes) => void
  noFocusNoEdit: () => void
}

export const useMapListStore = create<MapListState>()((set, get, store) => ({
  focusedCollection: undefined,
  setFocusedCollection: (collectionId: string) => set(() => ({ focusedCollection: collectionId })),
  pinnedCollections: [],
  addPinnedCollection: (collectionId: string) =>
    set((state) => ({
      pinnedCollections: [...state.pinnedCollections, collectionId],
    })),
  removePinnedCollection: (collectionId: string) =>
    set((state) => ({
      pinnedCollections: state.pinnedCollections.filter((id) => id !== collectionId),
    })),
  // setDisplayItems: (items) => set(() => ({ displayItems: items })),
  editOrFocus: {
    naddr: undefined,
    mode: "none",
    amOwner: false,
  },
  setFocusOnFeature: (naddr) => {
    const naddrData = decodeNaddr(naddr)

    const userPubkey = useNDKStore.getState().ndkUser?.pubkey

    const amOwner = userPubkey === naddrData.pubkey

    if ((naddrData.kind as NDKKind) === featureEventKind) {
      set(() => ({
        editOrFocus: { naddr, mode: "feature", amOwner },
      }))
    } else if ((naddrData.kind as NDKKind) === moderatedCommunityEventKind) {
      set(() => ({
        editOrFocus: {
          naddr,
          mode: "mod_collection",
          amOwner,
        },
      }))
    } else if ((naddrData.kind as NDKKind) === communityEventKind) {
      set(() => ({
        editOrFocus: {
          naddr,
          mode: "collection",
          amOwner,
        },
      }))
    }
  },
  setEditForNew: (editMode) => {
    set(() => ({
      editOrFocus: {
        naddr: undefined,
        mode: editMode,
        amOwner: true,
      },
    }))
  },
  noFocusNoEdit: () => {
    set(() => ({
      editOrFocus: {
        naddr: undefined,
        mode: "none",
        amOwner: false,
      },
    }))
  },
}))
