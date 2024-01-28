import { zodResolver } from "@hookform/resolvers/zod"
import { NDKKind } from "@nostr-dev-kit/ndk"
import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "~/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"
import {
  editCollectionFormSchema,
  type EditingCollectionFormSchema,
  UpdateCollectionFormSchema,
} from "~/models/collection"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"

export default function EditingStoryForm({
  naddr,
  onSubmit,
  onUpdateCollectionData,
  onDiscard,
}: {
  naddr: string | undefined
  onSubmit: (data: EditingCollectionFormSchema) => void
  onUpdateCollectionData: (data: UpdateCollectionFormSchema) => void
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

  const { data, error } = useQuery({
    queryKey: ["naddrEvent"],
    queryFn: async () => {
      const naddrData = decodeNaddr(naddr!)

      const res = await ndk?.fetchEvent({
        kinds: [34550 as NDKKind],
        // authors: [naddrData.pubkey],
        "#d": [naddrData.identifier],
      })

      if (res) {
        setImage(res.tagValue("image") ?? "")
        form.setValue("storyTitle", data?.tagValue("title") ?? "")
        form.setValue("storyDescription", data?.content ?? "")
      }

      return res
    },
    enabled: Boolean(naddr),
  })

  const handleUpdateCollectionData = () => {
    onUpdateCollectionData({
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
    <div className={"flex h-96 flex-col gap-2 break-all"}>
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
      {naddr ? (
        <Button size={"sm"} onClick={handleUpdateCollectionData}>
          Update collection
        </Button>
      ) : (
        <Button size={"sm"} onClick={handleSubmit}>
          Submit
        </Button>
      )}
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
                    rows={5}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </div>
  )
}
