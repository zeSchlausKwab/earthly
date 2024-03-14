import { useAutoAnimate } from "@formkit/auto-animate/react"
import { NDKNip07Signer } from "@nostr-dev-kit/ndk"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PanelTopClose } from "lucide-react"
import dynamic from "next/dynamic"
import Head from "next/head"
import { useEffect, useState } from "react"
import { useMedia } from "use-media"
import DevelopmentDisclaimer from "~/components/development-disclaimer"
import InDetailContainer from "~/components/edit-story/edit-container"
import EditingStory from "~/components/edit-story/editing-story"
import Header from "~/components/header"
import PassphraseLoginDialog from "~/components/passphrase-login-dialog"
import RecentItemsLists from "~/components/story/recent-items-list"
import RecentStoriesMobile from "~/components/story/recent-stories-mobile"
import { Button } from "~/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "~/components/ui/sheet"
import Layout from "~/pages/layout"
import { useMapListStore } from "~/store/map-list-store"
import { useNDKStore } from "~/store/ndk-store"
import { useRecentCollectionsStore } from "~/store/recent-collections-store"
import { useRecentFeaturesStore } from "~/store/recent-features-store"

const queryClient = new QueryClient()

const Map = dynamic(() => import("../components/map/map"), { ssr: false })

export default function Home() {
  const isWide = useMedia({ minWidth: "1024px" })
  const [parent] = useAutoAnimate()

  const { initAnonymous, ndk, initSigner } = useNDKStore()
  const { initRecentCollections } = useRecentCollectionsStore()
  const { initRecentFeatures } = useRecentFeaturesStore()
  const { editOrFocus } = useMapListStore()

  const [passphraseDialogOpen, setPassphraseDialogOpen] = useState(false)

  const initWithNothing = async () => {
    await initAnonymous()
    await initRecentCollections()
    await initRecentFeatures()

    if (typeof window.webln !== "undefined") {
      await window.webln.enable()
    } else {
      console.log("webln not found")
    }
  }

  const initWithSigner = async () => {
    const signer = new NDKNip07Signer()
    await initSigner(signer)
    await initRecentCollections()
    await initRecentFeatures()

    if (typeof window.webln !== "undefined") {
      await window.webln.enable()
    } else {
      console.log("webln not found")
    }
  }

  useEffect(() => {
    const shouldReconnect = Boolean(localStorage.getItem("shouldReconnect"))
    const storedEncryptedNsec = localStorage.getItem("encryptedNsec")

    if (storedEncryptedNsec) {
      setPassphraseDialogOpen(true)
    }

    if (!ndk && shouldReconnect) {
      void initWithSigner()
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
    await initRecentCollections()
    await initRecentFeatures()
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
          {isWide ? (
            <main ref={parent} className="flex h-full flex-row overflow-auto">
              <div className="flex w-1/4 flex-col gap-4 overflow-y-scroll p-4">
                <DevelopmentDisclaimer />
                {/* <FilterAddBar /> */}
                <RecentItemsLists />
              </div>
              <div className="flex-grow p-2">
                <Map />
              </div>
              {editOrFocus.mode !== "none" || editOrFocus.naddr ? (
                <div className="w-1/4 overflow-y-scroll p-2">
                  <InDetailContainer />
                </div>
              ) : null}
            </main>
          ) : (
            <main className="flex flex-grow flex-col-reverse">
              <Map />
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="absolute bottom-0 right-0 z-10 mb-4 mr-4">
                    <PanelTopClose />
                  </Button>
                </SheetTrigger>
                <SheetContent className="h-1/2 w-full overflow-y-scroll" side={"bottom"}>
                  <Header />
                  <DevelopmentDisclaimer />
                  <EditingStory />
                  <RecentStoriesMobile />
                </SheetContent>
              </Sheet>
            </main>
          )}
          <PassphraseLoginDialog
            open={passphraseDialogOpen}
            onRefuse={() => handleRefusePassphraseLogin()}
            onLogin={() => handleRPassphraseLogin()}
          />
        </Layout>
      </QueryClientProvider>
    </>
  )
}
