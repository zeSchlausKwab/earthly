import { useAutoAnimate } from "@formkit/auto-animate/react"
import { useEffect, useState } from "react"
import { useMapListStore } from "~/store/map-list-store"
import {
  RecentCollection,
  useRecentCollectionsStore,
} from "~/store/recent-collections-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import Story from "./story"

export default function RecentStories() {
  const { collections } = useRecentCollectionsStore()
  const { pinnedCollections } = useMapListStore()
  const { setCollection } = useZoomUIStore()

  const [parent] = useAutoAnimate()
  const [pinnedToView, setPinnedToView] = useState<RecentCollection[]>([])
  const [notPinnedToView, setNotPinnedToView] = useState<RecentCollection[]>([])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (collections.length > 0) {
        const mostRecentCollection = collections[0]
        if (!mostRecentCollection?.identifier) return
        // setFocusedCollection(mostRecentCollection.identifier)
        // setCollection(mostRecentCollection.features)
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [collections])

  useEffect(() => {
    if (collections.length > 0) {
      const pinnedToView = collections.filter((collection) => {
        return pinnedCollections.includes(collection.identifier)
      })
      const notPinnedToView = collections.filter((collection) => {
        return !pinnedCollections.includes(collection.identifier)
      })

      setPinnedToView(pinnedToView)
      setNotPinnedToView(notPinnedToView)
    }
  }, [collections, pinnedCollections])

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
    <div className={"flex flex-col gap-2 break-all text-sm"} ref={parent}>
      {pinnedToView.sort(sortByPublished).map((collection, index) => {
        return <Story key={collection.identifier} collection={collection} />
      })}
      {notPinnedToView.sort(sortByPublished).map((collection, index) => {
        return <Story key={collection.identifier} collection={collection} />
      })}
    </div>
  )
}
