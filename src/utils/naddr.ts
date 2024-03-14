import { nip19 } from "nostr-tools"
import { type AddressPointer } from "nostr-tools/nip19"

export const decodeNaddr = (naddr: `naddr${string}`): AddressPointer => {
  const naddrDecodeRes = nip19.decode(naddr)
  return naddrDecodeRes?.data as AddressPointer
}

export const encodeNaddr = (pointer: AddressPointer): `naddr${string}` => {
  return nip19.naddrEncode(pointer)
}
