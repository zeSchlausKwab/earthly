import L from "leaflet"
import { useEffect } from "react"
import { useMap } from "react-leaflet"
import { useZoomUIStore } from "~/store/zoom-ui-store"

export default function MapZoomFeature({}) {
  const { collection } = useZoomUIStore()

  const map = useMap()

  useEffect(() => {
    if (collection) {
      const bounds = L.geoJSON(collection).getBounds()
      console.log(bounds)
      map.fitBounds(bounds, { animate: true })
    }
  }, [collection])

  return null
}
