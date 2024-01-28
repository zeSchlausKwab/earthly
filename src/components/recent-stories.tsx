import NostrFeature from "~/components/nostr-feature"
import { Button } from "~/components/ui/button"
import { useEditingCollectionStore } from "~/store/edit-collection-store"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"
import { useNDKStore } from "~/store/ndk-store"
import Image from "next/image"

export default function RecentStories() {
  const { ndkUser } = useNDKStore()
  const { collections } = useRecentCollectionsStore()
  const { setGeometryFromNostr } = useEditingCollectionStore()

  const handleEdit = (naddr: string) => {
    void setGeometryFromNostr(naddr)
  }

  const handleClone = () => {
    console.log("clone")
  }

  return (
    <div className={"break-all rounded-lg border text-sm"}>
      {collections.map((collection, index) => {
        console.log(collection)
        return (
          <div key={collection.naddr} className={"flex flex-col gap-4 p-3"}>
            <div className={"flex justify-between"}>
              <b>{collection.title}</b>
              {ndkUser?.pubkey === collection.pubkey ? (
                <Button onClick={() => handleEdit(collection.naddr)}>
                  edit
                </Button>
              ) : (
                <Button onClick={handleClone}>clone</Button>
              )}
            </div>
            <b>{collection.naddr}</b>
            <div className={"flex flex-row gap-4"}>
              <Image
                src={collection.headerImage}
                alt={collection.title}
                width={0}
                height={0}
                sizes="100vw"
                style={{ width: "100%", height: "auto" }} // optional
              />
              <div className={"flex flex-col"}>
                <div>{collection.identifier}</div>
                <div>{collection.published_at}</div>
                <div>{collection.description}</div>
              </div>
            </div>
            <Accordion type="single" collapsible>
              <AccordionItem value="item-1">
                <AccordionTrigger>geometry</AccordionTrigger>
                <AccordionContent className={"flex flex-col gap-2"}>
                  {collection.featureNaddrs.map((tag) => {
                    return <NostrFeature key={tag} naddr={tag} />
                  })}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )
      })}
    </div>
  )
}
