import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useEditingCollectionStore, type CustomFeature } from "~/store/edit-collection-store"

import { zodResolver } from "@hookform/resolvers/zod"
import { NDKEvent } from "@nostr-dev-kit/ndk"
import { useQuery } from "@tanstack/react-query"
import { type Point } from "geojson"
import { useFieldArray, useForm } from "react-hook-form"
import { z } from "zod"
import { featureEventKind } from "~/config/constants"
import { useMapListStore } from "~/store/map-list-store"
import { useNDKStore } from "~/store/ndk-store"
import { decodeNaddr } from "~/utils/naddr"
import PointDisplay from "../geomety-types/point-display"
import { Button } from "../ui/button"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form"
import { Input } from "../ui/input"
import { Textarea } from "../ui/textarea"
import CommonItemBar from "./common-item-bar"
import { type GeoJsonGeometryTypes } from "geojson"

export const Icons = {
  spinner: Loader2,
}

export const singleFeatureFormSchema = z.object({
  name: z.string().min(3, {
    message: "The feature has to have a name.",
  }),
  description: z.string().min(3, {
    message: "Give a short description of your feature.",
  }),
  meta: z.array(z.object({ key: z.string().optional(), value: z.string().optional() })),
})

export default function EditingFeature({}) {
  const { editOrFocus, noFocusNoEdit } = useMapListStore()
  const { ndk, ndkUser } = useNDKStore()
  const { geometryCollection, setGeometry } = useEditingCollectionStore()

  const [feature, setFeature] = useState<CustomFeature>()
  const [event, setEvent] = useState<NDKEvent>()

  const form = useForm<z.infer<typeof singleFeatureFormSchema>>({
    resolver: zodResolver(singleFeatureFormSchema),
    defaultValues: {
      description: "",
      name: "",
      meta: [],
    },
  })

  const array = useFieldArray({
    control: form.control,
    name: "meta",
  })

  useEffect(() => {
    if (!geometryCollection.features[0]) return
    setFeature(geometryCollection.features[0] as CustomFeature)
    form.reset({
      name: (geometryCollection.features[0] as CustomFeature).properties.name ?? "",
      description: (geometryCollection.features[0] as CustomFeature).properties.description ?? "",
      meta: Object.entries((geometryCollection.features[0] as CustomFeature).properties)
        .filter((item) => {
          return item[0] !== "name" && item[0] !== "description"
        })
        .map(([key, value]) => {
          return {
            key: key,
            value: typeof value === "boolean" ? value.toString() : value,
          }
        }),
    })
  }, [geometryCollection])

  const { data, error } = useQuery({
    queryKey: [`${editOrFocus.naddr}`],
    queryFn: async () => {
      if (!editOrFocus.naddr) return
      const { identifier, kind, pubkey } = decodeNaddr(editOrFocus.naddr)

      const event = await ndk?.fetchEvent({
        authors: [pubkey],
        kinds: [kind],
        "#d": [identifier],
      })

      if (!event) return
      setEvent(event)

      const feature = JSON.parse(event.content) as CustomFeature

      form.reset({
        name: feature.properties.name ?? "",
        description: feature.properties.description ?? "",
        meta: Object.entries(feature.properties)
          .filter((item) => {
            return item[0] !== "name" && item[0] !== "description"
          })
          .map(([key, value]) => {
            return {
              key: key,
              value: typeof value === "boolean" ? value.toString() : value,
            }
          }),
        // meta: event
        //   .getMatchingTags("p")
        //   .map((tag) => {
        //     return {
        //       key: tag[0],
        //       value: tag[1],
        //     }
        //   })
        //   .filter((tag): tag is [string, string] => tag !== undefined),
      })

      setFeature(feature)

      if (pubkey === ndkUser?.pubkey) {
        setGeometry({
          type: "FeatureCollection",
          features: [feature],
        })
      }

      return event
    },
    enabled: Boolean(editOrFocus.naddr),
  })

  const handleSubmit = () => {
    const now = Math.floor(Date.now() / 1000)
    if (!feature) return

    const geometry = feature.geometry as unknown as {
      coordinates: []
      type: GeoJsonGeometryTypes
    }

    const eventContent = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geometry.coordinates,
      },
      properties: {
        ...form.getValues().meta.reduce((acc, item) => {
          if (item.key) {
            return {
              ...acc,
              [item.key]: item.value,
            }
          }
          return acc
        }, {}),
        name: form.getValues().name,
        description: form.getValues().description,
      },
    }

    const newFeatureEvent = new NDKEvent(ndk, {
      kind: featureEventKind,
      pubkey: ndkUser?.pubkey ?? "",
      content: JSON.stringify(eventContent),
      created_at: now,
      tags: [
        ["d", feature.properties.id],
        ["image", "https://source.unsplash.com/random/400x200"],
        ["published_at", now.toString()],
        // ["y", "place:feature"],
      ],
    })

    void newFeatureEvent.publish()
    noFocusNoEdit()
  }

  const handleEdit = () => {
    const now = Math.floor(Date.now() / 1000)

    if (!feature) return

    const geometry = feature.geometry as unknown as {
      coordinates: []
      type: GeoJsonGeometryTypes
    }

    const eventContent = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: geometry.coordinates,
      },
      properties: {
        ...form.getValues().meta.reduce((acc, item) => {
          if (item.key) {
            return {
              ...acc,
              [item.key]: item.value,
            }
          }
          return acc
        }, {}),
        name: form.getValues().name,
        description: form.getValues().description,
      },
    }

    const newFeatureEvent = new NDKEvent(ndk, {
      kind: featureEventKind,
      pubkey: ndkUser?.pubkey ?? "",
      content: JSON.stringify(eventContent),
      created_at: now,
      tags: [
        ["d", feature.properties.id],
        ["image", "https://source.unsplash.com/random/400x200"],
        ["published_at", event?.tagValue("published_at") ?? now.toString()],
        // ["y", "place:feature"],
      ],
    })

    void newFeatureEvent.publish()
    noFocusNoEdit()
  }

  return (
    <div className={"flex flex-col gap-4 rounded-lg border p-4"}>
      {editOrFocus.naddr ? (
        <div>
          {editOrFocus.amOwner ? (
            <div className={"flex flex-col gap-4 rounded-lg border p-4"}>
              <CommonItemBar amOwner onDismiss={() => console.log("dismiss not implemented")} onEdit={handleEdit} />
              <Form {...form}>
                <form className="flex flex-grow flex-col gap-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>feature name</FormLabel>
                        <FormControl>
                          <div className={"flex flex-row items-center gap-2"}>
                            <Input {...field} />
                          </div>
                        </FormControl>
                        {form.formState.errors.name && <FormMessage>{form.formState.errors.name.message}</FormMessage>}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>description</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={5} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {array.fields.map((item, index) => {
                    return (
                      <div className="flex flex-row gap-1">
                        <FormField
                          control={form.control}
                          name={`meta.${index}.key`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`meta.${index}.value`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )
                  })}
                </form>
              </Form>
              <Button onClick={() => array.append({ key: "", value: "" })}>add meta</Button>
            </div>
          ) : (
            <div>
              FEATURE DISPLAY
              <div>{data?.content}</div>
            </div>
          )}
        </div>
      ) : (
        <div>
          NEW FEATURE
          <div className={"flex flex-col gap-4 rounded-lg border p-4"}>
            <CommonItemBar
              onEdit={() => console.log("not implemented on edit")}
              onDismiss={() => console.log("not implemented dismiss")}
              onSubmit={handleSubmit}
            />
            <Form {...form}>
              <form className="flex flex-grow flex-col gap-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>feature name</FormLabel>
                      <FormControl>
                        <div className={"flex flex-row items-center gap-2"}>
                          <Input {...field} />
                        </div>
                      </FormControl>
                      {form.formState.errors.name && <FormMessage>{form.formState.errors.name.message}</FormMessage>}
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>description</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={5} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {array.fields.map((item, index) => {
                  return (
                    <div className="flex flex-row gap-1">
                      <FormField
                        control={form.control}
                        name={`meta.${index}.key`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`meta.${index}.value`}
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  )
                })}
              </form>
            </Form>
            <Button onClick={() => array.append({ key: "", value: "" })}>add meta</Button>
          </div>
        </div>
      )}
      {feature && <PointDisplay geometry={feature.geometry as Point} />}
    </div>
  )
}
