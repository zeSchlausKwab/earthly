import { ScanEye } from "lucide-react"
import Image from "next/image"
import useMedia from "use-media"
import { Button } from "~/components/ui/button"
import { featureEventKind } from "~/config/constants"
import { useMapListStore } from "~/store/map-list-store"
import { type RecentFeature } from "~/store/recent-features-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import { encodeNaddr } from "~/utils/naddr"
import { formatNostrTime } from "~/utils/time"
import ProfileByPubkey from "../profile-by-bubkey"

export default function PlaceFeature({ collection }: { collection: RecentFeature }) {
  const { setCollection } = useZoomUIStore()
  const { setFocusOnFeature } = useMapListStore()

  const isWide = useMedia({ minWidth: "1024px" })

  const handleZoomOnFeature = (collection: RecentFeature) => {
    setCollection(collection.features)
  }

  return (
    <div
      id={collection.identifier}
      key={collection.naddr}
      onClick={() => {
        const naddr = encodeNaddr({
          identifier: collection.identifier,
          kind: featureEventKind,
          pubkey: collection.pubkey,
        })
        setFocusOnFeature(naddr)
      }}
      className={`flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-3 hover:border-cyan-800 hover:shadow-md lg:w-full`}
    >
      <div className="flex flex-row gap-2">
        <div className="relative aspect-video lg:w-1/3">
          <Image fill src={collection.headerImage} alt={collection.title} />
        </div>

        <div className="flex flex-col justify-between lg:w-2/3">
          <div className="flex flex-col justify-between lg:flex-row">
            {isWide ? <ProfileByPubkey pubkey={collection.pubkey} /> : null}
            <Button variant="outline" size="icon">
              <ScanEye onClick={() => handleZoomOnFeature(collection)} />
            </Button>
          </div>
          <div>{formatNostrTime(collection.published_at ?? "1")}</div>
        </div>
      </div>
      <b className="text-md">{collection.title}</b>
      <div>{collection.description}</div>
    </div>
  )
}
