import { Input } from "~/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Textarea } from "~/components/ui/textarea"
import { Button } from "~/components/ui/button"
import {
  editCollectionFormSchema,
  type EditingCollectionFormSchema,
  UpdateCollectionFormSchema,
} from "~/models/collection"
import { useEffect, useState } from "react"
import { type NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"
import { useNDKStore } from "~/store/ndk-store"
import Image from "next/image"
import { decodeNaddr } from "~/utils/naddr"

export default function EditingStoryForm({
  naddr,
  onSubmit,
  onUpdate,
  onDiscard,
}: {
  naddr: string | undefined
  onSubmit: (data: EditingCollectionFormSchema) => void
  onUpdate: (data: UpdateCollectionFormSchema) => void
  onDiscard: () => void
}) {
  const { ndk } = useNDKStore()

  const [image, setImage] = useState<string>("")

  const form = useForm<EditingCollectionFormSchema>({
    resolver: zodResolver(editCollectionFormSchema),
    defaultValues: {
      storyTitle: "",
      storyDescription: "",
    },
  })

  useEffect(() => {
    if (!naddr) return
    const naddrData = decodeNaddr(naddr)
    const sub = ndk?.subscribe({
      kinds: [NDKKind.Article],
      authors: [naddrData.pubkey],
      "#d": [naddrData.identifier],
    })

    sub?.on("event", (event: NDKEvent) => {
      form.setValue("storyTitle", event.tagValue("title") ?? "")
      form.setValue("storyDescription", event.content)
      setImage(event.tagValue("image") ?? "")
    })
  }, [naddr])

  const handleUpdate = () => {
    onUpdate({
      storyTitle: form.getValues("storyTitle"),
      storyDescription: form.getValues("storyDescription"),
      naddr: naddr ?? "",
    })
  }

  const handleSubmit = () => {
    onSubmit({
      storyTitle: form.getValues("storyTitle"),
      storyDescription: form.getValues("storyDescription"),
    })
  }

  return (
    <div className={"flex flex-col gap-2 break-all"}>
      {image && (
        <Image
          alt="header image"
          src={image}
          width={400}
          height={200}
          className={"h-32 w-full rounded-lg object-cover"}
        />
      )}
      {naddr ? <b>naddr: {naddr}</b> : <b>new story</b>}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <FormField
            control={form.control}
            name="storyTitle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Story title</FormLabel>
                <FormControl>
                  <Input placeholder={"new story title..."} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="storyDescription"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Story description</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    placeholder={"new story description..."}
                    rows={10}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
      <div className={"flex flex-row justify-between"}>
        {naddr ? (
          <Button size={"sm"} onClick={handleUpdate}>
            Update
          </Button>
        ) : (
          <Button size={"sm"} onClick={handleSubmit}>
            Submit
          </Button>
        )}
        <Button size={"sm"} variant={"destructive"} onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  )
}
