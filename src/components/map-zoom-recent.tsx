import { useEffect } from "react"
import { useMap } from "react-leaflet"
import * as L from "leaflet"
import { type RecentCollection } from "~/store/recent-collections-store"
import { useUserSettingsStore } from "~/store/user-settings"

export default function MapZoomRecent({
  recentCollections,
}: {
  recentCollections: RecentCollection[]
}) {
  const { mapFollowRecentEvents } = useUserSettingsStore()
  const map = useMap()

  useEffect(() => {
    if (recentCollections.length > 0 && mapFollowRecentEvents) {
      const lastCollection = recentCollections[0]
      if (!lastCollection) return
      const bounds = L.geoJSON(lastCollection.features).getBounds()
      map.fitBounds(bounds, { animate: true })
    }
  }, [recentCollections, map])

  return null
}
