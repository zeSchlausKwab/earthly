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
import ProfileByPubkey from "../profile-by-bubkey"
import FeaturesContext from "./feature-context"

export default function Story({
  collection,
  inFocusOnMap,
}: {
  collection: RecentCollection
  inFocusOnMap?: boolean
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
      id={collection.identifier}
      key={collection.naddr}
      className={`flex flex-col gap-2 rounded-lg border p-3 hover:border-cyan-800 hover:shadow-md lg:w-full ${inFocusOnMap ? "border-cyan-800 shadow-md" : ""}`}
    >
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative aspect-video lg:w-1/3">
          <Image fill src={collection.headerImage} alt={collection.title} />
        </div>
        <div className="flex h-full flex-col justify-between lg:w-2/3">
          <div className="flex flex-col justify-between lg:flex-row">
            <ProfileByPubkey pubkey={collection.pubkey} />
            <div>{formatNostrTime(collection.published_at)}</div>
          </div>
          <div className="flex flex-row justify-between">
            <Button variant="outline" size="icon">
              <ScanEye onClick={() => handleZoomOnFeature(collection)} />
            </Button>
            {ndkUser?.pubkey === collection.pubkey ? (
              <Button onClick={() => handleEdit(collection.naddr)}>edit</Button>
            ) : (
              <Button onClick={() => handleClone(collection.naddr)}>
                clone
              </Button>
            )}
          </div>
        </div>
      </div>
      <b className="text-md">{collection.title}</b>
      <div>{collection.description}</div>
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
