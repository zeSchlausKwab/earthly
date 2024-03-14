import { Terminal, X } from "lucide-react"
import { useState } from "react"
import { useMapListStore } from "~/store/map-list-store"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"

const DevelopmentDisclaimer = ({}) => {
  const [show, setShow] = useState(true)
  const { editOrFocus } = useMapListStore()

  const handleClose = () => {
    setShow(false)
  }

  return (
    <div>
      {show && editOrFocus.naddr && (
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle className="flex flex-row items-center justify-between">
            <div>Warning!</div> <X onClick={handleClose} />
          </AlertTitle>
          <AlertDescription>
            This website is in early alpha. The events you create are sent to <b>wss://relay.earthly.land</b> and can be
            nuked at any time-. If the relay is down the relays can be pulled from your metadata and be visible to the
            public. <b>Please do not use this for anything sensitive.</b>{" "}
            <b className={"italic underline"}>However feel free to draw something interesting.</b>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export default DevelopmentDisclaimer
