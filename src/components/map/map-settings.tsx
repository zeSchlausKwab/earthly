import { Pause, Play } from "lucide-react"
import { Toggle } from "~/components/ui/toggle"
import { useUserSettingsStore } from "~/store/user-settings"

export default function MapSettings() {
  const { mapFollowRecentEvents, setMapFollowRecentEvents } =
    useUserSettingsStore()

  const handleChange = (e: boolean) => {
    setMapFollowRecentEvents(e)
  }

  return (
    <>
      <Toggle
        variant="default"
        aria-label="Toggle italic"
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
