import * as React from "react";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { FeatureGroup, MapContainer, Popup, TileLayer } from "react-leaflet";
import * as L from "leaflet";

import { v4 as uuidv4 } from "uuid";

import { EditControl } from "react-leaflet-draw";
import { useEditingCollectionStore } from "~/store/edit-collection-store";
import { FeaturePopup } from "~/pages/components/feature-popup";
import { MapZoom } from "~/pages/components/map-zoom";
import { useRecentCollectionsStore } from "~/store/recent-collections-store";

export default function Map() {
  const { geometryCollection, setGeometry } = useEditingCollectionStore();
  const { collections } = useRecentCollectionsStore();

  const [geojson, setGeojson] = useState<L.FeatureGroup | null>(null);
  const [selectedFeature, setSelectedFeature] = useState(null);

  const ref = useRef<L.FeatureGroup>(null);
  const recentCollection = useRef<L.FeatureGroup>(null);

  useEffect(() => {
    if (geometryCollection) {
      ref.current?.clearLayers();
      setGeojson(geometryCollection);
    }
  }, [geometryCollection]);

  useEffect(() => {
    recentCollection.current?.clearLayers();
    if (collections) {
      collections.forEach((collection) => {
        L.geoJSON(collection.features, {
          style: (feature) => {
            return {
              color: feature.properties.color,
            };
          },
        }).addTo(recentCollection.current);
      });
    }
  }, [collections]);

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
              description: description,
              name: title,
              color: color,
            },
          };
        } else {
          return feature;
        }
      }),
    };
    setGeometry(newGeometryCollection);
  };

  const handleFeatureDelete = (featureId: string) => {
    const newGeometryCollection = {
      ...geometryCollection,
      features: geometryCollection.features.filter(
        (feature) => feature.properties.id !== featureId,
      ),
    };
    setGeometry(newGeometryCollection);
  };

  useEffect(() => {
    if (ref.current?.getLayers().length === 0 && geojson) {
      L.geoJSON(geojson, {
        style: (feature) => {
          return {
            color: feature.properties.color,
          };
        },
        onEachFeature: (feature, layer) => {
          layer.on("click", () => {
            setSelectedFeature(feature);
          });
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
            }).addTo(ref.current);
          } else {
            ref.current?.addLayer(layer);
          }
        }
      });
    }
  }, [geojson]);

  const handleChange = () => {
    console.log("change");
    const geo = ref.current?.toGeoJSON();

    const geoWithProperties = {
      type: "FeatureCollection",
      features: geo?.features.map((feature) => {
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
        };
      }),
    };

    setGeometry(geoWithProperties);
  };

  return (
    <>
      {JSON.stringify(selectedFeature)}
      <MapContainer
        style={{
          height: "100%",
          width: "100%",
          zIndex: 0,
        }}
        center={[29.756433, -95.36403]}
        zoom={13}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png"
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
            <Popup
              position={[
                selectedFeature.geometry.coordinates[1],
                selectedFeature.geometry.coordinates[0],
              ]}
              onClose={() => {
                setSelectedFeature(null);
              }}
            >
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
        <MapZoom geojson={geometryCollection} />
      </MapContainer>
    </>
  );
}
