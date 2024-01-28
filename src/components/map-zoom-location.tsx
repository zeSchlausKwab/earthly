import { useMap } from "react-leaflet"

export default function MapZoomLocation({}) {
  const map = useMap()

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude
        const longitude = position.coords.longitude
        console.log(`Latitude: ${latitude}, Longitude: ${longitude}`)

        map.setView([latitude, longitude], 15)
      },
      (error) => {
        console.error("Error occurred while getting location", error)
      },
    )
  } else {
    console.log("Geolocation is not supported by this browser.")
  }
  return null
}
