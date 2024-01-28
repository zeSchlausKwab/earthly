import { nip19 } from "nostr-tools"
import { type AddressPointer } from "nostr-tools/lib/types/nip19"

export const decodeNaddr = (naddr: string) => {
  const naddrDecodeRes = nip19.decode(naddr)
  return naddrDecodeRes?.data as AddressPointer
}
