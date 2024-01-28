import { type Polygon } from "geojson"
import { Badge } from "~/components/ui/badge"

export default function PolygonDisplay({ geometry }: { geometry: Polygon }) {
  return (
    <p>
      {geometry.coordinates[0]?.map((cord, index) => {
        return (
          <Badge key={index} variant="outline">
            lat: {cord[0]} - lon: {cord[1]}
          </Badge>
        )
      })}
    </p>
  )
}
