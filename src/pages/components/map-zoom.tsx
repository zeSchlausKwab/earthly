import { useEffect } from "react"
import { useMap } from "react-leaflet"
import * as L from "leaflet"
import { type CustomFeatureCollection } from "~/store/edit-collection-store"

export function MapZoom({ geojson }: { geojson: CustomFeatureCollection }) {
  const map = useMap()

  useEffect(() => {
    if (geojson.features.length > 0) {
      const bounds = L.geoJSON(geojson).getBounds()
      map.fitBounds(bounds, { animate: true })
    }
  }, [geojson, map])

  return null
}
