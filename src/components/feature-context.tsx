import { type NDKEvent } from "@nostr-dev-kit/ndk"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { type CustomFeature } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"
import FeaturesCommentReply from "./feature-comment-reply"

export default function FeaturesContext({ naddr }: { naddr: string }) {
  const { ndk } = useNDKStore()
  const [featureEvent, setFeatureEvent] = useState<NDKEvent>()
  const [customFeature, setCustomFeature] = useState<CustomFeature>()

  const { data, error } = useQuery({
    queryKey: [`event-${naddr}`],
    queryFn: async () => {
      const naddrData = decodeNaddr(naddr)
      return ndk?.fetchEvent({
        kinds: [naddrData.kind],
        authors: [naddrData.pubkey],
        "#d": [naddrData.identifier],
      })
    },
    enabled: Boolean(naddr),
    onSuccess(data) {
      if (data) {
        setFeatureEvent(data)
        setCustomFeature(JSON.parse(data?.content ?? "") as CustomFeature)
      }
    },
  })

  return (
    <div className={"flex flex-col rounded-lg border p-2 text-sm"}>
      <b>{customFeature?.properties.name}</b>
      <p>{customFeature?.properties.description}</p>
      {featureEvent && (
        <FeaturesCommentReply
          parentEvent={featureEvent}
          forRootFeature={true}
        />
      )}
    </div>
  )
}
