import { type NDKEvent, type NDKKind } from "@nostr-dev-kit/ndk"
import { type LineString, type Point, type Polygon } from "geojson"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import EditingStoryMetaForm from "~/components/edit-story/editing-story-meta-form"
import LineStringDisplay from "~/components/geomety-types/line-string-display"
import PointDisplay from "~/components/geomety-types/point-display"
import PolygonDisplay from "~/components/geomety-types/polygon-display"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { Badge } from "~/components/ui/badge"
import {
  type CustomFeature,
  useEditingCollectionStore,
} from "~/store/edit-collection-store"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStoryFeature({
  feature,
  rootNaddr,
}: {
  feature: CustomFeature
  rootNaddr: string
}) {
  let identifier: string | undefined
  let pubkey: string | undefined

  const geometry = feature.geometry
  const featureProperties = feature.properties

  const { ndk, ndkUser } = useNDKStore()
  const { geometryCollection, setGeometry } = useEditingCollectionStore()

  if (rootNaddr) {
    const decoded = decodeNaddr(rootNaddr)
    identifier = decoded.identifier
    pubkey = decoded.pubkey
  }

  const [approvalEvent, setApprovalEvent] = useState<NDKEvent>()
  const [originalEvent, setOriginalEvent] = useState<NDKEvent>()

  const fetchData = async () => {
    if (!featureProperties.noteId) return
    const approvalEvent = await ndk?.fetchEvent({
      kinds: [4550 as NDKKind],
      "#e": [featureProperties.noteId],
      "#a": [`34550:${pubkey}:${identifier}`],
    })

    const originalEvent = await ndk?.fetchEvent({
      ids: [featureProperties.noteId],
    })

    if (originalEvent) setOriginalEvent(originalEvent)
    if (approvalEvent) setApprovalEvent(approvalEvent)
  }

  useEffect(() => {
    if (ndk && rootNaddr) {
      void fetchData()
    }
  }, [ndk, rootNaddr])

  const handleFeatureMetaChange = (
    featureId: string,
    title: string,
    description: string,
    color: string,
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
              color: color,
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
    <div className="flex flex-col rounded-lg border p-2 text-xs">
      <Accordion type="single" collapsible className={"flex flex-col"}>
        <AccordionItem value="item-1">
          <EditingStoryMetaForm
            title={featureProperties.name}
            description={featureProperties.description}
            color={featureProperties.color}
            approvalEvent={approvalEvent}
            originalEvent={originalEvent}
            identifier={identifier}
            onChange={(title, description) =>
              handleFeatureMetaChange(
                feature.properties.id,
                title,
                description,
                featureProperties.color,
              )
            }
          />
          <AccordionTrigger className={"gap-2"}>
            <Badge className={"w-[20%]"} variant="outline">
              {geometry.type}
            </Badge>
          </AccordionTrigger>
          <AccordionContent>
            {{
              Point: <PointDisplay geometry={geometry as Point} />,
              Polygon: <PolygonDisplay geometry={geometry as Polygon} />,
              LineString: (
                <LineStringDisplay geometry={geometry as LineString} />
              ),
              GeometryCollection: <p>{geometry.type}</p>,
              MultiLineString: <p>{geometry.type}</p>,
              MultiPoint: <p>{geometry.type}</p>,
              MultiPolygon: <p>{geometry.type}</p>,
              default: <p>{geometry.type}</p>,
            }[geometry.type] ?? <p>unknown object...</p>}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
