import { type NDKEvent } from "@nostr-dev-kit/ndk"
import { useQuery } from "@tanstack/react-query"
import { ScanEye } from "lucide-react"
import { useState } from "react"
import {
  type CustomFeature,
  CustomFeatureCollection,
} from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import { decodeNaddr } from "~/utils/naddr"
import ProfileByPubkey from "../profile-by-bubkey"
import { Button } from "../ui/button"
import FeaturesCommentReply from "./feature-comment-reply"

export default function FeaturesContext({ naddr }: { naddr: string }) {
  const { ndk } = useNDKStore()
  const { setCollection } = useZoomUIStore()
  const [featureEvent, setFeatureEvent] = useState<NDKEvent>()
  const [customFeature, setCustomFeature] = useState<CustomFeature>()

  const { data, error } = useQuery({
    queryKey: [`event-${naddr}`],
    queryFn: async () => {
      const naddrData = decodeNaddr(naddr)

      const res = await ndk?.fetchEvent({
        kinds: [naddrData.kind],
        authors: [naddrData.pubkey],
        "#d": [naddrData.identifier],
      })

      if (res) {
        setFeatureEvent(res)
        setCustomFeature(JSON.parse(res?.content ?? "") as CustomFeature)
      }

      return res
    },
    enabled: Boolean(naddr),
  })

  const handleZoomOnFeature = (collection: CustomFeature | undefined) => {
    if (!collection) return
    setCollection(collection as unknown as CustomFeatureCollection)
  }

  return (
    <div className={"flex flex-col rounded-lg border p-2 text-sm"}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-row justify-between gap-2">
          {featureEvent && <ProfileByPubkey pubkey={featureEvent?.pubkey} />}
          <Button variant="outline" size="icon">
            <ScanEye onClick={() => handleZoomOnFeature(customFeature)} />
          </Button>
        </div>
        <b>{customFeature?.properties.name}</b>
        <p>{customFeature?.properties.description}</p>
      </div>
      {featureEvent && (
        <FeaturesCommentReply
          parentEvent={featureEvent}
          forRootFeature={true}
        />
      )}
    </div>
  )
}
