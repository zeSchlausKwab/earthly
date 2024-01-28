import { create } from "zustand"
import NDK, {
  type NDKNip07Signer,
  NDKPrivateKeySigner,
  type NDKUser,
} from "@nostr-dev-kit/ndk"
import { relayList } from "~/config/relay-list"

interface NostrKeyState {
  ndk: NDK | undefined
  ndkUser: NDKUser | undefined
  initPrivateKey: (privateKey: string) => Promise<void>
  initSigner: (nip07Signer: NDKNip07Signer) => Promise<NDK>
  initAnonymous: () => Promise<void>
  logout: () => void
  disconnect: () => void
}

export const useNDKStore = create<NostrKeyState>()((set, get, store) => ({
  ndk: undefined,
  ndkUser: undefined,
  initPrivateKey: async (privateKey) => {
    localStorage.setItem("shouldReconnect", "true")
    set({ ndk: undefined, ndkUser: undefined })

    const newSigner = new NDKPrivateKeySigner(privateKey)
    const newSignerUser = await newSigner.user()

    const ndk = new NDK({
      explicitRelayUrls: relayList,
      signer: newSigner,
    })

    await ndk.connect()
    set({ ndkUser: newSignerUser, ndk })
    return
  },
  initSigner: async (nip07Signer) => {
    localStorage.setItem("shouldReconnect", "true")
    set({ ndk: undefined, ndkUser: undefined })

    const newSignerUser = await nip07Signer.user()

    const ndk = new NDK({
      explicitRelayUrls: relayList,
      signer: nip07Signer,
    })

    await ndk.connect()
    set({ ndkUser: newSignerUser, ndk })
    return ndk
  },
  initAnonymous: async () => {
    const ndk = new NDK({
      explicitRelayUrls: relayList,
    })

    await ndk.connect()
    set({ ndk })
    return
  },
  logout: () => {
    localStorage.removeItem("shouldReconnect")
    localStorage.removeItem("encryptedNsec")
    set({ ndk: undefined, ndkUser: undefined })
    void store.getState().initAnonymous()
  },
  disconnect: () => {
    set({ ndk: undefined })
  },
}))
