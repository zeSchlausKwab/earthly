import * as L from "leaflet"
import "leaflet-draw/dist/leaflet.draw.css"
import "leaflet/dist/leaflet.css"

import { useEffect, useRef, useState } from "react"
import { FeatureGroup, GeoJSON, MapContainer, Marker, Popup, TileLayer } from "react-leaflet"

import { v4 as uuidv4 } from "uuid"

import { Feature, FeatureCollection, Geometry, Position } from "geojson"

import Control from "react-leaflet-custom-control"
import { CustomFeatureCollection, FeatureProperties, useEditingCollectionStore } from "~/store/edit-collection-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"

import { LocateFixed } from "lucide-react"
import dynamic from "next/dynamic"
import { Tooltip } from "react-leaflet"
import MarkerClusterGroup from "react-leaflet-cluster"
import { useMapListStore } from "~/store/map-list-store"
import { useRecentFeaturesStore } from "~/store/recent-features-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import { Button } from "../ui/button"
import FeaturePopup from "./feature-popup"
import MapZoomFeature from "./map-zoom-on-feature"
import NewFeatureControl from "./new-feature-control"
import PointPin from "./point-pin"

const MapZoomEdit = dynamic(() => import("./map-zoom-edit"), {
  ssr: false,
})

const MapZoomRecent = dynamic(() => import("./map-zoom-recent"), {
  ssr: false,
})

// TODO: this is a hack to get around bad typing

export type CustomFeatureGeo = Feature<Geometry, FeatureProperties> & {
  geometry: Geometry & {
    coordinates: Position
  }
}

// remove unnecessary attribution flag
function removeAttributionFlag() {
  const svgElement = document.querySelector("svg.leaflet-attribution-flag")
  if (svgElement) {
    svgElement.remove()
  }
}

export default function Map() {
  const { geometryCollection, setGeometry } = useEditingCollectionStore()

  const { recentCollections } = useRecentCollectionsStore()
  const { recentFeatures } = useRecentFeaturesStore()

  const { setLocationFromUser } = useZoomUIStore()
  const { focusedCollection, pinnedCollections, setEditForNew } = useMapListStore()

  const [geojson, setGeojson] = useState<L.FeatureGroup | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<CustomFeatureGeo | undefined>(undefined)

  const ref = useRef<L.FeatureGroup>(null)
  const recentCollectionFG = useRef<L.FeatureGroup>(null)

  useEffect(() => {
    removeAttributionFlag()
  }, [recentFeatures])

  useEffect(() => {
    if (geometryCollection) {
      ref.current?.clearLayers()
      const featureGroup = L.geoJSON(geometryCollection)
      setGeojson(featureGroup)
    }
  }, [geometryCollection])

  useEffect(() => {
    recentCollectionFG.current?.clearLayers()
    if (recentCollections && recentCollectionFG.current) {
      recentCollections.forEach((collection) => {
        L.geoJSON(collection.features, {
          style: (feature) => {
            if (feature) {
              return {
                color: feature.properties.color,
              }
            } else {
              return {
                color: "#000000",
              }
            }
          },
          onEachFeature: (feature, layer) => {
            if (!feature) return
            layer.on("click", () => {
              const targetCollection = recentCollections.find((c) =>
                c.features.some((f) => f.properties.id === feature.properties.id),
              )
              console.log("targetCollection", targetCollection)
            })
          },
        }).addTo(recentCollectionFG.current as L.FeatureGroup)
      })
    }
  }, [recentCollections, pinnedCollections, focusedCollection])

  useEffect(() => {
    if (ref.current?.getLayers().length === 0 && geojson) {
      const geojsonObject = geojson.toGeoJSON()
      L.geoJSON(geojsonObject, {
        style: (feature) => {
          if (!feature) {
            return {
              color: "#000000",
            }
          }
          return {
            color: feature.properties.color,
          }
        },
        onEachFeature: (feature, layer) => {
          if (!feature) return
          layer.on("click", () => {
            // TODO: this is a hack to get around bad typing
            setSelectedFeature(feature as CustomFeatureGeo)
          })
        },
      }).eachLayer((layer) => {
        ref.current?.addLayer(layer)
      })
    }
  }, [geojson])

  const handleFeatureDescriptionChange = (featureId: string, title: string, description: string, color: string) => {
    const newGeometryCollection = {
      ...geometryCollection,
      features: geometryCollection.features.map((feature) => {
        if (feature.properties.id === featureId) {
          return {
            ...feature,
            properties: {
              ...feature.properties,
              color: color,
              name: title,
              description: description,
            },
          }
        } else {
          return feature
        }
      }),
    }
    setGeometry(newGeometryCollection)
  }

  const handleFeatureDelete = (featureId: string) => {
    const newGeometryCollection = {
      ...geometryCollection,
      features: geometryCollection.features.filter((feature) => feature.properties.id !== featureId),
    }
    setGeometry(newGeometryCollection)
  }

  const handleChange = () => {
    const geo = ref.current?.toGeoJSON() as FeatureCollection

    const geoWithProperties = {
      type: "FeatureCollection",
      features: geo?.features.map((feature) => {
        if (!feature.properties) return
        return {
          type: feature.type,
          geometry: feature.geometry,
          properties: {
            id: feature.properties.id ?? uuidv4(),
            color:
              feature.properties.color ??
              "#" +
                Math.floor(Math.random() * 16777215)
                  .toString(16)
                  .padStart(6, "0"),

            name: feature.properties.name ?? `new ${feature.geometry.type}-${Date.now()}`,
            description: feature.properties.description ?? `description for ${feature.geometry.type}-${Date.now()}`,
            isLink: Boolean(feature.properties.isLink) ?? false,
          },
        }
      }),
    }

    setGeometry(geoWithProperties as CustomFeatureCollection)
  }

  return (
    <>
      <MapContainer
        style={{
          height: "100%",
          width: "100%",
          zIndex: 0,
        }}
        center={[47.52220324767006, 9.77477120468771]}
        zoom={8}
      >
        <Control position="bottomleft">
          <Button onClick={setLocationFromUser} variant="outline" className="z-50 mb-2 ml-4">
            <LocateFixed />
          </Button>
        </Control>

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FeatureGroup>
          <MarkerClusterGroup>
            {recentFeatures.map((feature, index) => {
              // TODO: nasty, fix this
              const innerFeatures = feature.features as unknown as CustomFeatureCollection[]
              const innerGeature = innerFeatures[0] as { geometry: { coordinates: [number, number] } } | undefined
              if (!innerGeature) return
              const coords = innerGeature.geometry.coordinates

              if (!coords[0] || !coords[1]) return
              const pointerIcon = L.divIcon({
                iconAnchor: [4, 4],
                iconSize: [8, 8],
              })

              return (
                <Marker key={index} position={{ lat: coords[1], lng: coords[0] }} icon={pointerIcon}>
                  <Tooltip interactive={true} permanent={true} direction="top" className="custom-tooltip">
                    <PointPin feature={feature} />
                  </Tooltip>
                </Marker>
              )
            })}
          </MarkerClusterGroup>
          <GeoJSON data={geometryCollection} />
        </FeatureGroup>
        <FeatureGroup ref={ref}>
          <NewFeatureControl handleChange={handleChange} />
          {selectedFeature && (
            <Popup>
              <FeaturePopup
                key={selectedFeature.properties.id}
                featureId={selectedFeature.properties.id}
                currentDescription={selectedFeature.properties.description}
                currentTitle={selectedFeature.properties.name}
                currentColor={selectedFeature.properties.color}
                onChange={handleFeatureDescriptionChange}
                onDelete={handleFeatureDelete}
              />
            </Popup>
          )}
        </FeatureGroup>
        <FeatureGroup ref={recentCollectionFG}></FeatureGroup>
        {/* <MapZoomRecent recentCollections={recentCollections} /> */}
        {/* <MapZoomLocation /> */}
        <MapZoomFeature />
      </MapContainer>
    </>
  )
}
