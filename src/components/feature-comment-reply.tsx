import { NDKEvent } from "@nostr-dev-kit/ndk"
import { MessageCircle, X } from "lucide-react"
import { useState } from "react"
import { useNDKStore } from "~/store/ndk-store"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"
import { useQuery } from "@tanstack/react-query"
import ProfileByPubkey from "./profile-by-bubkey"

export default function FeaturesCommentReply({
  parentEvent,
  forRootFeature,
}: {
  parentEvent: NDKEvent
  forRootFeature?: boolean
}) {
  const { ndk, ndkUser } = useNDKStore()
  const [childReplyEvents, setChildReplyEvents] = useState<NDKEvent[]>()
  const [isReplyFormOpen, setIsReplyFormOpen] = useState(false)
  const [replyContent, setReplyContent] = useState("")

  const { data, error } = useQuery({
    queryKey: [`event-${parentEvent.id}`],
    queryFn: async () => {
      return ndk?.fetchEvents({
        kinds: [1],
        "#e": [parentEvent.id],
      })
    },
    enabled: Boolean(parentEvent),
    onSuccess(data) {
      if (data) {
        setChildReplyEvents(Array.from(data))
      }
    },
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

    console.log(replyEvent)

    await replyEvent.publish()

    setIsReplyFormOpen(false)
  }

  return (
    <div className={"flex flex-col gap-2 p-2 text-sm"}>
      <ProfileByPubkey pubkey={parentEvent.author.pubkey} />
      {parentEvent && !forRootFeature ? parentEvent.content : null}
      {isReplyFormOpen ? (
        <div className="flex flex-row justify-between">
          <Button onClick={handleSendReplyToNote}>Send</Button>
          <Button
            variant={"secondary"}
            size={"icon"}
            onClick={() => setIsReplyFormOpen(false)}
          >
            <X />
          </Button>
        </div>
      ) : (
        <Button size={"icon"} onClick={handleRevealReplyToFeatureOrNoteClick}>
          <MessageCircle />
        </Button>
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

      {childReplyEvents?.map((event) => {
        return (
          <div className="flex flex-col gap-2 rounded-lg border p-2">
            <FeaturesCommentReply parentEvent={event} forRootFeature={false} />
          </div>
        )
      })}
    </div>
  )
}
