import { type LineString } from "geojson"
import { Badge } from "~/components/ui/badge"

export default function LineStringDisplay({ geometry }: { geometry: LineString }) {
  return (
    <>
      {geometry.coordinates.map((cord, index) => {
        return (
          <Badge key={index} variant="outline">
            lat: {cord[0]} - lon: {cord[1]}
          </Badge>
        )
      })}
    </>
  )
}
