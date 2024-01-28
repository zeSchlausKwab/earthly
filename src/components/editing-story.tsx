import { useEditingCollectionStore } from "~/store/edit-collection-store"
import { Badge } from "~/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import {
  type GeoJsonGeometryTypes,
  type LineString,
  type Point,
  type Polygon,
} from "geojson"
import LineStringDisplay from "~/components/geomety-types/line-string-display"
import PointDisplay from "~/components/geomety-types/point-display"
import PolygonDisplay from "~/components/geomety-types/polygon-display"
import { Input } from "~/components/ui/input"
import { useNDKStore } from "~/store/ndk-store"
import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"
import * as React from "react"
import { useState } from "react"
import { Loader2 } from "lucide-react"
import EditingStoryForm from "~/components/editing-story-form"
import {
  mapGeometryCollectionFeature,
  runtimeGeometryFeatureToNostr,
} from "~/mapper/geometry-feature"
import {
  mapFeatureEventsToIdentifiers,
  runtimeCollectionToNostr,
} from "~/mapper/collection"
import { v4 as uuidv4 } from "uuid"
import {
  type EditingCollectionFormSchema,
  type UpdateCollectionFormSchema,
} from "~/models/collection"

import { decodeNaddr } from "~/utils/naddr"
import diff from "microdiff"
import { Textarea } from "~/components/ui/textarea"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStory({}) {
  const { geometryCollection, naddr } = useEditingCollectionStore()
  const { ndk, ndkUser } = useNDKStore()

  const [isPersisting, setIsPersisting] = useState<boolean>(false)

  const handlePersistCollection = async (data: EditingCollectionFormSchema) => {
    if (!ndk) return
    setIsPersisting(true)

    const now = Math.floor(Date.now() / 1000)

    const newFeatureEvents = await Promise.all(
      geometryCollection.features.map((feature) => {
        const geometry = feature.geometry as unknown as {
          coordinates: []
          type: GeoJsonGeometryTypes
        }

        // const geohashCenter = geohashFromFeatures(feature)

        return new NDKEvent(
          ndk,
          runtimeGeometryFeatureToNostr({
            kind: 30333 as NDKKind,
            pubkey: ndkUser?.pubkey ?? "",
            content: feature.properties.description,
            created_at: now,
            d: feature.properties.id,
            published_at: now,
            name: feature.properties.name,
            color: feature.properties.color,
            type: geometry.type,
            coordinates: geometry.coordinates,
            // geohash: geohashCenter,
          }),
        )
      }),
    )

    // const motherGeohash = geohashFromFeatures(geometryCollection.features)

    const motherNDKEvent = new NDKEvent(
      ndk,
      runtimeCollectionToNostr({
        kind: NDKKind.Article,
        content: data.storyDescription ?? "",
        created_at: now,
        pubkey: ndkUser?.pubkey ?? "",
        d: uuidv4(),
        title: `${data.storyTitle}`,
        image: `https://source.unsplash.com/random/400x200`, // TODO: implement nip-95
        published_at: now,
        features: [...mapFeatureEventsToIdentifiers(newFeatureEvents)],
        // geohash: motherGeohash,
      }),
    )

    await motherNDKEvent.publish().catch((e) => console.log("e", e))
    await Promise.all(newFeatureEvents.map((event) => event.publish()))
    setIsPersisting(false)
  }

  const handleUpdateCollection = async (data: UpdateCollectionFormSchema) => {
    if (!ndk) return
    setIsPersisting(true)

    const { kind, pubkey, identifier } = decodeNaddr(data.naddr)

    const lastMotherEvent = await ndk?.fetchEvent({
      // TODO: dont understand why kinds: [kind as NDKKind] is not working
      // kinds: [kind as NDKKind],
      authors: [pubkey],
      "#d": [identifier],
    })

    if (!lastMotherEvent) return

    const existingFeatureEvents = await Promise.all(
      lastMotherEvent.getMatchingTags("f").map(async (featureEvent) => {
        if (featureEvent[1]) {
          const {
            kind: featureKind,
            pubkey: featurePubkey,
            identifier: featureIdentifier,
          } = decodeNaddr(featureEvent[1])

          const lastFeatureEvent = await ndk?.fetchEvent({
            kinds: [30333 as NDKKind],
            authors: [pubkey],
            "#d": [featureIdentifier],
          })
          if (!lastFeatureEvent) return
          return mapGeometryCollectionFeature(lastFeatureEvent)
        }
      }),
    )

    const newAndChangedFeatures = geometryCollection.features
      .map((feature) => {
        const existingFeature = existingFeatureEvents.find(
          (existingFeature) => {
            return existingFeature?.properties.id === feature.properties.id
          },
        )

        if (!existingFeature) return feature

        const hasDiff = diff(feature, existingFeature as any).length > 0

        if (hasDiff) {
          return feature
        } else {
          return
        }
      })
      .filter((feature) => feature)

    const now = Math.floor(Date.now() / 1000)

    const deletedFeatureEvents = existingFeatureEvents.filter(
      (existingFeature) => {
        return !geometryCollection.features.find((feature) => {
          return feature.properties.id === existingFeature?.properties.id
        })
      },
    )

    const newFeatureEvents = newAndChangedFeatures.map((feature) => {
      if (!feature) return

      const geometry = feature.geometry as unknown as {
        coordinates: []
        type: GeoJsonGeometryTypes
      }

      // const geohashCenter = geohashFromFeatures(feature)

      return new NDKEvent(
        ndk,
        runtimeGeometryFeatureToNostr({
          kind: 30333 as NDKKind,
          pubkey: pubkey,
          content: feature.properties.description,
          created_at: now,
          d: feature.properties.id,
          published_at: now,
          name: feature.properties.name,
          color: feature.properties.color,
          type: geometry.type,
          coordinates: geometry.coordinates,
          // geohash: geohashCenter,
        }),
      )
    })

    const validFeatureEvents = newFeatureEvents.filter(
      (event): event is NDKEvent => event !== undefined,
    )

    const remainingEventPointers = lastMotherEvent
      .getMatchingTags("f")
      .filter((tag) => {
        if (!tag[1]) return true
        const { identifier } = decodeNaddr(tag[1])
        return !deletedFeatureEvents.find((event) => {
          if (!event) return false
          return event.properties.id === identifier
        })
      })

    const uniqueFeaturePointerList = [
      ...mapFeatureEventsToIdentifiers(validFeatureEvents),
      ...remainingEventPointers,
    ].filter((value, index, self) => {
      return self.map((item) => item[1]).indexOf(value[1]) === index
    })

    // TODO: not sue if these are the current collections
    // const motherGeohash = geohashFromFeatures(
    //   geometryCollection.features.flatMap((feature) => {
    //     const geometry = feature.geometry as unknown as {
    //       coordinates: []
    //       type: GeoJsonGeometryTypes
    //     }
    //     return geometry.coordinates
    //   }),
    // )

    const newMotherNDKEvent = new NDKEvent(
      ndk,
      runtimeCollectionToNostr({
        kind: kind,
        content: data.storyDescription ?? "",
        created_at: now,
        pubkey: pubkey,
        d: lastMotherEvent.tagValue("d") ?? "",
        title: `${data.storyTitle}`,
        image: `https://source.unsplash.com/random/400x200`,
        published_at: parseInt(lastMotherEvent.tagValue("published_at") ?? ""),
        features: uniqueFeaturePointerList,
        // geohash: motherGeohash,
      }),
    )

    await Promise.all(validFeatureEvents.map((event) => event.publish()))
    await newMotherNDKEvent.publish()

    setIsPersisting(false)
  }

  const onDiscard = () => {
    console.log("discard")
  }

  // TODO: implement on change for text fields and do a color picker

  return (
    <div className={"rounded-lg border p-4 text-sm"}>
      <EditingStoryForm
        onSubmit={handlePersistCollection}
        onUpdate={handleUpdateCollection}
        onDiscard={onDiscard}
        naddr={naddr}
      />
      {geometryCollection.features.map((feature, index) => {
        const geometry = feature.geometry
        const featureProperties = feature.properties
        return (
          <Accordion key={index} type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger className={"gap-2"}>
                <p
                  className={"w-[20%] text-sm"}
                  style={{ color: feature.properties.color }}
                >
                  {feature.properties.color}
                </p>
                <p className={""}>
                  <Input value={featureProperties.name} />
                  <Textarea value={featureProperties.description} />
                </p>
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
        )
      })}
      {isPersisting && <Icons.spinner className="h-4 w-4 animate-spin" />}
    </div>
  )
}
