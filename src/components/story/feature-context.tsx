import { useQuery } from "@tanstack/react-query"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"
import FeaturesCommentReply from "./feature-comment-reply"

export default function FeaturesContext({
  naddr,
}: {
  naddr: `naddr${string}`
}) {
  const { ndk } = useNDKStore()

  const { data, error } = useQuery({
    queryKey: [`${naddr}`],
    queryFn: async () => {
      const naddrData = decodeNaddr(naddr)

      const res = await ndk?.fetchEvent({
        kinds: [naddrData.kind],
        authors: [naddrData.pubkey],
        "#d": [naddrData.identifier],
      })

      return res
    },
    enabled: Boolean(naddr),
  })

  return (
    <div>
      {data && (
        <FeaturesCommentReply parentEvent={data} forRootFeature={true} />
      )}
    </div>
  )
}
