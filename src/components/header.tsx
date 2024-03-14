import { zodResolver } from "@hookform/resolvers/zod"
import { NDKNip07Signer } from "@nostr-dev-kit/ndk"
import { ClipboardCopy, Copy, Info, Settings } from "lucide-react"
import Image from "next/image"
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools"
import { ChangeEvent, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import MapSettings from "~/components/map/map-settings"
import { Button } from "~/components/ui/button"

import useMedia from "use-media"
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
import { Separator } from "~/components/ui/separator"
import { useToast } from "~/components/ui/use-toast"
import UserInfo from "~/components/user-info"
import { useNDKStore } from "~/store/ndk-store"
import { encryptMessage } from "~/utils/crypto"
import ProfileMetaForm from "./profile-meta-form"
import SiteInfo from "./site-info"
import ServerUtils from "./server-utils"

const privateKeySchema = z.object({
  nsecOrPrivateKey: z.string().refine(
    (value) => {
      let properNsec = false
      try {
        properNsec = Boolean(nip19.decode(value))
      } catch (err) {
        console.log(err)
      }
      const isPrivateKey = value.length === 64 && !value.startsWith("nsec")
      return properNsec || isPrivateKey
    },
    {
      message: "Invalid nsec or private key string",
    },
  ),
})

export default function Header() {
  const { ndk, initPrivateKey, initSigner, ndkUser, logout } = useNDKStore()

  const isWide = useMedia({ minWidth: "1024px" })

  const { toast } = useToast()

  const [keyPair, setKeyPair] = useState<{
    npub?: `npub1${string}` | undefined
    nsec?: `nsec1${string}` | undefined
  }>({
    npub: undefined,
    nsec: undefined,
  })
  const [passphrase, setPassphrase] = useState<string>("")
  const form = useForm<z.infer<typeof privateKeySchema>>({
    resolver: zodResolver(privateKeySchema),
    defaultValues: {
      nsecOrPrivateKey: "",
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
          npub: user.npub as `npub1${string}`,
          nsec: undefined,
        })

        toast({
          title: "Successfully authenticated with signer",
          description: `You are now authenticated with your signer.`,
        })
      }
    })
  }

  const onGenerateKeyPair = async () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const publicKey = getPublicKey(sk)
    setKeyPair({
      npub: nip19.npubEncode(publicKey),
      nsec: nsec,
    })
    form.setValue("nsecOrPrivateKey", nsec)
    await form.trigger("nsecOrPrivateKey")
  }

  const onPrivateKeyInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const inValue = e.target.value
    form.setValue("nsecOrPrivateKey", inValue)
    const formState = await form.trigger("nsecOrPrivateKey")

    if (formState) {
      if (inValue.startsWith("nsec")) {
        const sk = nip19.decode(inValue)
        console.log(sk)
        setKeyPair({
          npub: nip19.npubEncode(getPublicKey(sk.data as Uint8Array)),
          nsec: inValue as `nsec1${string}`,
        })
      } else {
        const sk = Uint8Array.from(Buffer.from(inValue, "hex"))
        setKeyPair({
          npub: nip19.npubEncode(getPublicKey(sk)),
          nsec: nip19.nsecEncode(sk),
        })
      }
    } else {
      setKeyPair({
        npub: undefined,
        nsec: undefined,
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
    if (keyPair.nsec) {
      await initPrivateKey(keyPair.nsec)
    }
  }

  const handleCopyPrivateKeyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(keyPair.nsec as string)
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
    <header className="flex flex-row items-center justify-between lg:p-4">
      {isWide ? (
        <div className="h-full w-[50px] lg:relative lg:w-[140px]">
          <Image fill src="/logo_text.svg" alt="earthly.land logo" />
        </div>
      ) : (
        <Image src="/logo.svg" alt="earthly.land logo" width={30} height={30} />
      )}
      <ServerUtils />

      <div className="z-50 flex flex-row items-center gap-4 text-xs lg:gap-8">
        <MapSettings />
        <UserInfo onlyImageOnMobile />
        {ndkUser ? (
          <Button size={!isWide ? "xs" : "sm"} onClick={logout}>
            Log Out
          </Button>
        ) : (
          <Popover>
            <PopoverTrigger asChild>
              <Button>Authenticate</Button>
            </PopoverTrigger>
            <PopoverContent className="break-all">
              <div className="flex flex-col gap-4">
                <Button onClick={onAuthenticateWithSigner}>Authenticate with signer</Button>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button className={"flex-grow"} disabled={!Boolean(keyPair.npub)}>
                      Authenticate with private key
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Authenticate with private key</DialogTitle>
                      <DialogDescription>
                        Your nsec will be encrypted with a passphrase and stored in your browser.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-row items-center gap-4">
                        <Label htmlFor="privateKey" className={"w-24"}>
                          Private key
                        </Label>
                        <Input id="privateKey" defaultValue={keyPair.nsec} readOnly />
                        <Button type="submit" size="sm" className="px-3">
                          <span className="sr-only">Copy</span>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-row items-center gap-4">
                        <Label htmlFor="publicKey" className={"w-24"}>
                          Public key
                        </Label>
                        <Input id="publicKey" defaultValue={keyPair.npub} readOnly />
                        <Button type="submit" size="sm" className="px-3">
                          <span className="sr-only">Copy</span>
                          <Copy className="h-4 w-4" />
                        </Button>
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
                      <Button type="button" variant="default" onClick={handlePrivateKeyLogin}>
                        Login
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Separator orientation={"horizontal"} />
                <Button onClick={onGenerateKeyPair}>Generate new private key</Button>
                <div className={"flex flex-row"}>
                  <Form {...form}>
                    <form className="flex-grow">
                      <FormField
                        control={form.control}
                        name="nsecOrPrivateKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Private Key or nsec</FormLabel>
                            <FormControl>
                              <div className={"flex flex-row items-center gap-2"}>
                                <Input placeholder="...private key or nsec" {...field} onChange={onPrivateKeyInput} />
                                <ClipboardCopy onClick={handleCopyPrivateKeyToClipboard} />
                              </div>
                            </FormControl>
                            {form.formState.errors.nsecOrPrivateKey && (
                              <FormMessage>{form.formState.errors.nsecOrPrivateKey.message}</FormMessage>
                            )}
                          </FormItem>
                        )}
                      />
                    </form>
                  </Form>
                </div>
                <div className={"p-2 text-xs"}>{keyPair.nsec ? <p>{keyPair.npub}</p> : <p>No nsec set.</p>}</div>
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Popover>
          <PopoverTrigger>
            <Settings className="h-4 w-4 lg:h-6 lg:w-6" />
          </PopoverTrigger>
          <PopoverContent>
            <ProfileMetaForm />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger>
            <Info className="h-4 w-4 lg:h-6 lg:w-6" />
          </PopoverTrigger>
          <PopoverContent>
            <SiteInfo />
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
