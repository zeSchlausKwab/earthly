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
  const { setFocusedCollection, pinnedCollections } = useMapListStore()
  const { setCollection } = useZoomUIStore()

  const [pinnedToView, setPinnedToView] = useState<RecentCollection[]>([])
  const [notPinnedToView, setNotPinnedToView] = useState<RecentCollection[]>([])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (collections.length > 0) {
        const mostRecentCollection = collections[0]
        if (!mostRecentCollection?.identifier) return
        setFocusedCollection(mostRecentCollection.identifier)
        // setCollection(mostRecentCollection.features)
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [collections, setFocusedCollection])

  // useEffect(() => {
  //   const pinned = collections.filter((collection) => {
  //     return pinnedCollections.includes(collection.identifier)
  //   })
  //   setPinnedToView(pinned)
  //   const notPinned = collections.filter((collection) => {
  //     return !pinnedCollections.includes(collection.identifier)
  //   })
  //   setNotPinnedToView(notPinned)
  // }, [pinnedCollections, collections])

  return (
    <div className={"flex flex-col gap-2 break-all text-sm"}>
      {collections
        .sort((a, b) => {
          return (
            new Date(Number(b.published_at) * 1000).getTime() -
            new Date(Number(a.published_at) * 1000).getTime()
          )
        })
        .map((collection, index) => {
          return <Story key={index} collection={collection} />
        })}
      {/* {pinnedToView
        .sort((a, b) => {
          return (
            new Date(Number(b.published_at) * 1000).getTime() -
            new Date(Number(a.published_at) * 1000).getTime()
          )
        })
        .map((collection, index) => {
          return <Story key={index} collection={collection} />
        })}
      {notPinnedToView
        .sort((a, b) => {
          return (
            new Date(Number(b.published_at) * 1000).getTime() -
            new Date(Number(a.published_at) * 1000).getTime()
          )
        })
        .map((collection, index) => {
          return <Story key={index} collection={collection} />
        })} */}
    </div>
  )
}
