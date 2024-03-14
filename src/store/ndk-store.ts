import NDK, { NDKPrivateKeySigner, type NDKNip07Signer, type NDKUser } from "@nostr-dev-kit/ndk"
import { nip19 } from "nostr-tools"
import { create } from "zustand"
import { relayList } from "~/config/relay-list"
import { toHexString } from "~/utils/crypto"

interface NostrKeyState {
  ndk: NDK | undefined
  ndkUser: NDKUser | undefined
  initPrivateKey: (nsec: `nsec1${string}`) => Promise<void>
  initSigner: (nip07Signer: NDKNip07Signer) => Promise<NDK>
  initAnonymous: () => Promise<void>
  logout: () => void
  disconnect: () => void
}

export const useNDKStore = create<NostrKeyState>()((set, get, store) => ({
  ndk: undefined,
  ndkUser: undefined,
  initPrivateKey: async (nsec) => {
    localStorage.setItem("shouldReconnect", "true")
    set({ ndk: undefined, ndkUser: undefined })
    const privateKey = toHexString(nip19.decode(nsec).data)
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
