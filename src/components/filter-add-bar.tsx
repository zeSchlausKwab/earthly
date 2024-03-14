import { KeyRound, LandPlot, Plus } from "lucide-react"
import { useMapListStore } from "~/store/map-list-store"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

export default function FilterAddBar({}) {
  const { setEditForNew } = useMapListStore()

  // const handleDisplayItemsChange = (v: ExistingEditModes[]) => {
  //   // setDisplayItems(v)
  // }

  return (
    <div className="flex flex-row items-center justify-between gap-2">
      {/* <ToggleGroup value={displayItems} onValueChange={handleDisplayItemsChange} type="multiple">
        <ToggleGroupItem value="feature">
          <MapPin />
          <div>Places</div>
        </ToggleGroupItem>
        <ToggleGroupItem value="collection">
          <LandPlot />
          <div>Collections</div>
        </ToggleGroupItem>
        <ToggleGroupItem value="mod_collection">
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
          <div>Moderated collections</div>
        </ToggleGroupItem>
      </ToggleGroup> */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex flex-row">
          <Plus />
          add
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <div>add item</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(v) => setEditForNew("feature")}>
            <LandPlot />
            <div>Place</div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(v) => setEditForNew("collection")}>
            <LandPlot />
            <div>Collection</div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(v) => setEditForNew("mod_collection")}>
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
            <div>Moderated collections</div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
