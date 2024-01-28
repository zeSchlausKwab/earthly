import { type Point } from "geojson"
import { Badge } from "~/components/ui/badge"

export default function PointDisplay({ geometry }: { geometry: Point }) {
  return (
    <Badge variant="outline">
      lat: {geometry.coordinates[0]} - lon: {geometry.coordinates[1]}
    </Badge>
  )
}
