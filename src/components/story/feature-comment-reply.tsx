import { NDKEvent } from "@nostr-dev-kit/ndk"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Heart, MessageCircle, X } from "lucide-react"
import { useState } from "react"
import { featureEventKind } from "~/config/constants"
import { useNDKStore } from "~/store/ndk-store"
import { formatNostrTime } from "~/utils/time"
import ProfileByPubkey from "../profile-by-bubkey"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"

export default function FeaturesCommentReply({
  parentEvent,
  forRootFeature,
}: {
  parentEvent: NDKEvent
  forRootFeature?: boolean
}) {
  const queryClient = useQueryClient()
  const { ndk, ndkUser } = useNDKStore()
  const [isReplyFormOpen, setIsReplyFormOpen] = useState(false)
  const [replyContent, setReplyContent] = useState("")
  const [iReacted, setIReacted] = useState(false)

  // useEffect(() => {
  //   const sub = ndk?.subscribe({
  //     kinds: [1],
  //     "#e": [parentEvent.id],
  //   })

  //   if (!sub) {
  //     return
  //   }

  //   sub.on("event", (event) => {
  //     console.log("new event", event)
  //     void queryClient.invalidateQueries({
  //       queryKey: [`${parentEvent.id}`],
  //     })
  //   })

  //   // return () => {
  //   //   sub.stop()
  //   // }
  // }, [])

  const { data, error } = useQuery({
    queryKey: [`${parentEvent.id}`],
    initialData: [],
    queryFn: async () => {
      const data = await ndk?.fetchEvents({
        kinds: [1],
        "#e": [parentEvent.id],
      })

      if (!data) {
        return []
      }

      return Array.from(data).sort((a, b) => {
        return (b.created_at ?? 0) - (a.created_at ?? 0)
      })
    },
    enabled: Boolean(parentEvent),
  })

  const { data: reactionsData, error: reactionsError } = useQuery({
    queryKey: [`${parentEvent.id}-reactions`],
    initialData: 0,
    queryFn: async () => {
      const data = await ndk?.fetchEvents({
        kinds: [7],
        "#e": [parentEvent.id],
      })

      if (!data) {
        return []
      }

      const oneOfRepliesIsMe = Array.from(data)?.some((event) => {
        return event.pubkey === ndkUser?.pubkey
      })

      setIReacted(oneOfRepliesIsMe)

      return data?.size ?? 0
    },
    enabled: Boolean(parentEvent),
  })

  const handleRevealReplyToFeatureOrNoteClick = () => {
    setIsReplyFormOpen(true)
  }

  const handleSendReplyToNote = async () => {
    const now = Math.floor(Date.now() / 1000)

    const pTags = parentEvent.getMatchingTags("p")

    const replyEvent = new NDKEvent(ndk, {
      kind: 1,
      content: replyContent,
      created_at: now,
      pubkey: ndkUser?.pubkey ?? "",
      tags: [
        forRootFeature
          ? ["e", parentEvent.id, "wss://relay.earthly.land", "root"]
          : ["e", parentEvent.id, "wss://relay.earthly.land", "reply"],
        ...pTags,
        ["p", `${ndkUser?.pubkey}`],
      ],
    })

    await replyEvent.publish()

    setIsReplyFormOpen(false)
    void queryClient.invalidateQueries({
      queryKey: [`${parentEvent.id}`],
    })
    setReplyContent("")
  }

  const handleSendReactionToFeature = async () => {
    const now = Math.floor(Date.now() / 1000)

    const reactEvent = new NDKEvent(ndk, {
      kind: 7,
      content: "❤️",
      created_at: now,
      pubkey: ndkUser?.pubkey ?? "",
      tags: [
        ["e", parentEvent.id],
        ["p", `${ndkUser?.pubkey}`],
        ["k", parentEvent?.kind?.toString() ?? `${featureEventKind}`],
      ],
    })

    await reactEvent.publish()

    void queryClient.invalidateQueries({
      queryKey: [`${parentEvent.id}-reactions`],
    })
  }

  return (
    <div className={"flex flex-col gap-2 p-1 text-sm"}>
      {forRootFeature ? null : (
        <div className="flex flex-row justify-between">
          <ProfileByPubkey pubkey={parentEvent.author.pubkey} />
          <div>{formatNostrTime(parentEvent.created_at?.toString() ?? "")}</div>
        </div>
      )}
      {parentEvent && !forRootFeature ? parentEvent.content : null}
      {isReplyFormOpen ? (
        <div className="flex flex-row justify-between">
          <Button size={"sm"} onClick={handleSendReplyToNote}>
            Send
          </Button>
          <Button variant={"secondary"} size={"icon"} onClick={() => setIsReplyFormOpen(false)}>
            <X />
          </Button>
        </div>
      ) : (
        <div className="flex flex-row items-center gap-3">
          <MessageCircle
            className="cursor-pointer hover:text-blue-500"
            size={16}
            onClick={handleRevealReplyToFeatureOrNoteClick}
          />
          <div className="flex flex-row items-center gap-1">
            <div>{reactionsData}</div>
            {iReacted ? (
              <Heart className="cursor-pointer hover:text-blue-500" fill="#FF0000" size={16} />
            ) : (
              <Heart className="cursor-pointer hover:text-blue-500" size={16} onClick={handleSendReactionToFeature} />
            )}
          </div>
        </div>
      )}
      {isReplyFormOpen && (
        <div>
          <Textarea
            placeholder={"...your reply"}
            rows={5}
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
          />
        </div>
      )}

      {data?.map((event) => {
        return (
          <div className="flex flex-col gap-2 rounded-lg border p-2" key={event.id}>
            <FeaturesCommentReply parentEvent={event} forRootFeature={false} />
          </div>
        )
      })}
    </div>
  )
}
