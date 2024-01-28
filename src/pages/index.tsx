import { NDKNip07Signer } from "@nostr-dev-kit/ndk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PanelTopClose } from "lucide-react"
import dynamic from "next/dynamic"
import Head from "next/head"
import { useEffect, useState } from "react"
import { useMedia } from "use-media"
import DevelopmentDisclaimer from "~/components/development-disclaimer"
import EditingStory from "~/components/editing-story"
import Header from "~/components/header"
import PassphraseLoginDialog from "~/components/passphrase-login-dialog"
import RecentStories from "~/components/recent-stories"
import { Button } from "~/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet"
import Layout from "~/pages/layout"
import { useNDKStore } from "~/store/ndk-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"

const queryClient = new QueryClient()

const Map = dynamic(() => import("../components/map"), { ssr: false })

export default function Home() {
  const isWide = useMedia({ minWidth: "1024px" })
  const { initAnonymous, ndk, initSigner } = useNDKStore()
  const { init: recentCollectionInit } = useRecentCollectionsStore()

  const [passphraseDialogOpen, setPassphraseDialogOpen] = useState(false)

  useEffect(() => {
    const shouldReconnect = Boolean(localStorage.getItem("shouldReconnect"))
    const storedEncryptedNsec = localStorage.getItem("encryptedNsec")

    if (storedEncryptedNsec) {
      setPassphraseDialogOpen(true)
    }

    const initWithNothing = async () => {
      await initAnonymous()
      await recentCollectionInit()

      if (typeof window.webln !== "undefined") {
        await window.webln.enable()
      } else {
        console.log("webln not found")
      }
    }

    const initWithWigner = async () => {
      const signer = new NDKNip07Signer()
      await initSigner(signer)
      await recentCollectionInit()

      if (typeof window.webln !== "undefined") {
        await window.webln.enable()
      } else {
        console.log("webln not found")
      }
    }

    if (!ndk && shouldReconnect) {
      void initWithWigner()
    } else if (!ndk && !shouldReconnect) {
      void initWithNothing()
    }
  }, [])

  const handleRefusePassphraseLogin = () => {
    localStorage.removeItem("encryptedNsec")
    localStorage.removeItem("shouldReconnect")
    setPassphraseDialogOpen(false)
  }

  const handleRPassphraseLogin = async () => {
    setPassphraseDialogOpen(false)
    if (typeof window.webln !== "undefined") {
      await window.webln.enable()
    } else {
      console.log("webln not found")
    }
    await recentCollectionInit()
  }

  return (
    <>
      <QueryClientProvider client={queryClient}>
        <Head>
          <title>earthly</title>
          <meta name="description" content="A social geojson editor on nostr" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <Layout>
          <main className="flex flex-grow flex-col-reverse lg:flex-row lg:overflow-auto">
            {isWide ? (
              <div className="flex w-2/5 flex-col gap-2 p-4 lg:overflow-y-scroll">
                <DevelopmentDisclaimer />
                <EditingStory />
                <RecentStories />
              </div>
            ) : (
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    className="absolute bottom-0 right-0 z-10 mb-4 mr-4"
                  >
                    <PanelTopClose />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  className="h-4/5 w-full overflow-y-scroll"
                  side={"bottom"}
                >
                  <Header />
                  <DevelopmentDisclaimer />
                  <EditingStory />
                  <RecentStories />
                </SheetContent>
              </Sheet>
            )}
            <div className="w-3/5">
              <Map />
            </div>
            <PassphraseLoginDialog
              open={passphraseDialogOpen}
              onRefuse={() => handleRefusePassphraseLogin()}
              onLogin={() => handleRPassphraseLogin()}
            />
          </main>
        </Layout>
      </QueryClientProvider>
    </>
  )
}
