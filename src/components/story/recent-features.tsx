import { useAutoAnimate } from "@formkit/auto-animate/react"
import { useRecentFeaturesStore, type RecentFeature } from "~/store/recent-features-store"
import PlaceFeature from "./place-feature"

export default function RecentFeatures() {
  const { recentFeatures } = useRecentFeaturesStore()

  const [parent] = useAutoAnimate()

  const sortByPublished = (a: RecentFeature, b: RecentFeature): number => {
    return new Date(Number(b.published_at) * 1000).getTime() - new Date(Number(a.published_at) * 1000).getTime()
  }
  return (
    <div className={"flex flex-col gap-2 break-all text-sm"} ref={parent}>
      {recentFeatures.sort(sortByPublished).map((feature) => {
        return <PlaceFeature key={feature.identifier} collection={feature} />
      })}
    </div>
  )
}
