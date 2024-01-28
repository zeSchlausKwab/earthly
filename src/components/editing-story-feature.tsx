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
import {
  type GeoJsonGeometryTypes,
  type LineString,
  type Point,
  type Polygon,
} from "geojson"
import LineStringDisplay from "~/components/geomety-types/line-string-display"
import PointDisplay from "~/components/geomety-types/point-display"
import PolygonDisplay from "~/components/geomety-types/polygon-display"
import { useNDKStore } from "~/store/ndk-store"
import { NDKEvent, NDKKind } from "@nostr-dev-kit/ndk"
import * as React from "react"
import { useEffect, useState } from "react"
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
import EditingStoryMetaForm from "~/components/editing-story-meta-form"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { Label } from "~/components/ui/label"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStory({}) {
  const { geometryCollection, naddr, setGeometry, setGeometryFromNostr } =
    useEditingCollectionStore()
  const { ndk, ndkUser } = useNDKStore()

  const [iAmOwner, setIAmOwner] = useState<boolean>(false)
  const [showUnapprovedFeatures, setShowUnapprovedFeatures] =
    useState<boolean>(true)
  const [approvalEvents, setApprovalEvents] = useState<NDKEvent[]>([])
  const [isPersisting, setIsPersisting] = useState<boolean>(false)
  const [collectionMeta, setCollectionMeta] = useState<{
    title: string
    description: string
    image: string
  }>()

  useEffect(() => {
    const doApprovedFeatures = async () => {
      if (!naddr) return
      const { kind, pubkey, identifier } = decodeNaddr(naddr)
      const approvalEvents = await ndk?.fetchEvents({
        kinds: [4550 as NDKKind],
        "#a": [`34550:${pubkey}:${identifier}`],
      })
      console.log("approvalEvents", approvalEvents)
      if (!approvalEvents) return
      setApprovalEvents(Array.from(approvalEvents))
    }
    void doApprovedFeatures()
  }, [iAmOwner])

  useEffect(() => {}, [showUnapprovedFeatures])

  useEffect(() => {
    if (!naddr) {
      setIAmOwner(true)
      return
    }
    const naddrData = decodeNaddr(naddr)
    setIAmOwner(ndkUser?.pubkey === naddrData.pubkey)
    ndk
      ?.fetchEvent({
        kinds: [naddrData.kind as NDKKind],
        authors: [naddrData.pubkey],
        "#d": [naddrData.identifier],
      })
      .then((event) => {
        if (!event) return
        setCollectionMeta({
          title: event.tagValue("title") ?? "",
          description: event.content,
          image: event.tagValue("image") ?? "",
        })
      })
  }, [naddr])

  const handlePersistCollection = async (data: EditingCollectionFormSchema) => {
    if (!ndk) return
    setIsPersisting(true)

    const now = Math.floor(Date.now() / 1000)
    const motherEventId = uuidv4()

    const motherNDKEvent = new NDKEvent(
      ndk,
      runtimeCollectionToNostr({
        kind: 34550 as NDKKind,
        pubkey: ndkUser?.pubkey ?? "",
        content: data.storyDescription ?? "",
        created_at: now,
        identifier: motherEventId,
        title: data.storyTitle ?? "",
        description: data.storyDescription ?? "",
        image: `https://source.unsplash.com/random/400x200`, // TODO: implement nip-95
        published_at: now,
        authorRelay: "wss;//relay.earthly.land",
        requestsRelay: "wss://relay.earthly.land",
        approvalsRelay: "wss://relay.earthly.land",
        moderatorPubKeys: [ndkUser?.pubkey ?? ""],
      }),
    )

    const newFeatureEvents = await Promise.all(
      geometryCollection.features.map((feature) => {
        const geometry = feature.geometry as unknown as {
          coordinates: []
          type: GeoJsonGeometryTypes
        }

        return new NDKEvent(
          ndk,
          runtimeGeometryFeatureToNostr({
            kind: 30333 as NDKKind,
            pubkey: ndkUser?.pubkey ?? "",
            content: feature.properties.description,
            created_at: now,
            d: feature.properties.id,
            communityEventAuthorPubkey: ndkUser?.pubkey ?? "",
            motherEventIdentifier: motherEventId,
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

    const newFeatureApprovals = await Promise.all(
      newFeatureEvents.map(async (event) => {
        const originalEvent = await event.toNostrEvent()
        const approvalEvent = new NDKEvent(ndk, {
          kind: 4550 as NDKKind,
          pubkey: ndkUser?.pubkey ?? "",
          content: JSON.stringify(originalEvent),
          created_at: now,
          tags: [
            [
              "a",
              `34550:${ndkUser?.pubkey}:${motherNDKEvent.tagValue("d")}`,
              "wss://relay.earthly.land",
            ],
            ["e", event.id, "wss://relay.earthly.land"],
            ["p", `${ndkUser?.pubkey}`, "wss://relay.earthly.land"],
            ["k", "30333"],
          ],
        })
        return approvalEvent
      }),
    )

    await motherNDKEvent.publish()
    await Promise.all(newFeatureEvents.map((event) => event.publish()))
    await Promise.all(newFeatureApprovals.map((event) => event.publish()))
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

    // await Promise.all(validFeatureEvents.map((event) => event.publish()))
    // await newMotherNDKEvent.publish()

    setIsPersisting(false)
  }

  const handleSubmitNewFeature = () => {
    console.log("submit new feature")
  }

  const handleSubmitGeometryChanges = async () => {
    if (!ndk || !naddr) return
    setIsPersisting(true)

    const { kind, pubkey, identifier } = decodeNaddr(naddr)

    console.log("kind", kind)
    console.log("pubkey", pubkey)
    console.log("identifier", identifier)

    console.log("ndk", ndk)

    const lastMotherEvent = await ndk?.fetchEvent({
      kinds: [kind as NDKKind],
      // authors: [pubkey],
      "#d": [identifier],
    })

    console.log("lastMotherEvent", lastMotherEvent)

    if (!lastMotherEvent) return

    const existingFeatureEvents = await ndk.fetchEvents({
      kinds: [4550 as NDKKind],
      authors: [
        ...lastMotherEvent
          .getMatchingTags("p")
          .map((tag) => tag[1])
          .filter((author): author is string => author !== undefined),
      ],
      "#a": [
        `34550:${lastMotherEvent.pubkey}:${lastMotherEvent.tagValue("d")}`,
      ],
    })

    console.log("existingFeatureEvents", existingFeatureEvents)

    const arrExistingFeatureEvents = await Promise.all(
      Array.from(existingFeatureEvents).map(async (ev) => {
        const resolvedGeometryEvent = await ndk.fetchEvent({
          ids: [ev.tagValue("e") ?? ""],
        })
        return mapGeometryCollectionFeature(resolvedGeometryEvent)
      }),
    )

    const newAndChangedFeatures = geometryCollection.features
      .map((feature) => {
        const existingFeature = arrExistingFeatureEvents.find(
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
      .filter((e) => e !== undefined) as CustomFeature[]

    const now = Math.floor(Date.now() / 1000)

    const newAndChangedEvents = newAndChangedFeatures.map((feature) => {
      const geometry = feature.geometry as unknown as {
        coordinates: []
        type: GeoJsonGeometryTypes
      }

      return new NDKEvent(
        ndk,
        runtimeGeometryFeatureToNostr({
          kind: 30333 as NDKKind,
          pubkey: ndkUser?.pubkey ?? "",
          content: feature.properties.description,
          created_at: now,
          d: feature.properties.id,
          communityEventAuthorPubkey: lastMotherEvent.pubkey ?? "",
          motherEventIdentifier: lastMotherEvent.tagValue("d") ?? "",
          published_at: now,
          name: feature.properties.name,
          color: feature.properties.color,
          type: geometry.type,
          coordinates: geometry.coordinates,
        }),
      )
    })

    console.log("newAndChangedEvents", newAndChangedEvents)

    await Promise.all(newAndChangedEvents.map((event) => event.publish()))
    setIsPersisting(false)
  }

  const onDiscard = () => {
    console.log("discard")
  }

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
    <div className={"flex flex-row rounded-lg border p-4 lg:flex-col"}>
      <div className="flex items-center space-x-2">
        <Switch
          id="show-unapproved-features"
          defaultChecked={true}
          onCheckedChange={(checked) => setShowUnapprovedFeatures(checked)}
        />
        <Label htmlFor="show-unapproved-features">
          Show unapproved features
        </Label>
      </div>
      {iAmOwner ? (
        <EditingStoryForm
          onSubmit={handlePersistCollection}
          onUpdateCollectionData={handleUpdateCollection}
          onDiscard={onDiscard}
          naddr={naddr}
        />
      ) : (
        <div className={"flex flex-col gap-2"}>
          <b>{collectionMeta?.title}</b>
          <div>{collectionMeta?.description}</div>
        </div>
      )}

      <div className={"flex flex-col"}>
        {geometryCollection.features.map((feature, index) => {
          const geometry = feature.geometry
          const featureProperties = feature.properties
          return (
            <Accordion
              key={index}
              type="single"
              collapsible
              className={"flex flex-col"}
            >
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
      </div>
      {naddr && (
        <Button onClick={handleSubmitGeometryChanges}>Submit changes</Button>
      )}
      {isPersisting && <Icons.spinner className="h-4 w-4 animate-spin" />}
    </div>
  )
}
