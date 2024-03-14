import * as React from "react"
import { useEffect, useState } from "react"
import { CheckCheck, Loader2 } from "lucide-react"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import { NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk"
import { useNDKStore } from "~/store/ndk-store"
import { Button } from "../ui/button"
import { featureEventKind } from "~/config/constants"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStoryMetaForm({
  title,
  description,
  color,
  approvalEvent,
  originalEvent,
  identifier,
  onChange,
}: {
  title: string
  description: string
  color: string
  approvalEvent?: NDKEvent
  originalEvent?: NDKEvent
  identifier?: string
  onChange: (title: string, description: string, color: string) => void
}) {
  const { ndk, ndkUser } = useNDKStore()

  const [value, setValue] = useState<{
    title: string
    description: string
    color: string
  }>({
    title: title ?? "",
    description: description ?? "",
    color: description ?? "",
  })

  useEffect(() => {
    onChange(value.title, value.description, value.color)
  }, [value])

  const handleFeatureApproval = async () => {
    if (ndk && ndkUser && originalEvent) {
      const now = Math.floor(Date.now() / 1000)
      const ev = await originalEvent.toNostrEvent()

      const approvalEvent = new NDKEvent(ndk, {
        kind: 4550 as NDKKind,
        pubkey: ndkUser.pubkey,
        content: JSON.stringify(ev),
        created_at: now,
        tags: [
          ["a", `${featureEventKind}:${ndkUser?.pubkey}:${identifier}`, "wss://relay.earthly.land"],
          ["e", `${originalEvent?.id}`, "wss://relay.earthly.land"],
          ["p", `${ndkUser?.pubkey}`, "wss://relay.earthly.land"],
          ["k", "4326"],
        ],
      })

      await approvalEvent.publish()
    }
  }

  return (
    <div className={"flex flex-row gap-2 text-sm"}>
      <div className="flex w-1/2 flex-col gap-2">
        <div className="flex flex-row items-center justify-between">
          {!approvalEvent && (
            <Button onClick={handleFeatureApproval}>
              <CheckCheck />
            </Button>
          )}
          <input
            type="color"
            onChange={(e) => {
              const color = e.target.value || ""
              setValue({ ...value, color })
            }}
            value={color}
          />
        </div>
        <Input value={title} onChange={(e) => setValue({ ...value, title: e.target.value })} />
      </div>
      <Textarea value={description} onChange={(e) => setValue({ ...value, description: e.target.value })} />
    </div>
  )
}
