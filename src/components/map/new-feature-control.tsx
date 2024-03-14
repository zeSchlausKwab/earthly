import { KeyRound, LandPlot, MapPin } from "lucide-react"
import Control from "react-leaflet-custom-control"
import { EditControl } from "react-leaflet-draw"
import { useMapListStore } from "~/store/map-list-store"
import { Button } from "../ui/button"
import L from "leaflet"

export default function NewFeatureControl({
  handleChange,
}: {
  handleChange: () => void
}) {
  const { setEditForNew, editOrFocus } = useMapListStore()

  const pointerIcon = new L.DivIcon({
    iconAnchor: [4, 4],
    iconSize: [8, 8],
  })

  // TODO: fix markers, figure out custom icons
  return (
    <div>
      <Control position="topright">
        {
          {
            feature: (
              <EditControl
                position="topright"
                onEdited={handleChange}
                onCreated={handleChange}
                onDeleted={handleChange}
                draw={{
                  rectangle: false,
                  polyline: false,
                  polygon: false,
                  marker: {
                    icon: new L.DivIcon({
                      iconAnchor: [4, 4],
                      iconSize: [8, 8],
                    }),
                  },
                  circlemarker: false,
                  circle: false,
                }}
              />
            ),
            collection: (
              <EditControl
                position="topright"
                onEdited={handleChange}
                onCreated={handleChange}
                onDeleted={handleChange}
                draw={{
                  rectangle: false,
                  polyline: true,
                  polygon: true,
                  marker: true,
                  circlemarker: false,
                  circle: false,
                }}
              />
            ),
            mod_collection: (
              <EditControl
                position="topright"
                onEdited={handleChange}
                onCreated={handleChange}
                onDeleted={handleChange}
                draw={{
                  rectangle: false,
                  polyline: true,
                  polygon: true,
                  marker: true,
                  circlemarker: false,
                  circle: false,
                }}
              />
            ),
            none: (
              <div className="z-50 mr-4 mt-2 flex flex-col">
                <Button
                  onClick={() => {
                    setEditForNew("feature")
                  }}
                  variant="outline"
                >
                  <MapPin />
                </Button>
                <Button
                  onClick={() => {
                    setEditForNew("collection")
                  }}
                  variant="outline"
                >
                  <LandPlot />
                </Button>
                <Button
                  onClick={() => {
                    setEditForNew("mod_collection")
                  }}
                  variant="outline"
                >
                  <div style={{ position: "relative" }}>
                    <LandPlot />
                    <KeyRound
                      className="h-3 w-3"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: -3,
                        fontSize: "0.8em",
                      }}
                    />
                  </div>
                </Button>
              </div>
            ),
          }[editOrFocus.mode]
        }
      </Control>
    </div>
  )
}
