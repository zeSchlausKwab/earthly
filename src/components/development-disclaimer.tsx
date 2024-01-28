import { Terminal } from "lucide-react"
import React from "react"
import { Alert, AlertTitle, AlertDescription } from "./ui/alert"

const DevelopmentDisclaimer = ({}) => {
  return (
    <Alert variant="destructive">
      <Terminal className="h-4 w-4" />
      <AlertTitle>Warning!</AlertTitle>
      <AlertDescription>
        This website is in early alpha. The events you create are sent to{" "}
        <b>wss://relay.earthly.land</b> and can be nuked at any time-. If the
        relay is down the relays can be pulled from your metadata and be visible
        to the public. <b>Please do not use this for anything sensitive.</b>{" "}
        <b className={"italic underline"}>
          However feel free to draw something interesting.
        </b>
      </AlertDescription>
    </Alert>
  )
}

export default DevelopmentDisclaimer
