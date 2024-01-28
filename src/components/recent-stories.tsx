import { useRecentCollectionsStore } from "~/store/recent-collections-store"
import Story from "./story"

export default function RecentStories() {
  const { collections } = useRecentCollectionsStore()

  return (
    <div
      className={"grid grid-cols-2 gap-2 break-all text-sm lg:flex lg:flex-col"}
    >
      {collections.map((collection, index) => {
        return <Story key={index} collection={collection} />
      })}
    </div>
  )
}
