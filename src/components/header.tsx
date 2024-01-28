import { Button } from "~/components/ui/button"
import React, { ChangeEvent, useState } from "react"
import { NDKNip07Signer } from "@nostr-dev-kit/ndk"
import { useNDKStore } from "~/store/ndk-store"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover"
import { Input } from "~/components/ui/input"
import { generatePrivateKey, getPublicKey, nip19 } from "nostr-tools"
import { Separator } from "~/components/ui/separator"
import { ClipboardCopy, Copy } from "lucide-react"
import { useToast } from "~/components/ui/use-toast"
import { z } from "zod"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import UserInfo from "~/components/user-info"
import MapSettings from "~/components/map-settings"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog"
import { Label } from "~/components/ui/label"
import { encryptMessage } from "~/utils/crypto"

const privateKeySchema = z.object({
  privateKey: z
    .string()
    .min(64, "Private key should be at least 64 characters long"),
})

export default function Header() {
  const { ndk, initPrivateKey, initSigner, ndkUser, logout } = useNDKStore()

  const { toast } = useToast()

  const [keyPair, setKeyPair] = useState<{
    publicKey: string
    privateKey: string
    npub?: string
    nsec?: string
  }>({
    publicKey: "",
    privateKey: "",
    npub: "",
    nsec: "",
  })
  const [passphrase, setPassphrase] = useState<string>("")
  const form = useForm<z.infer<typeof privateKeySchema>>({
    resolver: zodResolver(privateKeySchema),
    defaultValues: {
      privateKey: "",
    },
  })
  const onAuthenticateWithSigner = async () => {
    const nip07signer = new NDKNip07Signer()
    await initSigner(nip07signer)

    await nip07signer.user().then(async (user) => {
      if (!!user.npub && ndk) {
        const test = ndk.getUser({
          npub: user.npub,
        })

        setKeyPair({
          publicKey: user.pubkey,
          privateKey: "",
          npub: user.npub,
          nsec: "",
        })

        toast({
          title: "Successfully authenticated with signer",
          description: `You are now authenticated with your signer.`,
        })
      }
    })
  }

  const onGenerateKeyPair = async () => {
    const generatedPrivateKey = generatePrivateKey()
    const publicKey = getPublicKey(generatedPrivateKey)
    setKeyPair({
      publicKey,
      privateKey: generatedPrivateKey,
      npub: nip19.npubEncode(publicKey),
      nsec: nip19.nsecEncode(generatedPrivateKey),
    })
    form.setValue("privateKey", generatedPrivateKey)
    await form.trigger("privateKey")
  }

  const onPrivateKeyInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const privateKey = e.target.value
    form.setValue("privateKey", privateKey)
    const formState = await form.trigger("privateKey")

    if (formState) {
      const publicKey = getPublicKey(privateKey)
      setKeyPair({
        publicKey: publicKey,
        privateKey: privateKey,
        npub: nip19.npubEncode(publicKey),
        nsec: nip19.nsecEncode(privateKey),
      })
    } else {
      setKeyPair({
        publicKey: "",
        privateKey: "",
        npub: "",
        nsec: "",
      })
    }
  }

  const handlePrivateKeyLogin = async () => {
    const encryptedNsec = encryptMessage(keyPair.nsec ?? "", passphrase)
    if (!encryptedNsec) {
      toast({
        title: "Failed to encrypt private key",
        description: "Please try again.",
      })
      return
    }
    localStorage.setItem("encryptedNsec", encryptedNsec)
    await initPrivateKey(keyPair.privateKey)
  }

  const handleCopyPrivateKeyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(keyPair.privateKey)
      toast({
        title: "Private key copied to clipboard",
        description: "Preserve this key in a safe place.",
      })
    } catch (err) {
      toast({
        title: "Failed to copy text",
        description: "Error: " + JSON.stringify(err),
      })
    }
  }

  return (
    <header className="flex flex-none flex-row items-center justify-between p-4">
      <h1 className="text-2xl font-bold">earthly</h1>
      <div className="z-50 flex flex-row gap-8 text-xs">
        <MapSettings />
        <UserInfo />
        {ndkUser ? (
          <Button onClick={logout}>Log Out</Button>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button>Authenticate</Button>
            </PopoverTrigger>
            <PopoverContent className="break-all">
              <div className="flex flex-col gap-4">
                <Button onClick={onAuthenticateWithSigner}>
                  Authenticate with signer
                </Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      className={"flex-grow"}
                      disabled={!Boolean(keyPair.privateKey)}
                    >
                      Authenticate with private key
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Authenticate with private key</DialogTitle>
                      <DialogDescription>
                        Your nsec will be encrypted with a passphrase and stored
                        in your browser.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-row items-center gap-4">
                        <Label htmlFor="privateKey" className={"w-24"}>
                          Private key
                        </Label>
                        <Input
                          id="privateKey"
                          defaultValue={keyPair.privateKey}
                          readOnly
                        />
                        <Button type="submit" size="sm" className="px-3">
                          <span className="sr-only">Copy</span>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className={"text-xs text-gray-600"}>
                        {keyPair.nsec}
                      </div>
                      <div className="flex flex-row items-center gap-4">
                        <Label htmlFor="publicKey" className={"w-24"}>
                          Public key
                        </Label>
                        <Input
                          id="publicKey"
                          defaultValue={keyPair.publicKey}
                          readOnly
                        />
                        <Button type="submit" size="sm" className="px-3">
                          <span className="sr-only">Copy</span>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className={"text-xs text-gray-600"}>
                        {keyPair.npub}
                      </div>
                      <Separator orientation={"horizontal"} />
                      <div className="flex flex-row items-center gap-4">
                        <Label htmlFor="passphrase" className={"w-24"}>
                          Passphrase
                        </Label>
                        <Input
                          id="passphrase"
                          className={"w-40"}
                          type={"password"}
                          onChange={(e) => setPassphrase(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter className="sm:justify-between">
                      <DialogClose asChild>
                        <Button type="button" variant="secondary">
                          Close
                        </Button>
                      </DialogClose>
                      <Button
                        type="button"
                        variant="default"
                        onClick={handlePrivateKeyLogin}
                      >
                        Login
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Separator orientation={"horizontal"} />
                <Button onClick={onGenerateKeyPair}>
                  Generate new private key
                </Button>
                <div className={"flex flex-row"}>
                  <Form {...form}>
                    <form className="flex-grow">
                      <FormField
                        control={form.control}
                        name="privateKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Private Key</FormLabel>
                            <FormControl>
                              <div
                                className={"flex flex-row items-center gap-2"}
                              >
                                <Input
                                  placeholder="...private key"
                                  {...field}
                                  onChange={onPrivateKeyInput}
                                />
                                <ClipboardCopy
                                  onClick={handleCopyPrivateKeyToClipboard}
                                />
                              </div>
                            </FormControl>
                            {form.formState.errors.privateKey && (
                              <FormMessage>
                                {form.formState.errors.privateKey.message}
                              </FormMessage>
                            )}
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </div>
                <div className={"p-2 text-xs"}>
                  {keyPair.publicKey ? (
                    <p>{keyPair.publicKey}</p>
                  ) : (
                    <p>No private key set.</p>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </header>
  )
}
