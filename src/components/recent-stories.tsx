import { ScanEye } from "lucide-react"
import Image from "next/image"
import NostrFeature from "~/components/nostr-feature"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { Button } from "~/components/ui/button"
import { useEditingCollectionStore } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"
import { formatNostrTime } from "~/utils/time"

export default function RecentStories() {
  const { ndkUser } = useNDKStore()
  const { collections } = useRecentCollectionsStore()
  const { setGeometryFromNostr } = useEditingCollectionStore()

  const handleEdit = (naddr: string) => {
    void setGeometryFromNostr(naddr)
  }

  const handleClone = (naddr: string) => {
    void setGeometryFromNostr(naddr)
  }

  const handleZoomOnNaddr = (naddr: string) => {
    // const collection = collections.find((c) => c.naddr === naddr)
    // if (collection) {
    //   const { lat, lng, zoom } = collection
    //   window.map?.flyTo([lat, lng], zoom)
    // }
    console.log("zoom on naddr", naddr)
  }

  return (
    <div
      className={"grid grid-cols-2 gap-2 break-all text-sm lg:flex lg:flex-col"}
    >
      {collections.map((collection, index) => {
        return (
          <div
            key={collection.naddr}
            className={"flex  flex-col gap-2 rounded-lg border p-3 lg:w-full"}
          >
            <b>{collection.title}</b>

            <Image
              src={collection.headerImage}
              alt={collection.title}
              width={0}
              height={0}
              sizes="100vw"
              style={{ width: "50%", height: "auto" }} // optional
            />
            <div className={"flex flex-col"}>
              <div>{formatNostrTime(collection.published_at)}</div>
              <div>{collection.description}</div>
            </div>
            <div className="flex flex-row items-center justify-between">
              <ScanEye onClick={() => handleZoomOnNaddr(collection.naddr)} />
              {ndkUser?.pubkey === collection.pubkey ? (
                <Button onClick={() => handleEdit(collection.naddr)}>
                  edit
                </Button>
              ) : (
                <Button onClick={() => handleClone(collection.naddr)}>
                  clone
                </Button>
              )}
            </div>
            <Accordion type="single" collapsible>
              <AccordionItem value="item-1">
                <AccordionTrigger>geometry</AccordionTrigger>
                <AccordionContent className={"flex gap-2 lg:flex-col"}>
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
