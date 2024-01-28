import { nip19 } from "nostr-tools"
import { AddressPointer } from "nostr-tools/nip19"

export const decodeNaddr = (naddr: string): AddressPointer => {
  const naddrDecodeRes = nip19.decode(naddr)
  return naddrDecodeRes?.data as AddressPointer
}
