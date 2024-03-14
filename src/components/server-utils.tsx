import { Button } from "~/components/ui/button"
import { api } from "~/utils/api"

export default function ServerUtils() {
  const utils = api.useUtils()

  const handleSeedEvents = async () => {
    const createUsers = await utils.utils.seedEvents.fetch()
    console.log("seedData", createUsers)
  }

  const handleCreateUsers = async () => {
    const createUsers = await utils.utils.createUsers.fetch()
    console.log("seedData", createUsers)
  }

  const handleNukeRelay = async () => {
    const nukeRelay = await utils.utils.nukeRelay.fetch()
    console.log("nukeRelay", nukeRelay)
  }

  const handleReset = async () => {
    const reset = await utils.utils.reset.fetch()
    console.log("reset", reset)
  }

  return (
    <div className="flex flex-row gap-3">
      <Button onClick={handleSeedEvents} variant="outline" size="sm">
        Seed Data
      </Button>
      <Button onClick={handleCreateUsers} variant="outline" size="sm">
        Seed Users
      </Button>
      <Button onClick={handleNukeRelay} variant="destructive" size="sm">
        Nuke Relay
      </Button>
      <Button onClick={handleReset} variant="destructive" size="sm">
        Reset
      </Button>
    </div>
  )
}
