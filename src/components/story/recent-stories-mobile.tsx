import { EmblaCarouselType } from "embla-carousel"
import { useCallback, useEffect, useState } from "react"
import { useMapListStore } from "~/store/map-list-store"
import {
  RecentCollection,
  useRecentCollectionsStore,
} from "~/store/recent-collections-store"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../ui/carousel"
import Story from "./story"
import { useZoomUIStore } from "~/store/zoom-ui-store"

export default function RecentStoriesMobile() {
  const { collections } = useRecentCollectionsStore()
  const { setFocusedCollection } = useMapListStore()
  const { setCollection } = useZoomUIStore()

  const [api, setApi] = useState<EmblaCarouselType | null>(null)

  const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
    const collectionIndex = collections[emblaApi.selectedScrollSnap()]
    if (!collectionIndex) return
    console.log("collectionIndex", collectionIndex)
    setFocusedCollection(collectionIndex.identifier)
    setCollection(collectionIndex.features)
  }, [])

  useEffect(() => {
    if (!api) return

    onSelect(api)
    api.on("reInit", onSelect)
    api.on("select", onSelect)
  }, [api])

  const sortByPublished = (
    a: RecentCollection,
    b: RecentCollection,
  ): number => {
    return (
      new Date(Number(b.published_at) * 1000).getTime() -
      new Date(Number(a.published_at) * 1000).getTime()
    )
  }

  return (
    <Carousel setApi={(api) => api && setApi(api)} className="w-full">
      <CarouselContent className="w-full">
        {collections.sort(sortByPublished).map((collection, index) => (
          <CarouselItem key={collection.identifier}>
            <Story key={collection.identifier} collection={collection} />
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}
