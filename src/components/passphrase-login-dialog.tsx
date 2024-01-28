import { useState } from "react"
import { Icons } from "~/components/edit-story/editing-story"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { toast } from "~/components/ui/use-toast"
import { useNDKStore } from "~/store/ndk-store"
import { decryptMessage } from "~/utils/crypto"
import { Button } from "./ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"

export default function PassphraseLoginDialog({
  open,
  onRefuse,
  onLogin,
}: {
  open: boolean
  onRefuse: () => void
  onLogin: () => void
}) {
  const [passphrase, setPassphrase] = useState("")
  const [isInitiating, setIsInitiating] = useState(false)

  const { initPrivateKey } = useNDKStore()

  const handlePassphraseSubmit = async () => {
    const storedEncryptedNsec = localStorage.getItem("encryptedNsec")
    const nsec = decryptMessage(
      storedEncryptedNsec!,
      passphrase,
    ) as `nsec1${string}`

    if (!nsec) {
      toast({
        title: "Incorrect passphrase",
        description: "Please try again",
      })
    } else {
      toast({
        title: "Successfully logged in",
        description: "Welcome back!",
      })

      setIsInitiating(true)
      await initPrivateKey(nsec)
      setIsInitiating(false)
      onLogin()
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Authenticate</DialogTitle>
          <DialogDescription>
            You have a private key stored on this site
          </DialogDescription>
        </DialogHeader>
        <div className={"flex flex-row items-center justify-between gap-4"}>
          <Label htmlFor="passphrase" className={"w-24"}>
            Passphrase
          </Label>
          <Input
            id="passphrase"
            className={"w-1/2"}
            type={"password"}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          {isInitiating && <Icons.spinner className="h-6 w-6 animate-spin" />}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button onClick={onRefuse} type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
          <Button onClick={handlePassphraseSubmit} type="submit">
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
