import { ScanEye } from "lucide-react"
import Image from "next/image"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { Button } from "~/components/ui/button"
import { useEditingCollectionStore } from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { type RecentCollection } from "~/store/recent-collections-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import { formatNostrTime } from "~/utils/time"
import FeaturesContext from "./feature-context"

export default function Story({
  collection,
}: {
  collection: RecentCollection
}) {
  const { ndkUser } = useNDKStore()
  const { setGeometryFromNostr } = useEditingCollectionStore()
  const { setCollection } = useZoomUIStore()

  const handleEdit = (naddr: string) => {
    void setGeometryFromNostr(naddr)
  }

  const handleClone = (naddr: string) => {
    void setGeometryFromNostr(naddr)
  }

  const handleZoomOnFeature = (collection: RecentCollection) => {
    setCollection(collection.features)
  }

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
        <ScanEye onClick={() => handleZoomOnFeature(collection)} />
        {ndkUser?.pubkey === collection.pubkey ? (
          <Button onClick={() => handleEdit(collection.naddr)}>edit</Button>
        ) : (
          <Button onClick={() => handleClone(collection.naddr)}>clone</Button>
        )}
      </div>
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>discussion</AccordionTrigger>
          <AccordionContent className={"flex gap-2 lg:flex-col"}>
            {collection.featureNaddrs.map((tag) => {
              return <FeaturesContext key={tag} naddr={tag} />
            })}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
