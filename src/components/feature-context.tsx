import { type NDKEvent } from "@nostr-dev-kit/ndk"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { type CustomFeature } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"
import FeaturesCommentReply from "./feature-comment-reply"
import ProfileByPubkey from "./profile-by-bubkey"

export default function FeaturesContext({ naddr }: { naddr: string }) {
  const { ndk } = useNDKStore()
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

  return (
    <div className={"flex flex-col rounded-lg border p-2 text-sm"}>
      <div className="flex flex-row">
        <div className="flex flex-col">
          {featureEvent && <ProfileByPubkey pubkey={featureEvent?.pubkey} />}
          <b>{customFeature?.properties.name}</b>
          <p>{customFeature?.properties.description}</p>
        </div>
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
