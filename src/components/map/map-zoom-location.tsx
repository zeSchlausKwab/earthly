import { useEffect } from "react"
import { useMap } from "react-leaflet"
import { useZoomUIStore } from "~/store/zoom-ui-store"

export default function MapZoomLocation({}) {
  const map = useMap()

  const { locationFromUser } = useZoomUIStore()

  useEffect(() => {
    if (locationFromUser) {
      map.setView(locationFromUser, 15)
    }
  }, [locationFromUser])

  // if (navigator.geolocation) {
  //   navigator.geolocation.getCurrentPosition(
  //     (position) => {
  //       const latitude = position.coords.latitude
  //       const longitude = position.coords.longitude

  //       map.setView([latitude, longitude], 15)
  //     },
  //     (error) => {
  //       console.error("Error occurred while getting location", error)
  //     },
  //   )
  // } else {
  //   console.log("Geolocation is not supported by this browser.")
  // }
  // return null
}
