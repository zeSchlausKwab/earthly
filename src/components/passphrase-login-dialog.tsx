import React, { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog"
import { Label } from "~/components/ui/label"
import { Input } from "~/components/ui/input"
import { useNDKStore } from "~/store/ndk-store"
import { decryptMessage } from "~/utils/crypto"
import { nip19 } from "nostr-tools"
import { toast } from "~/components/ui/use-toast"
import { Icons } from "~/components/editing-story"

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
    const nsec = decryptMessage(storedEncryptedNsec!, passphrase)

    if (!nsec) {
      toast({
        title: "Incorrect passphrase",
        description: "Please try again",
      })
    } else {
      const privateKey = nip19.decode(nsec as `nsec1${string}`).data.toString()

      toast({
        title: "Successfully logged in",
        description: "Welcome back!",
      })

      setIsInitiating(true)
      await initPrivateKey(privateKey)
      setIsInitiating(false)
      onLogin()
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            You have a private key stored on this site
          </AlertDialogTitle>
          <AlertDialogDescription className={"flex flex-col gap-4"}>
            Enter the passphrase to decrypt it
            <div className={"flex w-full flex-row items-center gap-4"}>
              <Label htmlFor="passphrase" className={"w-24"}>
                Passphrase
              </Label>
              <Input
                id="passphrase"
                className={"w-40"}
                type={"password"}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              {isInitiating && (
                <Icons.spinner className="h-6 w-6 animate-spin" />
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onRefuse}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handlePassphraseSubmit}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
