import * as L from "leaflet"
import "leaflet-draw/dist/leaflet.draw.css"
import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState } from "react"
import { FeatureGroup, MapContainer, Popup, TileLayer } from "react-leaflet"

import { v4 as uuidv4 } from "uuid"

import { Feature, FeatureCollection, Geometry, Position } from "geojson"
import Control from "react-leaflet-custom-control"
import { EditControl } from "react-leaflet-draw"
import {
  CustomFeatureCollection,
  FeatureProperties,
  useEditingCollectionStore,
} from "~/store/edit-collection-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"

import { LocateFixed } from "lucide-react"
import dynamic from "next/dynamic"
import FeaturePopup from "~/components/map/feature-popup"
import { useMapListStore } from "~/store/map-list-store"
import { useZoomUIStore } from "~/store/zoom-ui-store"
import { Button } from "../ui/button"
import MapZoomFeature from "./map-zoom-on-feature"

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
  const { collections } = useRecentCollectionsStore()
  const { setLocationFromUser } = useZoomUIStore()
  const { setHoveredCollection } = useMapListStore()

  const [geojson, setGeojson] = useState<L.FeatureGroup | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<
    CustomFeatureGeo | undefined
  >(undefined)

  const ref = useRef<L.FeatureGroup>(null)
  const recentCollection = useRef<L.FeatureGroup>(null)

  useEffect(() => {
    removeAttributionFlag()
    if (geometryCollection) {
      ref.current?.clearLayers()
      const featureGroup = L.geoJSON(geometryCollection)
      setGeojson(featureGroup)
    }
  }, [geometryCollection])

  useEffect(() => {
    recentCollection.current?.clearLayers()
    if (collections && recentCollection.current) {
      collections.forEach((collection) => {
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
            layer.on("mouseover", () => {
              const targetCollection = collections.find((c) =>
                c.features.features.some(
                  (f) => f.properties.id === feature.properties.id,
                ),
              )
              setHoveredCollection(targetCollection?.identifier ?? null)
            })
            layer.on("mouseout", () => {
              setHoveredCollection(null)
            })
          },
        }).addTo(recentCollection.current as L.FeatureGroup)
      })
    }
  }, [collections])

  const handleFeatureDescriptionChange = (
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
      features: geometryCollection.features.filter(
        (feature) => feature.properties.id !== featureId,
      ),
    }
    setGeometry(newGeometryCollection)
  }

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
        if (
          layer instanceof L.Polyline ||
          layer instanceof L.Polygon ||
          layer instanceof L.Marker
        ) {
          if (layer?.feature?.properties.radius && ref.current) {
            new L.Circle(layer.feature.geometry.coordinates.slice().reverse(), {
              radius: layer.feature?.properties.radius,
            }).addTo(ref.current)
          } else {
            ref.current?.addLayer(layer)
          }
        }
      })
    }
  }, [geojson])

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

            name:
              feature.properties.name ??
              `new ${feature.geometry.type}-${Date.now()}`,
            description:
              feature.properties.description ??
              `description for ${feature.geometry.type}-${Date.now()}`,
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
        center={[48.208, 16.373]}
        zoom={13}
      >
        <Control position="bottomleft">
          <Button
            onClick={setLocationFromUser}
            variant="outline"
            className="z-50 mb-2 ml-4"
          >
            <LocateFixed />
          </Button>
        </Control>

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          opacity={0.8}
        />
        <FeatureGroup ref={ref}>
          <EditControl
            position="topright"
            onEdited={handleChange}
            onCreated={handleChange}
            onDeleted={handleChange}
            draw={{
              rectangle: true,
              circle: true,
              polyline: true,
              polygon: true,
              marker: true,
              circlemarker: true,
            }}
          />
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
        <FeatureGroup ref={recentCollection}></FeatureGroup>
        {/* <MapZoomEdit geojson={geometryCollection} /> */}
        <MapZoomRecent recentCollections={collections} />
        {/* <MapZoomLocation /> */}
        <MapZoomFeature />
      </MapContainer>
    </>
  )
}
