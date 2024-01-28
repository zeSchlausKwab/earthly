import {
  CustomFeature,
  useEditingCollectionStore,
} from "~/store/edit-collection-store"
import { Badge } from "~/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { type LineString, type Point, type Polygon } from "geojson"
import LineStringDisplay from "~/components/geomety-types/line-string-display"
import PointDisplay from "~/components/geomety-types/point-display"
import PolygonDisplay from "~/components/geomety-types/polygon-display"
import * as React from "react"
import { Loader2 } from "lucide-react"
import EditingStoryMetaForm from "~/components/editing-story-meta-form"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStoryFeature({
  feature,
}: {
  feature: CustomFeature
}) {
  const geometry = feature.geometry
  const featureProperties = feature.properties

  const { geometryCollection, setGeometry } = useEditingCollectionStore()

  const handleFeatureMetaChange = (
    featureId: string,
    title: string,
    description: string,
  ) => {
    const newGeometryCollection = {
      ...geometryCollection,
      features: geometryCollection.features.map((feature) => {
        if (feature.properties.id === featureId) {
          return {
            ...feature,
            properties: {
              ...feature.properties,
              description: description,
              name: title,
            },
          }
        } else {
          return feature
        }
      }),
    }
    setGeometry(newGeometryCollection)
  }

  return (
    <Accordion type="single" collapsible className={"flex flex-col"}>
      <AccordionItem value="item-1">
        <AccordionTrigger className={"gap-2"}>
          <p
            className={"w-[20%] text-sm"}
            style={{ color: feature.properties.color }}
          >
            {feature.properties.color}
          </p>
          <EditingStoryMetaForm
            title={featureProperties.name}
            description={featureProperties.description}
            onChange={(title, description) =>
              handleFeatureMetaChange(
                feature.properties.id as string,
                title,
                description,
              )
            }
          />
          <Badge className={"w-[20%]"} variant="outline">
            {geometry.type}
          </Badge>
        </AccordionTrigger>
        <AccordionContent>
          {{
            Point: <PointDisplay geometry={geometry as Point} />,
            Polygon: <PolygonDisplay geometry={geometry as Polygon} />,
            LineString: <LineStringDisplay geometry={geometry as LineString} />,
            GeometryCollection: <p>{geometry.type}</p>,
            MultiLineString: <p>{geometry.type}</p>,
            MultiPoint: <p>{geometry.type}</p>,
            MultiPolygon: <p>{geometry.type}</p>,
            default: <p>{geometry.type}</p>,
          }[geometry.type] ?? <p>unknown object...</p>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
