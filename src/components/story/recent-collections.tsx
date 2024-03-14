import { useAutoAnimate } from "@formkit/auto-animate/react"
import { useEffect, useState } from "react"
import { useMapListStore } from "~/store/map-list-store"
import {
  useRecentCollectionsStore,
  type RecentCollection,
} from "~/store/recent-collections-store"
import { type RecentFeature } from "~/store/recent-features-store"
import Story from "./story"

export default function RecentCollections() {
  const { recentCollections } = useRecentCollectionsStore()
  const { pinnedCollections } = useMapListStore()

  const [parent] = useAutoAnimate()
  const [recentItems, setRecentItems] = useState<
    (RecentCollection | RecentFeature)[]
  >([])
  const [pinnedToView, setPinnedToView] = useState<RecentCollection[]>([])
  const [notPinnedToView, setNotPinnedToView] = useState<RecentCollection[]>([])

  useEffect(() => {
    setRecentItems(recentCollections)
    const timeoutId = setTimeout(() => {
      console.log(recentItems)
    }, 2000)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [recentItems])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (recentCollections.length > 0) {
        const mostRecentCollection = recentCollections[0]
        if (!mostRecentCollection?.identifier) return
        // setFocusedCollection(mostRecentCollection.identifier)
        // setCollection(mostRecentCollection.features)
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [recentCollections])

  useEffect(() => {
    if (recentItems.length > 0) {
      const pinnedToView = recentCollections.filter((collection) => {
        return pinnedCollections.includes(collection.identifier)
      })
      const notPinnedToView = recentCollections.filter((collection) => {
        return !pinnedCollections.includes(collection.identifier)
      })

      setPinnedToView(pinnedToView)
      setNotPinnedToView(notPinnedToView)
    }
  }, [recentItems, pinnedCollections])

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
