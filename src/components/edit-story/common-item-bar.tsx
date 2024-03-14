import { Loader2, Send } from "lucide-react"
import { Button } from "../ui/button"

export const Icons = {
  spinner: Loader2,
}

export default function CommonItemBar({
  amOwner,
  onDismiss,
  onSubmit,
  onEdit,
}: {
  amOwner?: boolean
  onDismiss: () => void
  onSubmit?: () => void
  onEdit?: () => void
}) {
  return (
    <div className="flex flex-row justify-between">
      {amOwner ? (
        <Button size={"xs"} onClick={onEdit}>
          <Send className="mr-2 h-4 w-4" />
          Updade
        </Button>
      ) : (
        <Button size={"xs"} onClick={onSubmit}>
          <Send className="mr-2 h-4 w-4" />
          Submit
        </Button>
      )}

      <Button variant="destructive" size={"xs"} onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  )
}
