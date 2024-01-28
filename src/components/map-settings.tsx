import { useUserSettingsStore } from "~/store/user-settings"
import { Toggle } from "~/components/ui/toggle"
import { Pause, Play } from "lucide-react"

export default function MapSettings() {
  const { mapFollowRecentEvents, setMapFollowRecentEvents } =
    useUserSettingsStore()

  const handleChange = (e: boolean) => {
    setMapFollowRecentEvents(e)
    console.log(e)
  }

  return (
    <>
      <Toggle
        variant="default"
        aria-label="Toggle italic"
        className="w-12"
        onClick={() => handleChange(!mapFollowRecentEvents)}
        value={mapFollowRecentEvents.toString()}
        defaultValue={mapFollowRecentEvents.toString()}
      >
        {mapFollowRecentEvents ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Toggle>
    </>
  )
}
