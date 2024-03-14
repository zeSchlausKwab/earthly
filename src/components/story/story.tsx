import { ChevronRight, Pin, PinOff, ScanEye } from "lucide-react"
import Image from "next/image"
import useMedia from "use-media"
import { Button } from "~/components/ui/button"
import { useEditingCollectionStore } from "~/store/edit-collection-store"
import { useMapListStore } from "~/store/map-list-store"
import { useNDKStore } from "~/store/ndk-store"
import { type RecentCollection } from "~/store/recent-collections-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import ProfileByPubkey from "../profile-by-bubkey"
import SimpleTooltip from "../simple-tooltip"
import { Toggle } from "../ui/toggle"

export default function Story({ collection }: { collection: RecentCollection }) {
  const { ndkUser } = useNDKStore()
  const { setGeometryFromNostr } = useEditingCollectionStore()
  const { setCollection } = useZoomUIStore()
  const {
    setFocusOnFeature,
    addPinnedCollection,
    removePinnedCollection,
    focusedCollection,
    pinnedCollections,
    setFocusedCollection,
  } = useMapListStore()

  const isWide = useMedia({ minWidth: "1024px" })

  const focused = focusedCollection === collection.identifier
  const pinned = pinnedCollections.includes(collection.identifier)

  const handleEdit = (naddr: `naddr${string}`) => {
    void setGeometryFromNostr(naddr)
  }

  const handleClone = (naddr: `naddr${string}`) => {
    void setGeometryFromNostr(naddr)
  }

  const handleZoomOnFeature = (collection: RecentCollection) => {
    setCollection(collection.features)
  }

  const handlePinChange = (e: boolean) => {
    if (e) {
      addPinnedCollection(collection.identifier)
    } else {
      removePinnedCollection(collection.identifier)
    }
  }

  const handleFocusChange = (e: boolean) => {
    setFocusedCollection(e ? collection.identifier : "")
    setCollection(collection.features)
  }

  return (
    <div
      className="flex w-full flex-row gap-1 overflow-y-scroll"
      onClick={() => {
        setFocusOnFeature(collection.naddr)
      }}
    >
      {isWide ? (
        <div className="flex w-12 flex-col gap-1">
          <div className={`rounded-lg border ${pinned ? "bg-green-500" : ""}`}>
            <SimpleTooltip message="pin this">
              <Toggle
                aria-label="toggle pin"
                onPressedChange={(p) => handlePinChange(p)}
                pressed={pinned}
                defaultPressed={false}
              >
                {pinned ? <PinOff /> : <Pin />}
              </Toggle>
            </SimpleTooltip>
          </div>
          <div className={`h-full rounded-lg border p-1`}>
            <div
              className={`flex h-full flex-row justify-center rounded-lg border hover:bg-green-200 ${focused ? "bg-green-500" : ""}`}
              onClick={() => handleFocusChange(!focused)}
            >
              <SimpleTooltip message="focus this">
                <ChevronRight />
              </SimpleTooltip>
            </div>
          </div>
        </div>
      ) : null}
      <div
        id={collection.identifier}
        key={collection.naddr}
        className={`flex w-full flex-col gap-2 rounded-lg border p-3 hover:border-cyan-800 hover:shadow-md lg:w-full`}
      >
        <div className="flex flex-row gap-2">
          <div className="relative aspect-video lg:w-1/3">
            {isWide ? null : <ProfileByPubkey pubkey={collection.pubkey} />}
            <Image fill src={collection.headerImage} alt={collection.title} />
          </div>
          <div className="flex flex-col justify-between lg:w-2/3">
            <div className="flex flex-col justify-between lg:flex-row">
              {isWide ? <ProfileByPubkey pubkey={collection.pubkey} /> : null}
              {/* <div>{formatNostrTime(collection.published_at)}</div> */}
              <Button variant="outline" size="icon">
                <ScanEye onClick={() => handleZoomOnFeature(collection)} />
              </Button>
            </div>
            <div className="flex flex-row justify-between">
              {/* <Button variant="outline" size="icon">
                <ScanEye onClick={() => handleZoomOnFeature(collection)} />
              </Button> */}
              {/* {ndkUser?.pubkey === collection.pubkey ? (
                <Button onClick={() => handleEdit(collection.naddr)}>
                  edit
                </Button>
              ) : (
                <Button onClick={() => handleClone(collection.naddr)}>
                  clone
                </Button>
              )} */}
            </div>
          </div>
        </div>
        <b className="text-md">{collection.title}</b>
        <div>{collection.description}</div>
        {/* <Accordion type="single" collapsible>
          <AccordionItem value="item-1">
            <AccordionTrigger>discussion</AccordionTrigger>
            <AccordionContent className={"flex flex-col gap-2"}>
              {collection.featureNaddrs.map((tag) => {
                return <FeaturesContext key={tag} naddr={tag} />
              })}
            </AccordionContent>
          </AccordionItem>
        </Accordion> */}
      </div>
    </div>
  )
}
