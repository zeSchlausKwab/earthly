import { create } from "zustand";
import { utils } from "@noble/secp256k1";
import { generatePrivateKey, getPublicKey, nip19 } from "nostr-tools";
import { useNDKStore } from "~/store/ndk-store";

interface NostrKeyState {
  privateKey: string;
  publicKey: string;
  nsec: string;
  npub: string;
  isKeyPairValid: boolean;
  generateKeyPair: () => void;
  setKeyPair: (privateKey: string) => void;
}

export const useKeyStore = create<NostrKeyState>()((set, get, store) => ({
  privateKey: "",
  publicKey: "",
  nsec: "",
  npub: "",
  isKeyPairValid: false,
  generateKeyPair: () => {
    const privateKey = generatePrivateKey();
    get().setKeyPair(privateKey);
    useNDKStore.getState().init(privateKey);
  },
  setKeyPair: (privateKey) => {
    const isValid = utils.isValidPrivateKey(privateKey);
    if (isValid) {
      const publicKey = getPublicKey(privateKey);
      const nsec = nip19.nsecEncode(publicKey);
      const npub = nip19.npubEncode(publicKey);
      set({ privateKey, publicKey, nsec, npub, isKeyPairValid: true });
      useNDKStore.getState().init(privateKey);
    } else {
      set({
        privateKey,
        publicKey: "...invalid private key",
        nsec: "",
        npub: "",
        isKeyPairValid: false,
      });
      useNDKStore.getState().initAnonymous();
    }
  },
}));
