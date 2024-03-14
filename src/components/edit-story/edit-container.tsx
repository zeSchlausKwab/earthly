import { useEffect, useState } from "react"
import { useMapListStore } from "~/store/map-list-store"
import FeaturesContext from "../story/feature-context"
import { Button } from "../ui/button"
import EditingFeature from "./editing-feature"
import EditingStory from "./editing-story"

export default function InDetailContainer() {
  const { editOrFocus, noFocusNoEdit } = useMapListStore()
  const [naddr, setNaddr] = useState<`naddr${string}`>()

  useEffect(() => {
    setNaddr(editOrFocus.naddr)
  }, [editOrFocus.naddr])

  return (
    <div className="flex flex-col gap-4">
      {editOrFocus.mode !== "none" || editOrFocus.naddr ? (
        <Button onClick={() => noFocusNoEdit()} variant={"destructive"}>
          dismiss
        </Button>
      ) : null}

      {
        {
          feature: <EditingFeature />,
          collection: <EditingStory />,
          mod_collection: <EditingStory />,
          none: null,
        }[editOrFocus.mode]
      }
      {naddr ? <FeaturesContext naddr={naddr} /> : null}
    </div>
  )
}
