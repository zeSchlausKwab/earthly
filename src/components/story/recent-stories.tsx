import { useEffect } from "react"
import { useMapListStore } from "~/store/map-list-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"
import Story from "./story"

export default function RecentStories() {
  const { collections } = useRecentCollectionsStore()
  const { hoveredCollection } = useMapListStore()

  useEffect(() => {
    if (hoveredCollection) {
      const element = document.getElementById(hoveredCollection)
      if (element) {
        element.scrollIntoView({ behavior: "smooth" })
      }
    }
  }, [hoveredCollection])

  return (
    <div
      className={"grid grid-cols-2 gap-2 break-all text-sm lg:flex lg:flex-col"}
    >
      {collections
        .sort((a, b) => {
          return (
            new Date(Number(b.published_at) * 1000).getTime() -
            new Date(Number(a.published_at) * 1000).getTime()
          )
        })
        .map((collection, index) => {
          const inFocusOnMap = hoveredCollection === collection.identifier
          return (
            <Story
              key={index}
              collection={collection}
              inFocusOnMap={inFocusOnMap}
            />
          )
        })}
    </div>
  )
}
